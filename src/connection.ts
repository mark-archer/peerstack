import { anyObject, hashValue, newid } from "./common";
import { IMe, IUser, openMessage, signedObject, signMessage } from "./user";
import * as _ from "lodash";

export type txfn = <T>(data: (string | IRemoteData)) => Promise<T | void>

export interface IConnection {
  id: string
  remoteDeviceId: string
  lastAck: number //time
  handlers: { [key: string]: ((err: any, result: any) => void) }
  send: txfn
  receive: txfn
  me?: IMe
  remoteUser?: IUser
}

export interface IRemoteData {
  type: 'call' | 'response' | 'chunk'
  id: string,
  signature: string
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
    receive: data => onPeerMessage(conn, data) 
  }
  return conn
}

function signRemoteMessage(connection: IConnection, msg: IRemoteData) {
  const idsHash = hashValue(connection.id + msg.id).toString().substr(0, 6);
  const sigData = [idsHash, Date.now()].join();
  msg.signature = signMessage(sigData, connection.me.privateKey);
}

function verifyRemoteMessage(connection: IConnection, msg: IRemoteData) {
  const sig = openMessage(msg.signature, connection.remoteUser.publicKey);
  const [remoteIdsHash, strDT] = sig.split(',');
  const idsHash = hashValue(connection.id + msg.id).toString().substr(0, 6);
  if (remoteIdsHash !== idsHash) {
    throw new Error('invalid hash: ' + JSON.stringify({ idsHash, remoteIdsHash }));
  }
  const givenDT = Number(strDT);
  const dt = Date.now();
  const maxVarianceInDT = 100000; // 100 seconds
  if (givenDT > (dt + maxVarianceInDT) || givenDT < (dt - maxVarianceInDT)) {
    throw new Error('invalid dt: ' + JSON.stringify({ dt, givenDT }));
  }
}

export function RPC<T extends Function>(connection: IConnection, fn: T): T {
  return <any>function (...args) {
    return makeRemoteCall(connection, fn.name as any, args);
  };
}

export async function ping(n: number, s: string) {
  console.log('ping', n + s);
  return ['pong', ...arguments];
}

export const remotelyCallableFunctions: { [key: string]: Function } = {
  [ping.name]: ping,  
}

export async function makeRemoteCall(connection: IConnection, fnName: string, args: any[]) {
  try {
    const id = newid();
    const remoteCall: IRemoteCall = {
      type: 'call',
      id,
      fnName,
      args,
      signature: undefined
    }
    signRemoteMessage(connection, remoteCall);
    connection.send(remoteCall)
    return new Promise((resolve, reject) => {
      connection.handlers[id] = (err, result) => err ? reject(err) : resolve(result);
    });
  } catch (err) {
    console.error('error in doRemoteCall: ', err);
  }
}


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
        if ((fn as any).passConnection) {
          args.push(connection);
        }
        result = await fn(...args);
      } catch (err) {
        error = String(err);
      }
    }
    const response: IRemoteResponse = {
      type: 'response',
      id,
      result,
      error,
      signature: undefined
    }
    signRemoteMessage(connection, response);
    connection.send(response);
  } catch (err) {
    console.log('error in doRemoteCall: ', err);
  }
}

// function sendRemoteError(connection: IConnection, data: IRemoteCall | IRemoteResponse, error: string) {
//   const remoteError: IRemoteResponse = {
//     type: 'response',
//     id: data.id,
//     error,
//     signature: undefined
//   }
//   signRemoteMessage(connection, remoteError);
//   return connection.send(remoteError);
// }

const messageChunks = {};
export function onPeerMessage(connection: IConnection, message: string | IRemoteData) {
  connection.lastAck = Date.now();
  if (message === 'ack') return;
  if (typeof message === 'string') {
    message = JSON.parse(message);
  }
  const msgObj = message as IRemoteCall | IRemoteResponse | IRemoteChunk;

  if (msgObj.type === 'chunk') {
    // TODO validate chunk size, iChunk, and total size, to prevent remote attacker filling up memory 
    if (!messageChunks[msgObj.id]) {
      messageChunks[msgObj.id] = [];
    }
    const chunks = messageChunks[msgObj.id];
    chunks[msgObj.iChunk] = msgObj.chunk;
    if (_.compact(chunks).length === msgObj.totalChunks) {
      onPeerMessage(connection, { data: chunks.join('') } as any);
      delete messageChunks[msgObj.id];
    }
    return;
  }

  try {
    verifyRemoteMessage(connection, msgObj)
  } catch (err) {
    console.log('verification of remote message failed:', msgObj, err);    
    // sendRemoteError(connection, msgObj, 'verification of remote message failed');
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
        console.error('no handler for remote response', msgObj);
      }
      break;
    default:
      throw new Error('unknown remote call: ' + JSON.stringify(msgObj));
  }
}