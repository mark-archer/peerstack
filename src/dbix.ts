import { uniq, isArray, isDate, isObject } from 'lodash';
import { IData, Indexes, IDB, ICursor, DBQuery, DBKeyRange, DBKeyArray, DBKeyValue, PeerstackDBOpts } from './db';

// export type IDBQuery = string | number | Date | IDBKeyRange | IDBArrayKey | ArrayBuffer | ArrayBufferView;
export type IDBQuery = string | number | Date | IDBKeyRange | ArrayBuffer | ArrayBufferView;

export function convertDBQueryToIDBQuery(query: DBQuery): IDBQuery {
  if (isObject(query) && !isArray(query) && !isDate(query)) {
    const dbQuery = query as DBKeyRange;
    if (dbQuery.lower === null) {
      dbQuery.lower = undefined;
    }
    if (dbQuery.upper === null) {
      dbQuery.upper = undefined;
    }
    if (dbQuery.lower === undefined && dbQuery.upper === undefined) {
      return null;
    } else if (dbQuery.lower !== undefined && dbQuery.upper === undefined) {
      return IDBKeyRange.lowerBound(dbQuery.lower, dbQuery.lowerOpen);
    } else if (dbQuery.lower === undefined && dbQuery.upper !== undefined) {
      return IDBKeyRange.upperBound(dbQuery.upper, dbQuery.upperOpen);
    } else {
      return IDBKeyRange.bound(dbQuery.lower, dbQuery.upper, dbQuery.lowerOpen, dbQuery.upperOpen);
    }
  } else {
    // @ts-ignore
    return query as DBKeyValue | DBKeyArray;
    // return query as DBKeyValue;
  }
}

