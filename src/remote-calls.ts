import * as _ from "lodash";
import { fromJSON, isid, newid, parseJSON, sleep, stringify } from "./common";
import { connections, chunkSize, me } from "./connections";
import { checkPermission, getBlockIds, getDetailHashes, getBlockIdHashes, getDB, getPersonalGroup, hasPermission, IData, IDB, IGroup, usersGroup } from "./db";
import { keysEqual, IUser, openMessage, signMessage, verifySignedObject } from "./user";

export type txfn = <T>(data: (string | IRemoteData)) => Promise<T | void> | void

export interface IConnection {
  id: string
  remoteDeviceId: string
  lastAck: number //time
  handlers: { [key: string]: ((err: any, result: any) => void) }
  send: txfn
  close: () => void
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
      //    MAYBE ask any other peers if they have this user and if so check that public keys match
      await db.save(connection.remoteUser);
    }
  } catch (err) {
    throw new Error('remote user failed verification: ' + String(err));
  }
  connection.remoteUserVerified = true;
}

export async function getRemoteGroups() {
  const connection: IConnection = currentConnection;
  const db = await getDB();
  const allGroups = (await db.find('Group', 'type')) as IGroup[];
  const readGroups: IGroup[] = []
  for (const group of allGroups) {
    if (await hasPermission(connection.remoteUser?.id, group, 'read', db)) {
      readGroups.push(group);
    }
  }
  return readGroups;
}

export async function getRemoteBlockIds(groupId: string, level0BlockId: string) {
  const connection: IConnection = currentConnection;
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getBlockIds(groupId, level0BlockId);
}

export async function getRemoteData(id: string) {
  const connection: IConnection = currentConnection;
  const db = await getDB();
  const data = await db.get(id);
  await checkPermission(connection.remoteUser?.id, data.group, 'read');
  return data;
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

export async function fastSyncRemote(groupId: string, dataChannelLabel: string, lastModified: number) {
  new Promise<void>(async (resolve) => {
    try {
      const _connection: IConnection = currentConnection;
      await checkPermission(_connection.remoteUser?.id, groupId, 'read');
      const connection = connections.find(c => c.id === _connection.id);

      const dc = await connection.pc.createDataChannel(dataChannelLabel);
      let dcClosed = false;
      dc.onclose = () => dcClosed = true;

      const db = await getDB();
      const cursor = await db.openCursor({ lower: [groupId, lastModified], upper: [groupId, Infinity] }, 'group-modified', 'next');
      while (await cursor.next()) {
        const doc = cursor.value;
        const json = stringify(doc);
        // if bigger than chunkSize need to send slow way because it'll overflow the buffer (nice!!!)
        if (json.length > chunkSize) {
          await RPC(connection, pushData)(doc, true);
          continue;
        }
        while (!dcClosed && (dc.bufferedAmount + json.length) > chunkSize) {
          console.log('buffer full so waiting');
          await sleep(1);
        }
        if (dcClosed) {
          console.log('dc closed so breaking loop');
          break;
        }
        dc.send(json);
      }

      if (!dcClosed) {
        dc.send('END');
      }
    } catch (err) {
      console.error('error while remote streaming fastSync', { groupId, dataChannelLabel }, err);
    }
    resolve();
  })
}

async function fastSync(_connection: IConnection, groupId: string) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      await verifyRemoteUser(_connection)
      const connection = connections.find(c => c.id === _connection.id);
      const skipValidation = connection.remoteUser.id === me.id;

      const db = await getDB();
      const lastModifiedCursor = await db.openCursor({ lower: [groupId, -Infinity], upper: [groupId, Infinity] }, 'group-modified', 'prev');
      let lastModified = 0;
      while (await lastModifiedCursor.next()) {
        if (lastModifiedCursor.value?.type !== 'Group') {
          lastModified = lastModifiedCursor.value.modified;
          break;
        }
      }

      const dcLabel = `stream-sync-${groupId}-${newid()}`;
      await RPC(connection, fastSyncRemote)(groupId, dcLabel, lastModified);
      // let remotePromiseFinished = false;
      // remotePromise.catch(() => 0).then(() => sleep(100)).then(() => remotePromiseFinished = true);
      const dc = await connection.waitForDataChannel(dcLabel);

      const remoteJsonData = [];
      let streamEOF = false;

      dc.onmessage = (evt) => {
        const json = evt.data;
        if (json === 'END') {
          dc.close();
        } else {
          remoteJsonData.push(json);
        }
      }
      let dcClosed = false;
      dc.onclose = () => {
        dcClosed = true;
      }
      // sequentially process remote data to try to keep things responsive. 
      while ((!streamEOF && !dcClosed) || remoteJsonData.length) {
        try {
          if (!remoteJsonData.length) {
            await sleep(1);
            continue;
          }
          const docs: IData[] = remoteJsonData.map(json => parseJSON(json));
          remoteJsonData.length = 0;
          await db.save(docs, skipValidation); // skipping validation might be a big part of why this is so fast.... it probably shouldn't have been left like this
          docs.map(doc => eventHandlers.onRemoteDataSaved(doc));
          console.log(`fastSynced ${docs.length} docs`);
        } catch (err) {
          console.error('error processing remote data during fast sync', err);
        }
      }
    } catch (err) {
      reject(err);
    }
    resolve();
  });
}

