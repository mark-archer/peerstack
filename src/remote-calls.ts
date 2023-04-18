import * as _ from "lodash";
import { fromJSON, isid, newid,  } from "./common";
import { connections } from "./connections";
import { getDB, IData } from "./db";
import { keysEqual, IUser, openMessage, signMessage, verifySignedObject } from "./user";

export type txfn = <T>(data: (string | IRemoteData)) => Promise<T | void> | void

export interface IConnection {
  id: string
  remoteDeviceId: string
  lastAck: number //time
  handlers: { [key: string]: ((err: any, result: any) => void) }
  send: txfn
  close: () => void
  closed?: true
  me?: IUser
  remoteUser?: IUser
  remoteUserVerified?: boolean
  groups?: string[]
  pingMS?: number
}

export interface IRemoteData {
  type: 'call' | 'response' | 'chunk'
  id: string
}

export interface IRemoteCall extends IRemoteData {
  type: 'call'
  fnName: string
  args: any[]
}

export interface IRemoteResponse extends IRemoteData {
  type: 'response'
  result?: any
  error?: any
}

export interface IRemoteChunk extends IRemoteData {
  type: 'chunk',
  iChunk: number,
  totalChunks: number
  chunk: string,
}

export const eventHandlers = {
  onRemoteDataSaved: (data: IData) => {
    // placeholder
  },
}

export async function ping(...args) {
  return ['pong', ...args];
}

export async function testError(msg: string) {
  throw new Error(msg);
}

async function signId(id: string) {
  if (!isid(id)) {
    throw new Error('Only single ids are signed to prevent abuse');
  }
  return signMessage(id);
}

export async function verifyRemoteUser(connection: IConnection) {
  try {
    if (connection.remoteUserVerified) {
      return;
    }
    const id = newid();
    const signedId = await RPC(connection, signId)(id);
    const openedId = openMessage(signedId, connection.remoteUser.publicKey);
    if (openedId != id) {
      throw new Error('Failed to verify possession of correct secretKey')
    }
    verifySignedObject(connection.remoteUser, connection.remoteUser.publicKey);
    const db = await getDB();
    const dbUser = await db.get(connection.remoteUser.id) as IUser;
    if (dbUser && !keysEqual(dbUser.publicKey, connection.remoteUser.publicKey)) {
      // TODO allow public keys to change
      //    this will have to happen if a user's private key is compromised so we need to plan for it
      //    The obvious solution is to use some server as a source of truth but that kind of violates the p2p model
      throw new Error("Remote user's pubic key does not match what we have in db");
      // IDEA use previously known devices to try to do multi-factor authentication
      //    If the user has two or more devices they regularly use, we can ask as many of those devices
      //    as we can connect with, which is the correct public key for their user.
      //    we can reject the new public key until all available devices belonging to the user are in consensus.
    }
    if (!dbUser || dbUser.modified < connection.remoteUser.modified) {
      // TODO protect from users stealing other users' ids
      //    this can happen if user1 has never seen user2 before, and user3 creates a user object
      //    with user2's id but a new public/private key, then gives that to user1
      //    MAYBE ask any other peers if they have this user and if so check that public keys match
      await db.save(connection.remoteUser);
    }
  } catch (err) {
    throw new Error('remote user failed verification: ' + String(err));
  }
  connection.remoteUserVerified = true;
}


const remotelyCallableFunctions: { [key: string]: Function } = {
  ping,
  testError,
  signId,
}

export function setRemotelyCallableFunction(fn: Function, name?: string) {
  remotelyCallableFunctions[name || fn.name] = fn;
}

export function RPC<T extends Function>(connection: IConnection, fn: T): T {
  return <any>function (...args) {
    const fnName = Object.keys(remotelyCallableFunctions).find(fnName => remotelyCallableFunctions[fnName] == fn);
    if (fnName === "ping") {
      const sTime = Date.now();
      return makeRemoteCall(connection, fnName as any, args).then(result => {
        const eTime = Date.now();
        connection.pingMS = eTime - sTime;
        return result;
      })
    }
    return makeRemoteCall(connection, fnName as any, args);
  };
}

