import { get, set, isArray, groupBy } from 'lodash';
import { verifySignedObject, ISigned, IUser } from './user';
import { hashObject } from './common';

export interface IData extends ISigned {
  id: string,
  group: string,
  type: 'Group' | 'Deleted' | 'User' | 'any' | string,
  owner: string,
  modified: number,
  [key: string]: any
}

// export const GROUPS_GROUP_ID = 'groups';

export interface IGroupMember {
  userId: string,
  read?: boolean,
  create?: boolean,
  update?: boolean,
  delete?: boolean,
  admin?: boolean,
  expireMS?: number,
}

export interface IGroup extends IData {
  type: 'Group',
  name: string,
  members: IGroupMember[],
  blockedUserIds: string[],
  allowPublicViewers?: boolean,
  allowViewerComments?: boolean,
}

export const usersGroup: IGroup = { type: 'Group', id: 'users', group: 'users', owner: 'users', name: 'Users', modified: Date.now(), members: [], blockedUserIds: [] };

let _personalGroup: IGroup;
export function getPersonalGroup(myId: string) {
  if (!_personalGroup || _personalGroup.id != myId) {
    _personalGroup = { type: 'Group', id: myId, group: myId, owner: myId, name: 'Personal', modified: Date.now(), members: [], blockedUserIds: [] };
  }
  return _personalGroup;
}

// export interface IDataEvent extends ISigned {
//   id: string
//   group: string
//   dataId: string
//   userId: string
// }

// export interface IComment extends IData {
//   type: 'comment',
// }

export type indexes = 'group' | 'type' | 'owner' | 'modified'
  | 'group-modified' | 'type-modified' | 'owner-modified'
  | 'group-type-modified' | 'group-owner-modified';

export interface IDB {
  db: IDBDatabase
  insert: (data: IData | IData[]) => Promise<void>
  update: (data: IData | IData[]) => Promise<void>
  delete: (id: string) => Promise<void>
  get: (id: string) => Promise<IData>
  find: (query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: indexes) => Promise<IData[]>
  openCursor: (query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: indexes, direction?: IDBCursorDirection) => Promise<IDBCursorWithValue>
}


