import { newUser, init, newData, signObject, newGroup } from "./user"
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
    myGroup = newGroup();
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

  describe('saveChange', () => {
    test('create and update', async () => {
      // create
      const data = newData({ n: 1 });
      expect(await db.changes.getSubjectChanges(data.id)).toEqual([]);
      await saveChanges(data);
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
      data.modified++;
      await saveChanges(data);
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
      data.modified++;
      await saveChanges(data);
      dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      dbChanges = await db.changes.getSubjectChanges(data.id, data.modified);
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
    })

    test('create group and update group', async () => {
      // create group
      let data = newGroup();
      expect(await db.changes.getSubjectChanges(data.id)).toEqual([]);
      await saveChanges(data);
      let dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      let dbChanges = await db.changes.getSubjectChanges(data.id);
      expect(dbChanges).toMatchObject([
        {
          subject: data.id,
          changes: [['',data]]
        },
      ]);
      
      // update group
      data.name = "Better Group Name";
      data.modified++;
      await saveChanges(data);
      dbData = await db.get(data.id);
      expect(dbData).toEqual(data);
      dbChanges = await db.changes.getSubjectChanges(data.id, data.modified);
      expect(dbChanges).toMatchObject([
        {
          subject: data.id,
          changes: [['name','Better Group Name']]
        },
      ])
    });

    test('TODO reject changes due to lack of permissions', () => {

    })
  })
})
