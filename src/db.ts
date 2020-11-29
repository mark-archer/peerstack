import { get, set, isArray } from 'lodash';
import { verifySignedObject, ISigned } from './user';

export interface IData extends ISigned {
  id: string,
  group: string,
  type?: 'group' | 'any' | string,
  owner: string,
  modified?: number,
  [key:string]: any
}

// export const GROUPS_GROUP_ID = 'groups';

// export interface IGroup extends IData {
//   type: 'group',
//   name: string,
//   members: {
//     userId: string,
//     publicKey: string,
//     isAdmin?: boolean,
//     isEditor?: boolean,
//     isViewer?: boolean,
//     expireMS?: number,
//   }[],
//   blockedUserIds: string[],
//   allowPublicViewers?: boolean,
//   allowViewerComments?: boolean,
// }

// export interface IDataEvent extends ISigned {
//   id: string
//   group: string
//   dataId: string
//   userId: string
// }

// export interface IComment extends IData {
//   type: 'comment',
// }

export type indexes = 'group' | 'type' | 'owner' | 'modified'
  | 'group-modified' | 'type-modified' | 'owner-modified' 
  | 'group-type-modified' | 'group-owner-modified';

export interface IDB {
  insert: (data: IData | IData[]) => Promise<void> 
  update: (data: IData | IData[]) => Promise<void> 
  delete: (id: string) => Promise<void> 
  get: (id: string) => Promise<IData> 
  find: (query: string | IDBKeyRange, index?: indexes) => Promise<IData[]> 
}


