import * as _ from "lodash";
import { uniq } from "lodash";
import { fromJSON, isid, newid, sleep } from "./common";
import { connections } from "./connections";
import { checkPermission, getBlockData, getDetailHashes, getBlockIdHashes, getIndexedDB, getPersonalGroup, hasPermission, IData, IDB, IGroup, usersGroup } from "./db";
import { IUser, openMessage, signMessage, signObject, verifySignedObject } from "./user";

export type txfn = <T>(data: (string | IRemoteData)) => Promise<T | void> | void

export interface IConnection {
  id: string
  remoteDeviceId: string
  lastAck: number //time
  handlers: { [key: string]: ((err: any, result: any) => void) }
  send: txfn
  me?: IUser
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

export async function ping(n: number, s: string) {
  return ['pong', ...arguments];
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
    const id = newid();
    const signedId = await RPC(connection, signId)(id);
    const openedId = openMessage(signedId, connection.remoteUser.publicKey);
    if (openedId != id) {
      throw new Error('Failed to verify possession of correct secretKey')
    }
    verifySignedObject(connection.remoteUser, connection.remoteUser.publicKey);
    const db = await getIndexedDB();
    const dbUser = await db.get(connection.remoteUser.id) as IUser;
    if (dbUser && dbUser.publicKey !== connection.remoteUser.publicKey) {
      // TODO allow public keys to change
      //    this will have to happen if a user's private key is compromised so we need to plan for it
      //    The obvious solution is to use some server as a source of truth but that kind of violates the p2p model
      throw new Error('Public keys do not match');
      // IDEA use previously known devices to try to do multi-factor authentication
      //    If the user has two or more devices they regularly use, we can ask as many of those devices
      //    as we can connect with, which is the correct public key for their user.
      //    we can reject the new public key until all available devices belonging to the user are in consensus.
    }
    if (!dbUser || dbUser.modified < connection.remoteUser.modified) {
      // TODO protect from users stealing other users' ids
      //    this can happen if user1 has never seen user2 before, and user3 creates a user object
      //    with user2's id but a new public/private key, then gives that to user1
      await db.save(connection.remoteUser);
    }
  } catch (err) {
    throw new Error('remote user failed verification');
  }
  connection.remoteUserVerified = true;
}

export async function getRemoteGroups() {
  const connection: IConnection = currentConnection;
  const db = await getIndexedDB();
  const allGroups = (await db.find('Group', 'type')) as IGroup[];
  const readGroups: IGroup[] = []
  for (const group of allGroups) {
    if (await hasPermission(connection.remoteUser?.id, group, 'read', db)) {
      readGroups.push(group);
    }
  }
  return readGroups;
}

export async function getRemoteBlockData(groupId: string, level0BlockId: string) {
  const connection: IConnection = currentConnection;
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getBlockData(groupId, level0BlockId);
}

export async function getRemoteBlockHashes(groupId: string) {
  const connection: IConnection = currentConnection;
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getDetailHashes(groupId);
}

export async function getRemoteIdBlockHashes(groupId: string, blockId: string) {
  const connection: IConnection = currentConnection;
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getBlockIdHashes(groupId, blockId);
}

export const eventHandlers = {
  onRemoteDataSaved: (data: IData) => {
    // placeholder
  },
}

async function syncBlockId(connection: IConnection, db: IDB, groupId: string, blockId: string = '') {
  console.log(`syncing ${groupId} block ${blockId}`)
  const localHashes = await getBlockIdHashes(groupId, blockId);
  const remoteHashes = await RPC(connection, getRemoteIdBlockHashes)(groupId, blockId);
  const blockIds = uniq([...Object.keys(localHashes), ...Object.keys(remoteHashes)]);
  for (let blockId of blockIds) {
    const localHash = localHashes[blockId];
    const remoteHash = remoteHashes[blockId];
    if (localHash != remoteHash) {
      if (blockId.length < 6 && !blockId.startsWith('u')) {
        await syncBlockId(connection, db, groupId, blockId);
      } else {
        if (blockId.startsWith('u')) {
          blockId = 'users';
        }
        const remoteBlockData = await RPC(connection, getRemoteBlockData)(groupId, blockId);
        for (const remoteData of remoteBlockData) {
          const localData = await db.get(remoteData.id);
          if (!localData || localData.modified < remoteData.modified || (localData.signature != remoteData.signature && localData.modified == remoteData.modified && Math.random() > .8)) {
            // console.log('found data diff', { localData, remoteData });
            await db.save(remoteData);
            eventHandlers.onRemoteDataSaved(remoteData)
          }
        }
      }
    }
  }
}

