import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { decodeUint8ArrayFromBaseN, encodeUint8ArrayToBaseN, hashObject, newid } from './common';
import { IData } from './db';

export interface ISigned {
  signature?: string
  signer?: string
}

export interface IUser extends ISigned, IData {
  type: 'User',
  group: 'users',
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
    id: userId,
    owner: userId,
    group: 'users',
    type: 'User',
    displayName: displayName || userId,
    secretKey: encodeUint8ArrayToBaseN(newKey.secretKey),
    publicKey: encodeUint8ArrayToBaseN(newKey.publicKey),
    modified: Date.now(),
  }
}

export function hydrateMe(id: string, secretKey: string, displayName?: string): IMe {
  return {
    id,
    secretKey,
    publicKey: secretKey.substr(64),
    displayName: displayName || id,
    group: 'users',
    modified: 1, // don't want to overwrite data in the database with this most minimal user object
    owner: id,
    type: 'User',
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

export function signObject<T>(obj: T, secretKey: string, signerId: string): T & ISigned {
  const signedObj = obj as T & ISigned;
  delete signedObj.signature;
  signedObj.signer = signerId;
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