export async function getIndexedDB(
  dbName: string = 'peerstack',
  dbVersion: number = 1,
  onUpgrade?: ((evt: IDBVersionChangeEvent) => Promise<void>)
): Promise<IDB> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    throw new Error('indexedDB is not currently available')
  }
  const db: IDBDatabase = await new Promise(async (resolve, reject) => {
    const request = window.indexedDB.open(dbName, dbVersion);
    request.onerror = evt => reject(new Error('failed to open db: ' + String(evt)));
    request.onsuccess = evt => resolve((evt.target as any).result as IDBDatabase)
    request.onupgradeneeded = evt => {
      if (onUpgrade) return onUpgrade(evt);
      var db = (evt.target as any).result as IDBDatabase;
      if (dbVersion <= 1) {
        const dataStore = db.createObjectStore("data", { keyPath: 'id' });
        dataStore.createIndex("group", 'group', { unique: false })
        dataStore.createIndex("type", 'type', { unique: false })
        dataStore.createIndex("owner", 'owner', { unique: false })
        dataStore.createIndex("modified", 'modified', { unique: false })

        dataStore.createIndex("group-modified", ['group', 'modified'], { unique: false })
        dataStore.createIndex("type-modified", ['type', 'modified'], { unique: false })
        dataStore.createIndex("owner-modified", ['owner', 'modified'], { unique: false })

        dataStore.createIndex("group-type-modified", ['group', 'type', 'modified'], { unique: false })
        dataStore.createIndex("group-owner-modified", ['group', 'owner', 'modified'], { unique: false })
      }
    }
  });

  const insert = (data: IData | IData[]): Promise<any> => new Promise(async (resolve, reject) => {
    if (!isArray(data)) {
      data = [data];
    }
    await validateData(baseOps, data);
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const objectStore = transaction.objectStore('data');
    for (const d of data) {
      const request = objectStore.add(d);
      request.onerror = evt => reject(evt);
    }
    transaction.oncomplete = evt => {
      data.forEach((d: IData) => clearHashCache(d.group));
      resolve((evt.target as any).result);
    };
  });

  const update = (data: IData | IData[]): Promise<any> => new Promise(async (resolve, reject) => {
    if (!isArray(data)) {
      data = [data];
    }
    await validateData(baseOps, data);
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const objectStore = transaction.objectStore('data');
    for (const d of data) {
      const request = objectStore.put(d);
      request.onerror = evt => reject(evt);
    }
    transaction.oncomplete = evt => {
      data.forEach((d: IData) => clearHashCache(d.group));
      resolve((evt.target as any).result);
    };
  });

  const deleteOp = (id): Promise<any> => new Promise(async (resolve, reject) => {
    const dbData = await get(id);
    if (!dbData) return resolve();
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').delete(id);
    request.onerror = evt => reject(evt);
    request.onsuccess = evt => {
      clearHashCache(dbData.group);
      resolve((evt.target as any).result);
    };
  });

  const get = (id: string): Promise<IData> => new Promise(async (resolve, reject) => {
    const transaction = db.transaction(['data'], 'readonly');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').get(id);
    request.onerror = evt => reject(evt);
    request.onsuccess = evt => resolve((evt.target as any).result);
  });

  const find = (query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: indexes): Promise<IData[]> =>
    new Promise(async (resolve, reject) => {
      const transaction = db.transaction(['data'], 'readwrite');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).getAll(query);
      } else {
        request = dataStore.getAll(query);
      }
      request.onerror = evt => reject(evt);
      request.onsuccess = evt => resolve((evt.target as any).result);
    });

  const openCursor = (query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: indexes, direction?: IDBCursorDirection): Promise<IDBCursorWithValue> =>
    new Promise(async (resolve, reject) => {
      const transaction = db.transaction(['data'], 'readwrite');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).openCursor(query, direction);
      } else {
        request = dataStore.openCursor(query, direction);
      }
      request.onerror = evt => reject(evt);
      request.onsuccess = evt => resolve((evt.target as any).result);
    });

  const baseOps: IDB = {
    db,
    insert,
    update,
    delete: deleteOp,
    get,
    find,
    openCursor,
  }

  return baseOps;
}

export const checkPermission = (function <T extends Function>(hasPermission: T): T {
  return <any>async function (...args) {
    const hasPerm = await hasPermission(...args);
    if (!hasPerm) {
      const [userId, group, accessLevel] = args;
      throw new Error(`Signer ${userId} does not have ${accessLevel} permissions in group ${group && group.id || group}`)
    }
  };
})(hasPermission)

const groups: { [groupId: string]: IGroup } = {}
export async function hasPermission(userId: string, group: string | IGroup, accessLevel: 'read' | 'create' | 'update' | 'delete' | 'admin', db?: IDB): Promise<boolean> {
  if (group === 'users' && accessLevel === 'read') {
    return true;
  }
  if (userId == group || (typeof group === 'object' && userId == group.id)) {
    return true;
  }
  if (typeof group === 'string') {
    if (!groups[group]) {
      if (!db) {
        db = await getIndexedDB()
      }
      group = (await db.get(group)) as IGroup;
    } else {
      group = groups[group];
    }
  }
  group = group as IGroup;
  if (group?.type !== 'Group') {
    throw new Error('invalid group specified');
  }
  groups[group.id] = group;
  if (group.owner == userId) {
    // TODO verify user did not set themselves as the owner
    return true;
  }
  const memberWithAccess = group.members.find(m => m.userId === userId && (m[accessLevel] || m.admin));
  return Boolean(memberWithAccess);
}

