import { newMe, signMessage, openMessage, signObject, verifySignedObject } from "./user"

describe('user', () => {
  const me = newMe();
  test('sign message then open message', () => {
    const message = 'test message';
    const signedMessage = signMessage(message, me.privateKey)
    expect(signedMessage).not.toContain(message);
    const openedMessage = openMessage(signedMessage, me.publicKey);
    expect(openedMessage).toEqual(message);
  })

  test('sign object and verify signature', () => {
    const obj = { name: 'mark', date: new Date() }
    const signedObj = signObject(obj, me.privateKey);
    expect(signedObj.signature).toBeTruthy();
    expect(() => verifySignedObject(signedObj, me.publicKey)).not.toThrow(/.*/);
    expect(() => verifySignedObject(signedObj, newMe().publicKey)).toThrow(/Object signature verification failed/);
    expect(() => verifySignedObject(signedObj, me.publicKey + 1)).toThrow(/bad public key size/);
  })
})
