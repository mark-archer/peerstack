import { newUser, signMessage, openMessage, init, newData } from "./user"
import * as _ from 'lodash';
import 'should';
import { initDBWithMemoryMock } from "./db-mock";
import { applyChange, flattenObject, getChanges } from "./data-change";

describe('user', () => {

  const me = newUser();
  const peer = newUser();
  beforeAll(async () => {
    await initDBWithMemoryMock()
    await init(me);
  })

  test('sign message then open message', () => {
    const message = 'test message';
    const signedMessage = signMessage(message)
    expect(signedMessage).not.toContain(message);
    const openedMessage = openMessage(signedMessage, me.publicKey);
    expect(openedMessage).toEqual(message);
  })

  describe('flattenObject', () => {
    test('date', () => {
      const d = new Date();
      expect(
        flattenObject({ d })
      ).toEqual(
        [["d", d]]
      )
    })

    test('array', () => {
      expect(
        flattenObject([1, 'a'])
      ).toEqual(
        [
          ["0", 1],
          ["1", 'a'],
        ]
      )
    })

    test('complex object', () => {
      const d = new Date();
      const data = {
        n: 1, d, b: true, s: 'a', ary: [2, d, false, 'b'],
        obj: {
          n: 1, d, b: true, s: 'a', ary: [2, d, false, 'b']
        },
        null: null,
        undefined: undefined,
      };

      expect(
        flattenObject(data)
      ).toEqual(
        [
          ['n', 1],
          ['d', d],
          ['b', true],
          ['s', 'a'],
          ['ary.0', 2],
          ['ary.1', d],
          ['ary.2', false],
          ['ary.3', 'b'],
          ['obj.n', 1],
          ['obj.d', d],
          ['obj.b', true],
          ['obj.s', 'a'],
          ['obj.ary.0', 2],
          ['obj.ary.1', d],
          ['obj.ary.2', false],
          ['obj.ary.3', 'b'],
          ['null', null],
          ['undefined', undefined],
        ]
      )
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
          { ary: [1,2,3], obj: { a: 1, b: 2 }, n: 1 },
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
          { ary: [1,2,3], obj: { a: 1, b: 2 }, n: 1 },
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
          { ary: [1,2,3], obj: { a: 1, b: 2 }, n: 1 },
        )
      ).toEqual(
        {
          set: [
            ['ary', [1,2,3]],
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
          { ary: [1,[1]], obj: { a: 1, b: { c: 3 }, d: [1, 2] } },
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
          { ary: [1,[1]], obj: { a: 1, b: { c: 3 }, d: [1, 2] } },
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
  })

  describe('applyChange', () => {
    test('simple set', () => {
      expect(
        applyChange({}, { set: [['a', 1]], rm: []})
      ).toEqual(
        { a: 1 }
      )
    })

    test('new array', () => {
      expect(
        applyChange({}, { set: [['a.0', 1]], rm: []})
      ).toEqual(
        { a: [1] }
      )
    })

    test('new empty array', () => {
      expect(
        applyChange({}, { set: [['a', [] as any]], rm: []})
      ).toEqual(
        { a: [] }
      )
    })
  })

})