const users: { [userId: string]: IUser } = {};
export async function validateData(db: IDB, datas: IData[]) {
  const requiredFields = ['modified', 'type', 'group', 'id', 'owner', 'signature', 'signer'];
  for (const data of datas) {
    requiredFields.forEach(f => {
      if (!data[f]) throw new Error(`'${f}' is required on all data but was not found on ${JSON.stringify(data, null, 2)}`);
    })
    if (data.type === 'Group') {
      if (data.id !== data.group) {
        throw new Error(`All groups must have their group set to themselves`)
      }
    }
    else if (data.type === 'User') {
      if (data.group !== 'users') {
        throw new Error(`All users must have their group set to 'users'`);
      }
      if (data.owner !== data.id) {
        throw new Error(`The owner of a user must be that same user`);
      }
      if (data.signer !== data.id) {
        throw new Error(`The signer of a user must be that same user`)
      }
      const dbUser = users[data.id] || await db.get(data.id) as IUser;
      if (dbUser && (data as IUser).publicKey !== dbUser.publicKey) {
        throw new Error(`An attempt was made to update a user but the public keys do not match`);
      }
    }
    const user = data.type === 'User' && (data as IUser) || users[data.signer] || await db.get(data.signer) as IUser;
    if (!user?.id) {
      throw new Error(`Could not identify signer: ${JSON.stringify(data, null, 2)}`);
    }
    try {
      verifySignedObject(data, user.publicKey);
    } catch (err) {
      throw new Error(`Could not verify object signature: ${JSON.stringify({ data, user }, null, 2)}`)
    }
    users[user.id] = user;
    if (data.type == 'User') {
      // users are always allowed to create or update themselves 
      continue;
    }
    try {
      if (data.type === 'Group') {
        await hasPermission(user.id, data as IGroup, 'admin');
      } else {
        const dbData = await db.get(data.id);
        if (dbData && dbData.group != data.group) {
          await checkPermission(user.id, dbData.group, 'delete');
          await checkPermission(user.id, data.group, 'create');
          // } if (dbData && dbData.signature != data.signature) {
        } if (dbData) {
          await checkPermission(user.id, data.group, 'update')
        } else {
          await checkPermission(user.id, data.group, 'create')
        }
      }
    } catch (err) {
      throw new Error(`Permissions error: ${err} \n ${JSON.stringify(data, null, 2)}`)
    }
  }
}

export const BLOCK_SIZE = 60e3 * 60 * 24; // 1 day

export function getBlockId(modified: number) {
  return 'B' + Math.floor(modified / BLOCK_SIZE)
}

export async function getBlockData(group: string, level0BlockId: string) {
  const db = await getIndexedDB();
  const blockNum = Number(level0BlockId.substr(1));
  const lowerTime = blockNum * BLOCK_SIZE;
  const upperTime = lowerTime + BLOCK_SIZE;
  const blockData = await db.find(IDBKeyRange.bound([group, lowerTime], [group, upperTime]), 'group-modified');
  return blockData;
}

export type BlockHashLevel = 'L0' | 'L1';

export const L0BlockHashes: {
  [l1Hash: string]: { [blockId: string]: string }
} = {}

export const L1BlockHashes: {
  [groupId: string]: string
} = {}

function clearHashCache(groupId: string) {
  delete L0BlockHashes[L1BlockHashes[groupId]];
  delete L1BlockHashes[groupId];
}

