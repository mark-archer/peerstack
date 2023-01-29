import { isArray, isObject, isDate, sortBy } from "lodash";
// import { isObject } from "./common";

export type ILeaf = boolean | number | string | Date | null

export interface IObj {
  [key: string]: ILeaf | IObj | IObj[]
}

export type IFlat = [string, ILeaf][]

export function isObj(x: any): x is IObj {
  return isObject(x) && !isArray(x) && !isDate(x) && x !== null;
}

export function isLeaf(x: unknown): x is ILeaf {
  return !isObject(x) || isDate(x) || x === null;
}

export function flattenObject(obj: Record<string, any> | any[], pathPrefix: string = ''): IFlat {
  const pathValues: IFlat = [];
  for (const [pathPart, value] of Object.entries(obj)) {
    const path = pathPrefix + pathPart;
    if (isLeaf(value)) {
      pathValues.push([path, value]);
    } else {
      const subPathValues = flattenObject(value, path + '.');
      pathValues.push(...subPathValues);
    }
  }
  return pathValues;
}

export function getChanges(objFrom: any, objTo: any) {
  let flatFrom = flattenObject(objFrom);
  let flatTo = flattenObject(objTo);

  flatFrom = sortBy(flatFrom, ([path]) => path);
  flatTo = sortBy(flatTo, ([path]) => path);

  const changes: {
    set: IFlat
    rm: string[]
  } = {
    set: [],
    rm: []
  };

  let iFrom = 0;
  let iTo = 0;
  while (iFrom < flatFrom.length || iTo < flatTo.length) {
    const [pathFrom, valueFrom] = flatFrom[iFrom] || [];
    const [pathTo, valueTo] = flatTo[iTo] || [];

    if (pathFrom === pathTo) {
      if (valueFrom !== valueTo) {
        changes.set.push(flatTo[iTo]);
      }
      iFrom++;
      iTo++;
    } else if (!pathFrom || pathFrom > pathTo) {
      changes.set.push(flatTo[iTo]);
      iTo++;
    } else { // !pathTo || pathFrom < pathTo
      changes.rm.push(pathFrom);
      iFrom++;
    }
  }

  return changes;
}