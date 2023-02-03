import { newUser, init } from "./user"
import * as _ from 'lodash';
import 'should';
import { initDBWithMemoryMock } from "./db-mock";
import { applyChange, getChanges, isEmptyArray } from "./data-change";

describe('data-change', () => {

  const me = newUser();
  const peer = newUser();
  beforeAll(async () => {
    await initDBWithMemoryMock()
    await init(me);
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
        {
          set: [],
          rm: []
        }
      )
    })

    test('simple', () => {
      expect(
        getChanges({ a: 1 }, { a: 2 })
      ).toEqual(
        {
          set: [['a', 2]],
          rm: []
        }
      )
    })

    test('empty to value', () => {
      expect(
        getChanges({}, { a: 1 })
      ).toEqual(
        {
          set: [['a', 1]],
          rm: []
        }
      )
    })

    test('value to empty', () => {
      expect(
        getChanges({ a: 1 }, {})
      ).toEqual(
        {
          set: [],
          rm: ['a']
        }
      )
    })

    test('deep change', () => {
      expect(
        getChanges({ a: { b: [1, 2, 3] } }, { a: { b: [1, 3] } })
      ).toEqual(
        {
          set: [
            ['a.b.1', 3],
          ],
          rm: ['a.b.2']
        }
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
        {
          set: [
            ['a.b.1', 3],
            ['c', { d: null }],
            ['ddd', d],
          ],
          rm: [
            'a.b.2',
            'dd'
          ]
        }
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
        {
          set: [],
          rm: []
        }
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
        {
          set: [['n', 2]],
          rm: ['ary', 'obj']
        }
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
        {
          set: [
            ['ary', []],
            ['n', 2],
            ['obj', {}],
          ],
          rm: []
          // rm: [
          //   'ary.0',
          //   'ary.1',
          //   'ary.2',
          //   'obj.a',
          //   'obj.b',
          // ]
        }
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
        {
          set: [
            ['ary', [1, 2, 3]],
            ['n', 1],
            ['obj', { a: 1, b: 2 }],
          ],
          rm: []
        }
      )
    })

    test('sub sub objects removed', () => {
      expect(
        getChanges(
          { ary: [1, [1]], obj: { a: 1, b: { c: 3 }, d: [1, 2] } },
          { ary: [1], obj: { a: 1, d: [2] } }
        )
      ).toEqual(
        {
          set: [['obj.d.0', 2]],
          rm: [
            'ary.1',
            'obj.b',
            'obj.d.1',
          ]
        }
      )
    })

    test('empty array added', () => {
      expect(
        getChanges(
          { ary: [1, [1]], obj: { a: 1, b: { c: 3 }, d: [1, 2] } },
          { ary: [1], obj: { a: 1, d: [2] } }
        )
      ).toEqual(
        {
          set: [['obj.d.0', 2]],
          rm: [
            'ary.1',
            'obj.b',
            'obj.d.1',
          ]
        }
      )
    })

    test('array to obj', () => {
      expect(
        getChanges(
          { a: [1] },
          { a: { n: 1 } }
        )
      ).toEqual(
        {
          set: [['a', { n: 1 }]],
          rm: []
        }
      )
    })

    test('obj to ary', () => {
      expect(
        getChanges(
          { a: { n: 1 } },
          { a: [1] }
        )
      ).toEqual(
        {
          set: [['a', [1]]],
          rm: []
        }
      )
    })

    test('array to leaf', () => {
      expect(
        getChanges(
          { a: [1] },
          { a: 1 }
        )
      ).toEqual(
        {
          set: [['a', 1]],
          rm: []
        }
      )
    })

    test('obj to leaf', () => {
      expect(
        getChanges(
          { a: { n: 1 } },
          { a: 1 }
        )
      ).toEqual(
        {
          set: [['a', 1]],
          rm: []
        }
      )
    })

    test('leaf to array', () => {
      expect(
        getChanges(
          { a: 1 },
          { a: [1] }
        )
      ).toEqual(
        {
          set: [['a', [1]]],
          rm: []
        }
      )
    })

    test('leaf to obj', () => {
      expect(
        getChanges(
          { a: 1 },
          { a: { n: 1 } }
        )
      ).toEqual(
        {
          set: [['a', { n: 1 }]],
          rm: []
        }
      )
    })

    test('array to obj (with same key and value)', () => {
      expect(
        getChanges(
          { a: [1] },
          { a: { "0": 1 } }
        )
      ).toEqual(
        {
          set: [['a', { "0": 1 }]],
          rm: []
        }
      )
    })

    test('obj with numeric key', () => {
      expect(
        getChanges(
          { a: { "0": 1 } },
          { a: { "0": 2 } }
        )
      ).toEqual(
        {
          set: [['a.0', 2]],
          rm: []
        }
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
        {
          set: [['0', 2],['n', 2]],
          rm: []
        }
      )
    })
  })

  describe('applyChange', () => {
    test('simple set', () => {
      expect(
        applyChange({}, { set: [['a', 1]], rm: [] })
      ).toEqual(
        { a: 1 }
      )
    })

    test('new array', () => {
      expect(
        applyChange({}, { set: [['a.0', 1]], rm: [] })
      ).toEqual(
        { a: [1] }
      )
    })

    test('new empty array', () => {
      expect(
        applyChange({}, { set: [['a', []]], rm: [] })
      ).toEqual(
        { a: [] }
      )
    })

    test('rm array', () => {
      expect(
        applyChange({ a: [] }, { set: [], rm: ['a'] })
      ).toEqual(
        {}
      )
    })

    test('overwrite array with object', () => {
      expect(
        applyChange({ a: [] }, { set: [['a', { b: 1 }]], rm: [] })
      ).toEqual(
        { a: { b: 1 } }
      )
    })

    test('overwrite object with array', () => {
      expect(
        applyChange({ a: { b: 1 } }, { set: [['a', [1]]], rm: [] })
      ).toEqual(
        { a: [1] }
      )
    })

    test('change value of object field with numeric key', () => {
      expect(
        applyChange(
          { a: { "0": 1 } },
          {
            set: [['a.0', 2]],
            rm: []
          })
      ).toEqual(
        { a: { "0": 2 } }
      )
    })

    test('change value of array field with nonnumeric key', () => {
      const ary = [1];
      // @ts-ignore
      ary.a = 2;
      expect(
        applyChange(
          { a: [1] },
          {
            set: [['a.a', 2]],
            rm: []
          })
      ).toEqual(
        { a: ary }
      )
    })
  })
})