export async function getBlockHashes(groupId: string, level: BlockHashLevel = 'L0') {
  if (level == 'L1' && L1BlockHashes[groupId]) {
    return L1BlockHashes[groupId];
  }
  if (level == 'L0' && L1BlockHashes[groupId] && L0BlockHashes[L1BlockHashes[groupId]]) {
    return L0BlockHashes[L1BlockHashes[groupId]]
  }
  console.log(`building hash for group ${groupId}`)
  const db = await getIndexedDB();

  const maxTime = Date.now();
  const oldestDataResult = await db.openCursor(null, 'modified');
  const minTime = oldestDataResult?.value?.modified || Date.now();
  const blockHashes = {};

  // populate L0 hashes
  let interval = BLOCK_SIZE * 1000;
  let lowerTime = maxTime - (maxTime % interval);
  let upperTime = lowerTime + interval;
  while (minTime < upperTime) {
    const data = await db.find(IDBKeyRange.bound([groupId, lowerTime], [groupId, upperTime]), 'group-modified');
    lowerTime -= interval;
    upperTime -= interval;
    if (!data.length) continue;
    const grouped = groupBy(data, d => getBlockId(d.modified));
    Object.keys(grouped).forEach(key => {
      set(blockHashes, key, hashObject(grouped[key]));
    })
  }
  L1BlockHashes[groupId] = hashObject(blockHashes);
  L0BlockHashes[L1BlockHashes[groupId]] = blockHashes;
  if (level === 'L1') {
    return L1BlockHashes[groupId]
  } else {
    return blockHashes
  }
}

// export async function buildDBHashes() {
//   if (blockHashes) return blockHashes;
//   modifiedBlockIds = {};
//   blockHashes = {};
//   const db = await getIndexedDB();

//   const maxTime = Date.now();
//   const minTime = (await db.openCursor(null, 'modified')).value.modified;

//   // populate level 0
//   let interval = BLOCK_SIZE * 100;
//   let lowerTime = maxTime - (maxTime % interval);
//   let upperTime = lowerTime + interval;
//   while (minTime < upperTime) {
//     const data = await db.find(IDBKeyRange.bound(lowerTime, upperTime), 'modified');
//     // const data = await db.find(IDBKeyRange.bound(['9c9ba93245d849c593947212b6c2fc11',lowerTime], ['9c9ba93245d849c593947212b6c2fc11',upperTime]), 'group-modified');
//     lowerTime -= interval;
//     upperTime -= interval;
//     if (!data.length) continue;
//     const grouped = groupBy(data, d => d.group + '.L0.' + getBlockId(d.modified));
//     Object.keys(grouped).forEach(key => {
//       set(blockHashes, key, hashObject(grouped[key]));
//     })
//   }

//   const dataLower = await db.find(IDBKeyRange.upperBound(minTime), 'modified');
//   const dataUpper = await db.find(IDBKeyRange.lowerBound(maxTime), 'modified');
//   const dataNull = await db.find(null, 'modified');
//   console.log({ dataLower, dataUpper, dataNull });


//   // populate higher block levels
//   let level = 0;
//   while (BLOCK_SIZE * level ** 10 < maxTime) {
//     level++;
//     Object.keys(blockHashes).forEach(group => {
//       const blocks = Object.keys(blockHashes[group][`L${level-1}`]).sort();
//       let currentHigherBlock = blocks[0].substr(0, blocks[0].length - 1);
//       let hashes = [];
//       blocks.forEach(block => {
//         let higherBlock = block.substr(0, block.length - 1);
//         if (higherBlock != currentHigherBlock && hashes.length) {
//           set(blockHashes, `${group}.L${level}.${currentHigherBlock}`, hashObject(hashes));
//           hashes.length = 0;
//           currentHigherBlock = higherBlock;
//         }
//         hashes.push(blockHashes[group][`L${level-1}`][block]);
//       })
//       if (hashes.length) {
//         set(blockHashes, `${group}.L${level}.${currentHigherBlock}`, hashObject(hashes));
//       }
//     });
//   }

//   return blockHashes;
// }


// export function getMemoryDB(): IDB {
//   const memoryDB: {
//     [id: string]: IData
//   } = {}

