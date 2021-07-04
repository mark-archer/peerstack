import { isArray } from 'lodash';
import { IData, IFile, Indexes, IDB, validateData, clearHashCache, ICursor } from './db';


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

  const find = <T = IData>(query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: Indexes): Promise<T[]> =>
    new Promise(async (resolve, reject) => {
      const transaction = db.transaction(['data'], 'readonly');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).getAll(query);
      } else {
        request = dataStore.getAll(query);
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

  const openCursor = <T>(query?: string | number | IDBKeyRange | ArrayBuffer | Date | ArrayBufferView | IDBArrayKey, index?: Indexes, direction?: IDBCursorDirection): Promise<ICursor<T>> =>
    new Promise(async (resolve, reject) => {
      const transaction = db.transaction(['data'], 'readonly');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).openCursor(query, direction);
      } else {
        request = dataStore.openCursor(query, direction);
      }
      request.onerror = evt => reject(evt);
      let resolveNext: ((value: ICursor<T>) => void) = resolve;
      const cursorWrapper: ICursor<T> = {
        idbRequest: request,
        idbCursor: null,
        next: null,
        value: null,
      }
      request.onsuccess = evt => {
        const cursor: IDBCursorWithValue = (evt.target as any).result;
        cursorWrapper.idbCursor = cursor;
        if (!cursor) {
          cursorWrapper.next = null;
          cursorWrapper.value = null;
          resolveNext(cursorWrapper)
        } else {
          cursorWrapper.value = cursor.value;
          cursorWrapper.next = () => {
            const nextCursor = new Promise<ICursor<T>>(resolve => resolveNext = resolve);
            cursor.continue();
            return nextCursor;
          }
          resolveNext(cursorWrapper);
        }
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
    db,
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
