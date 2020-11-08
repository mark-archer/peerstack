import { newMe, signMessage, openMessage } from "./user"

test('signMessage then open message', () => {
  const me = newMe();
  const signedMessage = signMessage('test message', me.privateKey)
  expect(signedMessage).not.toContain('test message');
  const openedMessage = openMessage(signedMessage, me.publicKey);
  expect(openedMessage).toEqual('test message');
})