//   const baseOps: IDB = {    
//     insert: async data => memoryDB[data.id] = JSON.parse(JSON.stringify(data)),
//     update: async data => memoryDB[data.id] = JSON.parse(JSON.stringify(data)),
//     delete: async id => delete memoryDB[id] as undefined,
//     get: async id => memoryDB[id],
//     find: async (query: string | IDBKeyRange, index?: string) => {
//       const results: IData[] = [];
//       Object.keys(memoryDB).forEach(id => {
//         let testValue = id;
//         if (index) {
//           testValue = get(memoryDB, `${id}.${index}`, null);
//         }
//         if (
//           (typeof query === 'string' && testValue === query) ||
//           (query.includes && query.includes(testValue))
//         ) {
//           results.push(memoryDB[id])
//         }
//       })
//       return results;
//     },
//   }
//   return baseOps
// }



// export async function setupIndexedDBGroupOps(
//   group: string,
//   dbName: string = 'peerstack') 
// {
//   if (typeof window === 'undefined' || !window.indexedDB) {
//     throw new Error('indexdb is not currently available')
//   }
//   const groupStoreName = 'groups';
//   const dbVersion = Date.now();
//   const db: IDBDatabase = await new Promise(async (resolve, reject) => {
//     const request = window.indexedDB.open(dbName, dbVersion);
//     request.onerror = evt => reject(new Error('failed to open db: ' + String(evt)));
//     request.onsuccess = evt => resolve((evt.target as any).result as IDBDatabase)
//     request.onupgradeneeded = async evt => {
//       var db = (evt.target as any).result as IDBDatabase;
//       const { oldVersion } = evt
//       let groupStorePromise = Promise.resolve();
//       if (oldVersion < 1) {
//         groupStorePromise = new Promise((resolve) => {
//           const objectStore = db.createObjectStore(groupStoreName, { keyPath: 'id' });
//           objectStore.transaction.oncomplete = () => resolve();
//         });
//       }
//       await groupStorePromise;
//       if (group === groupStoreName) {
//         resolve(db);
//       }

//       const tx = db.transaction(groupStoreName, 'readonly');
//       tx.onerror = evt => reject(evt);
//       const group = await new Promise((resolve, reject) => {
//         const request = tx.objectStore(groupStoreName).get(group);
//         request.onerror = evt => reject(evt);
//         request.onsuccess = evt => resolve((evt.target as any).result);
//       });
//       if (!group) {
//         // add group
//         const tx = db.transaction(groupStoreName, 'readwrite');
//         tx.onerror = evt => reject(evt);
//         await new Promise((resolve, reject) => {
//           const request = tx.objectStore(groupStoreName).add({ id: group, });
//           request.onerror = evt => reject(evt);
//           request.onsuccess = evt => resolve((evt.target as any).result);
//         });
//         const groupObjectStore = db.createObjectStore(group, { keyPath: 'id' });
//         groupObjectStore.createIndex('type', 'type', { unique: false })
//         groupObjectStore.createIndex('createMS', 'createMS', { unique: false })
//         groupObjectStore.createIndex('updateMS', 'updateMS', { unique: false })

//       }
//       resolve(db);
//     }    
//   });

//   baseOps.get = (group: string, id: string): Promise<IData> => new Promise(async (resolve, reject) => {
//     resolve(null)
//     // const db = await openDb();
//     // const transaction = db.transaction(['data'], 'readonly');
//     // transaction.onerror = evt => reject(evt);
//     // const request = transaction.objectStore('data').get([group, id]);
//     // request.onerror = evt => reject(evt);
//     // request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.insert = (data: IData): Promise<any> => new Promise(async (resolve, reject) => {
//     resolve(null);
//     // const transaction = db.transaction(['data'], 'readwrite');
//     // transaction.onerror = evt => reject(evt);
//     // const request = transaction.objectStore('data').add(data);
//     // request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.update = (data: IData): Promise<any> => new Promise(async (resolve, reject) => {
//     const transaction = db.transaction(['data'], 'readwrite');
//     transaction.onerror = evt => reject(evt);
//     const request = transaction.objectStore('data').put(data);
//     request.onerror = evt => reject(evt);
//     request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.delete = (group, id): Promise<any> => new Promise(async (resolve, reject) => {
//     const transaction = db.transaction(['data'], 'readwrite');
//     transaction.onerror = evt => reject(evt);
//     const request = transaction.objectStore('data').delete([group, id]);
//     request.onerror = evt => reject(evt);
//     request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.find = (group: string, query: string | IDBKeyRange, index?: string): Promise<IData[]> => 
//     new Promise(async (resolve, reject) => {
//       // WIP
//       const transaction = db.transaction(['data'], 'readwrite');
//       transaction.onerror = evt => reject(evt);
//       const dataStore = transaction.objectStore('data');
//       let request: IDBRequest;
//       if (index) {
//         request = dataStore.index(index).getAll(query);
//       } else {
//         request = dataStore.getAll(query);
//       }
//       request.onerror = evt => reject(evt);
//       request.onsuccess = evt => resolve((evt.target as any).result);
//     });
// }

