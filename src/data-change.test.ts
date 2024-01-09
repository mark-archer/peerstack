import { newUser, init, newData, signObject, signObjectWithIdAndSecretKey,newGroup, IUser } from "./user"
import * as _ from 'lodash';
import 'should';
import { initDBWithMemoryMock } from "./db-mock.test";
import { applyChanges, getChanges, isEmptyArray, isEmptyObj, isLeaf, isObj, commitChange, deleteData, getDataChange, ingestChange, IDataChange } from "./data-change";
import { IData, IDB, IGroup } from "./db";
import { cloneDeep } from "lodash";
import { newid } from "./common";

describe('data-change', () => {

  const me = newUser('me');
  const peer = newUser('peer');
  let myGroup: IGroup;
  let db: IDB;
  beforeAll(async () => {
    db = await initDBWithMemoryMock()
    await init(me);
    signObject(me);
    await db.save(me);
    const dbPeer = { ...peer, secretKey: undefined };
    signObjectWithIdAndSecretKey(dbPeer, peer.id, peer.secretKey);
    await db.save(dbPeer);
    myGroup = newGroup();
    signObject(myGroup);
    await db.save(myGroup)
  })

  describe('test from chatGPT', () => {
    describe('isObj', () => {
      test('should return true if the input is an object', () => {
        const input = { a: 1 };
        expect(isObj(input)).toBe(true);
      });

      test('should return false if the input is an array', () => {
        const input = [1, 2, 3];
        expect(isObj(input)).toBe(false);
      });

      test('should return false if the input is a date', () => {
        const input = new Date();
        expect(isObj(input)).toBe(false);
      });

      test('should return false if the input is null', () => {
        const input = null;
        expect(isObj(input)).toBe(false);
      });
    });

    describe('isLeaf', () => {
      test('should return true if the input is not an object, a date or null', () => {
        const input1 = 1;
        const input2 = 'hello';
        const input3 = true;
        expect(isLeaf(input1)).toBe(true);
        expect(isLeaf(input2)).toBe(true);
        expect(isLeaf(input3)).toBe(true);
      });

      test('should return false if the input is an object', () => {
        const input = { a: 1 };
        expect(isLeaf(input)).toBe(false);
      });

      test('should return true if the input is a date', () => {
        const input = new Date();
        expect(isLeaf(input)).toBe(true);
      });

      test('should return true if the input is null', () => {
        const input = null;
        expect(isLeaf(input)).toBe(true);
      });
    });

    describe('isEmptyObj', () => {
      test('should return true if the input is an empty object', () => {
        const input = {};
        expect(isEmptyObj(input)).toBe(true);
      });

      test('should return false if the input is not an empty object', () => {
        const input = { a: 1 };
        expect(isEmptyObj(input)).toBe(false);
      });

      test('should return false if the input is an array', () => {
        const input = [1, 2, 3];
        expect(isEmptyObj(input)).toBe(false);
      });

      test('should return false if the input is null', () => {
        const input = null;
        expect(isEmptyObj(input)).toBe(false);
      });
    });

    describe('isEmptyArray', () => {
      test('should return true if the input is an empty array', () => {
        const input = [];
        expect(isEmptyArray(input)).toBe(true);
      });

      test('should return false if the input is not an empty array', () => {
        const input = [1, 2, 3];
        expect(isEmptyArray(input)).toBe(false);
      });

      test('should return false if the input is an object', () => {
        const input = { a: 1 };
        expect(isEmptyArray(input)).toBe(false);
      });

      test('should return false if the input is null', () => {
        const input = null;
        expect(isEmptyArray(input)).toBe(false);
      });
    });
  })

  describe('isEmptyArray', () => {
    test('array with nonnumeric key', () => {
      const ary = [];
      // @ts-ignore
      ary.a = 1;
      expect(isEmptyArray(ary)).toEqual(false);
    })
  })

  describe('getChanges', () => {
    test('empty objects', () => {
      expect(
        getChanges({}, {})
      ).toEqual(
        []
      )
    })

    test('nulls', () => {
      expect(
        getChanges(null, null)
      ).toEqual(
        []
      )
    })

    test('simple', () => {
      expect(
        getChanges({ a: 1 }, { a: 2 })
      ).toEqual(
        [['a', 2]]
      )
    })

    test('falsy values', () => {
      expect(
        getChanges({ a: 0 }, { a: null })
      ).toEqual(
        [['a', null]]
      )
    })

    test('falsy value to object', () => {
      expect(
        getChanges({ a: 0 }, { a: {} })
      ).toEqual(
        [['a', {}]]
      )
    })

    test('object value to falsy value', () => {
      expect(
        getChanges({ a: {} }, { a: 0 })
      ).toEqual(
        [['a', 0]]
      )
    })

    test('empty to value', () => {
      expect(
        getChanges({}, { a: 1 })
      ).toEqual(
        [['a', 1]]
      )
    })

    test('value to empty', () => {
      expect(
        getChanges({ a: 1 }, {})
      ).toEqual(
        [['a']]
      )
    })

    test('deep change', () => {
      expect(
        getChanges({ a: { b: [1, 2, 3] } }, { a: { b: [1, 3] } })
      ).toEqual(
        [
          ['a.b.1', 3],
          ['a.b.2'],
        ]
      )
    })

    test('complex change', () => {
      const d = new Date();
      expect(
        getChanges(
          { a: { b: [1, 2, 3] }, d: d, dd: d },
          { ddd: d, d: d, a: { b: [1, 3] }, c: { d: null } }
        )
      ).toEqual(
        [
          ['a.b.1', 3],
          ['a.b.2'],
          ['c', { d: null }],
          ['dd'],
          ['ddd', d],
        ]
      )
    })

    test('complex object, no change', () => {
      const d = new Date();
      expect(
        getChanges(
          { ddd: d, d: d, a: { b: [1, 3] }, c: { d: null } },
          { ddd: d, d: d, a: { b: [1, 3] }, c: { d: null } }
        )
      ).toEqual(
        []
      )
    })

    test('sub objects removed', () => {
      const d = new Date();
      expect(
        getChanges(
          { ary: [1, 2, 3], obj: { a: 1, b: 2 }, n: 1 },
          { n: 2 }
        )
      ).toEqual(
        [
          ['ary'],
          ['n', 2],
          ['obj']
        ]
      )
    })

    test('sub objects emptied', () => {
      const d = new Date();
      expect(
        getChanges(
          { ary: [1, 2, 3], obj: { a: 1, b: 2 }, n: 1 },
          { n: 2, ary: [], obj: {} }
        )
      ).toEqual(
        [
          ['ary', []],
          ['n', 2],
          ['obj', {}],
        ]
      )
    })

    test('sub objects added', () => {
      const d = new Date();
      expect(
        getChanges(
          { n: 2 },
          { ary: [1, 2, 3], obj: { a: 1, b: 2 }, n: 1 },
        )
      ).toEqual(
        [
          ['ary', [1, 2, 3]],
          ['n', 1],
          ['obj', { a: 1, b: 2 }],
        ]
      )
    })

    test('sub sub objects removed', () => {
      expect(
        getChanges(
          { ary: [1, [1]], obj: { a: 1, b: { c: 3 }, d: [1, 2] } },
          { ary: [1], obj: { a: 1, d: [2] } }
        )
      ).toEqual(
        [
          ['ary.1'],
          ['obj.b'],
          ['obj.d.0', 2],
          ['obj.d.1'],
        ]
      )
    })

    test('empty array added', () => {
      expect(
        getChanges(
          { n: 1 },
          { ary: [], n: 1 }
        )
      ).toEqual(
        [
          ['ary', []],
        ]
      )
    })

    test('array to obj', () => {
      expect(
        getChanges(
          { a: [1] },
          { a: { n: 1 } }
        )
      ).toEqual(
        [
          ['a', { n: 1 }]
        ]
      )
    })

    test('obj to ary', () => {
      expect(
        getChanges(
          { a: { n: 1 } },
          { a: [1] }
        )
      ).toEqual(
        [
          ['a', [1]]
        ]
      )
    })

    test('array to leaf', () => {
      expect(
        getChanges(
          { a: [1] },
          { a: 1 }
        )
      ).toEqual(
        [
          ['a', 1]
        ]
      )
    })

    test('obj to leaf', () => {
      expect(
        getChanges(
          { a: { n: 1 } },
          { a: 1 }
        )
      ).toEqual(
        [
          ['a', 1]
        ]
      )
    })

    test('leaf to array', () => {
      expect(
        getChanges(
          { a: 1 },
          { a: [1] }
        )
      ).toEqual(
        [
          ['a', [1]]
        ]
      )
    })

    test('leaf to obj', () => {
      expect(
        getChanges(
          { a: 1 },
          { a: { n: 1 } }
        )
      ).toEqual(
        [
          ['a', { n: 1 }]
        ]
      )
    })

    test('array to obj (with same key and value)', () => {
      expect(
        getChanges(
          { a: [1] },
          { a: { "0": 1 } }
        )
      ).toEqual(
        [
          ['a', { '0': 1 }]
        ]
      )
    })

    test('obj with numeric key', () => {
      expect(
        getChanges(
          { a: { "0": 1 } },
          { a: { "0": 2 } }
        )
      ).toEqual(
        [
          ['a.0', 2]
        ]
      )
    })

    test('array with nonnumeric key', () => {
      const ary1 = [1]; const ary2 = [2];
      //@ts-ignore
      ary1.n = 1; ary2.n = 2;
      expect(
        getChanges(
          ary1,
          ary2,
        )
      ).toEqual(
        [
          ['0', 2],
          ['n', 2],
        ]
      )
    })

    test('from or to undefined', () => {
      expect(getChanges(undefined, undefined)).toEqual([])

      expect(getChanges({ a: 1 }, undefined)).toEqual([['a']])

      expect(getChanges(undefined, { a: 1 })).toEqual([['a', 1]])
    })

    test('removing the first entry from an array', () => {
      // it's kind of expensive to have to cycle everything down
      expect(getChanges([1,2,3,4], [2,3,4])).toEqual([
        ['0', 2],
        ['1', 3],
        ['2', 4],
        ['3'],
      ])
    })
  })

  describe('applyChange', () => {
    test('simple set', () => {
      expect(
        applyChanges({}, [['a', 1]])
      ).toEqual(
        { a: 1 }
      )
    })

    test('new array', () => {
      expect(
        applyChanges({}, [['a.0', 1]])
      ).toEqual(
        { a: [1] }
      )
    })

    test('new empty array', () => {
      expect(
        applyChanges({}, [['a', []]])
      ).toEqual(
        { a: [] }
      )
    })

    test('rm array', () => {
      expect(
        applyChanges({ a: [] }, [['a']])
      ).toEqual(
        {}
      )
    })

    test('overwrite array with object', () => {
      expect(
        applyChanges({ a: [] }, [['a', { b: 1 }]])
      ).toEqual(
        { a: { b: 1 } }
      )
    })

    test('overwrite object with array', () => {
      expect(
        applyChanges({ a: { b: 1 } }, [['a', [1]]])
      ).toEqual(
        { a: [1] }
      )
    })

    test('change value of object field with numeric key', () => {
      expect(
        applyChanges(
          { a: { "0": 1 } },
          [['a.0', 2]])
      ).toEqual(
        { a: { "0": 2 } }
      )
    })

    test('change value of array field with nonnumeric key', () => {
      const ary = [1];
      // @ts-ignore
      ary.a = 2;
      expect(
        applyChanges(
          { a: [1] },
          [['a.a', 2]])
      ).toEqual(
        { a: ary }
      )
    })

    test('reset root obj with blank path', () => {
      expect(
        applyChanges(
          { a: { "0": 1 } },
          [['', 2]])
      ).toEqual(
        2
      )
    })

    test('reset root obj with blank path to default empty object', () => {
      expect(
        applyChanges(
          { a: { "0": 1 } },
          [['']])
      ).toEqual(
        {}
      )
    })
  })

  describe("getDataChange", () => {
    test("don't allow a single change to represent changing groups", async () => {
      const data = newData();
      expect(() =>
        getDataChange(data, { ...data, group: newid() })
      ).toThrow(/Changing groups cannot be represented with a single DataChange, it should be done as a delete out of the old group and a create in the new group./)
    })
  })

  describe('ingestChange', () => {
    let myGroupPeerCanWrite: IGroup;
    beforeEach(async () => {
      myGroupPeerCanWrite = newGroup();
      myGroupPeerCanWrite.members.push({ userId: peer.id, write: true });
      await commitChange(myGroupPeerCanWrite);
    })

    test('non-admin can not make themselves group owner', async () => {
      const updatedGroup = cloneDeep(myGroupPeerCanWrite);
      updatedGroup.owner = peer.id;
      updatedGroup.members = [{ userId: peer.id, admin: true }]
      updatedGroup.modified++;
      const dataChange = getDataChange(myGroupPeerCanWrite, updatedGroup);
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(ingestChange(dataChange)).rejects.toThrowError(`does not have admin permissions`);
    });

    test('admin member can change group owner', async () => {
      const updatedGroup = cloneDeep(myGroupPeerCanWrite);
      updatedGroup.owner = peer.id;
      updatedGroup.modified++;
      const dataChange = getDataChange(myGroupPeerCanWrite, updatedGroup);
      signObject(dataChange);
      await ingestChange(dataChange);
    })

    test('non-admin cannot delete group (or otherwise change the type', async () => {
      const updatedGroup: IData = cloneDeep(myGroupPeerCanWrite);
      updatedGroup.type = "Deleted"
      updatedGroup.owner = peer.id;
      updatedGroup.members = [{ userId: peer.id, admin: true }];
      updatedGroup.modified++;
      const dataChange = getDataChange(myGroupPeerCanWrite, updatedGroup);
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(ingestChange(dataChange)).rejects.toThrowError(`does not have admin permissions`);
    });

    test('reject my change due to lack of permissions', async () => {
      let peerGroupIRead: IGroup;
      peerGroupIRead = newGroup();
      peerGroupIRead.owner = peer.id;
      peerGroupIRead.members.push({ userId: me.id, read: true });
      signObjectWithIdAndSecretKey(peerGroupIRead, peer.id, peer.secretKey);
      await db.save(peerGroupIRead);

      const peerGroupData = newData({ n: 1 });
      peerGroupData.group = peerGroupIRead.id;
      signObjectWithIdAndSecretKey(peerGroupData, peer.id, peer.secretKey);

      await db.save(peerGroupData);

      const dataChange = getDataChange(peerGroupData, { ...peerGroupData, n: 2 });
      signObject(dataChange);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(`${me.id} does not have write permissions in group ${peerGroupIRead.id}`);
    })

    test('reject peer changes due to lack of permissions', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      await commitChange(data);

      const dataChange = getDataChange(data, { ...data, n: 2 });
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(new RegExp(`${peer.id} does not have write permissions in group ${myGroup.id}`));
    })

    test('reject peer changes due to restricted field attempting to be updated', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      await commitChange(data);

      const dataChange = getDataChange(data, { ...data, n: 2 });
      dataChange.changes.push(['group', peer.id]);
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/There is an entry in changes to update either id, group, or modified directly/);
    })

    test('reject peer changes to partial objects that do not exist', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      
      const dataChange = getDataChange(data, { ...data, n: 2 });
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/This appears to be a partial change to an object that doesn't exist/);
    })

    test('reject peer changes in a group other than the object resides in', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      await commitChange(data);
      
      const dataChange = getDataChange(data, { ...data, n: 2 });
      dataChange.group = peer.id;
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/Changes to objects in a different group than the change is not allowed/);
    })

    test('reject peer changes with modified data in the future', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      await commitChange(data);
      
      const dataChange = getDataChange(data, { ...data, n: 2 });
      dataChange.modified *= 2;
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/modified timestamp must be a number and cannot be in the future/);
    })
    
    test('reject peer changes with time part of id in the future', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      data.id = 'z' + data.id.substring(1);
      // await commitChange(data);
      
      const dataChange = getDataChange(null, { ...data, n: 2 });
      
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/time part of id cannot be in the future/);
    })

    test('reject peer changes when we cannot identify the signer of the change', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      await commitChange(data);
      
      const dataChange = getDataChange(null, { ...data, n: 2 });
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/Could not identify signer/);
    })

    test('reject modified is older than what is in db', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      await commitChange(data);
      data.modified--;
      const dataChange = getDataChange(null, { ...data, n: 2 });
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/modified cannot be less than the existing doc in db/);
    })

    test('ignore changes that have already been ingested', async () => {
      const data = newData({ group: myGroup.id, n: 1 });
      await commitChange(data);
      const dataChange = getDataChange(null, { ...data, n: 2 });
      signObject(dataChange);
      await ingestChange(dataChange);
      // change the dataChange, invalidating the signature but it doesn't matter since it's already been ingested
      dataChange.modified++;
      await ingestChange(dataChange);
      signObject(dataChange);
      await expect(
        ingestChange(dataChange)
      ).rejects.toThrow(/A dataChange that has already been ingested was encountered again but with a different signature/);
    })

    test('change that is older than data.modified but is newer for some fields', async () => {
      const data = newData({ a: 1, b: 1 });
      await commitChange(data);

      data.modified += 2;
      const change1 = getDataChange(data, { ...data, a: 2 });
      expect(change1.changes).toEqual([['a', 2]]);
      expect(change1.subject).toEqual(data.id);
      signObject(change1);
      await ingestChange(change1);

      let dbData = await db.get(data.id);
      expect(dbData).toMatchObject({ a: 2 });

      data.modified--;
      const change2 = getDataChange(data, { ...data, b: 2, a: 3 });
      expect(change2.changes).toEqual([['a', 3],['b', 2]]);
      signObject(change2);
      await ingestChange(change2);
      dbData = await db.get(data.id);
      // note that `b` should be updated but `a` shouldn't since there is a newer change for it
      expect(dbData).toMatchObject({ a: 2, b: 2, modified: data.modified+1 });
    })

    test('change for an object that this device does not have but `skipValidation` is true', async () => {
      const dataChange: IDataChange = {
        id: newid(),
        subject: newid(),
        group: myGroup.id,
        modified: 1,
        changes: [['n', 1]],
      }
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(
        ingestChange(dataChange, undefined, true)
      ).rejects.toThrow(/Cannot apply partial changes to an object that doesn\'t exist/);
    })

    describe('create or modify a user', () => {
      test('create a new user', async () => {
        const aUser = newUser();
        const aUserSafe = { ...aUser };
        delete aUserSafe.secretKey;
        signObjectWithIdAndSecretKey(aUserSafe, aUser.id, aUser.secretKey);
        const dataChange = getDataChange(null, aUserSafe);
        signObjectWithIdAndSecretKey(dataChange, aUser.id, aUser.secretKey);
        await ingestChange(dataChange);
        const dbUser = await db.get(aUser.id);
        expect(dbUser).toEqual(aUserSafe);
      })

      test('change an existing user', async () => {
        const aUser = newUser();
        const aUserSafe = { ...aUser };
        delete aUserSafe.secretKey;
        signObjectWithIdAndSecretKey(aUserSafe, aUser.id, aUser.secretKey);
        await db.save(aUserSafe);
        const updatedUser = { ...aUserSafe };
        updatedUser.name = "new name";
        const dataChange = getDataChange(aUserSafe, updatedUser);
        expect(dataChange.changes).toEqual([['name', "new name"]]);
        signObjectWithIdAndSecretKey(dataChange, aUser.id, aUser.secretKey);
        await ingestChange(dataChange);
        const dbUser: IUser = await db.get(aUser.id);
        expect(dbUser.name).toEqual(updatedUser.name);
      })

      test('reject change if not signed by user being changed', async () => {
        const aUser = newUser();
        const aUserSafe = { ...aUser };
        delete aUserSafe.secretKey;
        signObjectWithIdAndSecretKey(aUserSafe, aUser.id, aUser.secretKey);
        await db.save(aUserSafe);
        const updatedUser = { ...aUserSafe };
        updatedUser.name = "new name";
        const dataChange = getDataChange(aUserSafe, updatedUser);
        expect(dataChange.changes).toEqual([['name', "new name"]]);
        await expect(ingestChange(dataChange)).rejects.toThrow(/Changes to a user must be signed by themselves/);
        signObject(dataChange);
        await expect(ingestChange(dataChange)).rejects.toThrow(/Changes to a user must be signed by themselves/);
        // signObjectWithIdAndSecretKey(dataChange, aUser.id, aUser.secretKey);
        const dbUser: IUser = await db.get(aUser.id);
        expect(dbUser.name).toEqual(aUserSafe.name);
      })

      test('reject invalid user group', async () => {
        const aUser = newUser();
        // @ts-ignore
        aUser.group = aUser.id;
        const aUserSafe = { ...aUser };
        delete aUserSafe.secretKey;
        signObjectWithIdAndSecretKey(aUserSafe, aUser.id, aUser.secretKey);
        const dataChange = getDataChange(null, aUserSafe);
        signObjectWithIdAndSecretKey(dataChange, aUser.id, aUser.secretKey);
        await expect(ingestChange(dataChange)).rejects.toThrow(/All users must have their group set to 'users'/);
      })

      test('reject signer is not user', async () => {
        const aUser = newUser();
        const aUserSafe = { ...aUser };
        delete aUserSafe.secretKey;
        signObject(aUser);
        const dataChange = getDataChange(null, aUserSafe);
        signObjectWithIdAndSecretKey(dataChange, aUser.id, aUser.secretKey);
        await expect(ingestChange(dataChange)).rejects.toThrow(/The signer of a user must be that same user/);
      })

      test('reject public key is being changed', async () => {
        const aUser = newUser();
        const aUserSafe = { ...aUser };
        delete aUserSafe.secretKey;
        signObjectWithIdAndSecretKey(aUserSafe, aUser.id, aUser.secretKey);
        await db.save(aUserSafe);

        const { publicKey, secretKey } = newUser();
        const dataChange = getDataChange(null, {...aUserSafe, publicKey });
        signObjectWithIdAndSecretKey(dataChange, aUser.id, secretKey);
        await expect(ingestChange(dataChange)).rejects.toThrow(/An attempt was made to update a user but the public keys do not match/);
      })

    })
  })

  describe('commitChange', () => {
    let existingData1: IData;
    beforeEach(async () => {
      async function genData(i: number) {
        const data = newData({ n: 1, i });
        await commitChange(data);
        return await db.get(data.id);
      }
      existingData1 = await genData(1);
    });

    describe('benchmarks', () => {
      test('benchmark create [40 ms]', async () => {
        // 70ms is the fastest this could go
        // 100ms without validateDataChange
        // 185ms without 2 `hasPermission` calls
        const data = newData({ n: 1 });
        await commitChange(data);
        // let dbData = await db.get(data.id);
        // expect(dbData).toEqual(data);
      })

      test('benchmark update [40 ms]', async () => {
        const data = cloneDeep(existingData1);
        data.modified++;
        data.n = 2;
        await commitChange(data);
        // let dbData = await db.get(data.id);
        // expect(dbData).toEqual(data);
      })

      test('benchmark update group [80 ms]', async () => {
        const data = cloneDeep(existingData1);
        data.n = 2;
        data.group = myGroup.id;
        data.modified += 2;
        await commitChange(data);
        // let dbData = await db.get(data.id);
        // expect(dbData).toEqual(data);
      })

      test('benchmark create with db.save [100 ms]', async () => {
        const data = newData({ n: 1 });
        signObject(data);
        await db.save(data);
        // let dbData = await db.get(data.id);
        // expect(dbData).toEqual(data);
      })

      test('benchmark update with db.save [100 ms]', async () => {
        const data = cloneDeep(existingData1);
        data.n = 2;
        data.modified++;
        signObject(data);
        await db.save(data);
        // let dbData = await db.get(data.id);
        // expect(dbData).toEqual(data);
      })
    });

    test('create and update and update group', async () => {
      // create
      const data = newData({ n: 1 });
      expect(await db.changes.getSubjectChanges(data.id)).toEqual([]);
      await commitChange(data);
      let dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      let dbChanges = await db.changes.getSubjectChanges(data.id);
      expect(dbChanges.length).toEqual(1);
      expect(dbChanges[0].changes.length).toEqual(1);
      expect(dbChanges[0].changes[0][1]).toEqual(data);

      // update
      data.n = 2;
      data.s = "hi"
      data.ary = [1]
      data.obj = { a: 1 }
      await commitChange(data);
      dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      dbChanges = await db.changes.getSubjectChanges(data.id, data.modified);
      expect(dbChanges).toMatchObject([
        {
          group: data.group,
          subject: data.id,
          modified: data.modified,
          changes: [
            ['ary', [1]],
            ['n', 2],
            ['obj', { a: 1 }],
            ['s', 'hi']
          ]
        }
      ]);

      // update group
      data.group = myGroup.id;
      data.modified += 2;
      await commitChange(data);
      dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      dbChanges = await db.changes.getSubjectChanges(data.id, data.modified - 1);
      expect(dbChanges).toMatchObject([
        {
          group: me.id,
          subjectDeleted: true,
          changes: []
        },
        {
          group: myGroup.id,
          changes: [['', data]]
        }
      ]);
    });

    test('create group and update group', async () => {
      // create group
      let data = newGroup();
      expect(await db.changes.getSubjectChanges(data.id)).toEqual([]);
      await commitChange(data);
      let dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      let dbChanges = await db.changes.getSubjectChanges(data.id);
      expect(dbChanges).toMatchObject([
        {
          subject: data.id,
          changes: [['', data]]
        },
      ]);

      // update group
      data.name = "Better Group Name";
      await commitChange(data);
      dbData = await db.get(data.id);
      // data.modified++;
      // expect(dbData).toEqual(data);
      dbChanges = await db.changes.getSubjectChanges(data.id, data.modified);
      expect(dbChanges).toMatchObject([
        {
          subject: data.id,
          changes: [['name', 'Better Group Name']]
        },
      ])
    });

    test('delete and try to change deleted', async () => {
      existingData1.modified++;
      await deleteData(existingData1.id);
      let dbData = await db.get(existingData1.id);
      expect(dbData).toMatchObject({ type: "Deleted" });

      // try to change deleted object
      existingData1.modified++;
      await expect(
        commitChange(existingData1)
      ).rejects.toThrowError(/deleted/)
    });

    test('reject my changes due to lack of permissions', async () => {
      let peerGroupIRead: IGroup;
      peerGroupIRead = newGroup();
      peerGroupIRead.owner = peer.id;
      peerGroupIRead.members.push({ userId: me.id, read: true });
      signObjectWithIdAndSecretKey(peerGroupIRead, peer.id, peer.secretKey);
      await db.save(peerGroupIRead);

      const peerGroupData = newData({ n: 1 });
      peerGroupData.group = peerGroupIRead.id;
      signObjectWithIdAndSecretKey(peerGroupData, peer.id, peer.secretKey);

      await db.save(peerGroupData);

      peerGroupData.n++;
      await expect(commitChange(peerGroupData)).rejects.toThrow(/does not have write permissions in group/);
    })

    test("don't allow creating groups with id and group different", async () => {
      const aGroup = newGroup();
      aGroup.id = newid();
      await expect(commitChange(aGroup)).rejects.toThrow(/All groups must have their group set to their id/);
    });

    test("don't allow modified to be the same as what is in db", async () => {
      const p = commitChange(existingData1, { preserveModified: true })
      expect(p).rejects.toThrow(/modified is the same as what is in the db - this is almost certainly a mistake/);
    })
  })

  describe('deleteData', () => {
    let existingData1: IData;
    beforeEach(async () => {
      async function genData(i: number) {
        const data = newData({ n: 1, i });
        await commitChange(data);
        return await db.get(data.id);
      }
      existingData1 = await genData(1);
    });

    test('normal delete', async () => {
      await deleteData(existingData1.id);
    })

    test("don't allow deleting data that doesn't exist", async () => {
      const p = deleteData(newid());
      await expect(p).rejects.toThrow(/No data exists with id/)
    })
  })
})
