import { hashObject } from "./common";
import { newMe, signMessage, openMessage, signObject, verifySignedObject } from "./user"
import * as _ from 'lodash';
import 'should';

describe('user', () => {
  const me = newMe();
  test('sign message then open message', () => {
    const message = 'test message';
    const signedMessage = signMessage(message, me.secretKey)
    expect(signedMessage).not.toContain(message);
    const openedMessage = openMessage(signedMessage, me.publicKey);
    expect(openedMessage).toEqual(message);
  })

  test('sign object and verify signature', () => {
    const obj = { name: 'mark', date: new Date() }
    const signedObj = signObject(obj, me.secretKey);
    expect(signedObj.signature).toBeTruthy();
    expect(() => verifySignedObject(signedObj, me.publicKey)).not.toThrow(/.*/);
    expect(() => verifySignedObject(signedObj, newMe().publicKey)).toThrow(/Object signature verification failed/);
    expect(() => verifySignedObject(signedObj, me.publicKey + 1)).toThrow(/bad public key size/);
  })

  test('object verification error', () => {
    const obj = { name: 'mark', date: new Date() }
    const signedObj = signObject(obj, me.secretKey);
    signedObj.name = 'some other name'
    expect(() => verifySignedObject(signedObj, me.publicKey)).toThrow(/signature hash does not match/)
  })

  test('object hashs are 64 chars and signatures 256 chars', () => {
    const obj = { nums: _.range(1000000), propA: 'A', propB: 'B' };
    const hash = hashObject(obj);
    hash.length.should.equal(64);
    const signature = signMessage(hash, me.secretKey);
    signature.length.should.equal(256);
  })
})
