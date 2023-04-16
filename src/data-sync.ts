import * as _ from "lodash";
import { uniq } from "lodash";
import { newid, parseJSON, sleep, stringify } from "./common";
import { connections, chunkSize, me, IDeviceConnection, deviceConnections } from "./connections";
import { checkPermission, getBlockIds, getDetailHashes, getBlockIdHashes, getDB, hasPermission, IData, IDB, IGroup, getGroupUsersHash, getPersonalGroup } from "./db";
import { ingestChange, IDataChange } from "./data-change";
import { getBlockChangeInfo, getPrefixHashes } from "./data-change-sync";
import { eventHandlers, getCurrentConnection, IConnection, ping, RPC, setRemotelyCallableFunction, verifyRemoteUser } from "./remote-calls";


async function getRemoteGroups() {
  const connection: IConnection = getCurrentConnection();
  await verifyRemoteUser(connection);
  const db = await getDB();
  const allGroups = (await db.find('Group', 'type')) as IGroup[];
  const readGroups: IGroup[] = []
  if (connection.remoteUser?.id === me.id) {
    readGroups.push(getPersonalGroup(me.id));
  }
  for (const group of allGroups) {
    if (await hasPermission(connection.remoteUser?.id, group, 'read', db)) {
      readGroups.push(group);
    }
  }
  return readGroups;
}

async function getRemoteBlockIds(groupId: string, level0BlockId: string) {
  const connection: IConnection = getCurrentConnection();
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getBlockIds(groupId, level0BlockId);
}

async function getRemoteData(id: string) {
  const connection: IConnection = getCurrentConnection();
  const db = await getDB();
  const data = await db.get(id);
  await checkPermission(connection.remoteUser?.id, data.group, 'read');
  return data;
}

const groupUserHashes: { [groupId: string]: string } = {};

async function getRemoteGroupUsers(groupId: string, remoteHash: string) {
  const connection: IConnection = getCurrentConnection();
  if (groupUserHashes[groupId] === remoteHash) {
    return [];
  }
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  const { hash: localHash, users } = await getGroupUsersHash(groupId);
  groupUserHashes[groupId] = localHash;
  if (localHash === remoteHash) {
    return [];
  } else {
    return users;
  }
}

async function getRemoteBlockHashes(groupId: string) {
  const connection: IConnection = getCurrentConnection();
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getDetailHashes(groupId);
}

async function getRemoteIdBlockHashes(groupId: string, blockId: string) {
  const connection: IConnection = getCurrentConnection();
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getBlockIdHashes(groupId, blockId);
}

async function getRemotePrefixHashes(groupId: string, blockPrefix = 'B') {
  const connection: IConnection = getCurrentConnection();
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getPrefixHashes(groupId, blockPrefix);
}

async function getRemoteBlockChangeInfo(groupId: string, blockId: string) {
  const connection: IConnection = getCurrentConnection();
  await checkPermission(connection.remoteUser?.id, groupId, 'read');
  return getBlockChangeInfo(groupId, blockId);
}

async function getRemoteDataChange(id: string) {
  const connection: IConnection = getCurrentConnection();
  const db = await getDB();
  const change = await db.changes.get(id);
  await checkPermission(connection.remoteUser?.id, change.group, 'read');
  return change;
}

