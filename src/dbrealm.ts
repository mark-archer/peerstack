
import { parseJSON, stringify } from './common';
import { DBCursorDirection, DBKeyArray, DBKeyRange, DBQuery, ICursor, IData, IDB, Indexes, PeerstackDBOpts } from './db';

import Realm from "realm";
import { db, isObject } from '.';
import { isDate, isEqual, isArray } from 'lodash';

function dbQueryToRealmQuery(query?: DBQuery, index?: Indexes): string {
  if (!query && !index) {
    // no query or index so return everything
    return null
  } else if (typeof query !== 'object' || isDate(query)) {
    // query is just a single value like 'User' so { query: 'User', index: 'type' } => `type === 'User'`    
    return `${index ?? 'id'} == ${typeof query === "string" ? `"${query}"` : query}`;
  } else if (isArray(query)) {
    const fields = index.split('-');
    if (fields.length != query.length) {
      throw new Error('Number of values in the query must match number of fields in index');
    }
    return fields.map((field, i) => {
      const value = query[i];
      return `${field} == ${typeof value === 'number' ? value : `"${value}"`}`;
    }).join(' && ');
  } else {
    // query is a range across one or more indexes
    let fields: string[] = index?.split('-') ?? ['id'];
    let lowerValues: any[] = query.lower !== undefined && isArray(query.lower) ? (query.lower as any[]) : [(query.lower as any)];
    let upperValues: any[] = query.upper !== undefined && isArray(query.upper) ? (query.upper as any[]) : [(query.upper as any)];

    if ((lowerValues && fields.length !== lowerValues.length) && (upperValues && fields.length !== upperValues.length)) {
      throw new Error(`Number of indexes must match number of values in lower or upper`)
    }

    let strQuery: string[] = [];
    let queryValues: any[] = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const lower = lowerValues?.[i];
      const upper = upperValues?.[i];
      if (lower !== undefined) {
        if (query.lowerOpen && i === fields.length - 1) {
          strQuery.push(`${field} > $${queryValues.length}`);
        } else {
          strQuery.push(`${field} >= $${queryValues.length}`);
        }
        queryValues.push(lower);
      }
      if (upper !== undefined) {
        if (query.upperOpen && i === fields.length - 1) {
          strQuery.push(`${field} < $${queryValues.length}`);
        } else {
          strQuery.push(`${field} <= $${queryValues.length}`);
        }
        queryValues.push(upper);
      }
    }
    let strQueryResult = strQuery.join(' && ');
    queryValues.forEach((value, i) => strQueryResult = strQueryResult.replace(`$${i}`, typeof value === 'string' ? `"${value}"` : value))
    // console.log('query string generated', { query, index, str: strQueryResult })
    return strQueryResult;
  }
}

