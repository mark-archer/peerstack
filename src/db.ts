import { compact, groupBy, isArray, isObject, set, sortBy, uniq } from 'lodash';
import { hashObject } from './common';
import { ISigned, IUser, verifySignedObject } from './user';

export interface IData extends ISigned {
  id: string,
  group: string,
  type: 'Group' | 'Deleted' | 'User' | 'any' | string,
  owner: string,
  modified: number,
  subject?: string,
  [key: string]: any
}

export interface IGroupMember {
  userId: string,
  read?: boolean,
  write?: boolean,
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
  apps?: string[],
}

export interface IFile {
  type: 'File'
  id: string
  name: string
  fileType: string
  size: number
  blob: Blob
  isPublic: boolean
  shareUsers: string[]
  shareGroups: string[]
}

export const usersGroup: IGroup = { type: 'Group', id: 'users', group: 'users', owner: 'users', name: 'Users', modified: Date.now(), members: [], blockedUserIds: [] };

let _personalGroup: IGroup;
export function getPersonalGroup(myId: string) {
  if (!_personalGroup || _personalGroup.id != myId) {
    _personalGroup = { type: 'Group', id: myId, group: myId, owner: myId, name: 'Personal', modified: Date.now(), members: [], blockedUserIds: [] };
  }
  return _personalGroup;
}

export type Indexes
  = 'group'
  | 'type'
  | 'owner'
  | 'modified'
  | 'group-type'
  | 'group-owner'
  | 'group-modified'
  | 'type-owner'
  | 'type-modified'
  | 'owner-modified'
  | 'group-type-owner'
  | 'group-type-modified'
  | 'group-owner-modified'
  | 'type-owner-modified'
  | 'group-type-owner-modified'
  | 'subject'
  | 'group-subject'
  | 'type-subject'
  | 'group-type-subject'

export interface ICursor<T = IData> {
  idbRequest: IDBRequest,
  idbCursor: IDBCursorWithValue,
  value: T,
  next: () => Promise<ICursor<T>>
}
export interface IDB {
  db: IDBDatabase
  save: (data: IData | IData[], skipValidation?: boolean) => Promise<void>
  find: <T = IData>(query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: Indexes) => Promise<T[]>
  get: <T = IData>(id: string) => Promise<T>
  delete: (id: string) => Promise<void>
  openCursor: <T = IData>(query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: Indexes, direction?: IDBCursorDirection) => Promise<ICursor<T>>
  files: {
    save: (file: IFile) => Promise<void>
    get: (id: string) => Promise<IFile>
    delete: (id: string) => Promise<void>
  },
  local: {
    save: (data: any) => Promise<void>
    get: (id: string) => Promise<any>
    delete: (id: string) => Promise<void>
  },
}

export interface PeerstackDBOpts {
  dbName?: string,
  dbVersion?: number,
  onUpgrade?: ((evt: IDBVersionChangeEvent) => Promise<void>)
}

