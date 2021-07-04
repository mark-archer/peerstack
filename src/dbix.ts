import { isArray } from 'lodash';
import { isObject } from './common';
import { IData, IFile, Indexes, IDB, validateData, clearHashCache, ICursor, DBQuery, DBKeyRange, DBKeyArray, DBKeyValue } from './db';

export type IDBQuery = string | number | Date | IDBKeyRange | IDBArrayKey | ArrayBuffer | ArrayBufferView;

export function convertDBQueryToIDBQuery(query: DBQuery): IDBQuery {
  if (isObject(query)) {
    const dbQuery = query as DBKeyRange;
    if (dbQuery.lower !== undefined && dbQuery.upper === undefined) {
      return IDBKeyRange.lowerBound(dbQuery.lower, dbQuery.lowerOpen);
    } else if (dbQuery.lower === undefined && dbQuery.upper !== undefined) {
      return IDBKeyRange.upperBound(dbQuery.upper, dbQuery.upperOpen);
    } else {
      return IDBKeyRange.bound(dbQuery.lower, dbQuery.upper, dbQuery.lowerOpen, dbQuery.upperOpen);
    }
  } else {
    return query as DBKeyValue | DBKeyArray;
  }
}

export async function init(
  { dbName = 'peerstack', dbVersion = 6, onUpgrade = undefined } = {}
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

  const find = <T = IData>(query?: DBQuery, index?: Indexes): Promise<T[]> =>
    new Promise(async (resolve, reject) => {
      const ixQuery = convertDBQueryToIDBQuery(query)
      const transaction = db.transaction(['data'], 'readonly');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).getAll(ixQuery);
      } else {
        request = dataStore.getAll(ixQuery);
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

  const openCursor = <T>(query?: DBQuery, index?: Indexes, direction?: IDBCursorDirection): Promise<ICursor<T>> =>
    new Promise(async (resolve, reject) => {
      const ixQuery = convertDBQueryToIDBQuery(query);
      const transaction = db.transaction(['data'], 'readonly');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).openCursor(ixQuery, direction);
      } else {
        request = dataStore.openCursor(ixQuery, direction);
      }
      request.onerror = evt => reject(evt);
      const cursor: ICursor<T> = {
        next: null,
        value: null,
      }
      let resolveNext = (value: T) => resolve(cursor);
      request.onsuccess = evt => {
        const ixCursor: IDBCursorWithValue = (evt.target as any).result;
        cursor.value = ixCursor?.value;
        resolveNext(cursor.value);
        cursor.next = () => new Promise((resolve, reject) => {
          if (!ixCursor) return reject(new Error('Cursor has either reached the end or is no longer valid'))
          ixCursor.continue();
          resolveNext = resolve
        })
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