async function fastSyncDataChangesRemote(groupId: string, dataChannelLabel: string, lastModified: number) {
  new Promise<void>(async (resolve) => {
    try {
      const _connection: IConnection = getCurrentConnection();
      const connection = connections().find(c => c.id === _connection.id);
      await checkPermission(_connection.remoteUser?.id, groupId, 'read');

      const dc = await connection.pc.createDataChannel(dataChannelLabel);
      let dcClosed = false;
      dc.onclose = () => dcClosed = true;

      const db = await getDB();

      // TODO try opening 3 dataChange cursors: one for normal data, one for users, one for types
      //    if user or type is oldest modified and relevant for group, send that, otherwise send data
      //    increment whichever one is sent, keep going until they area all done

      const cursor = await db.changes.openCursor(groupId, lastModified ?? undefined);
      while (await cursor.next()) {
        const doc = cursor.value;
        const json = stringify(doc);
        // if bigger than chunkSize need to send slow way because it'll overflow the buffer
        if (json.length > chunkSize) {
          // TODO create `pushDataChange` fn and call for all connections in `commitChange`
          // await RPC(connection, pushDataChange)(doc, true);
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

async function fastSyncDataChanges(connection: IDeviceConnection, groupId: string) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const skipValidation = connection.remoteUser.id === me.id;
      const db = await getDB();

      const lastModifiedCursor = await db.changes.openCursor(groupId, Infinity, 'prev');
      await lastModifiedCursor.next();
      const lastModified = lastModifiedCursor.value?.modified || -Infinity;

      const dcLabel = `stream-sync-changes-${groupId}-${newid()}`;
      await RPC(connection, fastSyncDataChangesRemote)(groupId, dcLabel, lastModified);

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
            console.log(`no remote data to process, going to sleep and will check again`);
            await sleep(1); // TODO this value should be tuned
            continue;
          }
          const changes: IDataChange[] = remoteJsonData.map(json => parseJSON(json));
          remoteJsonData.length = 0;

          const changedDocs: { [id: string]: IData } = {};
          for (const change of changes) {
            try {
              // NOTE this is very expensive - it does verification, validation, merges the change in with the existing data, _and_ writes the data to disk
              //  if syncing with self it'll skip verification and validation which is most the work
              //  it'll short-circuit if we already have the change
              const doc = await ingestChange(change, undefined, skipValidation);
              if (doc) {
                changedDocs[doc.id] = doc;
              }
            } catch (err) {
              console.error(`error ingesting remote data change`, change, err);
            }
          }
          Object.values(changedDocs).map(doc => eventHandlers.onRemoteDataSaved(doc));
          console.log(`ingestDataChanges ${changes.length} docs`);
        } catch (err) {
          console.error('error processing remote data during fast sync', err);
        }
      }
    } catch (err) {
      reject(err);
    }
    console.log(`finished fast syncing dataChanges from ${connection.remoteDeviceId} for group ${groupId}`);
    resolve();
  });
}