export async function getIndexedDB(
  dbName: string = 'peerstack', 
  dbVersion: number = 1, 
  onUpgrade?: ((evt: IDBVersionChangeEvent) => Promise<void>)
): Promise<IDB> 
{
  if (typeof window === 'undefined' || !window.indexedDB) {
    throw new Error('indexedDB is not currently available')
  }
  const db: IDBDatabase = await new Promise(async (resolve, reject) => {
    const request = window.indexedDB.open(dbName, dbVersion);
    request.onerror = evt => reject(new Error('failed to open db: ' + String(evt)));
    request.onsuccess = evt => resolve((evt.target as any).result as IDBDatabase)
    request.onupgradeneeded = evt => {
      if (onUpgrade) return onUpgrade(evt);
      var db = (evt.target as any).result as IDBDatabase;
      if (dbVersion <= 1) {
        const dataStore = db.createObjectStore("data", { keyPath: 'id' });
        dataStore.createIndex("group", 'group', { unique: false })
        dataStore.createIndex("type", 'type', { unique: false })
        dataStore.createIndex("owner", 'owner', { unique: false })
        dataStore.createIndex("modified", 'modified', { unique: false })

        dataStore.createIndex("group-modified", ['group', 'modified'], { unique: false })
        dataStore.createIndex("type-modified", ['type', 'modified'], { unique: false })
        dataStore.createIndex("owner-modified", ['owner', 'modified'], { unique: false })
        
        dataStore.createIndex("group-type-modified", ['group', 'type', 'modified'], { unique: false })
        dataStore.createIndex("group-owner-modified", ['group', 'owner', 'modified'], { unique: false })
      }
    }
  });  

  const insert = (data: IData | IData[]): Promise<any> => new Promise(async (resolve, reject) => {
    if (!isArray(data)) {
      data = [data];
    }
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const objectStore = transaction.objectStore('data');
    for (const d of data) {
      const request = objectStore.add(d);
      request.onerror = evt => reject(evt);
    }    
    transaction.oncomplete = evt => resolve((evt.target as any).result);
  });

  const update = (data: IData | IData[]): Promise<any> => new Promise(async (resolve, reject) => {
    if (!isArray(data)) {
      data = [data];
    }
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const objectStore = transaction.objectStore('data');
    for (const d of data) {
      const request = objectStore.put(d);
      request.onerror = evt => reject(evt);
    }    
    transaction.oncomplete = evt => resolve((evt.target as any).result);
  });

  const deleteOp = (id): Promise<any> => new Promise(async (resolve, reject) => {
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').delete(id);
    request.onerror = evt => reject(evt);
    request.onsuccess = evt => resolve((evt.target as any).result);
  });

  const get = (id: string): Promise<IData> => new Promise(async (resolve, reject) => {
    const transaction = db.transaction(['data'], 'readonly');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').get(id);
    request.onerror = evt => reject(evt);
    request.onsuccess = evt => resolve((evt.target as any).result);
  });

  const find = (query: string | IDBKeyRange, index?: indexes): Promise<IData[]> => 
    new Promise(async (resolve, reject) => {
      // WIP
      const transaction = db.transaction(['data'], 'readwrite');
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

  const baseOps: IDB = {
    insert,
    update,
    delete: deleteOp,
    get,
    find,
  }
  
  return baseOps;
}

// export function getMemoryDB(): IDB {
//   const memoryDB: {
//     [id: string]: IData
//   } = {}
  
//   const baseOps: IDB = {    
//     insert: async data => memoryDB[data.id] = JSON.parse(JSON.stringify(data)),
//     update: async data => memoryDB[data.id] = JSON.parse(JSON.stringify(data)),
//     delete: async id => delete memoryDB[id] as undefined,
//     get: async id => memoryDB[id],
//     find: async (query: string | IDBKeyRange, index?: string) => {
//       const results: IData[] = [];
//       Object.keys(memoryDB).forEach(id => {
//         let testValue = id;
//         if (index) {
//           testValue = get(memoryDB, `${id}.${index}`, null);
//         }
//         if (
//           (typeof query === 'string' && testValue === query) ||
//           (query.includes && query.includes(testValue))
//         ) {
//           results.push(memoryDB[id])
//         }
//       })
//       return results;
//     },
//   }
//   return baseOps
// }



// export async function setupIndexedDBGroupOps(
//   group: string,
//   dbName: string = 'peerstack') 
// {
//   if (typeof window === 'undefined' || !window.indexedDB) {
//     throw new Error('indexdb is not currently available')
//   }
//   const groupStoreName = 'groups';
//   const dbVersion = Date.now();
//   const db: IDBDatabase = await new Promise(async (resolve, reject) => {
//     const request = window.indexedDB.open(dbName, dbVersion);
//     request.onerror = evt => reject(new Error('failed to open db: ' + String(evt)));
//     request.onsuccess = evt => resolve((evt.target as any).result as IDBDatabase)
//     request.onupgradeneeded = async evt => {
//       var db = (evt.target as any).result as IDBDatabase;
//       const { oldVersion } = evt
//       let groupStorePromise = Promise.resolve();
//       if (oldVersion < 1) {
//         groupStorePromise = new Promise((resolve) => {
//           const objectStore = db.createObjectStore(groupStoreName, { keyPath: 'id' });
//           objectStore.transaction.oncomplete = () => resolve();
//         });
//       }
//       await groupStorePromise;
//       if (group === groupStoreName) {
//         resolve(db);
//       }

//       const tx = db.transaction(groupStoreName, 'readonly');
//       tx.onerror = evt => reject(evt);
//       const group = await new Promise((resolve, reject) => {
//         const request = tx.objectStore(groupStoreName).get(group);
//         request.onerror = evt => reject(evt);
//         request.onsuccess = evt => resolve((evt.target as any).result);
//       });
//       if (!group) {
//         // add group
//         const tx = db.transaction(groupStoreName, 'readwrite');
//         tx.onerror = evt => reject(evt);
//         await new Promise((resolve, reject) => {
//           const request = tx.objectStore(groupStoreName).add({ id: group, });
//           request.onerror = evt => reject(evt);
//           request.onsuccess = evt => resolve((evt.target as any).result);
//         });
//         const groupObjectStore = db.createObjectStore(group, { keyPath: 'id' });
//         groupObjectStore.createIndex('type', 'type', { unique: false })
//         groupObjectStore.createIndex('createMS', 'createMS', { unique: false })
//         groupObjectStore.createIndex('updateMS', 'updateMS', { unique: false })
        
//       }
//       resolve(db);
//     }    
//   });
  
//   baseOps.get = (group: string, id: string): Promise<IData> => new Promise(async (resolve, reject) => {
//     resolve(null)
//     // const db = await openDb();
//     // const transaction = db.transaction(['data'], 'readonly');
//     // transaction.onerror = evt => reject(evt);
//     // const request = transaction.objectStore('data').get([group, id]);
//     // request.onerror = evt => reject(evt);
//     // request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.insert = (data: IData): Promise<any> => new Promise(async (resolve, reject) => {
//     resolve(null);
//     // const transaction = db.transaction(['data'], 'readwrite');
//     // transaction.onerror = evt => reject(evt);
//     // const request = transaction.objectStore('data').add(data);
//     // request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.update = (data: IData): Promise<any> => new Promise(async (resolve, reject) => {
//     const transaction = db.transaction(['data'], 'readwrite');
//     transaction.onerror = evt => reject(evt);
//     const request = transaction.objectStore('data').put(data);
//     request.onerror = evt => reject(evt);
//     request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.delete = (group, id): Promise<any> => new Promise(async (resolve, reject) => {
//     const transaction = db.transaction(['data'], 'readwrite');
//     transaction.onerror = evt => reject(evt);
//     const request = transaction.objectStore('data').delete([group, id]);
//     request.onerror = evt => reject(evt);
//     request.onsuccess = evt => resolve((evt.target as any).result);
//   });

//   baseOps.find = (group: string, query: string | IDBKeyRange, index?: string): Promise<IData[]> => 
//     new Promise(async (resolve, reject) => {
//       // WIP
//       const transaction = db.transaction(['data'], 'readwrite');
//       transaction.onerror = evt => reject(evt);
//       const dataStore = transaction.objectStore('data');
//       let request: IDBRequest;
//       if (index) {
//         request = dataStore.index(index).getAll(query);
//       } else {
//         request = dataStore.getAll(query);
//       }
//       request.onerror = evt => reject(evt);
//       request.onsuccess = evt => resolve((evt.target as any).result);
//     });
// }

// export async function validateAndSaveComment(data: IComment) {
//   if (data.type !== 'comment') {
//     throw new Error('validateAndSaveComment should only be called with data of type "comment"');
//   }
//   const group = await baseOps.get('groups', data.group) as IGroup;
//   const member = group.members.find(m => m.userId == data.owner);

//   const exists = Boolean(await baseOps.get('groups', data.id));
//   if (!member && group.allowPublicViewers && group.allowViewerComments) {
    
//   }

//   if (!member && !(group.allowPublicViewers && group.allowViewerComments)) {
//     throw new Error('User is not a group member and public comments are not allowed');
//   }

//   if (
//     !(member.isAdmin || member.isEditor) && 
//     !(data.type === 'comment' && group.allowViewerComments && (group.allowPublicViewers || member.isViewer))
//   ) {
//     throw new Error(`Member does not have write permissions to the group`);
//   }
//   verifySignedObject(data, member.publicKey);
  
//   if (exists) {
//     return baseOps.update(data);
//   } else {
//     return baseOps.insert(data);
//   }
// }


// export async function validateAndSave(data: IData) {
//   // if (data.type === 'comment') {
//   //   return validateAndSaveComment(data as IComment);
//   // }
//   const group = await baseOps.get(GROUPS_GROUP_ID, data.group) as IGroup;
//   const member = group.members.find(m => m.userId == data.owner);
//   if (!member) {
//     throw new Error(`Owner of data is not a member of the group`);
//   }
//   if (!(member.isAdmin || member.isEditor)) {
//     throw new Error(`Member does not have write permissions to the group`);
//   }
//   verifySignedObject(data, member.publicKey);
//   const exists = Boolean(await baseOps.get(data.group, data.id));
//   if (exists) {
//     return baseOps.update(data);
//   } else {
//     return baseOps.insert(data);
//   }
// }

// export async function validateAndGet(getEvent: IDataEvent) {
//   const { group, userId, dataId } = getEvent;
//   const group = await baseOps.get(GROUPS_GROUP_ID, group) as IGroup;
//   const member = group.members.find(m => m.userId == userId);
//   if (!member && group.allowPublicViewers) {
//     throw new Error(`User is not a member of the group`);
//   }
//   verifySignedObject(getEvent, member.publicKey);
//   return baseOps.get(group, dataId);
// }

// export async function validateAndDelete(deleteEvent: IDataEvent) {
//   const { group, userId, dataId } = deleteEvent;
//   const group = await baseOps.get(GROUPS_GROUP_ID, group) as IGroup;
//   const member = group.members.find(m => m.userId == userId);
//   if (!member) {
//     throw new Error(`User is not a member of the group`);
//   }
//   verifySignedObject(deleteEvent, member.publicKey);
//   const dbData = await baseOps.get(group, dataId);
//   if (!(member.isAdmin || dbData.owner === userId)) {
//     throw new Error(`User must be an admin or owner of the data to delete it`);
//   }
//   return baseOps.delete(group, dataId);
// }


