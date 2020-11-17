import { newid } from "./common";
import { IMe, IUser, signObject, verifySignedObject } from "./user";
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

export const remotelyCallableFunctions: { [key: string]: Function } = {
  [ping.name]: ping,  
  [testError.name]: testError
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
      args,
      signature: undefined
    }
    remoteCall = signObject(remoteCall, connection.me.privateKey);
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
    error,
    signature: undefined
  }
  response = signObject(response, connection.me.privateKey);
  connection.send(response);
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
        result = await fn(...args);
      } catch (err) {
        error = String(err);
      }
    }
    let response: IRemoteResponse = {
      type: 'response',
      id,
      result,
      error,
      signature: undefined
    }
    response = signObject(response, connection.me.privateKey);
    connection.send(response);
  } catch (err) {
    sendRemoteError(connection, id, 'unhandled error in handelRemoteCall: ' + err);
  }
}

const messageChunks = {};
export function onPeerMessage(connection: IConnection, message: string | IRemoteData) {
  connection.lastAck = Date.now();
  if (message === 'ack') return;
  if (typeof message === 'string') {
    message = JSON.parse(message);
  }
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
      onPeerMessage(connection, chunks.join(''));
    }
    return;
  }

  try {
    verifySignedObject(msgObj, connection.remoteUser.publicKey)
  } catch (err) {
    sendRemoteError(connection, msgObj.id, 'verification of remote message failed');
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