async function fastSyncDataRemote(groupId: string, dataChannelLabel: string, lastModified: number) {
  new Promise<void>(async (resolve) => {
    try {
      const _connection: IConnection = getCurrentConnection();
      const connection = connections().find(c => c.id === _connection.id);
      await checkPermission(_connection.remoteUser?.id, groupId, 'read');

      const dc = await connection.pc.createDataChannel(dataChannelLabel);
      let dcClosed = false;
      dc.onclose = () => dcClosed = true;

      const db = await getDB();
      const cursor = await db.openCursor({ lower: [groupId, lastModified], upper: [groupId, Infinity] }, 'group-modified', 'next');
      while (await cursor.next()) {
        const doc = cursor.value;
        const json = stringify(doc);
        // if bigger than chunkSize need to send slow way because it'll overflow the buffer
        if (json.length > chunkSize) {
          // await RPC(connection, pushData)(doc, true);
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

async function fastSyncData(connection: IDeviceConnection, groupId: string) {
  return new Promise<void>(async (resolve, reject) => {
    try {
      await verifyRemoteUser(connection)
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
      await RPC(connection, fastSyncDataRemote)(groupId, dcLabel, lastModified);
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
            console.log(`no remote data to process, going to sleep and will check again`);
            await sleep(1); // TODO this value should be tuned
            continue;
          }
          const docs: IData[] = remoteJsonData.map(json => parseJSON(json));
          remoteJsonData.length = 0;
          await db.save(docs, skipValidation);
          docs.map(doc => eventHandlers.onRemoteDataSaved(doc));
          console.log(`fastSynced ${docs.length} docs`);
        } catch (err) {
          console.error('error processing remote data during fast sync', err);
        }
      }
    } catch (err) {
      reject(err);
    }
    console.log(`finished fast syncing data from ${connection.remoteDeviceId} for group ${groupId}`);
    resolve();
  });
}

let pendingDeepSyncDataChanges = Promise.resolve();
async function deepSyncDataChanges(connection: IDeviceConnection, db: IDB, groupId: string, blockPrefix?: string) {
  // const trustedUser = connection.remoteUser.id === me.id ||  await hasPermission(connection.remoteUser.id, groupId, 'admin');
  const skipValidation = connection.remoteUser.id === me.id;
  let unlockSync: () => any;
  let blockSyncLock = new Promise<void>((resolve) => {
    unlockSync = resolve;
  })
  let thisBlockSync = pendingDeepSyncDataChanges.then(async () => {
    if (blockPrefix) {
      console.log(`syncing dataChanges ${groupId} block ${blockPrefix}`);
    }
    let localHashes = await getPrefixHashes(groupId, blockPrefix);
    const remoteHashes = await RPC(connection, getRemotePrefixHashes)(groupId, blockPrefix);
    // sort and don't reverse, we do oldest first so we don't prevent fastSync if things are interrupted and then restarted
    //  Note that this is including local hash prefixes which remote might not have any data for but we want to be safe and check
    const blockPrefixes = uniq([...Object.keys(localHashes), ...Object.keys(remoteHashes)]).sort();

    for (let blockPrefix of blockPrefixes) {
      const localHash = localHashes[blockPrefix];
      const remoteHash = remoteHashes[blockPrefix];
      if (localHash != remoteHash) {
        if (blockPrefix.length < 9) {
          unlockSync();
          await deepSyncDataChanges(connection, db, groupId, blockPrefix);
        } else {
          const blockId = blockPrefix;
          const remoteBlockChangeInfo = await RPC(connection, getRemoteBlockChangeInfo)(groupId, blockId);
          for (const remoteChangeInfo of remoteBlockChangeInfo) {
            const localChange = await db.changes.get(remoteChangeInfo.id);
            if (!localChange || localChange.modified < remoteChangeInfo.modified) {
              await RPC(connection, getRemoteDataChange)(remoteChangeInfo.id)
                .then(async remoteChange => {
                  const doc = await ingestChange(remoteChange, undefined, skipValidation);
                  if (doc) {
                    eventHandlers.onRemoteDataSaved(doc);
                  }
                })
                .catch(err => {
                  console.error('error syncing remote change', remoteChangeInfo, err);
                })
            }
          }
        }
      }
    }
  });
  pendingDeepSyncDataChanges = Promise.race([thisBlockSync, blockSyncLock]).catch(err => console.error(`error while syncing blockId`, { groupId, blockId: blockPrefix }, err));
  await thisBlockSync;
}

let pendingDeepSyncData = Promise.resolve();
async function deepSyncData(connection: IDeviceConnection, db: IDB, groupId: string, blockId: string = '') {
  const trustedUser = connection.remoteUser.id === me.id || await hasPermission(connection.remoteUser.id, groupId, 'admin');
  if (!trustedUser) {
    return;
  }
  let unlockSync: () => any;
  let blockSyncLock = new Promise<void>((resolve) => {
    unlockSync = resolve;
  })
  let thisBlockSync = pendingDeepSyncData.then(async () => {
    if (blockId) {
      console.log(`syncing data with admin ${connection.remoteUser?.id} for group ${groupId}, block ${blockId}`);
    }
    let localHashes = await getBlockIdHashes(groupId, blockId);
    const remoteHashes = await RPC(connection, getRemoteIdBlockHashes)(groupId, blockId);
    // sort and don't reverse so we do oldest first so we avoid interfering with fastSync if things are interrupted and then restarted
    const blockIds = Object.keys(remoteHashes).sort();

    const tryFastSync = blockId == "" && blockIds.some(bid => bid !== 'u' && localHashes[bid] !== remoteHashes[bid]);
    if (tryFastSync) {
      console.log(`fastSync starting ${groupId}`);
      console.time(`fastSync ${groupId}`);
      await fastSyncData(connection, groupId).catch(err => console.error('error during fastSync', err));
      console.timeEnd(`fastSync ${groupId}`);
      localHashes = await getBlockIdHashes(groupId, blockId);
    }

    for (let blockId of blockIds) {
      const localHash = localHashes[blockId];
      const remoteHash = remoteHashes[blockId];
      if (localHash != remoteHash) {
        if (blockId.length < 6 && !blockId.startsWith('u')) {
          unlockSync();
          await deepSyncData(connection, db, groupId, blockId);
        } else {
          if (blockId.startsWith('u')) {
            blockId = 'users';
          }
          const remoteBlockData = await RPC(connection, getRemoteBlockIds)(groupId, blockId);
          for (const remoteData of remoteBlockData) {
            const localData = await db.get(remoteData.id);
            if (!localData || localData.modified < remoteData.modified) {
              await RPC(connection, getRemoteData)(remoteData.id)
                .then(async remoteData => {
                  const alwaysValidate = ['Group', 'User', 'Type'].includes(remoteData.type);
                  // we're only syncing with trustedUsers so we can usually skip validation
                  const skipValidation = !alwaysValidate;
                  await db.save(remoteData, skipValidation);
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
  pendingDeepSyncData = Promise.race([thisBlockSync, blockSyncLock]).catch(err => console.error(`error while syncing blockId`, { groupId, blockId }, err));
  await thisBlockSync;
}

async function syncAllGroupData(connection: IDeviceConnection, groupId: string) {
  await verifyRemoteUser(connection);
  const db = await getDB();

  // sync users
  const { hash: localHash, users } = await getGroupUsersHash(groupId);
  const remoteUsers = await RPC(connection, getRemoteGroupUsers)(groupId, localHash);
  for (const remoteUser of remoteUsers) {
    const localUser = users.find(u => u.id === remoteUser.id);
    if (localUser && localUser.modified >= remoteUser.modified) continue;
    await db.save(remoteUser);
  }

  // TODO: sync types

  // go directly to `deepSyncData` if we don't have any data for this group yet
  //  syncing changes, then data can be _very_ slow
  const groupDataCursor = await db.openCursor({ lower: [groupId, -Infinity], upper: [groupId, Infinity] }, 'group-modified');
  let hasData = false;
  while (await groupDataCursor.next()) {
    if (groupDataCursor.value && groupDataCursor.value.type !== 'Group') {
      hasData = true;
      break;
    }
  }
  if (!hasData) {
    deepSyncData(connection, db, groupId);
    return;
  }

  // fast sync data changes
  await fastSyncDataChanges(connection, groupId);

  // deep sync data changes
  //  don't await, just queue up
  deepSyncDataChanges(connection, db, groupId)
    .then(() => {
      console.log(`finished deep syncing dataChanges from ${connection.remoteDeviceId} for group ${groupId}`);
      return deepSyncData(connection, db, groupId)
    })
    .then(() => {
      console.log(`finished deep syncing data from ${connection.remoteDeviceId} for group ${groupId}`);
    });
}

interface SyncInfo {
  connection: IDeviceConnection;
  group: IGroup;
  resolve: (() => void);
  reject: (() => void);
  priority: 1 | 2 | 3;
}
let syncInfos: SyncInfo[] = [];

async function getNextGroupInfoToSync(infos: SyncInfo[] = syncInfos): Promise<SyncInfo> {
  if (!infos.length) return null;

  const filters: ((si: SyncInfo) => boolean)[] = [
    // priorities 
    si => si.priority === 1,
    si => si.priority === 2,

    // personal groups
    si => si.group.id === me.id,

    // active groups
    si => !si.group.inactive,
  ]

  // if any filter reduces the list of possibilities, recurse with that smaller list
  for (const filter of filters) {
    const filtered = infos.filter(filter);
    if (filtered.length > 0 && filtered.length < infos.length) {
      return getNextGroupInfoToSync(filtered)
    }
  }

  // if we only have 1 at this point just return that.
  if (infos.length === 1) {
    return infos[0];
  }

  // TODO prefer group admins
  // TODO prefer group hosts
  // TODO prefer devices that I've synced with most recently
  // TODO prefer users that I trust (me being most trustworthy)

  // prefer faster connections
  const uniqConns = uniq(infos.map(si => si.connection));
  const fastest = await Promise.race(uniqConns.map(async conn => {
    await RPC(conn, ping)();
    return conn;
  }));
  // TODO this can stall out, there should be a `errorAfterTimeout` call
  const nextSync = syncInfos.find(si => si.connection === fastest);
  return nextSync;
}

let pid = 0;
function syncGroupBackground() {
  if (pid) return;
  pid = setTimeout(async () => {
    try {
      let si = await getNextGroupInfoToSync();
      if (!si) {
        pid = 0;
        return;
      }

      // sync changes
      await syncAllGroupData(si.connection, si.group.id);

      // remove done and not-doing (simultaneously resolving their promises)
      syncInfos = syncInfos.filter(si2 => {
        const doneOrNotDoing =
          // same device and group (including this one)
          (si.group.id === si2.group.id && si.connection.remoteDeviceId === si2.connection.remoteDeviceId) ||
          // or connection closed
          si2.connection.closed;
        if (doneOrNotDoing) {
          si2.resolve();
        }
        return !doneOrNotDoing;
      });

    } catch (err) {
      console.error(`error during syncGroupBackground`, err);
    }

    // trigger next sync
    pid = 0;
    syncGroupBackground(); // trampolined recursive call
  })
}

export async function syncGroup(connection: IDeviceConnection, remoteGroup: IGroup, priority: 1 | 2 | 3 = 2) {
  let resolve, reject;
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  const syncInfo = {
    priority,
    connection,
    group: remoteGroup,
    resolve,
    reject
  };
  syncInfos.push(syncInfo);
  syncGroupBackground();
  return promise;
}

export async function syncDBs(connection: IConnection) {
  const deviceConnection = Object.values(deviceConnections).find(c => c.id === connection.id);
  if (!deviceConnection) {
    console.warn('device connection not found');
    return;
  }
  let remoteGroups = await RPC(deviceConnection, getRemoteGroups)();
  return Promise.all(remoteGroups.map((group: IGroup) => syncGroup(deviceConnection, group)));
}


const changesAlreadySeen: {
  [id: string]: true
} = {}
export async function pushDataChange(change: IDataChange, dontBroadcast?: boolean) {
  const id = change.id
  if (changesAlreadySeen[id]) {
    return;
  }
  changesAlreadySeen[id] = true;
  const connection: IConnection = getCurrentConnection();
  await verifyRemoteUser(connection);
  const db = await getDB();
  const dbChange = await db.changes.get(id);
  if (!dbChange) {
    const doc = await ingestChange(change);
    if (doc) {
      eventHandlers.onRemoteDataSaved(doc);
    }
  }
  if (!dontBroadcast) {
    connections().forEach(async _connection => {
      // this data was probably pushed from the current connection so resist forwarding it to that one but if it's the only connection available push it to try to get it propagating
      if (connection == _connection && connections().length > 1) {
        return;
      }
      // only push data if the user has indicated it is interested in this group
      if (_connection.groups?.some(groupId => groupId == change.group)) {
        // verified user has read permission to this group otherwise this is a security hole
        if (await hasPermission(connection.remoteUser.id, change.group, 'read')) {
          RPC(_connection, pushDataChange)(change);
        }
      }
    });
  }
}

Object.entries({
  getRemoteGroups,
  getRemoteGroupUsers,
  getRemoteBlockHashes,
  getRemoteIdBlockHashes,
  getRemoteBlockIds,
  getRemoteData,
  getRemotePrefixHashes,
  getRemoteBlockChangeInfo,
  getRemoteDataChange,
  fastSyncDataChangesRemote,
  fastSyncDataRemote,
  pushDataChange,
}).forEach(([name, fn]) => setRemotelyCallableFunction(fn, name));