export async function init(
  { dbName = 'peerstack', dbVersion = 1, onUpgrade }: PeerstackDBOpts = {}
): Promise<IDB> {

  const DataSchema = {
    name: "Data",
    properties: {
      id: { type: "string", indexed: true },
      group: { type: "string", indexed: true },
      type: { type: "string", indexed: true },
      owner: { type: "string", indexed: true },
      modified: { type: "int", indexed: true },
      doc: "string",
    },
    primaryKey: "id",
  };

  const LocalDataSchema = {
    name: "Local",
    properties: {
      id: { type: "string", indexed: true },
      group: { type: "string?", indexed: true },
      type: { type: "string?", indexed: true },
      owner: { type: "string?", indexed: true },
      modified: { type: "int?", indexed: true },
      doc: "string",
    },
    primaryKey: "id",
  };

  const FilesSchema = {
    name: "Files",
    properties: {
      id: { type: "string", indexed: true },
      name: { type: "string", indexed: true },
      fileType: { type: "string", indexed: true },
      size: "int",
      blob: "data",
      isPublic: "bool",
      shareUsers: "string[]",
      shareGroups: "string[]"

    },
    primaryKey: "id",
  };

  const realm = await Realm.open({
    path: dbName,
    schema: [DataSchema, LocalDataSchema, FilesSchema],
  });

  // TODO this won't work for 'Files'
  async function dbOp(storeName: 'Data' | 'Files' | 'Local', op: 'save' | 'delete' | 'get', value) {
    if (storeName === 'Files') {
      throw new Error('currently not implemented for Files')
    }
    if (op === 'get') {
      const dbValue = realm.objectForPrimaryKey(storeName, value?.id || value) as any;
      if (!dbValue) {
        return null
      } else {
        return parseJSON(dbValue.doc)
      }
    } else if (op === 'save') {
      const d = value;
      let dbValue = realm.objectForPrimaryKey(storeName, d.id) as any;
      if (!dbValue) {
        // create
        dbValue = {
          id: d.id,
          group: d.group,
          type: d.type,
          owner: d.owner,
          modified: d.modified,
          doc: stringify(d)
        }
        realm.write(() => {
          realm.create(storeName, dbValue);
          console.log('realm created', dbValue)
        });
      } else {
        // update
        realm.write(() => {
          dbValue.group = d.group;
          dbValue.type = d.type;
          dbValue.owner = d.owner;
          dbValue.modified = d.modified;
          dbValue.doc = stringify(d);
          console.log('realm updated', dbValue)
        });
      }
      return value;
    } else if (op === 'delete') {
      const d = value;
      let dbValue = realm.objectForPrimaryKey(storeName, d.id) as any;
      if (dbValue) {
        realm.write(() => {
          realm.delete(dbValue);
          console.log('realm deleted', dbValue)
        });
      }
      return true;
    } else {
      throw new Error('unrecognized op: ' + op)
    }
  }

  const save = async (data: IData[]): Promise<any> => {
    // all writes are done in same transaction (or that's the intention at least)
    realm.write(() => {
      for (const d of data) {
        let dbEntry = realm.objectForPrimaryKey("Data", d.id) as any;
        if (!dbEntry) {
          // create
          dbEntry = {
            id: d.id,
            group: d.group,
            type: d.type,
            owner: d.owner,
            modified: d.modified,
            doc: stringify(d)
          }
          realm.create("Data", dbEntry);
          console.log('realm created', dbEntry)

        } else {
          // update
          dbEntry.group = d.group;
          dbEntry.type = d.type;
          dbEntry.owner = d.owner;
          dbEntry.modified = d.modified;
          dbEntry.doc = stringify(d);
          console.log('realm updated', dbEntry)
        }
      }
    })
  }

  
  const find = async <T = IData>(query?: DBQuery, index?: Indexes): Promise<T[]> => {
    let results;
    if (!query) {
      // no query so return everything
      results = realm.objects("Data");
    } else {
      results = realm.objects("Data").filtered(dbQueryToRealmQuery(query, index));      
    }
    if (index) {
      results = results.sorted(index.split('-').map(s => [s, false]));
    }
    return results.map(r => parseJSON(r.doc));
  }

  const openCursor = async <T>(query?: DBQuery, index?: Indexes, direction?: IDBCursorDirection): Promise<ICursor<T>> => {
    let results: any = realm.objects("Data");
    if (query) {
      results = realm.objects("Data").filtered(dbQueryToRealmQuery(query, index));      
    }
    if (index) {
      results = results.sorted(index.split('-').map(s => [s, false]));
    }
    if (!direction) {
      direction = 'next';
    }
    let currentIndex = 0;
    let step = 1;
    if (direction === 'prev' || direction === 'prevunique') {
      currentIndex = results.length - 1;
      step = -1;
    }
    let currentValue: T = null;
    const fields = (index ?? "id").split('-');
    const onlyUnique = direction.includes('unique');
    function getNext() {
      let nextValue;
      do {
        nextValue = parseJSON(results[currentIndex]?.doc ?? null);  
        currentIndex += step;
      } while (
        onlyUnique &&
        currentValue &&
        nextValue &&
        isEqual(
          fields.map(f => currentValue?.[f]),
          fields.map(f => nextValue?.[f])
        )
      )      
      currentValue = nextValue;
      return nextValue;
    }
    
    const cursor = {
      value: null,
      next: async () => {
        cursor.value = getNext();
        return cursor.value;
      }
    }
    return cursor;
  }

  const baseOps: IDB = {
    find,
    openCursor,
    save,
    get: id => dbOp('Data', 'get', id),
    delete: id => dbOp('Data', 'delete', id),
    files: {
      // TODO can't use dbOp for files
      save: file => dbOp('Files', 'save', file),
      get: id => dbOp('Files', 'get', id),
      delete: id => dbOp('Files', 'delete', id),
    },
    local: {
      save: data => dbOp('Local', 'save', data),
      get: id => dbOp('Local', 'get', id),
      delete: id => dbOp('Local', 'delete', id),
    },
  }

  return baseOps;
}
