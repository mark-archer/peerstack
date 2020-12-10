import { fromJSON, isid, newid } from "./common";
import { IMe, IUser, newMe, openMessage, signMessage, signObject, verifySignedObject } from "./user";
import * as _ from "lodash";
import { getIndexedDB, buildDBHashes } from "./db";

export type txfn = <T>(data: (string | IRemoteData)) => Promise<T | void> | void

export interface IConnection {
  id: string
  remoteDeviceId: string
  lastAck: number //time
  handlers: { [key: string]: ((err: any, result: any) => void) }
  send: txfn
  me?: IMe
  remoteUser?: IUser
  remoteUserVerified?: boolean
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

export function newConnection(remoteDeviceId: string, send: txfn): IConnection {
  let conn;
  conn = {
    id: newid(),
    remoteDeviceId,
    handlers: {},
    lastAck: Date.now(),
    send,
    receive: data => onRemoteMessage(conn, data) 
  }
  return conn
}

export function RPC<T extends Function>(connection: IConnection, fn: T): T {
  return <any>function (...args) {
    return makeRemoteCall(connection, fn.name as any, args);
  };
}

export async function ping(n: number, s: string) {
  return ['pong', ...arguments];
}

export async function testError(msg: string) {
  throw new Error(msg);
}

async function proveIdentity(idToSign: string) {
  if (!isid(idToSign)) {
    throw new Error('For security purposes, identity proof is only done with single ids');
  }
  return signMessage(idToSign, currentConnection.me.secretKey);
}

export async function verifyRemoteUser(connection: IConnection) {
  const idToSign = newid();
  let openedId: string;
  const failedVerificationError = new Error('remote user failed verification');
  try {
    const signedId = await RPC(connection, proveIdentity)(idToSign);  
    openedId = openMessage(signedId, connection.remoteUser.publicKey);
  } catch (err) {
    throw failedVerificationError
  }  
  if (openedId !== idToSign) {
    throw failedVerificationError
  }
  connection.remoteUserVerified = true;
}

export async function getRemoteGroups() {
  const connection: IConnection = currentConnection;
  const db = await getIndexedDB();
  const groups = await db.find('Group', 'type');
  // todo limit groups by what user has read permissions to 
  return groups;
}

export async function syncDBs(connection: IConnection) {  
  const remoteGroups = await RPC(connection, getRemoteGroups)();
  const hashes = await buildDBHashes();
  for (const group of remoteGroups) {
    const level = 'L1';
    const groupHashes = hashes[group.id]?.[level] || {};
    const remoteGroupHashes = await RPC(connection, getGroupDBHash)(group.id, level);
    const blocks = _.uniq([...Object.keys(groupHashes), ...Object.keys(remoteGroupHashes)]);
    // reverse because we want to do newest first, it may automatically resolve discrepancies in older blocks
    blocks.sort().reverse(); 
    console.log({blocks});
    return;
  }
}

export async function getGroupDBHash(groupId: string, level: string = 'L0') {
  const connection: IConnection = currentConnection;
  // todo verify user has read permissions to group
  const hashes = await buildDBHashes();
  return hashes[groupId]?.[level] || {};
}

export const remotelyCallableFunctions: { [key: string]: Function } = {
  ping,  
  testError,
  proveIdentity,
  getRemoteGroups,
  getGroupDBHash
}

export async function makeRemoteCall(connection: IConnection, fnName: string, args: any[]) {
  const id = newid();
  let rejectRemoteCall;
  const remoteCallPromise = new Promise((resolve, reject) => {
    rejectRemoteCall = reject;
    connection.handlers[id] = (err, result) => err ? reject(err) : resolve(result);
  });
  try {
    let remoteCall: IRemoteCall = {
      type: 'call',
      id,
      fnName,
      args
    }
    remoteCall = signObject(remoteCall, connection.me.secretKey);
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
async function handelRemoteCall(connection: IConnection, remoteCall: IRemoteCall) {
  const { id, fnName, args } = remoteCall;
  try {
    const fn = remotelyCallableFunctions[fnName];
    let result;
    let error;
    if (typeof fn !== 'function') {
      error = `${fnName} is not a remotely callable function`;
    } else {
      try {
        if (!connection.remoteUserVerified && fn != proveIdentity) {
          await verifyRemoteUser(connection);
          console.log('remote user verified', connection);
        }        
        currentConnection = connection; // this is a pretty hacky
        result = await fn(...args);
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
  message = fromJSON(JSON.parse(message as any));
  connection.lastAck = Date.now();
  if (message === 'ack') return;
  if (message == 'ping') { 
    connection.send('pong');
    return;
  }
  if (message == 'pong') return console.log('pong!', connection);
  const msgObj = message as IRemoteCall | IRemoteResponse | IRemoteChunk;
  
  if (msgObj.type === 'chunk') {
    // validate chunk size, iChunk, and total size, to prevent remote attacker filling up memory 
    if (msgObj.totalChunks * msgObj.chunk.length > 1e9) {

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