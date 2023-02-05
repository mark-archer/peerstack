import { newUser, init, newData, signObject } from "./user"
import * as _ from 'lodash';
import 'should';
import { initDBWithMemoryMock } from "./db-mock";
import { applyChanges, getChanges, isEmptyArray, saveChanges } from "./data-change";
import { IDB, IGroup } from "./db";

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
    myGroup = newData({ 
      type: 'Group',
      blockedUserIds: [],
      members: [],
      name: 'My Group',
    });
    myGroup.group = myGroup.id;
    signObject(myGroup);
    await db.save(myGroup)
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
        [
          { path: 'a', value: 2 }
        ]
      )
    })

    test('falsy values', () => {
      expect(
        getChanges({ a: 0 }, { a: null })
      ).toEqual(
        [
          { path: 'a', value: null }
        ]
      )
    })

    test('falsy value to object', () => {
      expect(
        getChanges({ a: 0 }, { a: {} })
      ).toEqual(
        [
          { path: 'a', value: {} }
        ]
      )
    })

    test('object value to falsy value', () => {
      expect(
        getChanges({ a: {} }, { a: 0 })
      ).toEqual(
        [
          { path: 'a', value: 0 }
        ]
      )
    })

    test('empty to value', () => {
      expect(
        getChanges({}, { a: 1 })
      ).toEqual(
        [
          { path: 'a', value: 1 }
        ]
      )
    })

    test('value to empty', () => {
      expect(
        getChanges({ a: 1 }, {})
      ).toEqual(
        [ { path: 'a' }]        
      )
    })

    test('deep change', () => {
      expect(
        getChanges({ a: { b: [1, 2, 3] } }, { a: { b: [1, 3] } })
      ).toEqual(
        [
          { path: 'a.b.1', value: 3 },
          { path: 'a.b.2' },
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
          { path: 'a.b.1', value: 3 },
          { path: 'a.b.2' },
          { path: 'c', value: { d: null } },
          { path: 'dd' },
          { path: 'ddd', value: d },
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
          { path: 'ary' },
          { path: 'n', value: 2 },
          { path: 'obj' },
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
          { path: 'ary', value: []},
          { path: 'n', value: 2},
          { path: 'obj', value: {}},
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
          { path: 'ary', value: [1,2,3]},
          { path: 'n', value: 1},
          { path: 'obj', value: { a:1, b: 2}},
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
          { path: "ary.1" },
          { path: "obj.b" },
          { path: 'obj.d.0', value: 2 },
          { path: "obj.d.1" },
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
          { path: 'ary', value: [] },
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
          { path: 'a', value: { n: 1 } }
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
          { path: 'a', value: [1] }
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
          { path: 'a', value: 1 }
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
          { path: 'a', value: 1 }
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
          { path: 'a', value: [1] }
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
          { path: 'a', value: { n: 1 } }
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
          { path: 'a', value: { "0": 1 } }
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
          { path: 'a.0', value: 2 }
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
          { path: '0', value: 2 },
          { path: 'n', value: 2 },
        ]
      )
    })

    test('from or to undefined', () => {
      expect(getChanges(undefined, undefined)).toEqual([])

      expect(getChanges({ a: 1 }, undefined)).toEqual([
        { path: 'a' }
      ])

      expect(getChanges(undefined, { a: 1 })).toEqual([
        { path: 'a', value: 1 }
      ])
    })
  })

  describe('applyChange', () => {
    test('simple set', () => {
      expect(
        applyChanges({}, { path: 'a', value: 1 })
      ).toEqual(
        { a: 1 }
      )
    })

    test('new array', () => {
      expect(
        applyChanges({}, { path: 'a.0', value: 1 })
      ).toEqual(
        { a: [1] }
      )
    })

    test('new empty array', () => {
      expect(
        applyChanges({}, { path: 'a', value: [] })
      ).toEqual(
        { a: [] }
      )
    })

    test('rm array', () => {
      expect(
        applyChanges({ a: [] }, { path: 'a' })
      ).toEqual(
        {}
      )
    })

    test('overwrite array with object', () => {
      expect(
        applyChanges({ a: [] }, { path: 'a', value: { b: 1 } })
      ).toEqual(
        { a: { b: 1 } }
      )
    })

    test('overwrite object with array', () => {
      expect(
        applyChanges({ a: { b: 1 } }, { path: 'a', value: [1] })
      ).toEqual(
        { a: [1] }
      )
    })

    test('change value of object field with numeric key', () => {
      expect(
        applyChanges(
          { a: { "0": 1 } },
          { path: 'a.0', value: 2 })
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
          { path: 'a.a', value: 2 })
      ).toEqual(
        { a: ary }
      )
    })

    test('reset root obj with blank path', () => {
      expect(
        applyChanges(
          { a: { "0": 1 } },
          { path: '', value: 2 })
      ).toEqual(
        2
      )
    })
  })

  describe('saveChange', () => {
    test('create and update', async () => {
      // create
      const data = newData({ n: 1});
      expect(await db.changes.getSubjectChanges(data.id)).toEqual([]);
      await saveChanges(data);
      let dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      let dbChanges = await db.changes.getSubjectChanges(data.id);
      expect(dbChanges.length).toEqual(1);
      expect(dbChanges[0].value).toEqual(data);

      // update
      data.n = 2;
      data.s = "hi"
      data.ary = [1]
      data.obj = { a: 1 }
      data.modified++;
      await saveChanges(data);
      dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      dbChanges = await db.changes.getSubjectChanges(data.id, data.modified);
      expect(dbChanges.length).toEqual(4);
      let expectedChanges: any = [
        { path: 'ary', value: [1]  },
        { 
          group: data.group, 
          subject: data.id,
          modified: data.modified,
          path: 'n',
          value: 2,
        },
        { path: 'obj', value: { a: 1 } },
        { path: 's', value: 'hi' },
      ]
      expect(dbChanges).toMatchObject(expectedChanges);

      // update group
      data.group = myGroup.id;
      data.modified++;
      await saveChanges(data);
      dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      dbChanges = await db.changes.getSubjectChanges(data.id, data.modified);
      expect(dbChanges.length).toEqual(2);
      expectedChanges = [
        { 
          group: me.id, 
          path: '', 
          subjectDeleted: true,
        },
        { 
          group: myGroup.id, 
          path: '',
          value: data,
        },
      ]
      expect(dbChanges).toMatchObject(expectedChanges);
    })

  })
})
