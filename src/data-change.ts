import { isArray, isObject, isDate, uniq, set, unset, isEqual, max, cloneDeep, isNumber } from "lodash";
import { idTime, newid } from "./common";
import { getDB, checkPermission, IData, hasPermission, IGroup, getUser, users, isGroup } from "./db";
import { ISigned, IUser, keysEqual, signObject, userId, verifySignedObject } from './user';
// import { isObject } from "./common";

export type IChange = [string, any?]

export function isObj(x: any) {
  return isObject(x) && !isArray(x) && !isDate(x) && x !== null;
}

export function isLeaf(x: unknown) {
  return !isObject(x) || isDate(x) || x === null;
}

export function isEmptyObj(x: any): x is {} {
  return isObj(x) && Object.keys(x).length === 0;
}

export function isEmptyArray(x: any): x is [] {
  return isArray(x) && Object.keys(x).length === 0;
}


export function getChanges(objFrom: any, objTo: any): IChange[] {
  const changes: IChange[] = [];

  const allKeys = uniq([
    ...Object.keys(objFrom || []),
    ...Object.keys(objTo || []),
  ]).sort();

  for (const key of allKeys) {
    const fromVal = objFrom?.[key];
    const toVal = objTo?.[key];
    if (isEqual(fromVal, toVal)) {
      continue;
    }
    if (toVal === undefined) {
      changes.push([key]);
    } else if (
      (!isEmptyObj(toVal) && isObj(toVal) && isObj(fromVal)) ||
      (!isEmptyArray(toVal) && isArray(toVal) && isArray(fromVal))
    ) {
      const subChanges = getChanges(fromVal, toVal);
      subChanges.forEach(c => {
        c[0] = `${key}.${c[0]}`;
      });
      changes.push(...subChanges);
    } else {
      changes.push([key, toVal])
    }
  }

  return changes;
}

export function applyChanges(toObj: any, changes: IChange[]) {
  for (const [path, value] of changes) {
    if (path === '') {
      toObj = value ?? {}
    } else if (value === undefined) {
      unset(toObj, path);
    } else {
      set(toObj, path, value);
    }
  }
  return toObj;
}

export interface IDataChange extends ISigned {
  id: string
  group: string
  subject: string
  modified: number
  changes: IChange[]
  subjectDeleted?: boolean
  received?: number
}

export function getDataChange<T extends IData, U extends IData>(dataFrom?: T, dataTo?: U): IDataChange {
  // create
  if (!dataFrom) {
    return {
      id: newid(),
      group: dataTo.group,
      subject: dataTo.id,
      modified: dataTo.modified,
      changes: [
        ['', dataTo]
      ],
    }
  }

  // delete
  if (!dataTo) {
    return {
      id: newid(),
      group: dataFrom.group,
      subject: dataFrom.id,
      modified: dataFrom.modified,
      subjectDeleted: true,
      changes: []
    }
  }

  // changing groups
  if (dataFrom.group !== dataTo.group) {
    throw new Error('Changing groups cannot be represented with a single DataChange, it should be done as a delete out of the old group and a create in the new group.')
  }

  // update 
  const ignoredFields = ['signer', 'signature', 'modified'];
  const changes = getChanges(dataFrom, dataTo)
    .filter(([path]) => !ignoredFields.includes(path));
  return {
    id: newid(),
    group: dataTo.group,
    subject: dataTo.id,
    modified: dataTo.modified,
    changes
  };
}

export function signDataChange(dataChange: IDataChange) {
  const received = dataChange.received;
  delete dataChange.received;
  signObject(dataChange);
  dataChange.received = received;  
}

export async function verifyDataChange(dataChange: IDataChange) {
  const received = dataChange.received;
  delete dataChange.received;
  const signer: IUser = await getUser(dataChange.signer);
  const publicKey = signer.publicKey;
  verifySignedObject(dataChange, publicKey);  
  dataChange.received = received;  
}