export async function getIndexedDB(
  { dbName = 'peerstack', dbVersion = 6, onUpgrade }: PeerstackDBOpts = {}
): Promise<IDB> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('indexedDB is not currently available')
  }

  function createIndex(objectStore: IDBObjectStore, index: Indexes) {
    let keyPath: string[] | string = index.split('-');
    if (keyPath.length == 1) {
      keyPath = keyPath[0];
    }
    objectStore.createIndex(index, keyPath, { unique: false });
  }

  const db: IDBDatabase = await new Promise(async (resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onerror = evt => reject(new Error('failed to open db: ' + String(evt)));
    request.onsuccess = evt => resolve((evt.target as any).result as IDBDatabase)
    request.onupgradeneeded = async evt => {
      const db = (evt.target as any).result as IDBDatabase;
      const oldVersion = evt.oldVersion
      const upgradeTransaction = (evt.target as any).transaction as IDBTransaction;
      if (oldVersion < 1) {
        const dataStore = db.createObjectStore("data", { keyPath: 'id' });
        createIndex(dataStore, 'group');
        createIndex(dataStore, 'type');
        createIndex(dataStore, 'owner');
        createIndex(dataStore, 'modified');

        createIndex(dataStore, 'group-modified');
        createIndex(dataStore, 'type-modified');
        createIndex(dataStore, 'owner-modified');

        createIndex(dataStore, 'group-type-modified');
        createIndex(dataStore, 'group-owner-modified');
      }
      if (oldVersion < 2) {
        const fileStore = db.createObjectStore("files", { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        const dataStore = upgradeTransaction.objectStore('data');
        createIndex(dataStore, 'group-type');
        createIndex(dataStore, 'group-owner');
        createIndex(dataStore, 'type-owner');

        createIndex(dataStore, 'group-type-owner');
        createIndex(dataStore, 'type-owner-modified');

        createIndex(dataStore, 'group-type-owner-modified');
      }
      if (oldVersion < 4) {
        const dataStore = upgradeTransaction.objectStore('data');
        createIndex(dataStore, 'subject');
        createIndex(dataStore, 'group-subject');
        createIndex(dataStore, 'group-type-subject');
      }
      if (oldVersion < 5) {
        const dataStore = upgradeTransaction.objectStore('data');
        createIndex(dataStore, 'type-subject');
      }
      if (oldVersion < 6) {
        const local = db.createObjectStore("local", { keyPath: 'id' });
      }
      if (onUpgrade) await onUpgrade(evt);
    }
  });

  const save = (data: IData | IData[], skipValidation: boolean = false): Promise<any> => new Promise(async (resolve, reject) => {
    if (!isArray(data)) {
      data = [data];
    }
    if (!skipValidation) {
      await validateData(baseOps, data);
    }
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

  const find = <T = IData>(query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: Indexes): Promise<T[]> =>
    new Promise(async (resolve, reject) => {
      const transaction = db.transaction(['data'], 'readonly');
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

  function dbOp(storeName: 'data' | 'files' | 'local', op: 'put' | 'delete' | 'get', value) {
    return new Promise<any>((resolve, reject) => {
      const mode: IDBTransactionMode = op == 'get' ? 'readonly' : 'readwrite';
      const transaction = db.transaction([storeName], mode);
      transaction.onerror = evt => reject(evt);
      const request = transaction.objectStore(storeName)[op](value);
      request.onerror = evt => reject(evt);
      // if (op == 'get') {
      request.onsuccess = evt => resolve((evt.target as any).result);
      // } else {
      //   transaction.oncomplete = evt => resolve((evt.target as any).result);
      // }
    })
  }

  async function deleteOp(id) {
    const dbData = await get(id);
    if (!dbData) return;
    await dbOp('data', 'delete', id);
    clearHashCache(dbData.group);
  }

  const get = (id: string) => dbOp('data', 'get', id);

  const openCursor = <T>(query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: Indexes, direction?: IDBCursorDirection): Promise<ICursor<T>> =>
    new Promise(async (resolve, reject) => {
      const transaction = db.transaction(['data'], 'readonly');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).openCursor(query, direction);
      } else {
        request = dataStore.openCursor(query, direction);
      }
      request.onerror = evt => reject(evt);
      let resolveNext: ((value: ICursor<T>) => void) = resolve;
      const cursorWrapper: ICursor<T> = {
        idbRequest: request,
        idbCursor: null,
        next: null,
        value: null,
      }
      request.onsuccess = evt => {
        const cursor: IDBCursorWithValue = (evt.target as any).result;
        cursorWrapper.idbCursor = cursor;
        if (!cursor) {
          cursorWrapper.next = null;
          cursorWrapper.value = null;
          resolveNext(cursorWrapper)
        } else {
          cursorWrapper.value = cursor.value;
          cursorWrapper.next = () => {
            const nextCursor = new Promise<ICursor<T>>(resolve => resolveNext = resolve);
            cursor.continue();
            return nextCursor;
          }
          resolveNext(cursorWrapper);
        }
      }
    });

  const saveFile = (file: IFile) => {
    if (file.type !== 'File') {
      throw new Error(`type must be 'File'`)
    }
    if (!isArray(file.shareGroups) || !isArray(file.shareUsers)) {
      throw new Error(`shareGroups and shareUsers must be arrays`);
    }
    const requiredFields = ['id', 'name', 'fileType', 'size', 'blob'];
    requiredFields.forEach(key => {
      if (!file[key]) {
        throw new Error(`'${key}' is required but not present`)
      }
    });
    return dbOp('files', 'put', file);
  }
  const getFile = (id: string) => dbOp('files', 'get', id);
  const deleteFile = (id: string) => dbOp('files', 'delete', id);

  const baseOps: IDB = {
    db,
    save,
    delete: deleteOp,    
    get,
    find,
    openCursor,
    files: {
      save: saveFile,
      get: getFile,
      delete: deleteFile,
    },
    local: {
      save: data => dbOp('local', 'put', data),
      get: id => dbOp('local', 'get', id),
      delete: id => dbOp('local', 'delete', id),
    },
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
export async function hasPermission(userId: string, group: string | IGroup, accessLevel: 'read' | 'write' | 'admin', db?: IDB): Promise<boolean> {
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

  // enables propagating deleted groups
  if ((group as any)?.type == 'Deleted' && group.id === group.group) {
    return true
  }
  
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
    if (!isObject(data)) {
      throw new Error('data must be an object')
    }
    requiredFields.forEach(f => {
      if (!data[f]) throw new Error(`'${f}' is required on all data but was not found on ${JSON.stringify(data, null, 2)}`);
    })
    if (data.modified > (Date.now() + 60000)) {
      throw new Error(`modified timestamp cannot be in the future`);
    }
    // TODO verify type is not being changed on existing data (e.g. deleting a user or group)
    if (data.type === 'Group') {
      if (data.id !== data.group) {
        throw new Error(`All groups must have their group set to themselves`);
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
          await checkPermission(user.id, dbData.group, 'write');
          await checkPermission(user.id, data.group, 'write');
        } if (dbData) {
          await checkPermission(user.id, data.group, 'write')
        } else {
          await checkPermission(user.id, data.group, 'write')
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

export async function getGroupUsers(groupId: string): Promise<IUser[]> {
  const db = await getIndexedDB();
  const group = await db.get(groupId) as IGroup;
  if (!group) return [];
  let userIds: string[] = (group.members || []).map(m => m.userId);
  userIds.push(group.owner);
  userIds = uniq(compact(userIds))
  let users = await Promise.all(userIds.map(userId => db.get(userId))) as IUser[];
  users = compact(users);
  users = sortBy(users, 'modified');
  return users;
}

export async function getBlockData(group: string, level0BlockId: string) {
  if (level0BlockId === 'users') {
    return getGroupUsers(group);
  }
  const db = await getIndexedDB();
  const blockNum = Number(level0BlockId.substr(1));
  const lowerTime = blockNum * BLOCK_SIZE;
  const upperTime = lowerTime + BLOCK_SIZE;
  const blockData = await db.find(IDBKeyRange.bound([group, lowerTime], [group, upperTime]), 'group-modified');
  return blockData;
}

export const L5BlockHashes: {
  [groupId: string]: { [blockId: string]: string }
} = {}

function clearHashCache(groupId: string) {
  // TODO this could be done much cleaner by sending in the old and new L5 block id
  if (groupId === 'users') {
    // TODO make sure this is working correctly
    // if a user is changed just clear the entire cache for now
    Object.keys(L5BlockHashes).forEach(_groupId => {
      delete L5BlockHashes[_groupId]['users']
      delete blockHashes[groupId]
    })

  } else {
    delete L5BlockHashes[groupId];
    delete blockHashes[groupId]
  }
}

const blockHashes: {
  [groupId: string]: {
    [detailLevel: string]: { [blockId: string]: string }
  }
} = {};

// l0BlockId example: B18664 | users
export async function getBlockHashes(groupId: string, detailLevel: number = 0) {
  if (detailLevel >= 6) {
    detailLevel = 5;
  }
  if (blockHashes[groupId] && blockHashes[groupId][detailLevel]) {
    return blockHashes[groupId][detailLevel];
  }
  if (detailLevel >= 5) {
    const _blockHashes = await getDetailHashes(groupId) as any as { [blockId: string]: string }
    set(blockHashes, `${groupId}.${detailLevel}`, _blockHashes);
    return _blockHashes;
  } else {
    const nextLevel = await getBlockHashes(groupId, detailLevel + 1);
    const keyed = Object.entries(nextLevel).map(([blockId, hashes]) => ({
      blockId,
      hashes
    }))
    const grouped = groupBy(keyed, data => data.blockId.substr(0, data.blockId.length - 1) || 'u');
    const _blockHashes = {};
    Object.keys(grouped).forEach(key => {
      set(_blockHashes, key, hashObject(grouped[key])); // maybe speed up by only hashing id+modified
    });
    set(blockHashes, `${groupId}.${detailLevel}`, _blockHashes);
    return _blockHashes;
  }
}

export async function getBlockIdHashes(groupId: string, blockId: string) {
  const detailLevel = blockId.length || 1;
  const blockHashes = await getBlockHashes(groupId, detailLevel)
  const blockIdHashes: { [blockId: string]: string } = {}
  Object.keys(blockHashes).forEach(key => {
    if (key.startsWith(blockId)) {
      blockIdHashes[key] = blockHashes[key];
    }
  })
  return blockIdHashes;
}

export async function getDetailHashes(groupId: string) {
  if (L5BlockHashes[groupId]) {
    return L5BlockHashes[groupId]
  }
  // console.log(`building hash for group ${groupId}`)
  const db = await getIndexedDB();

  const maxTime = Date.now();
  const cursorModified = await db.openCursor(null, 'modified');
  const minTime = cursorModified?.value?.modified || Date.now();
  const blockHashes = {};

  // include any users in this group as 'users' block
  blockHashes['users'] = hashObject(await getGroupUsers(groupId))

  // populate L0 hashes
  let interval = BLOCK_SIZE * 1000; // this gets 1k days at a time but groups them by day which is block0
  let lowerTime = maxTime - (maxTime % interval);
  let upperTime = lowerTime + interval;
  while (minTime < upperTime) {
    let data = await db.find(IDBKeyRange.bound([groupId, lowerTime], [groupId, upperTime]), 'group-modified');
    lowerTime -= interval;
    upperTime -= interval;
    if (!data.length) continue;
    // speed up and improve reliability by only hashing id+modified
    data = data.map(d => ({ id: d.id, modified: d.modified } as any))
    const grouped = groupBy(data, d => getBlockId(d.modified));
    Object.keys(grouped).forEach(key => {
      set(blockHashes, key, hashObject(grouped[key]));
    })
  }
  L5BlockHashes[groupId] = blockHashes;
  return blockHashes  
}

// @ts-ignore
if (typeof window !== 'undefined') window.peerdb = module.exports;