let syncGroupPromiseChain = Promise.resolve();
export async function syncGroup(connection: IConnection, remoteGroup: IGroup, db: IDB) {
  syncGroupPromiseChain = syncGroupPromiseChain.then(async () => {
    const groupId = remoteGroup.id;
    if (groupId !== connection.me.id && groupId !== usersGroup.id) {
      const localGroup = await db.get(groupId);
      if (!localGroup || remoteGroup.modified > localGroup.modified) { // TODO potential security hole if we don't have the local group, do we trust the remote user?
        await db.save(remoteGroup);
        eventHandlers.onRemoteDataSaved(remoteGroup);
      }
    }
    await syncBlockId(connection, db, groupId);
  })
  .catch(err => {
    console.error(`error while syncing group`, { remoteDevice: connection.remoteDeviceId, group: remoteGroup}, err)
  });
  return syncGroupPromiseChain
}

export async function syncDBs(connection: IConnection) {
  const startTime = Date.now();
  const db = await getIndexedDB();
  const _syncGroup = (group: IGroup) => syncGroup(connection, group, db);
  
  let remoteGroups = await RPC(connection, getRemoteGroups)();
  remoteGroups = _.shuffle(remoteGroups);  // randomize order to try to spread traffic around
  if (connection.me.id === connection.remoteUser.id) {
    remoteGroups.unshift(getPersonalGroup(connection.me.id));
  }
  console.log({ remoteGroups })
  connection.groups = remoteGroups.map(g => g.id);

  await Promise.all(remoteGroups.map(_syncGroup));
  // for (const remoteGroup of remoteGroups) await _syncGroup(remoteGroup);
  console.log(`finished syncing DB with ${connection.remoteDeviceId} in ${Date.now() - startTime} ms`);
}

const pushDataAlreadySeen: {
  [idPlusModified: string]: true
} = {}
export async function pushData(data: IData) {
  const idPlusModified = data.id + data.modified;
  if (pushDataAlreadySeen[idPlusModified]) {
    // console.log('already seen so not saving or forwarding data', data);
    return;
  }
  // console.log('starting data save', data);
  pushDataAlreadySeen[idPlusModified] = true;
  const connection: IConnection = currentConnection;
  const db = await getIndexedDB();
  const dbData = await db.get(data.id);
  if (!dbData || dbData.modified < data.modified) {
    await db.save(data);
    eventHandlers.onRemoteDataSaved(data);
  }
  connections.forEach(_connection => {
    // this data was probably pushed from the current connection so resist forwarding it to that one but if it's the only connection available push it to try to get it propagating
    if (connection == _connection && connections.length > 1) {
      return;
    }
    // TODO make sure we have verified user has read permission to this group otherwise this is a security hole
    if (_connection.groups?.some(groupId => groupId == data.group)) {
      // console.log('forwarding data to connection', { data, conn: _connection });
      RPC(_connection, pushData)(data);
    }
  });
}

// these names have to be done this way so they persist through code minification
export const remotelyCallableFunctions: { [key: string]: Function } = {
  ping,
  testError,
  getRemoteGroups,
  getRemoteBlockHashes,
  getRemoteIdBlockHashes,
  getRemoteBlockData,
  pushData,
  signId,
}

export function RPC<T extends Function>(connection: IConnection, fn: T): T {
  return <any>function (...args) {
    const fnName = Object.keys(remotelyCallableFunctions).find(fnName => remotelyCallableFunctions[fnName] == fn);
    return makeRemoteCall(connection, fnName as any, args);
  };
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
    remoteCall = signObject(remoteCall);
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
    verifySignedObject(remoteCall as any, connection.remoteUser.publicKey);
    const fn = remotelyCallableFunctions[fnName];
    let result;
    let error;
    if (typeof fn !== 'function') {
      error = `${fnName} is not a remotely callable function`;
    } else {
      try {
        if (!connection.remoteUserVerified && fn != signId) {
          await verifyRemoteUser(connection);
          console.log('remote user verified', connection);
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
    console.log('ping!', connection)
    connection.send('pong');
    return;
  }
  if (message == 'pong') {
    console.log('pong!', connection);
    return;
  }
  const msgObj = message as IRemoteCall | IRemoteResponse | IRemoteChunk;

  if (msgObj.type === 'chunk') {
    // validate size to prevent remote attacker filling up memory
    if (msgObj.totalChunks * msgObj.chunk.length > 1e9) {
      throw new Error(`Message larger than maximum allowed size of ${1e8} (~100Mb)`)
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