let pendingBlockSync = Promise.resolve();
async function syncBlockId(connection: IConnection, db: IDB, groupId: string, blockId: string = '') {
  let unlockBlockSync: () => any;
  let blockSyncLock = new Promise<void>((resolve) => {
    unlockBlockSync = resolve;
  })
  let thisBlockSync = pendingBlockSync.then(async () => {
    // if (groupId !== '72500a76054b418db3bc6ebf337b4bfd') {
    //   return;
    // }
    if (blockId) {
      console.log(`syncing ${groupId} block ${blockId}`);
    }
    let localHashes = await getBlockIdHashes(groupId, blockId);
    const remoteHashes = await RPC(connection, getRemoteIdBlockHashes)(groupId, blockId);
    const blockIds = Object.keys(remoteHashes).sort().reverse(); // reverse to do newest first

    const tryFastSync = blockId == "" && blockIds.some(bid => bid !== 'u' && localHashes[bid] !== remoteHashes[bid]);
    if (tryFastSync) {
      console.log(`fastSync starting ${groupId}`);
      console.time(`fastSync ${groupId}`);
      await fastSync(connection, groupId).catch(err => console.error('error during fastSync', err));
      console.timeEnd(`fastSync ${groupId}`);
      localHashes = await getBlockIdHashes(groupId, blockId);
    }

    for (let blockId of blockIds) {
      const localHash = localHashes[blockId];
      const remoteHash = remoteHashes[blockId];
      if (localHash != remoteHash) {
        if (blockId.length < 6 && !blockId.startsWith('u')) {
          // this assumes all blockIds in this set will, at most, result in `syncBlockId`
          // so it is okay to unblock `syncBlockId` (which also prevents a deadlock)
          unlockBlockSync();
          await syncBlockId(connection, db, groupId, blockId);
        } else {
          if (blockId.startsWith('u')) {
            blockId = 'users';
          }
          const remoteBlockData = await RPC(connection, getRemoteBlockIds)(groupId, blockId);
          for (const remoteData of remoteBlockData) {
            const localData = await db.get(remoteData.id);
            // if (!localData || localData.modified < remoteData.modified || (localData.signature != remoteData.signature && localData.modified == remoteData.modified && Math.random() > .8)) {
            if (!localData || localData.modified < remoteData.modified) {
              await RPC(connection, getRemoteData)(remoteData.id)
                .then(async remoteData => {
                  await db.save(remoteData);
                  eventHandlers.onRemoteDataSaved(remoteData)
                })
                .catch(err => {
                  console.error('error syncing remote data', remoteData, err);
                })
            }
          }
        }
      }
    }
  });
  pendingBlockSync = Promise.race([thisBlockSync, blockSyncLock]).catch(err => console.error(`error while syncing blockId`, { groupId, blockId }, err));
  await thisBlockSync;
}

