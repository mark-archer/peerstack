import { compact, groupBy, isArray, isObject, set, sortBy, uniq } from 'lodash';
import { hashObject, idTime, isid_v1 } from './common';
import { ISigned, IUser, keysEqual, verifySigner } from './user';
import * as dbix from './dbix'
import { IDataChange } from './data-change';
import { Event } from './events';

export const events = {
  dataSaved: new Event<IData>('DataSaved'),
  dataDeleted: new Event<IData>('DataDeleted'),
}

export interface IData extends ISigned {
  id: string
  group: string
  type: 'Group' | 'Deleted' | 'User' | 'any' | string
  modified: number
  subject?: string
  ttl?: number // date in ms after which the data should be deleted

  [key: string]: any // TODO this should probably be removed
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
  owner: string,
  members: IGroupMember[],
  blockedUserIds: string[],
  allowPublicViewers?: boolean,
  allowViewerComments?: boolean,
  apps?: string[],
  inactive?: boolean
}

export function isGroup(data: IData): data is IGroup {
  return data.type === "Group";
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

export interface IKVIndex extends IData {
  type: 'Index'
  dataKey: string // the name of the field to index
  dataType?: string // if no dataType is specified index will apply to _all_ data in group    
}

export const usersGroup: IGroup = {
  type: 'Group',
  id: 'users',
  group: 'users',
  owner: 'users',
  name: 'Users',
  modified: Date.now(),
  members: [],
  blockedUserIds: []
};

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
  | 'modified'
  | 'group-type'
  | 'group-modified'
  | 'type-modified'
  | 'group-type-modified'
  | 'subject'
  | 'group-subject'
  | 'type-subject'
  | 'group-type-subject'
  | IKVIndex

export interface ICursor<T> {
  value: T
  next: () => Promise<T | boolean>
}

export type DBCursorDirection = "next" | "nextunique" | "prev" | "prevunique";

export type DBKeyValue = string | number | Date

export type DBKeyArray = DBKeyValue[]

export interface DBKeyRange {
  lower?: DBKeyValue | DBKeyArray,
  upper?: DBKeyValue | DBKeyArray,
  lowerOpen?: boolean,
  upperOpen?: boolean
}

export type DBQuery = DBKeyValue | DBKeyArray | DBKeyRange

export interface IDB {
  save: (data: IData | IData[], skipValidation?: boolean) => Promise<void>
  get: <T extends IData>(id: string) => Promise<T>
  delete: (id: string) => Promise<void>
  find: <T = IData>(query?: DBQuery, index?: Indexes) => Promise<T[]>
  openCursor: <T extends IData>(query?: DBQuery, index?: Indexes, direction?: DBCursorDirection) => Promise<ICursor<T>>
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
  changes: {
    save: (data: IDataChange | IDataChange[]) => Promise<void>
    get: (id: string) => Promise<IDataChange>
    delete: (id: string) => Promise<void>
    openCursor: (group: string, modified?: number, direction?: IDBCursorDirection) => Promise<ICursor<IDataChange>>
    getSubjectChanges: (subject: string, modified?: number) => Promise<IDataChange[]>
  },
}

export interface PeerstackDBOpts {
  dbName?: string,
  dbVersion?: number,
  onUpgrade?: ((evt: any) => Promise<void>),
  persistenceLayer?: IPersistenceLayer,
  [key: string]: any
}

export interface IPersistenceLayer {
  init: (opts: PeerstackDBOpts) => Promise<IDB>
}


let dbPromise: Promise<IDB>;
export async function init(opts?: PeerstackDBOpts): Promise<IDB> {
  if (dbPromise) {
    return dbPromise;
  }
  let db: IDB;
  let resolveDbPromise
  dbPromise = new Promise(resolve => resolveDbPromise = resolve);

  let persistenceLayer = opts?.persistenceLayer;
  if (!persistenceLayer) {
    if (typeof indexedDB !== 'undefined') {
      persistenceLayer = dbix;
    } else {
      throw new Error('Indexed DB not available.  You must implement a persistence layer.')
      // persistenceLayer = dbrealm;
    }
  }

  // else {
  //   persistenceLayer = dbfs;
  //   if (!(opts as dbrealm.DBFSOpts)._fs) {
  //     const fs = require('react-native-fs');
  //     (opts as dbrealm.DBFSOpts)._fs = {
  //       readFile: path => fs.readFile(fs.DocumentDirectoryPath + '/' + path, 'utf8'),
  //       listFiles: path => fs.readDir(fs.DocumentDirectoryPath + '/' + path).then(results => results.map(r => r.name)),
  //       writeFile: (path, data) => fs.writeFile(fs.DocumentDirectoryPath + '/' + path, data),
  //       deleteFile: path => fs.unlink(fs.DocumentDirectoryPath + '/' + path),
  //       mkdir: path => fs.mkdir(fs.DocumentDirectoryPath + '/' + path),
  //       exists: path => fs.exists(path),
  //     }
  //   }
  // }
  const _db = await persistenceLayer.init(opts);

  db = { ..._db, files: { ..._db.files }, local: { ..._db.local } };

  db.save = async (data: IData | IData[], skipValidation: boolean = false, skipVerification: boolean = skipValidation) => {
    if (!isArray(data)) {
      data = [data];
    }
    if (!skipValidation) {
      await validateData(db, data);
    }
    if (!skipVerification) {
      for (const dat of data) {
        await verifySigner(dat);
      }
    }
    await _db.save(data);
    data.forEach((d: IData) => {
      clearHashCache(d.group);
      events.dataSaved.emit(d);
    });
  };

  // NOTE: delete has very little use since deleting data that has already propagated to other devices will just get recreated when syncing with those devices
  //       Currently the only way to remove data from the network is to change it's type to "Deleted" and remove all non-required fields
  db.delete = async (id) => {
    const dbData = await _db.get(id);
    // NOTE: no real validation is here because this only affects local, you can only affect network with updates (`save`) which is heavily validated
    if (!dbData) return;
    await _db.delete(id);
    clearHashCache(dbData.group);
    events.dataDeleted.emit(dbData);
  }

  db.files.save = (file: IFile) => {
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
    return _db.files.save(file);
  }

  resolveDbPromise(db);
  return dbPromise;
}

// TODO this is redundant with `init` and should probably be deprecated
export async function getDB(): Promise<IDB> {
  return init();
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

export const groups: { [groupId: string]: IGroup } = {};
export const users: { [userId: string]: IUser } = {};

export async function getGroup(groupId: string, forceRefresh?: boolean) {
  if (forceRefresh || !groups[groupId]) {
    groups[groupId] = await (await getDB()).get(groupId) as IGroup;
  }
  return groups[groupId];
}

export async function getUser(userId: string, forceRefresh?: boolean) {
  if (forceRefresh || !users[userId]) {
    users[userId] = await (await getDB()).get(userId) as IUser;
  }
  return users[userId];
}

export async function hasPermission(userId: string, group: string | IGroup, accessLevel: 'read' | 'write' | 'admin', db?: IDB): Promise<boolean> {
  if (['users', 'types'].includes(group as any) && accessLevel === 'read') {
    return true;
  }
  if (userId == group || (typeof group === 'object' && userId == group.id)) {
    return true;
  }
  if (typeof group === 'string') {
    group = await getGroup(group);
  }

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

export async function validateData(db: IDB, datas: IData[]) {
  const requiredFields = ['modified', 'type', 'group', 'id', 'signature', 'signer'];
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
    if (!isid_v1(data.id) && idTime(data.id) > (Date.now() + 60000)) {
      throw new Error(`time part of id cannot be in the future`);
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
      if (data.signer !== data.id) {
        throw new Error(`The signer of a user must be that same user`)
      }
      const dbUser = await getUser(data.id);
      if (dbUser && !keysEqual((data as IUser).publicKey, dbUser.publicKey)) {
        // This intentionally prevents a user from being rekeyed via a normal update.  
        // TODO We need a special function to allow a user to rekey themselves. 
        throw new Error(`An attempt was made to update a user but the public keys do not match`);
      }
    }
    const user = data.type === 'User' && (data as IUser) || await getUser(data.signer);
    if (!user?.id) {
      throw new Error(`Could not identify signer: ${JSON.stringify(data, null, 2)}`);
    }
    users[user.id] = user;
    if (data.type == 'User') {
      continue; // users are always allowed to create or update themselves
    }
    try {
      if (data.type === 'Group') {
        await hasPermission(user.id, data as IGroup, 'admin');
      } else {
        const dbData = await db.get(data.id);
        if (dbData && dbData.modified > data.modified) {
          throw new Error('modified must be newer than the existing doc in db')
        }
        if (dbData && dbData.group != data.group) {
          await checkPermission(user.id, dbData.group, 'write');
          await checkPermission(user.id, data.group, 'write');
        } else {
          await checkPermission(user.id, data.group, 'write')
        }
        if (dbData && dbData.type === 'Index' && data.type !== 'Index') {
          // call delete to remove index entries because this is no longer going to be an Index
          await db.delete(data.id);
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
  const db = await getDB();
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

export async function getBlockIds(group: string, level0BlockId: string): Promise<{ id: string, modified: number }[]> {
  if (level0BlockId === 'users') {
    return getGroupUsers(group);
  }
  const db = await getDB();
  const blockNum = Number(level0BlockId.substr(1));
  const lowerTime = blockNum * BLOCK_SIZE;
  const upperTime = lowerTime + BLOCK_SIZE;
  // const blockData = await db.find(IDBKeyRange.bound([group, lowerTime], [group, upperTime]), 'group-modified');
  const blockData = await db.find({ lower: [group, lowerTime], upper: [group, upperTime] }, 'group-modified');
  return blockData.map(d => ({ id: d.id, modified: d.modified }));
}

export const L5BlockHashes: {
  [groupId: string]: { [blockId: string]: string }
} = {};

export const blockHashes: {
  [groupId: string]: {
    [detailLevel: string]: { [blockId: string]: string }
  }
} = {};

export function clearHashCache(groupId: string) {
  // TODO this could be done much cleaner by sending in the old and new L5 block id (old and new modified date)
  //      Then all you have to do is recalculate the old and new block which should be much faster
  if (groupId === 'users') {
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

// l0BlockId example: B18664 | users
export async function getBlockHashes(groupId: string, detailLevel: number = 0) {
  if (detailLevel > 5) {
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
  const db = await getDB();

  const maxTime = Date.now();
  const cursorModified = await db.openCursor(null, 'modified');
  await cursorModified.next();

  const minTime = cursorModified?.value?.modified || Date.now();
  const blockHashes = {};

  // include any users in this group as 'users' block
  blockHashes['users'] = hashObject(await getGroupUsers(groupId))

  // populate L0 hashes
  let interval = BLOCK_SIZE * 1000; // this gets 1k days at a time but groups them by day which is block0
  let lowerTime = maxTime - (maxTime % interval);
  let upperTime = lowerTime + interval;
  while (minTime < upperTime) {
    // let data = await db.find(IDBKeyRange.bound([groupId, lowerTime], [groupId, upperTime]), 'group-modified');
    let data = await db.find({ lower: [groupId, lowerTime], upper: [groupId, upperTime] }, 'group-modified');
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

export async function getGroupUsersHash(groupId: string) {
  const users = await getGroupUsers(groupId);
  const hashValues = sortBy(users, ["modified", "id"]).map(u => ({ id: u.id, modified: u.modified }));
  return { users, hash: hashObject(hashValues) };
}

// @ts-ignore
if (typeof window !== 'undefined') window.peerdb = module.exports;
