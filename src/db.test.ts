// import { newid } from './common';
// import { getDB, IData } from './db';

describe('db', () => {

  test('dummy', () => {
    expect(1).toEqual(1);
  })

  // test('baseOps CRUD', async () => {
  //   const db = await getMemoryDB()
  //   const data: IData = {
  //     type: 'post',
  //     id: newid(),
  //     group: newid(),
  //     owner: newid(),
  //     signature: null,
  //   }
  //   // CREATE
  //   await db.insert(data)

  //   // READ
  //   const dbData = await db.get(data.id);
  //   expect(dbData).toMatchObject(data);

  //   // UPDATE
  //   dbData.signature = 'updated';
  //   await db.update(dbData);
  //   const dbData2 = await db.get(data.id);
  //   expect(dbData2).toMatchObject(dbData2);

  //   // FIND with index
  //   const results2 = await db.find('post', 'type');
  //   expect(results2).toMatchObject([{ id: data.id }])

  //   // FIND with key range
  //   const keyRange = { includes: () => true } as any;
  //   const results = await db.find(keyRange);
  //   expect(results).toMatchObject([{ id: data.id }])

  //   // FIND with bad id
  //   const results3 = await db.find('bad-id');
  //   expect(results3.length).toEqual(0);


  //   // DELETE 
  //   await db.delete(dbData.id);
  //   const dbData3 = await db.get(data.id);
  //   expect(dbData3).toBeNull();
  // })

  // test.skip('indexedDB baseOps CRUD', async () => {
  //   const db = await getDB();
  //   const id = newid();
  //   let data: IData = { type: 'any', id, group: id, owner: id, signature: null, modified: Date.now() }

  //   // CREATE
  //   await db.save(data)
  //   const startTime = Date.now();
  //   data = await db.get(id);
  //   console.log('insert', { data });
  //   console.log(`took: ${Date.now() - startTime}ms`)

  //   // UPDATE
  //   data.type = 'fake2'
  //   let r = await db.save(data);
  //   console.log({ r });
  //   data = await db.get(id);
  //   console.log('update', { data })
  //   console.log(`took: ${Date.now() - startTime}ms`)

  //   // READ
  //   data.id = newid();
  //   const time = Date.now();
  //   await db.save(data);
  //   console.log('simple find', await db.find(id))
  //   console.log('find with group index - expect 2', await db.find(id, 'group'))
  //   console.log('find with type index - expect several', await db.find('fake2', 'type'))
  //   console.log('find with modified - expect 1', await db.find(IDBKeyRange.lowerBound(time), 'modified'))
  //   console.log(`took: ${Date.now() - startTime}ms`)

  //   // DELETE
  //   r = await db.delete(id);
  //   console.log({ r });
  //   data = await db.get(id);
  //   console.log('delete', { data })

  //   console.log(`took: ${Date.now() - startTime}ms`)
  // });

  // test('validated CRUD', async () => {
  //   const user = newMe();
  //   const userId = user.id;
  //   const groupId = newid();

  //   // GROUP
  //   const group: IGroup = {
  //     type: 'group',
  //     groupId: GROUPS_GROUP_ID,
  //     id: groupId,
  //     ownerId: newid(),
  //     createMS: Date.now(),
  //     name: groupId,
  //     blockedUserIds: [],
  //     members: [{
  //       userId,
  //       publicKey: user.publicKey,
  //       isEditor: true,
  //     }],
  //     signature: null,      
  //   }
  //   baseOps.insert(group);

  //   // CREATE
  //   const data: IData = {
  //     type: 'post',
  //     id: newid(),
  //     groupId,
  //     ownerId: userId,
  //     createMS: Date.now(),
  //     signature: null,
  //   }
  //   signObject(data, user.secretKey);
  //   await validateAndSave(data)

  //   // READ
  //   const getEvent: IDataEvent = {
  //     id: newid(),
  //     dataId: data.id,
  //     groupId,
  //     userId,
  //     signature: null,
  //   }
  //   signObject(getEvent, user.secretKey);
  //   const dbData = await validateAndGet(getEvent);
  //   expect(dbData).toMatchObject(data);

  //   // UPDATE
  //   (dbData as any).title = 'some title';
  //   expect(validateAndSave(dbData)).rejects.toMatch("asdf");
  //   signObject(dbData, user.secretKey);
  //   await validateAndSave(dbData);
  //   const dbData2 = await validateAndGet(getEvent);
  //   expect(dbData2).toMatchObject(dbData);
  // })
})