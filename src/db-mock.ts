import { isArray } from "lodash";
import { DBQuery, IData, IDB, IFile, Indexes, IPersistenceLayer, init as initDB } from "./db"


class MemoryCollection<T extends { id: string }> {

  private collection: Record<string, T> = {};

  save = async(data: T | T[], skipValidation?: boolean) => {
    if (!isArray(data)) {
      data = [data]
    }
    data.forEach(d => this.collection[d.id] = d);
  }

  get = async (id: string) => this.collection[id];

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
  const localCollection = new MemoryCollection<IData>();

  let db: IDB = {
    save: dataCollection.save,
    // @ts-ignore
    get: dataCollection.get,
    delete: dataCollection.delete,
    find: dataCollection.find,
    openCursor: dataCollection.openCursor,
    files: {
      // save: (file: IFile) => Promise<void>
      // get: (id: string) => Promise<IFile>
      // delete: (id: string) => Promise<void>
      save: file => filesCollection.save(file),
      get: filesCollection.get,
      delete: filesCollection.delete,
    },
    local: {
      // save: (data: any) => Promise<void>
      // get: (id: string) => Promise<any>
      // delete: (id: string) => Promise<void>
      save: localCollection.save,
      get: localCollection.get,
      delete: localCollection.delete,
    },
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