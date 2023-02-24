import { hashObject } from "./common";
import { newUser, signMessage, openMessage, signObject, verifySignedObject, init } from "./user"
import * as _ from 'lodash';
import 'should';
import { initDBWithMemoryMock } from "./db-mock.test";

describe('user', () => {

  const me = newUser();
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

  test('sign object and verify signature', () => {
    const obj = { name: 'mark', date: new Date() }
    const signedObj = signObject(obj);
    expect(signedObj.signature).toBeTruthy();
    expect(() => verifySignedObject(signedObj, me.publicKey)).not.toThrow(/.*/);
    expect(() => verifySignedObject(signedObj, newUser().publicKey)).toThrow(/Object signature verification failed/);
    expect(() => verifySignedObject(signedObj, me.publicKey + 1)).toThrow(/bad public key size/);
  })

  test('object verification error', () => {
    const obj = { name: 'mark', date: new Date() }
    const signedObj = signObject(obj);
    signedObj.name = 'some other name'
    expect(() => verifySignedObject(signedObj, me.publicKey)).toThrow(/Object signature verification failed/);
  })

  test('object hashes are 64 chars and signatures 172 chars', () => {
    const obj = { nums: _.range(1000000), propA: 'A', propB: 'B' };
    const hash = hashObject(obj);
    hash.length.should.equal(64);
    const signature = signMessage(hash);
    signature.length.should.equal(172);
  })
})