export async function syncGroup(connection: IConnection, remoteGroup: IGroup, db: IDB) {
  try {
    const groupId = remoteGroup.id;
    let localGroup = await db.get(groupId);

    // don't add groups unless adding them from my own device
    if (!localGroup) {
      if (connection.remoteUser?.id === connection.me?.id) {
        await syncBlockId(connection, db, groupId, 'users');
        await db.save(remoteGroup, true);
        localGroup = remoteGroup;
      } else {
        return;
      }
    }

    if (groupId !== connection.me.id && groupId !== usersGroup.id) {
      if (remoteGroup.modified > localGroup.modified) {
        // const skipValidation = !localGroup; // if we don't have the local group there's a good chance we can't verify it since the signer could be a peer we don't already know
        await db.save(remoteGroup);
        await syncBlockId(connection, db, groupId, 'users');
        await db.save(remoteGroup);
        eventHandlers.onRemoteDataSaved(remoteGroup);
      } else if (localGroup.type === 'Deleted' && remoteGroup.modified < localGroup.modified) {
        RPC(connection, pushData)(localGroup);
        return;
      }
    }
    await syncBlockId(connection, db, groupId);
  } catch (err) {
    console.log('error syncing group')
  }
}

export async function syncDBs(connection: IConnection, apps?: string[]) {
  const startTime = Date.now();
  const db = await getDB();
  const _syncGroup = (group: IGroup) => syncGroup(connection, group, db);

  // get groups from remote device that it thinks I have permissions too
  let remoteGroups = await RPC(connection, getRemoteGroups)();

  // // First sync all group meta data (group object and users in group)
  // for (const remoteGroup of remoteGroups) {
  //   // TODO don't process remote group unless I've indicated I want to join it (and haven't left it)
  //   const localGroup = await db.get(remoteGroup.id);
  //   if (!localGroup || localGroup.modified < remoteGroup.modified) {
  //     // sync group users before saving the group object to make sure we have the group signer locally
  //     await syncBlockId(connection, db, remoteGroup.id, 'users')
  //     await db.save(remoteGroup).catch(err => console.log('error saving group', err));
  //   }
  // }

  // if apps are specified only sync data for groups that are for those apps
  if (apps?.length) {
    remoteGroups = remoteGroups.filter(g => g.apps?.length && g.apps.find(a => apps.includes(a)));
  }

  // randomize order to try to spread traffic around
  remoteGroups = _.shuffle(remoteGroups);

  // add personal group if I'm also the user on the other device
  if (connection.me.id === connection.remoteUser.id) {
    // TODO: since the connection is me I should sync all users and pull all data, saving without validating
    remoteGroups.unshift(getPersonalGroup(connection.me.id));
  }

  // add group ids to connection for later reference
  connection.groups = remoteGroups.map(g => g.id);

  // sync active groups completely before syncing inactive groups
  const activeGroups = remoteGroups.filter(g => !g.inactive);
  const inactiveGroups = remoteGroups.filter(g => g.inactive);
  await Promise.all(activeGroups.map(_syncGroup));
  console.log(`finished syncing active groups with ${connection.remoteDeviceId} in ${Date.now() - startTime} ms`);
  await Promise.all(inactiveGroups.map(_syncGroup));
  console.log(`finished syncing inactive groups with ${connection.remoteDeviceId} in ${Date.now() - startTime} ms`);

  // await Promise.all(remoteGroups.map(_syncGroup));
  // // for (const remoteGroup of remoteGroups) await _syncGroup(remoteGroup);

  // console.log(`finished syncing DB with ${connection.remoteDeviceId} in ${Date.now() - startTime} ms`);
}

const pushDataAlreadySeen: {
  [idPlusModified: string]: true
} = {}
export async function pushData(data: IData, dontBroadcast?: boolean) {
  const idPlusModified = data.id + data.modified;
  if (pushDataAlreadySeen[idPlusModified]) {
    // console.log('already seen so not saving or forwarding data', data);
    return;
  }
  // console.log('starting data save', data);
  pushDataAlreadySeen[idPlusModified] = true;
  const connection: IConnection = currentConnection;
  const db = await getDB();
  const dbData = await db.get(data.id);
  if (!dbData || dbData.modified < data.modified) {
    await db.save(data);
    eventHandlers.onRemoteDataSaved(data);
  }
  if (!dontBroadcast) {
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
}

const remotelyCallableFunctions: { [key: string]: Function } = {
  ping,
  testError,
  getRemoteGroups,
  getRemoteBlockHashes,
  getRemoteIdBlockHashes,
  getRemoteBlockData: getRemoteBlockIds,
  getRemoteData,
  pushData,
  signId,
  streamRemoteDataSync: fastSyncRemote,
}

export function setRemotelyCallableFunction(fn: Function, name?: string) {
  remotelyCallableFunctions[name || fn.name] = fn;
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