export const RPC_TIMEOUT_MS = 10_000;
export async function makeRemoteCall(connection: IConnection, fnName: string, args: any[]) {
  const id = newid();
  let rejectRemoteCall;

  const remoteCallPromise = new Promise((resolve, reject) => {
    rejectRemoteCall = reject;
    const pid = setTimeout(() => {
      delete connection.handlers[id]  
      reject(`RPC timeout: ${fnName}(${args.join(',')})`);
    }, 10_000);
    connection.handlers[id] = (err, result) => {
      clearTimeout(pid);
      err ? reject(err) : resolve(result);
    }
  });
  try {
    let remoteCall: IRemoteCall = {
      type: 'call',
      id,
      fnName,
      args
    }
    // WebRTC is already encrypted so signing the call object seems wasteful
    // remoteCall = signObject(remoteCall);
    connection.send(remoteCall);
  } catch (err) {
    rejectRemoteCall(err);
  }
  return remoteCallPromise;
}

async function sendRemoteError(connection: IConnection, callId: string, error: string) {
  let response: IRemoteResponse = {
    type: 'response',
    id: callId,
    error
  }
  connection.send(response);
}

let currentConnection: IConnection;
export const getCurrentConnection = () => currentConnection;

async function handelRemoteCall(connection: IConnection, remoteCall: IRemoteCall) {
  const { id, fnName, args } = remoteCall;
  try {
    // WebRTC is already encrypted so verifying at this level seems wasteful (see `verifyRemoteUser` below)
    // verifySignedObject(remoteCall as any, connection.remoteUser.publicKey);
    const fn = remotelyCallableFunctions[fnName];
    let result;
    let error;
    if (typeof fn !== 'function') {
      error = `${fnName} is not a remotely callable function`;
    } else {
      try {
        if (!connection.remoteUserVerified && fn != signId) {
          await verifyRemoteUser(connection);
          // console.log('remote user verified', { deviceId: connection.remoteDeviceId, userId: connection.remoteUser?.id })
        }
        // make the current connection available to the fn when it is called
        currentConnection = connection;
        const resultPromise = fn(...args);
        // unset current connection as soon as possible to prevent weird usage
        currentConnection = null;
        result = await resultPromise;
      } catch (err) {
        error = String(err);
      }
    }
    let response: IRemoteResponse = {
      type: 'response',
      id,
      result,
      error
    }
    connection.send(response);
  } catch (err) {
    sendRemoteError(connection, id, 'unhandled error in handelRemoteCall: ' + err);
  }
}

const messageChunks = {};
export function onRemoteMessage(connection: IConnection, message: string | IRemoteData): void {
  // console.log({ connection, message })
  // TODO check if fromJSON calls eval, if so this is a security hole
  message = fromJSON(JSON.parse(message as any));
  connection.lastAck = Date.now();
  if (message === 'ack') return;
  if (message == 'ping') {
    console.log('ping!', { deviceId: connection.remoteDeviceId, userId: connection.remoteUser?.id })
    connection.send('pong');
    return;
  }
  if (message == 'pong') {
    console.log('pong!', { deviceId: connection.remoteDeviceId, userId: connection.remoteUser?.id })
    return;
  }
  const msgObj = message as IRemoteCall | IRemoteResponse | IRemoteChunk;

  if (msgObj.type === 'chunk') {
    // validate size to prevent remote attacker filling up memory
    if (msgObj.totalChunks * msgObj.chunk.length > 1e9) {
      throw new Error(`Message larger than maximum allowed size of ${1e8} (~100Mb), use files for very large objects or write a custom function to stream the data`)
    }
    if (!messageChunks[msgObj.id]) {
      messageChunks[msgObj.id] = [];
    }
    const chunks = messageChunks[msgObj.id];
    chunks[msgObj.iChunk] = msgObj.chunk;
    if (_.compact(chunks).length === msgObj.totalChunks) {
      delete messageChunks[msgObj.id];
      onRemoteMessage(connection, chunks.join(''));
    }
    return;
  }

  switch (msgObj.type) {
    case 'call':
      handelRemoteCall(connection, msgObj);
      break;
    case 'response':
      const handler = connection.handlers[msgObj.id]
      if (handler) {
        handler(msgObj.error, msgObj.result);
        delete connection.handlers[msgObj.id];
      } else {
        /* istanbul ignore next */
        console.error('no handler for remote response', connection, msgObj)
      }
      break;
    default:
      // @ts-ignore
      sendRemoteError(connection, msgObj.id, 'unknown remote call: ' + msgObj.type)
  }
}