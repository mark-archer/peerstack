import { isArray, isObject, isDate, uniq, set, unset, isEqual, sortBy } from "lodash";
import { newid } from "./common";
import { me } from "./connections";
import { checkPermission, getDB, hasPermission, IData, validateData } from "./db";
import { ISigned, IUser, signObject, verifySignedObject } from './user';
// import { isObject } from "./common";

export interface IChange {
  path: string
  value?: any
}

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
      changes.push({ path: key });
    } else if (
      (!isEmptyObj(toVal) && isObj(toVal) && isObj(fromVal)) ||
      (!isEmptyArray(toVal) && isArray(toVal) && isArray(fromVal))
    ) {
      const subChanges = getChanges(fromVal, toVal);
      subChanges.forEach(c => {
        c.path = `${key}.${c.path}`
      });
      changes.push(...subChanges);
    } else {
      changes.push({
        path: key,
        value: toVal,
      })
    }
  }

  return changes;
}

export function applyChanges(toObj: any, changes: IChange | IChange[]) {
  if (!isArray(changes)) {
    changes = [changes]
  }
  for (const change of changes) {
    if (change.path === '') {
      toObj = change.value ?? {}
    } else if (change.value === undefined) {
      unset(toObj, change.path);
    } else {
      set(toObj, change.path, change.value);
    }
  }
  return toObj;
}

export interface IDataChange extends IChange, ISigned {
  id: string
  group: string
  subject: string
  modified: number
  subjectDeleted?: boolean
}

export function getDataChanges<T extends IData, U extends IData>(dataFrom?: T, dataTo?: U): IDataChange[] {
  // create
  if (!dataFrom) {
    return [
      {
        id: newid(),
        group: dataTo.group,
        subject: dataTo.id,
        modified: dataTo.modified,
        path: '',
        value: dataTo
      }
    ]
  }

  // delete
  if (!dataTo) {
    return [
      {
        id: newid(),
        group: dataFrom.group,
        subject: dataFrom.id,
        modified: dataFrom.modified,
        path: '',
        subjectDeleted: true
      }
    ]
  }

  // changing groups
  if (dataFrom.group !== dataTo.group) {
    // delete out of `from` group and create in `to` group
    return [
      ...getDataChanges(dataFrom, undefined),
      ...getDataChanges(undefined, dataTo),
    ]
  }
  
  // update 
  const changes = getChanges(dataFrom, dataTo);
  return changes.map(change => {
    return {
      id: newid(),
      group: dataTo.group,
      subject: dataTo.id,
      modified: dataTo.modified,
      ...change
    }
  });
}

// this is to save changes made locally - we need a different function to save remote changes
export async function saveChange<T extends IData>(data: T) {
  const db = await getDB();
  const dbData = await db.get(data.id);
  await validateData(db, [data]);

  const changes = getDataChanges(dbData, data);
  changes.forEach(c => signObject(c));
  for (const change of changes) {
    await db.changes.save(change);
  }
  return changes;
}

export async function receiveChanges(changes: IDataChange[]) {
  const db = await getDB();

  changes = sortBy(changes, 'modified');

  const signers: { [signer: string]: IUser } = {}
  const subjects: { [subject: string]: IData } = {};
  const subjectsDeleted: { [subject: string]: string} = {};
  const existingChanges: { [subject: string]: IDataChange[] } = {};

  // verify changes
  for (const change of changes) {
    const signer = signers[change.signer] || (await db.get(change.signer) as IUser);
    const publicKey = signer.publicKey;
    verifySignedObject(change, publicKey);
    if (!subjects[change.subject]) {
      subjects[change.subject] = await db.get(change.subject);
    }
    const data = subjects[change.subject];
    if (data.type === "Group") {
      await hasPermission(signer.id, data.group, 'admin');      
    } else {
      await hasPermission(signer.id, change.group, 'write');
    }
    // TODO since we're no longer relying on db.save to verify permissions it needs to be done here, will be a lot of work
  }

  // apply changes
  for (const change of changes) {
    if (await db.changes.get(change.id)) {
      continue;
    }
    await db.changes.save(change);

    // TODO check if this is a change for an object that was already deleted - not allowed unless the path is empty

    let data = subjects[change.subject] || await db.get(change.subject);
    
    if (data.modified > change.modified) {
      // TODO what if change.group !== data.group?
      const _existingChanges = 
        existingChanges[change.subject] || 
        await db.changes.getSubjectChanges(change.subject, change.modified);
      existingChanges[change.subject] = _existingChanges;
      const newerChangeExists = _existingChanges.find(c => change.path.startsWith(c.path) && change.modified <= c.modified);
      if (newerChangeExists) {
        continue;
      }
    }
    if (change.subjectDeleted) {
      subjectsDeleted[change.subject] = change.group;
    }
    
    data = applyChanges(data, change);
    if (data.modified < change.modified) {
      // TODO this will be inefficient for lots of changes made at the same time
      data.modified = change.modified;      
    }
    subjects[change.subject] = data;    
  }

  // write changes
  const updatedDatas = Object.values(subjects);
  for (const data of updatedDatas) {
    const isDeleted = subjectsDeleted[data.subject] === data.group;
    if (isDeleted) {
      await db.delete(data.id);
    } else {
      // TODO since we're no longer relying on db.save to verify permissions we'll need to do more work before saving or applying the changes
      await db.save(data, true);
    }
  }
  
  return Object.values(subjects);
}

// export async function getChanges(group: string, lastReceived: number) {
//   const db = await getDB();
//   db.changes
// }