// export async function validateAndSaveComment(data: IComment) {
//   if (data.type !== 'comment') {
//     throw new Error('validateAndSaveComment should only be called with data of type "comment"');
//   }
//   const group = await baseOps.get('groups', data.group) as IGroup;
//   const member = group.members.find(m => m.userId == data.owner);

//   const exists = Boolean(await baseOps.get('groups', data.id));
//   if (!member && group.allowPublicViewers && group.allowViewerComments) {

//   }

//   if (!member && !(group.allowPublicViewers && group.allowViewerComments)) {
//     throw new Error('User is not a group member and public comments are not allowed');
//   }

//   if (
//     !(member.isAdmin || member.isEditor) && 
//     !(data.type === 'comment' && group.allowViewerComments && (group.allowPublicViewers || member.isViewer))
//   ) {
//     throw new Error(`Member does not have write permissions to the group`);
//   }
//   verifySignedObject(data, member.publicKey);

//   if (exists) {
//     return baseOps.update(data);
//   } else {
//     return baseOps.insert(data);
//   }
// }


// export async function validateAndSave(data: IData) {
//   // if (data.type === 'comment') {
//   //   return validateAndSaveComment(data as IComment);
//   // }
//   const group = await baseOps.get(GROUPS_GROUP_ID, data.group) as IGroup;
//   const member = group.members.find(m => m.userId == data.owner);
//   if (!member) {
//     throw new Error(`Owner of data is not a member of the group`);
//   }
//   if (!(member.isAdmin || member.isEditor)) {
//     throw new Error(`Member does not have write permissions to the group`);
//   }
//   verifySignedObject(data, member.publicKey);
//   const exists = Boolean(await baseOps.get(data.group, data.id));
//   if (exists) {
//     return baseOps.update(data);
//   } else {
//     return baseOps.insert(data);
//   }
// }

// export async function validateAndGet(getEvent: IDataEvent) {
//   const { group, userId, dataId } = getEvent;
//   const group = await baseOps.get(GROUPS_GROUP_ID, group) as IGroup;
//   const member = group.members.find(m => m.userId == userId);
//   if (!member && group.allowPublicViewers) {
//     throw new Error(`User is not a member of the group`);
//   }
//   verifySignedObject(getEvent, member.publicKey);
//   return baseOps.get(group, dataId);
// }

// export async function validateAndDelete(deleteEvent: IDataEvent) {
//   const { group, userId, dataId } = deleteEvent;
//   const group = await baseOps.get(GROUPS_GROUP_ID, group) as IGroup;
//   const member = group.members.find(m => m.userId == userId);
//   if (!member) {
//     throw new Error(`User is not a member of the group`);
//   }
//   verifySignedObject(deleteEvent, member.publicKey);
//   const dbData = await baseOps.get(group, dataId);
//   if (!(member.isAdmin || dbData.owner === userId)) {
//     throw new Error(`User must be an admin or owner of the data to delete it`);
//   }
//   return baseOps.delete(group, dataId);
// }


// @ts-ignore
if (typeof window !== 'undefined') window.peerdb = module.exports;
