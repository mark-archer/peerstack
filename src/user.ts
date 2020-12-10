import { newid, encodeUint8ArrayToBaseN, decodeUint8ArrayFromBaseN, hashObject, anyObject } from './common';
import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';

export interface IUser extends ISigned {
  type: 'User',
  id: string,
  displayName: string,
  publicKey: string,
  modified: number
}

export interface IMe extends IUser {
  secretKey: string
}

export function newMe(displayName?: string): IMe {
  const userId = newid();
  const newKey = nacl.sign.keyPair();
  return {
    type: 'User',
    id: userId,
    displayName: displayName || userId,
    secretKey: encodeUint8ArrayToBaseN(newKey.secretKey),
    publicKey: encodeUint8ArrayToBaseN(newKey.publicKey),
    modified: Date.now(),
  }
}

export function signMessage(msg: string, secretKey: string) {
  const _secretKey = decodeUint8ArrayFromBaseN(secretKey)
  const msgDecoded = naclUtil.decodeUTF8(msg);
  const msgSigned = nacl.sign(msgDecoded, _secretKey);
  return encodeUint8ArrayToBaseN(msgSigned);
}

export function openMessage(signedMsg: string, publicKey: (Uint8Array | string)) {
  const msgDecoded = decodeUint8ArrayFromBaseN(signedMsg);
  const _publicKey = (typeof publicKey === 'string') ? decodeUint8ArrayFromBaseN(publicKey) : publicKey;
  const msgOpened = nacl.sign.open(msgDecoded, _publicKey);
  return naclUtil.encodeUTF8(msgOpened);
}

export interface ISigned {
  signature?: string
}

export function signObject<T>(obj: T, secretKey: string): T & ISigned {
  const signedObj = obj as T & ISigned;
  delete signedObj.signature;
  const hash = hashObject(signedObj);
  signedObj.signature = signMessage(hash, secretKey);
  return signedObj;
}

export function verifySignedObject(obj: ISigned, publicKey: string) {
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