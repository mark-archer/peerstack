import { newUser, init, newData, signObject, newGroup, signObjectWithIdAndSecretKey } from "./user"
import * as _ from 'lodash';
import 'should';
import { initDBWithMemoryMock } from "./db-mock";
import { applyChanges, getChanges, isEmptyArray, isEmptyObj, isLeaf, isObj, commitChange, validateDataChange, deleteData, getDataChange, ingestChange } from "./data-change";
import { IData, IDB, IGroup } from "./db";
import { cloneDeep } from "lodash";

describe('data-change', () => {

  const me = newUser();
  const peer = newUser();
  let myGroup: IGroup;
  let db: IDB;
  beforeAll(async () => {
    db = await initDBWithMemoryMock()
    await init(me);
    await db.save(me);
    await db.save(peer);
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
  })

  describe('ingestChange', () => {
    let group: IGroup;
    beforeEach(async () => {
      group = newGroup();
      group.members.push({ userId: peer.id, write: true });
      await commitChange(group);
    })

    test('non-admin can not make themselves group owner', async () => {
      const updatedGroup = cloneDeep(group);
      updatedGroup.owner = peer.id;
      updatedGroup.members = [{ userId: peer.id, admin: true }]
      updatedGroup.modified++;
      const dataChange = getDataChange(group, updatedGroup);
      // expect(dataChange).toMatchObject({
      //   changes: [['owner', peer.id]]
      // });
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(ingestChange(dataChange)).rejects.toThrowError(`does not have admin permissions`);
    });

    test('admin member can change group owner', async () => {
      const updatedGroup = cloneDeep(group);
      updatedGroup.owner = peer.id;
      updatedGroup.modified++;
      const dataChange = getDataChange(group, updatedGroup);
      signObject(dataChange);
      await ingestChange(dataChange);
    })

    test('non-admin cannot delete group (or otherwise change the type', async () => {
      const updatedGroup: IData = cloneDeep(group);
      updatedGroup.type = "Deleted"
      updatedGroup.owner = peer.id;
      updatedGroup.members = [{ userId: peer.id, admin: true }];
      updatedGroup.modified++;
      const dataChange = getDataChange(group, updatedGroup);
      signObjectWithIdAndSecretKey(dataChange, peer.id, peer.secretKey);
      await expect(ingestChange(dataChange)).rejects.toThrowError(`does not have admin permissions`);
    });


    // test('TODO reject changes due to lack of permissions', () => {
    // })

    // TODO test/deal with the scenario where a user receives a change that fails validation
    //      if they proceed, they could just never see that change unless there is something like a DLQ
    //      it seems like the best thing is to halt receiving from that device+group
    //      the problem is this could get device-pairs stuck in a locked state
    //      need to figure this out
    //      deep syncs are the ultimate fallback but we'd like to get to a point where they aren't required
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
      // existingData2 = await genData(2);
      // existingData3 = await genData(3);
      // existingData4 = await genData(4);
      // existingData5 = await genData(5);
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
      data.modified++;
      await commitChange(data);
      dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
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
  })

  // TODO describe('deleteData', () => { })
})
