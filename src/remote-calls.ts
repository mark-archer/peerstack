import { fromJSON, isid, newid } from "./common";
import { IMe, IUser, newMe, openMessage, signMessage, signObject, verifySignedObject } from "./user";
import * as _ from "lodash";
import { getIndexedDB, getBlockData, getBlockHashes, IData, BlockHashLevel } from "./db";

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
  groups?: string[]
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

export function verifyRemoteUser(connection: IConnection) {
  try {
    verifySignedObject(connection.remoteUser, connection.remoteUser.publicKey);    
  } catch (err) {
    throw new Error('remote user failed verification');
  }
  connection.remoteUserVerified = true;
}

export async function getRemoteGroups() {
  const connection: IConnection = currentConnection;
  const db = await getIndexedDB();
  const groups = await db.find('Group', 'type');
  // TODO limit groups by what user has read permissions to 
  return groups;
}

export async function getRemoteBlockData(group: string, level0BlockId: string) {
  const connection: IConnection = currentConnection;
  // TODO verify user has read permissions
  return getBlockData(group, level0BlockId);
}

export async function getRemoteBlockHashes(groupId: string, level: BlockHashLevel = 'L0') {
  const connection: IConnection = currentConnection;
  // TODO verify user has read permissions to group
  return getBlockHashes(groupId, level);
}

export const eventHandlers = {
  onRemoteDataInserted: (data: IData) => {
    // placeholder
  },
  onRemoteDataUpdated: (data: IData) => {
    // placeholder
  }
}

export async function syncDBs(connection: IConnection) {
  let remoteGroups = await RPC(connection, getRemoteGroups)();
  remoteGroups = _.shuffle(remoteGroups); 
  if (connection.me.id === connection.remoteUser.id) {
    const myId = connection.me.id;
    remoteGroups.unshift({ type: 'Group', id: myId, group: myId, owner: myId, title: 'Personal', modified: Date.now() })
  }
  connection.groups = remoteGroups.map(g => g.id);
  const db = await getIndexedDB();
  // const groupPromises = remoteGroups.map(async group => {
  for (const group of remoteGroups) {
    const l1LocalHash = await getBlockHashes(group.id, 'L1');
    const l1RemoteHash = await RPC(connection, getRemoteBlockHashes)(group.id, 'L1');
    if (l1LocalHash == l1RemoteHash) continue;

    const newData = [];
    const startTime = Date.now();
    const level = 'L0';
    const remoteHashes = await RPC(connection, getRemoteBlockHashes)(group.id, level);
    const localHashes = await getBlockHashes(group.id, level);
    const blockIds = _.uniq([...Object.keys(localHashes), ...Object.keys(remoteHashes)]);
    // console.log({ blockIds, localHashes, remoteHashes })
    // reverse because we want to do newest first
    blockIds.sort().reverse();
    for (const blockId of blockIds) {
      if (localHashes[blockId] != remoteHashes[blockId]) {
        // console.log('found hash diff', {groupId: group.id, blockId, localHash: localHashes[blockId], remoteHash: remoteHashes[blockId], })
        const remoteBlockData = await RPC(connection, getRemoteBlockData)(group.id, blockId);
        for (const remoteData of remoteBlockData) {
          const localData = await db.get(remoteData.id);
          if (!localData || localData.modified < remoteData.modified) {
            // console.log('found data diff', { localData, remoteData });
            newData.push(remoteData);
            if (localData) {
              db.update(remoteData).then(() => eventHandlers.onRemoteDataUpdated(remoteData));              
            } else {
              db.insert(remoteData).then(() => eventHandlers.onRemoteDataInserted(remoteData));
            }
          }
        }
      }
    }
    console.log(`finished syncing ${group.title} in ${Date.now() - startTime}ms`);
  }
  // }); await Promise.all(groupPromises);
}

export async function pushData(data: IData) {
  const connection: IConnection = currentConnection;
  // TODO verify signed data 
  const db = await getIndexedDB();
  const dbData = await db.get(data.id);
  if (!dbData) {
    await db.insert(data);
    eventHandlers.onRemoteDataInserted(data);
  } else if (dbData.modified < data.modified) {
    await db.update(data);
    eventHandlers.onRemoteDataUpdated(data);
  }
}

export const remotelyCallableFunctions: { [key: string]: Function } = {
  ping,
  testError,
  getRemoteGroups,
  getRemoteBlockHashes,
  getRemoteBlockData,
  pushData,
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
        if (!connection.remoteUserVerified) {
          verifyRemoteUser(connection);
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