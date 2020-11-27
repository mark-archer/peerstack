import { get, set } from 'lodash';
import { verifySignedObject, ISigned } from './user';

export interface IData extends ISigned {
  id: string,
  type: 'group' | 'comment' | string,
  groupId: string,
  ownerId: string,
  createMS: number,
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
//   groupId: string
//   dataId: string
//   userId: string
// }

// export interface IComment extends IData {
//   type: 'comment',
// }

export const memoryDB: {
  [groupId: string]: { [id: string]: IData }
} = {}

export const baseOps = {
  get: async function (groupId: string, id: string): Promise<IData> {
    // indexdb.get
    return get(memoryDB, `${groupId}.${id}`, null)
  },
  insert: async function (data: IData): Promise<void> {
    // indexdb.add
    set(memoryDB, `${data.groupId}.${data.id}`, JSON.parse(JSON.stringify(data)))
  },
  update: async function (data: IData): Promise<void> {
    // indexdb.put
    set(memoryDB, `${data.groupId}.${data.id}`, JSON.parse(JSON.stringify(data)))
  },
  delete: async function (groupId: string, id: string): Promise<void> {
    // indexdb.delete
    set(memoryDB, `${groupId}.${id}`, undefined)
  },
  find: async function (groupId: string, query: string | IDBKeyRange, index?: string): Promise<IData[]> {
    const results: IData[] = [];
    const group = memoryDB[groupId];
    Object.keys(group).forEach(id => {
      let testValue = id;
      if (index) {
        testValue = get(group, `${id}.${index}`, null);
      }
      if (
        (typeof query === 'string' && testValue === query) ||
        (query.includes && query.includes(testValue))
      ) {
        results.push(group[id])
      }
    })
    return results;
  },
}

export function setupIndexedDBOps(
  dbName: string = 'peerstack', 
  dbVersion: number = 1, 
  onUpgrade?: ((evt: IDBVersionChangeEvent) => Promise<void>)) 
{
  if (typeof window === 'undefined' || !window.indexedDB) {
    throw new Error('indexdb is not currently available')
  }
  const openDb = (): Promise<IDBDatabase> => new Promise(async (resolve, reject) => {
    const request = window.indexedDB.open(dbName, dbVersion);
    request.onerror = evt => reject(new Error('insert failed - failed to open db: ' + String(evt)));
    request.onupgradeneeded = evt => {
      if (onUpgrade) return onUpgrade(evt);
      var db = (evt.target as any).result as IDBDatabase;
      if (dbVersion <= 1) {
        const dataStore = db.createObjectStore("data", { keyPath: ['groupId', 'id'] });
        // dataStore.createIndex("group-id", ['groupId', 'id'], { unique: true, multiEntry: false })
      }
    }
    request.onsuccess = evt => resolve((evt.target as any).result as IDBDatabase)
  });

  baseOps.get = (groupId: string, id: string): Promise<IData> => new Promise(async (resolve, reject) => {
    const db = await openDb();
    const transaction = db.transaction(['data'], 'readonly');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').get([groupId, id]);
    request.onerror = evt => reject(evt);
    request.onsuccess = evt => resolve((evt.target as any).result);
  });

  baseOps.insert = (data: IData): Promise<any> => new Promise(async (resolve, reject) => {
    const db = await openDb();
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').add(data);
    request.onsuccess = evt => resolve((evt.target as any).result);
  });

  baseOps.update = (data: IData): Promise<any> => new Promise(async (resolve, reject) => {
    const db = await openDb();
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').put(data);
    request.onerror = evt => reject(evt);
    request.onsuccess = evt => resolve((evt.target as any).result);
  });

  baseOps.delete = (groupId, id): Promise<any> => new Promise(async (resolve, reject) => {
    const db = await openDb();
    const transaction = db.transaction(['data'], 'readwrite');
    transaction.onerror = evt => reject(evt);
    const request = transaction.objectStore('data').delete([groupId, id]);
    request.onerror = evt => reject(evt);
    request.onsuccess = evt => resolve((evt.target as any).result);
  });

  baseOps.find = (groupId: string, query: string | IDBKeyRange, index?: string): Promise<IData[]> => 
    new Promise(async (resolve, reject) => {
      // WIP
      const db = await openDb();
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
}

// export async function validateAndSaveComment(data: IComment) {
//   if (data.type !== 'comment') {
//     throw new Error('validateAndSaveComment should only be called with data of type "comment"');
//   }
//   const group = await baseOps.get('groups', data.groupId) as IGroup;
//   const member = group.members.find(m => m.userId == data.ownerId);

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
//   const group = await baseOps.get(GROUPS_GROUP_ID, data.groupId) as IGroup;
//   const member = group.members.find(m => m.userId == data.ownerId);
//   if (!member) {
//     throw new Error(`Owner of data is not a member of the group`);
//   }
//   if (!(member.isAdmin || member.isEditor)) {
//     throw new Error(`Member does not have write permissions to the group`);
//   }
//   verifySignedObject(data, member.publicKey);
//   const exists = Boolean(await baseOps.get(data.groupId, data.id));
//   if (exists) {
//     return baseOps.update(data);
//   } else {
//     return baseOps.insert(data);
//   }
// }

// export async function validateAndGet(getEvent: IDataEvent) {
//   const { groupId, userId, dataId } = getEvent;
//   const group = await baseOps.get(GROUPS_GROUP_ID, groupId) as IGroup;
//   const member = group.members.find(m => m.userId == userId);
//   if (!member && group.allowPublicViewers) {
//     throw new Error(`User is not a member of the group`);
//   }
//   verifySignedObject(getEvent, member.publicKey);
//   return baseOps.get(groupId, dataId);
// }

// export async function validateAndDelete(deleteEvent: IDataEvent) {
//   const { groupId, userId, dataId } = deleteEvent;
//   const group = await baseOps.get(GROUPS_GROUP_ID, groupId) as IGroup;
//   const member = group.members.find(m => m.userId == userId);
//   if (!member) {
//     throw new Error(`User is not a member of the group`);
//   }
//   verifySignedObject(deleteEvent, member.publicKey);
//   const dbData = await baseOps.get(groupId, dataId);
//   if (!(member.isAdmin || dbData.ownerId === userId)) {
//     throw new Error(`User must be an admin or owner of the data to delete it`);
//   }
//   return baseOps.delete(groupId, dataId);
// }


