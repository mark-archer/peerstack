import { IData, Indexes, IDB, ICursor, DBQuery, DBKeyRange, DBKeyArray, DBKeyValue, DBCursorDirection, PeerstackDBOpts } from './db';

// export function convertDBQueryToFSQuery(query: DBQuery): IDBQuery {
//   if (isObject(query)) {
//     const dbQuery = query as DBKeyRange;
//     if (dbQuery.lower !== undefined && dbQuery.upper === undefined) {
//       return IDBKeyRange.lowerBound(dbQuery.lower, dbQuery.lowerOpen);
//     } else if (dbQuery.lower === undefined && dbQuery.upper !== undefined) {
//       return IDBKeyRange.upperBound(dbQuery.upper, dbQuery.upperOpen);
//     } else {
//       return IDBKeyRange.bound(dbQuery.lower, dbQuery.upper, dbQuery.lowerOpen, dbQuery.upperOpen);
//     }
//   } else {
//     return query as DBKeyValue | DBKeyArray;
//   }
// }

class FSIndex {
  constructor(name: string) {
    
  }
  // TODO build this class
}

export type DataStore = 'data' | 'files' | 'local';

export interface FS {
  readFile: (path: string) => Promise<string>
  listFiles: (path: string) => Promise<string[]>  
  writeFile: (path: string, contents: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
}

let fs: FS;

export interface DBFSOpts extends PeerstackDBOpts {
  _fs: FS
}

export async function init({ dbName = 'peerstack', dbVersion = 1, onUpgrade, _fs }: DBFSOpts): Promise<IDB> {
  fs = _fs
  const readJSON = (path: string) => fs.readFile(path).then(JSON.parse)
  const writeJSON = (path: string, data: any) => fs.writeFile(path, JSON.stringify(data))

  const indexes: { [key: string]: FSIndex } = {}

  async function createIndex(dataStore: DataStore, index: Indexes) {
    await fs.mkdir(`${dbName}/${dataStore}/indexes/${index}`)    
  }

  const db = await new Promise(async (resolve, reject) => {
    try {
      const infoFile = `${dbName}/info.json`;
      const info: { version: number } = await readJSON(infoFile).catch(err => {
        if (String(err).includes('no such file')) {
          return { version: 0 };
        }
        throw err
      })
      const currentVersion = info.version
      if (currentVersion < dbVersion) {
        if (currentVersion < 1) {
          info.version = 1;

          await fs.mkdir(`${dbName}/data`)
          await fs.mkdir(`${dbName}/files`)
          await fs.mkdir(`${dbName}/local`)
          await fs.mkdir(`${dbName}/indexes`)

          const data: DataStore = "data";
          await createIndex(data, 'group');
          await createIndex(data, 'type');
          await createIndex(data, 'owner');
          await createIndex(data, 'modified');  
          await createIndex(data, 'group-modified');
          await createIndex(data, 'type-modified');
          await createIndex(data, 'owner-modified');  
          await createIndex(data, 'group-type-modified');
          await createIndex(data, 'group-owner-modified');
          await createIndex(data, 'group-type');
          await createIndex(data, 'group-owner');
          await createIndex(data, 'type-owner');  
          await createIndex(data, 'group-type-owner');
          await createIndex(data, 'type-owner-modified');  
          await createIndex(data, 'group-type-owner-modified');
          await createIndex(data, 'subject');
          await createIndex(data, 'group-subject');
          await createIndex(data, 'group-type-subject');
          await createIndex(data, 'type-subject');          
        }

        if (onUpgrade) {
          await onUpgrade(info);
        }
        await writeJSON(infoFile, info);
      }  
    } catch (err) {
      reject(err)
    }
  });

  const save = (data: IData[]): Promise<any> => new Promise(async (resolve, reject) => {
    // TODO write all data to individual files
  });

  const find = <T = IData>(query?: DBQuery, index?: Indexes): Promise<T[]> =>
    new Promise(async (resolve, reject) => {
      // TODO search files/indexes
    });

  const openCursor = <T>(query?: DBQuery, index?: string, direction?: DBCursorDirection): Promise<ICursor<T>> =>
    new Promise(async (resolve, reject) => {
      // TODO create cursor for files
    });

  function dbOp(dataStore: DataStore, op: 'put' | 'delete' | 'get', value) {
    switch (op) {
      case 'put':
        return writeJSON(`${dbName}/${dataStore}/${value.id}.json`, value);
      case 'get':
        return readJSON(`${dbName}/${dataStore}/${value}.json`);
      case 'delete':
        return fs.deleteFile(`${dbName}/${dataStore}/${value}.json`);
    }    
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
