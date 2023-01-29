import { newUser, signMessage, openMessage, init, newData } from "./user"
import * as _ from 'lodash';
import 'should';
import { initDBWithMemoryMock } from "./db-mock";
import { flattenObject, getChanges } from "./data-change";

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

  })

})
