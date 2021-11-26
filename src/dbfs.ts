import * as _ from 'lodash';
import { sortedIndex, sortedIndexOf } from 'lodash';
import { isObject } from '.';
import { isArray, parseJSON, stringify } from './common';
import { DBCursorDirection, DBKeyArray, DBKeyRange, DBQuery, ICursor, IData, IDB, Indexes, PeerstackDBOpts } from './db';

function cleanPath(path) {
  return path.split('/').map(s => encodeURIComponent(s)).join('/')
  // return path.replace(/\:/g, '%3A');
}

let fs: FS;
const readJSON = (path: string) => fs.readFile(cleanPath(path))
  .catch(err => {
    if (String(err?.message).toLowerCase().includes('no such file')) {
      return null;
    } else {
      throw err;
    }
  })
  .then(parseJSON);

let writeLock: Promise<any> = Promise.resolve();
const writeJSON = async (path: string, data: any) => {
  path = cleanPath(path);

  let lockPromiseResolve;
  let lockPromise = new Promise((resolve) => {
    lockPromiseResolve = resolve;
  })
  const oldWriteLock = writeLock;
  writeLock = lockPromise;
  await oldWriteLock;
   
  // if (path.includes('7194ee666e4c4ab18f1f7466ec525a43')) {
  //   console.log('WRITING STARTED', { path, data })
  // }  
  // console.log('WRITING STARTED', { path, data })
  if (fs.exists(path)) {
    await fs.deleteFile(path).catch(err => console.log('error deleting file', err));
  }
  const r = await fs.writeFile(path, stringify(data));
  // console.log('WRITING FINISHED', { path, data })  
  // if (path.includes('7194ee666e4c4ab18f1f7466ec525a43')) {
  //   console.log('WRITING FINISHED', { path, data })
  // }
  // if (path.includes('7194ee666e4c4ab18f1f7466ec525a43')) {
  //   const data = await readJSON(path);
  //   console.log('READING BACK', { path, data })
  // }
  lockPromiseResolve();
  console.log('wrote', path)
  return r;
}

type IndexesOrId = Indexes | 'id';

type IndexMap = {
  values: any[][]
  ids: string[][]
};

class DBFSIndex {
  private __indexMap: IndexMap = null;

  constructor(
    readonly name: string,
    readonly fileName: string
  ) { }

  private async getIndex() {
    if (!this.__indexMap) {
      this.__indexMap = await readJSON(this.fileName);
    }
    return this.__indexMap;
  }

  private async saveIndex() {
    const index = await this.getIndex();
    await writeJSON(this.fileName, index);
  }

  public async add(value: string[], id: string) {
    const index = await this.getIndex();
    const iValue = sortedIndex(index.values, value);
    if (index.values[iValue] !== value) {
      index.values.splice(iValue, 0, value);
      index.ids.splice(iValue, 0, [id]);
      await this.saveIndex();
    } else {
      const iId = sortedIndex(index.ids[iValue], id);
      if (index.ids[iValue][iId] !== id) {
        index.ids[iValue].splice(iId, 0, id);
        await this.saveIndex();
      }
    }
  }

  public async remove(value: string[], id: string) {
    const index = await this.getIndex();
    const iValue = sortedIndex(index.values, value);
    if (index.values[iValue] === value) {
      const iId = sortedIndex(index.ids[iValue], id);
      if (index.ids[iValue][iId] === id) {
        if (index.ids[iValue].length === 1) {
          // remove value (and [id]) from index
          index.values.splice(iValue, 1);
          index.ids.splice(iValue);
          await this.saveIndex();
        } else {
          // remove id
          index.ids[iValue].splice(iId, 1);
          await this.saveIndex();
        }
      }
    }
  }

  private async matchQuery(query?: DBQuery, direction: DBCursorDirection = 'next'): Promise<string[]> {
    const index = await this.getIndex();
    if (!query) {
      return _.flatten(index.ids)
    }
    if (typeof query !== 'object') {
      const i = sortedIndexOf(index.values, [query]);
      return index.ids[i] || [];
    }
    if (isArray(query)) {
      const ids = await Promise.all((query as DBKeyArray).map(key => this.matchQuery(key)));
      return _.flatten(ids);
    }
    const { lowerOpen, upperOpen, lower, upper } = query as DBKeyRange;
    const matchedIds = [];
    if (direction === 'next' || direction === 'nextunique') {
      // TODO looks like `nextunique` isn't being accounted for
      for (let i = 0; i < index.values.length; i++) {
        const key = index.values[i];
        if (key > upper || (key === upper && upperOpen)) break;
        if (key < lower || (key === lower && lowerOpen)) continue;
        matchedIds.push(...index.ids[i])
      }
    } else {
      // TODO looks like `prevunique` isn't being accounted for
      for (let i = index.values.length - 1; i >= 0; i--) {
        const key = index.values[i];
        if (key > upper || (key === upper && upperOpen)) continue;
        if (key < lower || (key === lower && lowerOpen)) break;
        matchedIds.push(...index.ids[i])
      }
    }
    return matchedIds;
  }

  async find(query?: DBQuery): Promise<string[]> {
    // get all keys that match query
    let ids: string[] = await this.matchQuery(query)
    return ids;
  }

  async openCursor(query?: DBQuery, direction?: DBCursorDirection): Promise<ICursor<string>> {
    let ids = await this.matchQuery(query, direction);
    let lastIndex = 0;
    const cursor: ICursor<string> = {
      value: ids[lastIndex] ?? null,
      next: async () => ids[lastIndex++] ?? null,
    }
    return cursor;
  }
}

export type DataStore = 'data' | 'files' | 'local';