export async function init(
  { dbName = 'peerstack', dbVersion = 6, onUpgrade }: PeerstackDBOpts = {}
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
      // if (oldVersion < 7) {
      //   const kvIndex = db.createObjectStore("keyValueIndex", { keyPath: ['group', 'key', 'value', 'type', 'id'] });
      //   // @ts-ignore
      //   // createIndex(keyValueIndex, 'id')
      // }
      if (onUpgrade) await onUpgrade(evt);
    }
  });

  // interface IIndex {
  //   group: string,
  //   key: string,
  //   value: any,
  //   type: string,
  //   id: string
  // }

  const save = (data: IData[]): Promise<any> => new Promise(async (resolve, reject) => {
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const objectStore = transaction.objectStore('data');
    // const kvStore = transaction.objectStore('keyValueIndex');
    for (const d of data) {
      // const indexes: IIndex[] = await find([d.type, 'Index'], 'group-type');
      // if (indexes) {
      //   const kvDelete = kvStore.delete(IDBKeyRange.bound([, , , , d.id], [, , , , d.id]))
      //   kvDelete.onerror = evt => reject(evt);
      //   indexes.forEach(kv => {
      //     const ixEntry: IIndex = {
      //       id: d.id,
      //       group: d.group,
      //       type: d.type,
      //       key: kv.key,
      //       value: d[kv.key],
      //     }
      //     const request = kvStore.put(ixEntry)
      //     request.onerror = evt => reject(evt);
      //   })
      // }
      const request = objectStore.put(d);
      request.onerror = evt => reject(evt);
    }
    transaction.oncomplete = evt => {
      resolve((evt.target as any).result);
    };
  });

  const find = <T = IData>(query?: DBQuery, index?: Indexes): Promise<T[]> =>
    new Promise(async (resolve, reject) => {
      const ixQuery = convertDBQueryToIDBQuery(query)
      const transaction = db.transaction(['data'], 'readonly');
      transaction.onerror = evt => reject(evt);
      const dataStore = transaction.objectStore('data');
      // if (String(index) === 'key-value') {
      //   const kvStore = transaction.objectStore('keyValueIndex'); // todo combine this with the above transaction
      //   const request = kvStore.getAll(ixQuery);
      //   request.onerror = evt => reject(evt);
      //   request.onsuccess = async evt => {
      //     const kvResults = (evt.target as any).result as IIndex[];
      //     const ids = uniq(kvResults.map(kv => kv.id));
      //     const results = await Promise.all(ids.map(id => dbOp('data', 'get', id)))
      //     resolve(results);
      //   };
      // } else {
        let request: IDBRequest;
        if (index) {
          request = dataStore.index(index).getAll(ixQuery);
        } else {
          request = dataStore.getAll(ixQuery);
        }
        request.onerror = evt => reject(evt);
        request.onsuccess = evt => resolve((evt.target as any).result);
      // }
    });

  const getIXDBCursor = <T extends IData>(query?: DBKeyRange, index?: string, direction?: IDBCursorDirection) => {
    const returnObj = {
      reject: null as (err) => any,
      next: null as () => Promise<T>
    }    

    let request: IDBRequest;
    let transaction: IDBTransaction;
    let ixCursor: IDBCursorWithValue;
    let transactionClosed = false;
    let cursorFinished = false;
    let restartingCursor = false;
    let priorValue: T;
    let nextValue: T;    
    let resolveNextValue;
    let nPriorResults = 0;

    returnObj.next = () => new Promise((resolve, _reject) => {
      returnObj.reject = _reject;
      if (transactionClosed && !cursorFinished) {
        restartingCursor = true;
        openTransactionRequest();        
      }
      if (nextValue || cursorFinished) {
        resolve(nextValue);
        nextValue = null;
        resolveNextValue = null;
        ixCursor?.continue();
      } else {
        resolveNextValue = resolve;
      }
    });

    function openTransactionRequest() {
      transactionClosed = false;
      transaction = db.transaction(['data'], 'readonly');
      transaction.onerror = evt => returnObj.reject(evt);
      transaction.onabort = evt => returnObj.reject(evt);
      transaction.oncomplete = evt => {
        if(resolveNextValue && !cursorFinished) {
          restartingCursor = true;
          openTransactionRequest(); // the transaction closed while we were waiting for a value so open a new one
        } else {
          transactionClosed = true;
        }
      }
      const dataStore = transaction.objectStore('data');
      let ixQuery = convertDBQueryToIDBQuery(query);
      if (index) {
        request = dataStore.index(index).openCursor(ixQuery, direction);
      } else {
        request = dataStore.openCursor(ixQuery, direction);
      }

      request.onerror = evt => returnObj.reject(evt);      
      request.onsuccess = evt => {      
        ixCursor = (evt.target as any).result;
        if (!ixCursor) {
          cursorFinished = true;
          if (resolveNextValue) {
            resolveNextValue(null);
          } else {
            nextValue = null;
          }
          return;
        }

        if (ixCursor && restartingCursor && priorValue) {
          restartingCursor = false
          if (!index) {
            ixCursor.advance(nPriorResults);
            return;
          }
          if (index && priorValue?.id !== ixCursor?.value?.id) {
            let priorKey = index.split('-').map(key => priorValue[key]);
            if (priorKey.length === 1) {
              priorKey = priorKey[0];
            }
            ixCursor.continuePrimaryKey(priorKey, priorValue.id);
            return;
          }
        }        
        if (priorValue && priorValue?.id === ixCursor?.value?.id) {
          ixCursor.continue();
          return;
        }

        priorValue = ixCursor?.value;        
        nPriorResults++;

        if (resolveNextValue) {
          resolveNextValue(ixCursor?.value);
          resolveNextValue = null;
          nextValue = null;
          ixCursor?.continue();
        } else {
          nextValue = ixCursor?.value;
        }      
      }    
    }
    openTransactionRequest();

    return returnObj;
  };

  const openCursor = async <T extends IData>(query?: DBQuery, index?: string, direction?: IDBCursorDirection): Promise<ICursor<T>> => {
    if (!direction) {
      direction = 'next'
    }
    let queryObject: DBKeyRange;
    if (!isObject(query) || isArray(query) || isDate(query)) {
      if (direction === 'next' || direction == 'nextunique') {
        queryObject = { lower: query };
      } else {
        queryObject = { upper: query };        
      }
    } else {
      queryObject = { ...query };
    }

    let ixCursor = getIXDBCursor<T>(queryObject, index, direction);
    
    const cursor: ICursor<T> = {
      next: null,
      value: null,
    }
    let nextValue: Promise<T> = ixCursor.next();
    cursor.next = async () => {
      cursor.value = await nextValue;
      nextValue = ixCursor.next();
      return cursor.value;
    }
    return cursor;
  };

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

  const baseOps: IDB = {
    find,
    openCursor,
    save,
    get: id => dbOp('data', 'get', id),
    delete: id => dbOp('data', 'delete', id),
    files: {
      save: file => dbOp('files', 'put', file),
      get: id => dbOp('files', 'get', id),
      delete: id => dbOp('files', 'delete', id),
    },
    local: {
      save: data => dbOp('local', 'put', data),
      get: id => dbOp('local', 'get', id),
      delete: id => dbOp('local', 'delete', id),
    },
  }

  return baseOps;
}