export async function validateDataChange(dataChange: IDataChange, dbData?: IData) {

  // TODO somewhere outside this function, verify when receiving if we don't trust the peer 

  const db = await getDB();
  if (!dbData) {
    dbData = await db.get(dataChange.subject);
  }

  // don't allow partial changes to objects that don't exist
  if (!dbData && dataChange.changes[0][0] !== '') {
    throw new Error(`This appears to be a partial change to an object that doesn't exist`);
  }

  // don't allow changing `id`, `group`, `modified` with an entry in `changes`
  if (dataChange.changes.find(c => ['id', 'group', 'modified'].includes(c[0]))) {
    throw new Error(`There is an entry in changes to update either id, group, or modified directly.  This is not allowed.  ` +
      `Use a delete then a create to update id or group.  Modified is updated with the modified value of the change itself`);
  }

  const isDbDeletedType = dbData?.type === "Deleted";
  const isGroupChange = dbData && dbData.group !== dataChange.group && !isDbDeletedType

  // don't allow changes to objects in a different group than the change
  if (isGroupChange) {
    throw new Error(`Changes to objects in a different group than the change is not allowed`);
  }

  // Don't allow changes to deleted objects (if those objects have been deleted in the same group)
  if (isDbDeletedType && dbData.group === dataChange.group) {
    throw new Error(`This object ${dbData.id} has been deleted out of group ${dbData.group}.  Changes to deleted objects are not allowed.`);
  }

  const data = applyChanges(cloneDeep(dbData), dataChange.changes) as IData;
  data.modified = dataChange.modified;

  if (!isNumber(data.modified) || data.modified > (Date.now() + 60000)) {
    throw new Error(`modified timestamp must be a number and cannot be in the future`);
  }
  if (idTime(data.id) > (Date.now() + 60000)) {
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
  const user = data.type === 'User' && (data as IUser) || await getUser(dataChange.signer);
  if (!user?.id) {
    throw new Error(`Could not identify signer: ${JSON.stringify(data, null, 2)}`);
  }
  if (data.type == 'User') {
    users[user.id] = user; // just in case this is creating a user
    return data; // users are always allowed to create or update themselves
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

export async function ingestChange(dataChange: IDataChange, dbData?: IData) {
  const db = await getDB();

  // if we already have this change in the db, just return
  if (await db.changes.get(dataChange.id)) {
    return;
  }

  if (dbData === undefined) {
    dbData = await db.get(dataChange.subject);
  }

  // verify changes  
  await validateDataChange(dataChange, dbData);

  // TODO verifySignature (probably should be done somewhere outside of this function)

  await db.changes.save(dataChange);

  if (dataChange.subjectDeleted) {
    dbData = {
      type: 'Deleted',
      group: dataChange.group,
      id: dataChange.subject,
      modified: dataChange.modified,
    }
  }

  if (dataChange.modified > (dbData?.modified ?? -Infinity)) {
    dbData = applyChanges(dbData, dataChange.changes);
    dbData.modified = dataChange.modified;
  } else {
    const existingChanges = await db.changes.getSubjectChanges(dataChange.subject, dataChange.modified);
    const newerChangesThanInDb = dataChange.changes.filter(pathChange => {
      const dbChangesWithPath = existingChanges.filter(existingChange =>
        existingChange.group === dataChange.group &&
        existingChange.changes.find(([path]) => path.startsWith(pathChange[0]))
      );
      const lastDbPathModified = max(dbChangesWithPath.map(c => c.modified)) ?? -Infinity;
      return lastDbPathModified < dataChange.modified;
    });
    dbData = applyChanges(dbData, newerChangesThanInDb);
  }

  // sign object if we can, otherwise delete signer and signature (we won't be able to do "full syncs" for this object because we don't have a signed version)
  if (
    // (dbData.type !== 'Group' && (await hasPermission(userId, dbData.group, 'write', db))) ||
    (dbData.type === 'Group' && (await hasPermission(userId, dbData as IGroup, 'admin', db)))
  ) {
    // TODO this adds a lot of overhead but allows "deep syncs" with peers so leaving it for now
    //      it could become unnecessary (changes work well and deep syncs aren't required), 
    //      if so this should be removed since it's a lot of computational and storage overhead
    //      also `signer` is misleading since it's just the last user to receive the change who had write permission
    //      really, this isn't even needed for deep syncs as long as you're syncing with someone who has write permissions
    //        _except groups_  so sign groups if you're an admin, groups should always have a signature and be signed when saving
    //          which means we can't send updates to groups as a change?
    //            we can just send the entire object (signed) with an empty path :)
    //        deep syncs can still be through peers with writes
    signObject(dbData);
  } else {
    delete dbData.signer;
    delete dbData.signature;
  }
  await db.save(dbData, true);
}

// This is intended as the entry point for writing changes made locally
// use `ingestChange` when syncing with peers
export async function commitChange<T extends IData>(data: T) {
  const db = await getDB();
  const dbData = (await db.get(data.id)) || null;

  if (dbData && dbData.modified === data.modified) {
    throw new Error('modified is the same as what is in the db - this is almost certainly a mistake');
  }

  const groupChanging = dbData && dbData.group !== data.group;

  // if `group` isn't changing, just generate change and call receive
  if (!groupChanging) {
    // check that I have permissions to write this data
    if (isGroup(data)) {
      await checkPermission(userId, data, 'admin');
    } else {
      await checkPermission(userId, data.group, 'write');
    }
    const dataChange = getDataChange(dbData, data);
    signObject(dataChange);
    await ingestChange(dataChange, dbData);
    // TODO push to peers
  }
  else { // group is changing
    // make sure I can write to both groups
    await checkPermission(userId, dbData.group, 'write');
    await checkPermission(userId, data.group, 'write');

    // delete out of old group
    const deleteOutOfOldGroup = getDataChange(dbData, undefined);
    deleteOutOfOldGroup.modified = data.modified - 1;
    signObject(deleteOutOfOldGroup);
    await ingestChange(deleteOutOfOldGroup, dbData);

    // create in new group
    const createInNewGroup = getDataChange(undefined, data);
    signObject(createInNewGroup);
    await ingestChange(createInNewGroup);

    // TODO push to peers
  }
}

export async function deleteData(id: string) {
  const db = await getDB();
  const dbData = await db.get(id);
  if (!dbData) { 
    return;
  }
  await checkPermission(userId, dbData.group, 'write');
  const dataChange = getDataChange(dbData, null);
  signObject(dataChange);
  await ingestChange(dataChange, dbData);
}

