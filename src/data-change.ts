import { isArray, isObject, isDate, sortBy, get, uniq, compact, set, unset, isEqual } from "lodash";
// import { isObject } from "./common";

export type ILeaf = boolean | number | string | Date | null

export interface IObj {
  [key: string]: ILeaf | IObj | IObj[]
}

// TODO these aren't typed correct and will allow most things
export type IEmptyArray = [];
export type IEmptyObject = {};

export type IFlat = [string, ILeaf | IEmptyArray | IEmptyObject][]

export interface IChange {
  set: [string, any][],
  rm: string[],
}

export function isObj(x: any): x is IObj {
  return isObject(x) && !isArray(x) && !isDate(x) && x !== null;
}

export function isLeaf(x: unknown): x is ILeaf {
  return !isObject(x) || isDate(x) || x === null;
}

export function isEmptyObj(x: any): x is {} {
  return isObj(x) && Object.keys(x).length === 0;
}

export function isEmptyArray(x: any): x is [] {
  return isArray(x) && x.length === 0;
}

export function flattenObject(obj: Record<string, any> | any[], pathPrefix: string = ''): IFlat {
  const pathValues: IFlat = [];
  for (const [pathPart, value] of Object.entries(obj)) {
    const path = pathPrefix + pathPart;
    if (isLeaf(value) || isEmptyObj(value) || isEmptyArray(value)) {
      pathValues.push([path, value]);
    } else {
      const subPathValues = flattenObject(value, path + '.');
      pathValues.push(...subPathValues);
    }
  }
  return pathValues;
}

export function getChanges(objFrom: any, objTo: any): IChange {
  const changes: IChange = {
    set: [],
    rm: [],
  };

  const allKeys = uniq([
    ...Object.keys(objFrom),
    ...Object.keys(objTo),
  ]).sort();

  for (const key of allKeys) {
    const fromVal = objFrom[key];
    const toVal = objTo[key];
    if (isEqual(fromVal, toVal)) {
      continue;
    }
    if (toVal === undefined) {
      changes.rm.push(key);
    } else if (
      (!isEmptyObj(toVal) && isObj(toVal) && isObj(fromVal)) ||
      (!isEmptyArray(toVal) && isArray(toVal) && isArray(fromVal))
    ) {
      const subChanges = getChanges(fromVal, toVal);
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