import { isArray, isObject, isDate, uniq, set, unset, isEqual, sortBy, max, chain } from "lodash";
import { newid } from "./common";
import { getDB, hasPermission, IData } from "./db";
import { ISigned, IUser, signObject, userId, verifySignedObject } from './user';
// import { isObject } from "./common";

export type IChange = [string, any?]

function isObj(x: any) {
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

// this is to save changes made locally - we need a different function to save remote changes
export async function saveChanges<T extends IData>(data: T) {
  const db = await getDB();
  const dbData = await db.get(data.id);

  // TODO maybe redo this as just generating changes and processing them through "receiveChanges"
  //      that way everything is going through the same code
  
  signObject(data);
  await db.save(data);
  
  // if `group` is changing delete out of old group
  if (data && dbData && data.group !== dbData.group) {
    // TODO verify that "me" has permissions to write to both groups
    // delete out of old group
    const deleteOutOfOldGroup = getDataChange(dbData, undefined);
    deleteOutOfOldGroup.modified = data.modified;
    signObject(deleteOutOfOldGroup);
    await db.changes.save(deleteOutOfOldGroup);

    // create in new group
    const createInNewGroup = getDataChange(undefined, data);
    signObject(createInNewGroup);
    await db.changes.save(createInNewGroup);
  } else {
    const dataChange = getDataChange(dbData, data);
    signObject(dataChange);
    await db.changes.save(dataChange);
    return dataChange;
  }
}

export async function receiveChange(dataChange: IDataChange) {
  const db = await getDB();

  // if we already have this change in the db, just return
  if (await db.changes.get(dataChange.id)) {
    return;
  }

  // TODO somewhere we need to remove signer and signature from the "data" object since they may not be valid anymore
  // unless this user "me" has permissions to make the change, in which case "me" should sign
  // the object before it's saved that way other users can do a "deep" sync directly with the objects if needed
  // think more about this...

  // verify changes
  // TODO since we're no longer relying on db.save to verify permissions it needs to be done here, will be a lot of work
  let dbData = await db.get(dataChange.subject);
  const signer: IUser = await db.get(dataChange.signer);
  const publicKey = signer.publicKey;
  verifySignedObject(dataChange, publicKey);
  if (dbData.type === "Group") {
    await hasPermission(signer.id, dbData.group, 'admin');
  } else {
    await hasPermission(signer.id, dataChange.group, 'write');
  }
  
  if (dataChange.changes[0][0] !== '') {
    if (!dbData) {
      throw new Error(`This appears to be a partial change to an object that doesn't exist`);
    }
    if (dbData.group !== dataChange.group) {
      throw new Error(`This appears to be a change to an object that is in a different group which isn't allowed`);
    }
  }

  if (dbData?.type === "Deleted" && dbData.group === dataChange.group) {
    throw new Error(`This object has already been deleted out of this group.  Changes to deleted objects are not allowed.`);
  }

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
    applyChanges(dbData, newerChangesThanInDb);
  }

  // sign object if we can, otherwise delete signer and signature (we won't be able to do "full syncs" for this object because we don't have a signed version)
  if(
    (dbData.type === 'Group' && (await hasPermission(userId, dbData.group, 'admin'))) || 
    (dbData.type !== 'Group' && (await hasPermission(userId, dbData.group, 'write')))
  ) {
    signObject(dbData);
  } else {
    delete dbData.signer;
    delete dbData.signature;
  }
  await db.save(dbData, true);
}

