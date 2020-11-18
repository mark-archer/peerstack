import { newid } from './common';
import { newMe, signObject } from './user';
import { baseOps, IData, /*validateAndSave, IGroup, GROUPS_GROUP_ID, validateAndGet, IDataEvent*/ } from './db';

describe('db', () => {

  test('baseOps CRUD', async () => {
    const data: IData = {
      type: 'post',
      id: newid(),
      groupId: newid(),
      ownerId: newid(),
      createMS: Date.now(),
      signature: null,
    }
    // CREATE
    await baseOps.insert(data)

    // READ
    const dbData = await baseOps.get(data.groupId, data.id);
    expect(dbData).toMatchObject(data);

    // UPDATE
    dbData.signature = 'updated';
    await baseOps.update(dbData);
    const dbData2 = await baseOps.get(data.groupId, data.id);
    expect(dbData2).toMatchObject(dbData2);

    // FIND with index
    const results2 = await baseOps.find(data.groupId, 'post', 'type');
    expect(results2).toMatchObject([{ id: data.id }])

    // FIND with key range
    const keyRange = { includes: () => true } as any;
    const results = await baseOps.find(data.groupId, keyRange);
    expect(results).toMatchObject([{ id: data.id }])

    // FIND with bad id
    const results3 = await baseOps.find(data.groupId, 'bad-id');
    expect(results3.length).toEqual(0);


    // DELETE 
    await baseOps.delete(dbData.groupId, dbData.id);
    const dbData3 = await baseOps.get(data.groupId, data.id);
    expect(dbData3).toBeNull();
  })

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