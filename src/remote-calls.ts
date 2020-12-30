import { fromJSON, isid, newid } from "./common";
import { IMe, IUser, newMe, openMessage, signMessage, signObject, verifySignedObject } from "./user";
import * as _ from "lodash";
import { getIndexedDB, getBlockData, getBlockHashes, IData, BlockHashLevel, IGroup, hasPermission, checkPermission, IDB, usersGroup, getPersonalGroup } from "./db";
import { connections } from "./connections";

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

export async function ping(n: number, s: string) {
  return ['pong', ...arguments];
}

export async function testError(msg: string) {
  throw new Error(msg);
}

async function signId(id: string) {
  const connection: IConnection = currentConnection;
  if (!isid(id)) {
    throw new Error('Only single ids are signed to prevent abuse');
  }
  return signMessage(id, connection.me.secretKey);
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
    if (!dbUser) {
      // TODO protect from users stealing other users' ids
      //    this can happen if user1 has never seen user2 before, and user3 creates a user object
      //    with user2's id but a new public/private key, then gives that to user1
      await db.insert(dbUser);
    } else if (dbUser.modified < connection.remoteUser.modified) {
      await db.update(connection.remoteUser);
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

export async function getRemoteBlockHashes(groupId: string, level: BlockHashLevel = 'L0') {
  const connection: IConnection = currentConnection;
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
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

export async function syncGroup(connection: IConnection, remoteGroup: IGroup, db: IDB) {
  if (remoteGroup.id !== connection.me.id && remoteGroup.id !== 'users') {
    const localGroup = await db.get(remoteGroup.id);
    if (!localGroup) {
      await db.insert(remoteGroup);
      eventHandlers.onRemoteDataInserted(remoteGroup);
    } else if (remoteGroup.modified > localGroup.modified) {
      await db.update(remoteGroup);
      eventHandlers.onRemoteDataUpdated(remoteGroup);
    }
  }
  const l1LocalHash = await getBlockHashes(remoteGroup.id, 'L1');
  const l1RemoteHash = await RPC(connection, getRemoteBlockHashes)(remoteGroup.id, 'L1');
  if (l1LocalHash == l1RemoteHash) {
    // console.log(`L1 hashes match ${l1RemoteHash} so skipping L0 sync: ${group.title || group.name}`);
    return;
  }
  console.log(`L1 hashes different so continuing with L0 sync: ${remoteGroup.title || remoteGroup.name} ${JSON.stringify({l1LocalHash, l1RemoteHash}, null, 2)}`);

  const startTime = Date.now();
  const blockHashLevel = 'L0';
  const remoteHashes = await RPC(connection, getRemoteBlockHashes)(remoteGroup.id, blockHashLevel);
  const localHashes = await getBlockHashes(remoteGroup.id, blockHashLevel);
  // const blockIds = _.uniq([...Object.keys(localHashes), ...Object.keys(remoteHashes)]);
  const blockIds = Object.keys(remoteHashes);
  blockIds.sort().reverse(); // reverse because we want to do newest first
  console.log({ blockIds, localHashes, remoteHashes })
  for (const blockId of blockIds) {
    if (localHashes[blockId] != remoteHashes[blockId]) {
      // console.log('found hash diff', {groupId: remoteGroup.id, blockId, localHash: localHashes[blockId], remoteHash: remoteHashes[blockId], })
      const remoteBlockData = await RPC(connection, getRemoteBlockData)(remoteGroup.id, blockId);
      for (const remoteData of remoteBlockData) {
        const localData = await db.get(remoteData.id);
        if (!localData || localData.modified < remoteData.modified) {
          // console.log('found data diff', { localData, remoteData });
          if (localData) {
            db.update(remoteData).then(() => eventHandlers.onRemoteDataUpdated(remoteData));
          } else {
            db.insert(remoteData).then(() => eventHandlers.onRemoteDataInserted(remoteData));
          }
        }
      }
    }
  }
  console.log(`finished syncing ${remoteGroup.title || remoteGroup.name} in ${Date.now() - startTime}ms`);
}

export async function syncDBs(connection: IConnection) {
  const db = await getIndexedDB();
  const _syncGroup = (group: IGroup) => syncGroup(connection, group, db);

  await _syncGroup(usersGroup);
  let remoteGroups = await RPC(connection, getRemoteGroups)();
  remoteGroups = _.shuffle(remoteGroups);  // randomize order to try to spread traffic around
  if (connection.me.id === connection.remoteUser.id) {
    remoteGroups.unshift(getPersonalGroup(connection.me.id));
  }
  console.log({ remoteGroups })
  connection.groups = remoteGroups.map(g => g.id);

  await Promise.all(remoteGroups.map(_syncGroup));
  // for (const remoteGroup of remoteGroups) await _syncGroup(remoteGroup);
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
  if (!dbData) {
    await db.insert(data);
    eventHandlers.onRemoteDataInserted(data);
  } else if (dbData.modified < data.modified) {
    await db.update(data);
    eventHandlers.onRemoteDataUpdated(data);
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
  getRemoteBlockData,
  pushData,
  signId,
}
console.log('remotely callable functions', remotelyCallableFunctions)

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
    remoteCall = signObject(remoteCall, connection.me.secretKey, connection.me.id);
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
        if (!connection.remoteUserVerified && fn != signId) {
          await verifyRemoteUser(connection);
          console.log('remote user verified', connection);
        }
        // make the current connection available to the fn when it is called
        currentConnection = connection;
        const resultPromise = fn(...args);
        // unset current connection as soon as the function returns to prevent weird usage
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
    connection.send('pong');
    return;
  }
  if (message == 'pong') return console.log('pong!', connection);
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