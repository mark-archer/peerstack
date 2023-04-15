import { isArray, isObject, isDate, uniq, set, unset, isEqual, max, cloneDeep, isNumber } from "lodash";
import { idTime, isid_v1, newid } from "./common";
import { me } from "./connections";
import { invalidateCache } from "./data-change-sync";
import { getDB, checkPermission, IData, hasPermission, IGroup, getUser, users, isGroup } from "./db";
import { ISigned, IUser, keysEqual, signObject, userId, verifySigner } from './user';
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

export async function validateDataChange(dataChange: IDataChange, dbData?: IData) {

  // TODO somewhere outside this function, verify when receiving if we don't trust the peer 

  const db = await getDB();
  if (dbData === undefined) {
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
  data.modified = max([dataChange.modified, data.modified]);

  // if this is changing an existing group, ensure user has permissions to do that
  if (dbData?.type === 'Group') {
    await checkPermission(dataChange.signer, dbData.group, 'admin');
  }

  if (!isNumber(data.modified) || data.modified > (Date.now() + 60000)) {
    throw new Error(`modified timestamp must be a number and cannot be in the future`);
  }
  // TODO convert v1 ids to v2
  if (!isid_v1(data.id) && idTime(data.id) > (Date.now() + 60000)) {
    throw new Error(`time part of id cannot be in the future`);
  }
  // TODO verify type is not being changed on existing data (e.g. deleting a user or group)
  if (data.type === 'Group') {
    if (data.id !== data.group) {
      throw new Error(`All groups must have their group set to their id`);
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
      await checkPermission(user.id, (dbData || data) as IGroup, 'admin');
    } else {
      if (dbData && dbData.modified > data.modified) {
        throw new Error('modified cannot be less than the existing doc in db')
      }
      if (dbData && dbData.group != data.group) {
        await checkPermission(user.id, dbData.group, 'write');
        await checkPermission(user.id, data.group, 'write');
      } else {
        await checkPermission(user.id, data.group, 'write')
      }
      /* istanbul ignore next */
      if (dbData && dbData.type === 'Index' && data.type !== 'Index') {
        // call delete to remove index entries because this is no longer going to be an Index
        // this is bad because it's modifying the database as part of a validation check...
        /* istanbul ignore next */
        await db.delete(data.id);
      }
    }
  } catch (err) {
    throw new Error(`Permissions error: ${err} \n ${JSON.stringify(data, null, 2)}`)
  }
}

export async function ingestChange(dataChange: IDataChange, dbData?: IData, skipValidation = false) {
  const db = await getDB();

  // if we already have this change in the db, just return
  const dbDataChange = await db.changes.get(dataChange.id);
  if (dbDataChange) {
    if (dbDataChange.signature !== dataChange.signature) {
      throw new Error('A dataChange that has already been ingested was encountered again but with a different signature')
    }
    return;
  }

  if (dbData === undefined) {
    dbData = await db.get(dataChange.subject);
  }
  const oldModified = dbData?.modified;

  if (!skipValidation) {
    // verify changes  
    await validateDataChange(dataChange, dbData);
    if (dataChange.subject === dataChange.signer && !dbData) {
      // this is creating (or modifying) a user we dont' have in the db
      // TODO look up the user's public key from a registry
    } 
    else if (dbData?.type === 'User') {
      if (dataChange.signer !== dbData.id) {
        throw new Error('Changes to a user must be signed by themselves');
      }
    }
    else {
      await verifySigner(dataChange);
    }
  }

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

  // future "full/deep syncs" will only be done with users that have write permissions to group so we don't need signed objects
  //    just verify user has write permissions and update local db with any objects that have a newer modified
  //    existing "full sync" algorithm will continue to work fine
  //  _except_ groups so sign groups if your an admin, groups should always have a signature and be signed when saving 
  if (dbData.type === 'Group' && (await hasPermission(userId, dbData as IGroup, 'admin', db))) {
    signObject(dbData);
  }
  // if I'm changing myself, sign it to let everyone know it's valid
  else if (dbData?.type === 'User' && dbData?.id === me?.id) {
    signObject(dbData);
  } 
  else {
    // otherwise delete signer and signature if they exist since they are probably no longer correct
    delete dbData.signer;
    delete dbData.signature;
  }

  // save the modified data to the database
  await db.save(dbData, true);

  // save the change to the database 
  await db.changes.save(dataChange);

  invalidateCache(dataChange.group, dataChange.modified, oldModified);

  return dbData;
}

// This is intended as the entry point for writing changes made locally
// use `ingestChange` when syncing with peers
export async function commitChange<T extends IData>(data: T, options: { preserveModified?: boolean } = {}): Promise<IDataChange[]> {
  const db = await getDB();
  const dbData = (await db.get(data.id)) || null;

  if (!options.preserveModified) {
    data.modified = Date.now();
    /* istanbul ignore next */
    if (dbData && dbData.modified === data.modified) {
      /* istanbul ignore next */
      data.modified++;
    }
  }
  if (dbData && dbData.modified === data.modified) {
    throw new Error('modified is the same as what is in the db - this is almost certainly a mistake');
  }

  const changes: IDataChange[] = [];

  const groupChanging = dbData && dbData.group !== data.group;

  // if `group` isn't changing, just generate change and call receive
  if (!groupChanging) {
    // check that I have permissions to write this data
    if (isGroup(data)) {
      await checkPermission(userId, data, 'admin');
      // it's very important that groups are signed so putting this here 
      //  the user might have already signed this so this could be useless 
      //  and expensive but updates to groups should be rare so doing this for now
      signObject(data);
    } else {
      await checkPermission(userId, data.group, 'write');
    }
    const dataChange = getDataChange(dbData, data);
    signObject(dataChange);
    await ingestChange(dataChange, dbData);
    changes.push(dataChange);
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
    changes.push(deleteOutOfOldGroup);

    // create in new group
    const createInNewGroup = getDataChange(undefined, data);
    signObject(createInNewGroup);
    await ingestChange(createInNewGroup);
    changes.push(createInNewGroup);
  }
  return changes;
}

export async function deleteData(id: string) {
  const db = await getDB();
  const dbData = await db.get(id);
  if (!dbData) {
    throw new Error(`No data exists with id ${id}`);
  }
  await checkPermission(userId, dbData.group, 'write');
  const dataChange = getDataChange(dbData, null);
  signObject(dataChange);
  await ingestChange(dataChange, dbData);
}

