import { newid, encodeUint8ArrayToBaseN, decodeUint8ArrayFromBaseN, hashObject, anyObject } from './common';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

export interface IUser {
  id: string,
  displayName: string,
  publicKey: string
}

export interface IMe extends IUser {
  privateKey: string
}

export function newMe(displayName?: string): IMe {
  const userId = newid();
  const newKey = nacl.sign.keyPair();
  return {
    id: userId,
    displayName: displayName || userId,
    privateKey: encodeUint8ArrayToBaseN(newKey.secretKey),
    publicKey: encodeUint8ArrayToBaseN(newKey.publicKey),
  }
}

export function signMessage(msg: string, privateKey: string) {
  const secretKey = decodeUint8ArrayFromBaseN(privateKey)
  const msgDecoded = naclUtil.decodeUTF8(msg);
  const msgSigned = nacl.sign(msgDecoded, secretKey);
  return encodeUint8ArrayToBaseN(msgSigned);
}

export function openMessage(signedMsg: string, publicKey: (Uint8Array | string)) {
  const msgDecoded = decodeUint8ArrayFromBaseN(signedMsg);
  const _publicKey = (typeof publicKey === 'string') ? decodeUint8ArrayFromBaseN(publicKey) : publicKey;
  const msgOpened = nacl.sign.open(msgDecoded, _publicKey);
  return naclUtil.encodeUTF8(msgOpened);
}

export type signedObject = { signature: string } & anyObject;

export function signObject<T>(obj: T, privateKey: string): T & { signature: string } {
  const signedObj = { ...obj, signature: undefined }
  delete signedObj.signature;
  const hash = hashObject(signedObj);
  signedObj.signature = signMessage(hash, privateKey);
  return signedObj;
}

export function verifySignedObject(obj: signedObject, publicKey: string) {
  try {
    const signature = obj.signature;
    const sigHash = openMessage(signature, publicKey);
    delete obj.signature;
    const hash = hashObject(obj);
    obj.signature = signature;
    if (hash !== sigHash) {
      throw new Error('signature hash does not match');
    }
  } catch (err) {
    throw new Error('Object signature verification failed: ' + String(err));
  }
}