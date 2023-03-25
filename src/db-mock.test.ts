import { cloneDeep, isArray, isDate, orderBy } from "lodash";
import { isObject } from "./common";
import { IDataChange } from "./data-change";
import { DBQuery, IData, IDB, IFile, Indexes, IPersistenceLayer, init as initDB, DBCursorDirection, ICursor } from "./db"


class MemoryCollection<T extends { id: string }> {

  readonly collection: Record<string, T> = {};

  save = async (data: T | T[], skipValidation?: boolean) => {
    if (!isArray(data)) {
      data = [data];
    }
    data.forEach(d => this.collection[d.id] = cloneDeep(d));
  }

  get = async (id: string) => cloneDeep(this.collection[id]);

  delete = async (id: string) => (delete this.collection[id], void 0);

  find = async (query?: DBQuery, index?: Indexes) => {
    const _index: string = typeof index === 'string' && index || 'id';
    const indexAry = _index.split('-');
    let results = Object.values(this.collection).filter(doc => {
      if (isArray(query)) {
        return indexAry.some((key, i) => doc[key] !== query[i]);
      }
      else if (isObject(query) && !isDate(query)) {
        if (query.lower) {
          if (isArray(query.lower)) {
            const noMatch = indexAry.some((key, i) => {
              if (query.lowerOpen === false) {
                return doc[key] <= query.lower[i];
              } else {
                return doc[key] < query.lower[i];
              }
            });
            if (noMatch) return false;
          } else {
            if (doc[_index] !== query.lower) return false;
          }
        }
        if (query.upper) {
          if (isArray(query.upper)) {
            const noMatch = indexAry.some((key, i) => {
              if (query.upperOpen === false) {
                return doc[key] >= query.upper[i];
              } else {
                return doc[key] > query.upper[i];
              }
            });
            if (noMatch) return false;
          } else {
            if (doc[_index] !== query.upper) return false;
          }
        }
        return true;
      } else {
        return doc[_index] === query
      }
    })
    return results;
  }

  openCursor = async (query?: DBQuery, index?: Indexes, direction: DBCursorDirection = 'next') => {
    const _index: string = typeof index === 'string' && index || 'id';
    const indexAry = _index.split('-');
    const cursor: ICursor<T> = {
      next: async () => {
        let docs = await this.find(query, index);
        docs = orderBy(docs, [...indexAry, 'id']);
        if (direction?.startsWith('prev')) {
          docs = docs.reverse();
        }
        if (!cursor.value) {
          cursor.value = docs[0];
          return cursor.value;
        }
        let newValue: T = null;
        for (const doc of docs) {
          let found = false;
          if (direction.includes('next')) {
            if (direction.includes('unique')) {
              found = indexAry.every((key) => doc[key] >= cursor.value[key])
                && indexAry.some((key) => doc[key] > cursor.value[key]);                
            } else {
              found = indexAry.every((key) => doc[key] >= cursor.value[key])
                && doc.id > cursor.value.id;              
            }
          } else {
            if (direction.includes('unique')) {
              found = !indexAry.some((key) => doc[key] >= cursor.value[key]);
            } else {
              found = !indexAry.some((key) => doc[key] > cursor.value[key] && doc.id >= cursor.value.id);
            }
          }
          if (found) {
            newValue = doc;
            break;
          }
        }
        cursor.value = newValue;
        return newValue;
      },
      value: null
    }
    return cursor;
  }
}

export async function initMemoryDB() {
  const dataCollection = new MemoryCollection<IData>();
  const filesCollection = new MemoryCollection<IFile>();
  const localCollection = new MemoryCollection<any>();
  const changesCollection = new MemoryCollection<IDataChange>();

  let db: IDB = {
    save: dataCollection.save,
    // @ts-ignore
    get: dataCollection.get,
    delete: dataCollection.delete,
    // @ts-ignore
    find: dataCollection.find,
    // @ts-ignore
    openCursor: dataCollection.openCursor,
    files: {
      save: file => filesCollection.save(file),
      get: filesCollection.get,
      delete: filesCollection.delete,
    },
    local: {
      save: localCollection.save,
      get: localCollection.get,
      delete: localCollection.delete,
    },
    changes: {
      save: changesCollection.save,
      get: changesCollection.get,
      delete: changesCollection.delete,
      // @ts-ignore    
      openCursor: async (group: string, modified?: number) => {
        const cursor = {
          next: async () => {

          },
          value: null
        }
        return cursor;
      },
      getSubjectChanges: async (subject, modified?) => {
        return Object.values(changesCollection.collection)
          .filter(c => c.subject === subject && (modified === undefined || c.modified >= modified))
          .map(cloneDeep);
      }
    }
  }
  return db;
}

export async function mockPersistencyLayerOpts(): Promise<IPersistenceLayer> {
  let db: IDB;
  async function init() {
    if (!db) {
      db = await initMemoryDB();
    }
    return db;
  }
  return {
    init
  }
}

export async function initDBWithMemoryMock(): Promise<IDB> {
  return await initDB({
    persistenceLayer: await mockPersistencyLayerOpts()
  });
}