export interface FS {
  readFile: (path: string) => Promise<string>
  listFiles: (path: string) => Promise<string[]>
  writeFile: (path: string, contents: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
}

export interface DBFSOpts extends PeerstackDBOpts {
  _fs: FS
}

export interface DBFSInfoFile {
  version: number,
  indexes: {
    dataStore: DataStore
    name: string
  }[]
}

export async function init({ dbName = 'peerstack', dbVersion = 1, onUpgrade, _fs }: DBFSOpts): Promise<IDB> {
  fs = _fs
  const indexes: { [index: string]: DBFSIndex } = {}

  await new Promise(async (resolve, reject) => {
    try {
      const infoFile = `${dbName}/info.json`;
      let info: DBFSInfoFile = await readJSON(infoFile);
      if (!info) {
        info = { version: 0, indexes: [] };
        await fs.mkdir(`${dbName}`);
      }
      async function createIndex(dataStore: DataStore, index: string) {
        // await fs.mkdir(`${dbName}/${dataStore}/indexes/${index}`);
        await fs.mkdir(`${dbName}/${dataStore}/indexes`);
        const blankIndex: IndexMap = {
          values: [],
          ids: []
        }
        await fs.writeFile(`${dbName}/${dataStore}/indexes/${index}.json`, JSON.stringify(blankIndex))
        info.indexes.push({ dataStore, name: index });
      }
      const currentVersion = info.version
      if (currentVersion < dbVersion) {
        if (currentVersion < 1) {
          info.version = 1;

          await fs.mkdir(`${dbName}/data`)
          await fs.mkdir(`${dbName}/files`)
          await fs.mkdir(`${dbName}/local`)
          await fs.mkdir(`${dbName}/indexes`)

          const data: DataStore = "data";
          await createIndex(data, 'id');
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
      info.indexes.forEach(dbfsIndex => {        
        indexes[dbfsIndex.name] = new DBFSIndex(dbfsIndex.name, `${dbName}/${dbfsIndex.dataStore}/indexes/${dbfsIndex.name}.json`);        
      })
    } catch (err) {
      reject(err)
    }
    resolve(null)
  });

  function dbOp(dataStore: DataStore, op: 'get' | 'save' | 'delete', value) {
    // TODO don't write as JSON if `files` datastore
    switch (op) {
      case 'get':
        return readJSON(`${dbName}/${dataStore}/${value}.json`);
      case 'save':
        return writeJSON(`${dbName}/${dataStore}/${value.id}.json`, value);
      case 'delete':
        return fs.deleteFile(`${dbName}/${dataStore}/${value}.json`);
    }
  }

  const find = async <T = IData>(query?: DBQuery, index?: Indexes): Promise<T[]> => {
    let _index = index || 'id';
    const ids = await indexes[_index as string].find(query);
    return Promise.all(ids.map(id => dbOp('data', 'get', id)))
  }

  const openCursor = async <T>(query?: DBQuery, index?: Indexes, direction?: DBCursorDirection): Promise<ICursor<T>> => {
    if (typeof index !== 'string') {
      throw new Error('custom indexes are not supported')
    }
    let _index: string = index || 'id';
    const indexCursor = await indexes[_index].openCursor(query, direction);
    const cursor: ICursor<T> = {
      value: null,
      next: async () => {
        const nextId = await indexCursor.next();
        // console.log({ nextId })
        if (!nextId) {
          cursor.value = null;
        } else {
          // NOTE: if nextId is deleted between `openCursor` and when it is requested, this can result in `value` equalling null
          cursor.value = await dbOp('data', 'get', nextId);
        }
        return cursor.value
      }
    }
    await cursor.next();
    return cursor;
  }

  const save = async (data: IData[]): Promise<any> => {
    // return Promise.all(data.map(async d => {
    //   const dbData = await dbOp('data', 'get', d.id);
    //   await Promise.all(Object.keys(indexes).map(indexName => {
    //     const fieldNames = indexName.split('-');
    //     if (dbData) {
    //       const oldValues = fieldNames.map(fn => dbData[fn]);
    //       indexes[indexName].remove(oldValues, d.id);
    //     }
    //     const newValues = fieldNames.map(fn => data[fn]);
    //     indexes[indexName].add(newValues, d.id);
    //   }))
    //   return dbOp('data', 'put', d)
    // }));
    for (const d of data) {
      const dbData = await dbOp('data', 'get', d.id);
      await Promise.all(Object.keys(indexes).map(indexName => {
        const fieldNames = indexName.split('-');
        if (dbData) {
          const oldValues = fieldNames.map(fn => dbData[fn]);
          indexes[indexName].remove(oldValues, d.id);
        }
        const newValues = fieldNames.map(fn => data[fn]);
        indexes[indexName].add(newValues, d.id);
      }))
      await dbOp('data', 'save', d)
    }
  }

  const _delete = async (id: string): Promise<any> => {
    const dbData = await dbOp('data', 'get', id);
    await Promise.all(Object.keys(indexes).map(indexName => {
      const fieldNames = indexName.split('-');
      if (dbData) {
        const oldValues = fieldNames.map(fn => dbData[fn]);
        indexes[indexName].remove(oldValues, id);
      }
    }));
    return await dbOp('data', 'delete', id);
  }

  const baseOps: IDB = {
    find,
    openCursor,
    save,
    delete: _delete,
    get: id => dbOp('data', 'get', id),
    files: {
      save: file => dbOp('files', 'save', file),
      get: id => dbOp('files', 'get', id),
      delete: id => dbOp('files', 'delete', id),
    },
    local: {
      save: data => dbOp('local', 'save', data),
      get: id => dbOp('local', 'get', id),
      delete: id => dbOp('local', 'delete', id),
    },
  }

  return baseOps;
}
