import { uniq, isArray, isDate, isObject } from 'lodash';
import { IDataChange } from './data-change';
import { IData, Indexes, IDB, ICursor, DBQuery, DBKeyRange, DBKeyArray, DBKeyValue, PeerstackDBOpts, IKVIndex } from './db';

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
  { dbName = 'peerstack', dbVersion = 8, onUpgrade }: PeerstackDBOpts = {}
): Promise<IDB> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('indexedDB is not currently available')
  }

  function createIndex(objectStore: IDBObjectStore, index: Indexes) {
    if (typeof index !== 'string') {
      throw new Error('only strings are supported')
    }
    let keyPath: string[] | string = index.split('-');
    if (keyPath.length == 1) {
      keyPath = keyPath[0];
    }
    objectStore.createIndex(index as string, keyPath, { unique: false });
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
        createIndex(dataStore, 'modified');

        createIndex(dataStore, 'group-modified');
        createIndex(dataStore, 'type-modified');

        createIndex(dataStore, 'group-type-modified');
      }
      if (oldVersion < 2) {
        const fileStore = db.createObjectStore("files", { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        const dataStore = upgradeTransaction.objectStore('data');
        createIndex(dataStore, 'group-type');
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
        const localStore = db.createObjectStore("local", { keyPath: 'id' });
      }
      if (oldVersion < 7) {
        const kvIndex = db.createObjectStore("keyValueIndex", { keyPath: ['indexId', 'dataId'] });
        // @ts-ignore
        createIndex(kvIndex, 'indexId-dataValue')
        // @ts-ignore
        createIndex(kvIndex, 'indexId')
      }
      if (oldVersion < 8) {
        const kvIndex = db.createObjectStore("changes", { keyPath: 'id' });
        createIndex(kvIndex, 'subject');
        // @ts-ignore
        createIndex(kvIndex, 'subject-modified');
        createIndex(kvIndex, 'group-modified');
      }
      if (onUpgrade) await onUpgrade(evt);
    }
  });

  interface IKVIndexEntry {
    indexId: string
    dataId: string
    dataValue: string
  }

  async function deleteIndexEntries(ix: IKVIndex) {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['keyValueIndex'], 'readwrite');
      const kvStore = transaction.objectStore('keyValueIndex');
      const cursor = kvStore.index('indexId').openCursor(ix.id);
      cursor.onerror = reject;
      cursor.onsuccess = (evt) => {
        const ixCursor: IDBCursorWithValue = (evt.target as any).result;
        if (ixCursor) {
          ixCursor.delete();
          ixCursor.continue();
        } else {
          resolve(null);
        }
      }
    });
  }

  async function buildIndexEntries(ix: IKVIndex) {
    await new Promise(async (resolve, reject) => {
      // const transIX = db.transaction(['keyValueIndex'], 'readwrite');
      // const kvStore = transIX.objectStore('keyValueIndex');
      const transData = db.transaction(['data'], 'readonly');
      const dataStore = transData.objectStore('data');

      const cursor: IDBRequest<IDBCursorWithValue> = ix.dataType
        ? dataStore.index('group-type').openCursor([ix.group, ix.dataType])
        : dataStore.index('group').openCursor(ix.group);
      cursor.onerror = reject;
      const ixInserts: Promise<any>[] = [];
      cursor.onsuccess = (evt) => {
        const ixCursor: IDBCursorWithValue = (evt.target as any).result;
        if (ixCursor) {
          const data = ixCursor.value;
          const ixEntry: IKVIndexEntry = {
            indexId: ix.id,
            dataId: data.id,
            dataValue: data[ix.dataKey],
          }
          ixInserts.push(
            dbOp('keyValueIndex', 'put', ixEntry)
          );
          ixCursor.continue();
        } else {
          Promise.all(ixInserts).then(() => resolve(null))
        }
      }
    });
  }

  const save = (data: IData[]): Promise<any> => new Promise(async (resolve, reject) => {
    const indexCache = {} as { [key: string]: IKVIndex[] }
    await Promise.all(uniq(data.map(d => d.group).map(async g => {
      indexCache[g] = await find([g, 'Index'], 'group-type');
    })));
    const transaction = db.transaction(['data', 'keyValueIndex'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const dataStore = transaction.objectStore('data');
    const kvStore = transaction.objectStore('keyValueIndex');

    for (const d of data) {
      indexCache[d.group]
        .filter(ix => !ix.dataType || ix.dataType === d.type)
        .forEach(ix => {
          const ixEntry: IKVIndexEntry = {
            indexId: ix.id,
            dataId: d.id,
            dataValue: d[ix.dataKey],
          }
          // TODO maybe delete entries with null values
          const request = kvStore.put(ixEntry)
          request.onerror = evt => reject(evt);
        });
      const request = dataStore.put(d);
      request.onerror = evt => reject(evt);
    }
    transaction.oncomplete = async evt => {
      // when saving type of 'Index', rebuild index
      for (const d of data) {
        if (d.type === 'Index') {
          await deleteIndexEntries(d as IKVIndex);
          await buildIndexEntries(d as IKVIndex);
        }
      }
      resolve((evt.target as any).result);
    };
  });

  const find = <T = IData>(query?: DBQuery, index?: Indexes | IKVIndex): Promise<T[]> => new Promise(async (resolve, reject) => {
    const transaction = db.transaction(['data', 'keyValueIndex'], 'readonly');
    transaction.onerror = evt => reject(evt);
    const dataStore = transaction.objectStore('data');
    if (isObject(index)) {
      // prefix all query values with index id
      if (!isObject(query) || isDate(query)) {
        query = [index.id, query];  // query by index and value
      } else if (isArray(query)) {
        throw new Error('querying by index values of arrays is not supported'); // TODO this might be fine (or at least possible). needs to be tested
      } else {
        if (query.lower) {
          query.lower = [index.id, query.lower as DBKeyValue]
        }
        if (query.upper) {
          query.upper = [index.id, query.upper as DBKeyValue]
        }
      }
      const ixQuery = convertDBQueryToIDBQuery(query)
      const kvStore = transaction.objectStore('keyValueIndex');
      const request = kvStore.index('indexId-dataValue').getAll(ixQuery);
      request.onerror = evt => reject(evt);
      request.onsuccess = async evt => {
        const kvResults = (evt.target as any).result as IKVIndexEntry[];
        const ids = uniq(kvResults.map(kv => kv.dataId));
        const results = await Promise.all(ids.map(id => dbOp('data', 'get', id)))
        resolve(results);
      };
    } else {
      const ixQuery = convertDBQueryToIDBQuery(query)
      let request: IDBRequest;
      if (index) {
        request = dataStore.index(index).getAll(ixQuery);
      } else {
        request = dataStore.getAll(ixQuery);
      }
      request.onerror = evt => reject(evt);
      request.onsuccess = evt => resolve((evt.target as any).result);
    }
  });

  const getIXDBCursor = <T extends { id: string } = IData>(query?: DBKeyRange, index?: string, direction?: IDBCursorDirection, objectStore: 'data' | 'changes' = 'data') => {
    const cursorState = {
      reject: null as (err) => any,
      next: null as () => Promise<T>
    }

    let ixCursor: IDBCursorWithValue;
    let transactionClosed = false;
    let cursorFinished = false;
    let restartingCursor = false;
    let priorValue: T;
    let nextValue: T;
    let resolveNextValue;
    let nPriorResults = 0;

    cursorState.next = () => new Promise((resolve, _reject) => {
      cursorState.reject = _reject;
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
      const transaction = db.transaction([objectStore], 'readonly');
      transaction.onerror = evt => cursorState.reject(evt);
      transaction.onabort = evt => cursorState.reject(evt);
      transaction.oncomplete = evt => {
        if (resolveNextValue && !cursorFinished) {
          restartingCursor = true;
          openTransactionRequest(); // the transaction closed while we were waiting for a value so open a new one
        } else {
          transactionClosed = true;
        }
      }
      const dataStore = transaction.objectStore(objectStore);
      const ixQuery = convertDBQueryToIDBQuery(query);
      const request: IDBRequest = index
        ? dataStore.index(index).openCursor(ixQuery, direction)
        : dataStore.openCursor(ixQuery, direction);
      request.onerror = evt => cursorState.reject(evt);
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

        // TODO this can probably be simplified - priorValue should always be true unless the cursor is done in which case we shouldn't get here
        if (restartingCursor && priorValue) {
          restartingCursor = false
          if (!index) {
            ixCursor.advance(nPriorResults); // TODO this should probably be +1
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

        // this is needed because `continuePrimaryKey` gets us to our last value but we want the value after that
        if (priorValue?.id === ixCursor.value?.id) {
          ixCursor.continue();
          return;
        }

        priorValue = ixCursor.value;
        nPriorResults++;

        if (resolveNextValue) {
          resolveNextValue(ixCursor.value);
          resolveNextValue = null;
          nextValue = null;
          ixCursor.continue();
        } else {
          nextValue = ixCursor.value;
        }
      }
    }
    openTransactionRequest();

    return cursorState;
  };

  const openCursor = async <T extends { id: string } = IData>(query?: DBQuery, index?: Indexes, direction?: IDBCursorDirection, objectStore: 'data' | 'changes' = 'data'): Promise<ICursor<T>> => {
    if (typeof index !== 'string') {
      throw new Error('custom indexes not currently supported')
    }
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

    let ixCursor = getIXDBCursor<T>(queryObject, index, direction, objectStore);

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

  async function deleteData(id: string) {
    const data: IData = await dbOp('data', 'get', id);
    if (data.type === 'Index') {
      await deleteIndexEntries(data as IKVIndex);
    }
    return dbOp('data', 'delete', id);
  }

  function dbOp(storeName: 'data' | 'files' | 'local' | 'keyValueIndex' | 'changes', op: 'put' | 'delete' | 'get', value) {
    return new Promise<any>((resolve, reject) => {
      const mode: IDBTransactionMode = op === 'get' ? 'readonly' : 'readwrite';
      const transaction = db.transaction([storeName], mode);
      transaction.onerror = evt => reject(evt);
      const request = transaction.objectStore(storeName)[op](value);
      request.onerror = evt => reject(evt);
      request.onsuccess = evt => resolve((evt.target as any).result);
    });
  }

  const baseOps: IDB = {
    find,
    openCursor,
    save,
    get: id => dbOp('data', 'get', id),
    delete: deleteData,
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
    changes: {
      save: data => dbOp('changes', 'put', data),
      get: id => dbOp('changes', 'get', id),
      delete: id => dbOp('changes', 'delete', id),
      openCursor: (group, modified = -Infinity, direction: IDBCursorDirection = 'next') => {
        const index: Indexes = 'group-modified';
        const query: DBQuery = { lower: [group, modified], upper: [group, Infinity] };
        return openCursor<IDataChange>(query, index, direction, 'changes');
      },
      getSubjectChanges: (subject, modified?): Promise<IDataChange[]> => new Promise(async (resolve, reject) => {
        const transaction = db.transaction(['changes'], 'readonly');
        transaction.onerror = evt => reject(evt);
        const dataStore = transaction.objectStore('changes');
        let request: IDBRequest;
        const ixQuery = convertDBQueryToIDBQuery({ lower: [subject, modified || -Infinity], upper: [subject, Infinity] });
        request = dataStore.index('subject-modified').getAll(ixQuery);
        request.onerror = evt => reject(evt);
        request.onsuccess = evt => resolve((evt.target as any).result);
      })
    }
  }

  return baseOps;
}
