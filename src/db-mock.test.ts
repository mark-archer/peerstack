import { cloneDeep, isArray } from "lodash";
import { IDataChange } from "./data-change";
import { DBQuery, IData, IDB, IFile, Indexes, IPersistenceLayer, init as initDB } from "./db"


class MemoryCollection<T extends { id: string }> {

  readonly collection: Record<string, T> = {};

  save = async(data: T | T[], skipValidation?: boolean) => {
    if (!isArray(data)) {
      data = [data];
    }
    data.forEach(d => this.collection[d.id] = cloneDeep(d));
  }

  get = async (id: string) => cloneDeep(this.collection[id]);

  delete = async (id: string) => (delete this.collection[id], void 0);

  find = async (query?: DBQuery, index?: Indexes) => {
    throw new Error("Not implemented");
  }

  openCursor = async (query?: DBQuery, index?: Indexes) => {
    throw new Error("Not implemented");
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
    find: dataCollection.find,
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
      openCursor: (group: string, modified?: number) => {
        throw new Error("Not implemented")
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