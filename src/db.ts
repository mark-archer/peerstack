import { compact, groupBy, isArray, isObject, reject, set, sortBy, uniq } from 'lodash';
import { hashObject } from './common';
import { ISigned, IUser, verifySignedObject } from './user';
import * as dbix from './dbix'
import * as dbfs from './dbfs'

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
  get: <T = IData>(id: string) => Promise<T>
  delete: (id: string) => Promise<void>
  find: <T = IData>(query?: DBQuery, index?: Indexes) => Promise<T[]>
  openCursor: <T = IData>(query?: DBQuery, index?: Indexes, direction?: DBCursorDirection) => Promise<ICursor<T>>
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
  onUpgrade?: ((evt: any) => Promise<void>),
  persistenceLayer?: IPersistenceLayer,
  [key: string]: any
}

export interface IPersistenceLayer {
  init: (opts: PeerstackDBOpts) => Promise<IDB>
}

let db: IDB

export async function init(opts?: PeerstackDBOpts): Promise<IDB> {
  let persistenceLayer = opts?.persistenceLayer;
  if (typeof indexedDB !== 'undefined') {
    persistenceLayer = dbix;
  } else {
    persistenceLayer = dbfs;
    if (!(opts as dbfs.DBFSOpts)._fs) {
      const fs = require('react-native-fs');
      (opts as dbfs.DBFSOpts)._fs = {
        readFile: path => fs.readFile(fs.DocumentDirectoryPath + '/' + path, 'utf8'),
        listFiles: path => fs.readDir(fs.DocumentDirectoryPath + '/' + path).then(results => results.map(r => r.name)),
        writeFile: (path, data) => fs.writeFile(fs.DocumentDirectoryPath + '/' + path, data),
        deleteFile: path => fs.unlink(fs.DocumentDirectoryPath + '/' + path),
        mkdir: path => fs.mkdir(fs.DocumentDirectoryPath + '/' + path),
        exists: path => fs.exists(path),
      }
    }
  }
  const _db = await persistenceLayer.init(opts);
  
  db = { ..._db, files: { ..._db.files },  local: { ..._db.local } };

  db.save = async (data: IData | IData[], skipValidation: boolean = false) => {
    if (!isArray(data)) {
      data = [data];
    }
    if (!skipValidation) {
      await validateData(db, data);
    }
    await _db.save(data);
    data.forEach((d: IData) => clearHashCache(d.group));    
  };

  db.delete = async (id) => {
    const dbData = await _db.get(id);
    // NOTE: no real validation is here because this is only affects local, you can only affect network with updates (`save`) which is heavily validated
    if (!dbData) return;
    await _db.delete(id);
    clearHashCache(dbData.group);
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

  return db;
}

export async function getDB(): Promise<IDB> {
  if (!db) {
    throw new Error('db has not been initialized')
  }
  return db;
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
        db = await getDB()
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
      continue; // users are always allowed to create or update themselves
    }
    try {
      if (data.type === 'Group') {
        await hasPermission(user.id, data as IGroup, 'admin');
      } else {
        const dbData = await db.get(data.id);
        if (dbData && dbData.group != data.group) {
          await checkPermission(user.id, dbData.group, 'write');
          await checkPermission(user.id, data.group, 'write');
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

export async function getBlockData(group: string, level0BlockId: string) {
  if (level0BlockId === 'users') {
    return getGroupUsers(group);
  }
  const db = await getDB();
  const blockNum = Number(level0BlockId.substr(1));
  const lowerTime = blockNum * BLOCK_SIZE;
  const upperTime = lowerTime + BLOCK_SIZE;
  // const blockData = await db.find(IDBKeyRange.bound([group, lowerTime], [group, upperTime]), 'group-modified');
  const blockData = await db.find({ lower: [group, lowerTime], upper: [group, upperTime] }, 'group-modified');
  return blockData;
}

export const L5BlockHashes: {
  [groupId: string]: { [blockId: string]: string }
} = {}

export function clearHashCache(groupId: string) {
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
  const db = await getDB();

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

// @ts-ignore
if (typeof window !== 'undefined') window.peerdb = module.exports;
