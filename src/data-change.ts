import { isArray, isObject, isDate, uniq, set, unset, isEqual } from "lodash";
import { me } from "./connections";
import { checkPermission, getDB, hasPermission, IData, validateData } from "./db";
import { ISigned, signObject } from './user';
// import { isObject } from "./common";

export interface IChange {
  set: [string, any][],
  rm: string[],
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


export function getChange(objFrom: any, objTo: any): IChange {
  const changes: IChange = {
    set: [],
    rm: [],
  };

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
      changes.rm.push(key);
    } else if (
      (!isEmptyObj(toVal) && isObj(toVal) && isObj(fromVal)) ||
      (!isEmptyArray(toVal) && isArray(toVal) && isArray(fromVal))
    ) {
      const subChanges = getChange(fromVal, toVal);
      changes.rm.push(...subChanges.rm.map(p => `${key}.${p}`));
      subChanges.set.forEach(s => s[0] = `${key}.${s[0]}`);
      changes.set.push(...subChanges.set);
    } else {
      changes.set.push([key, toVal])
    }
  }

  return changes;
}

export function applyChange(toObj: any, change: IChange) {
  change.set.forEach(([path, value]) => {
    set(toObj, path, value);
  });
  change.rm.forEach(path => {
    unset(toObj, path);
  });
  return toObj;
}

export interface IDataChange extends IChange, ISigned {
  // id: string
  group: string
  subject: string
  modified: number
  received?: number
  subjectDeleted?: boolean
}

// this is to save changes made locally - we need a different function to save remote changes
export async function saveData<T extends IData>(data: T) {
  const db = await getDB();
  const dbData = await db.get(data.id);
  await validateData(db, [data]);
  const change = getChange(dbData, data);
  if (dbData && dbData.group !== data.group) {
    const deleteOld: IDataChange = {
      group: dbData.group,
      subject: dbData.id,
      modified: data.modified,
      subjectDeleted: true,
      rm: [],
      set: [],      
    }
    signObject(deleteOld);
    // await db.changes.save(deleteOld);
  }
  const dataChange: IDataChange = {
    group: data.group,
    subject: data.id,
    modified: data.modified,
    ...change
  }
  // await db.changes.save(dataChange);
  return dataChange;
}

export async function receiveChange(dataChange: IDataChange) {
  const db = await getDB();
  const dbData = await db.get(dataChange.subject);
  const data = applyChange(dbData, dataChange);
  await db.save(data);
  // await db.changes.save(dataChange);
  return data;
}
