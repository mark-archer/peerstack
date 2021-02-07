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

export function newUser(displayName?: string): IUser & { secretKey: string } {
  const userId = newid();
  const newKey = nacl.sign.keyPair();
  return {
    type: 'User',
    id: userId,
    owner: userId,
    group: 'users',
    displayName: displayName || userId,
    secretKey: encodeUint8ArrayToBaseN(newKey.secretKey),
    publicKey: encodeUint8ArrayToBaseN(newKey.publicKey),
    modified: Date.now(),
  }
}

let userId: string;
let secretKey: string;
export async function init(config?: { id: string, secretKey: string, displayName?: string, iconUrl?: string, dontWarn?: boolean, dontStore?: boolean }) {  
  if (config) {
    userId = config.id;
    secretKey = config.secretKey;
    if (config.dontStore) {
      return userId;
    }
    if (!config.dontWarn) {
      alert("You're about to be asked if you'd like to store a username and password for this site.  It is highly recommend you click SAVE unless you're comfortable managing your user id and secret key yourself.")
    }
    // @ts-ignore
    const creds = await navigator.credentials.create({ password: { id: config.id, password: config.secretKey, displayName: config.displayName, iconUrl: config.iconUrl } });
    await navigator.credentials.store(creds);    
    return userId
  }
  // @ts-ignore
  const creds = await navigator.credentials.get({ password: true })
  userId = creds.id;
  // @ts-ignore
  secretKey = creds.password;
  return userId;
}

export function hydrateUser(id: string, secretKey: string, displayName?: string): IUser {
  return {
    id,
    publicKey: secretKey.substr(64),
    displayName: displayName || id,
    group: 'users',
    modified: 1, // don't want to overwrite data in the database with this most minimal user object
    owner: id,
    type: 'User',
  }
}

export function signMessageWithSecretKey(msg: string, secretKey: string) {
  const _secretKey = decodeUint8ArrayFromBaseN(secretKey)
  const msgDecoded = naclUtil.decodeUTF8(msg);
  const msgSigned = nacl.sign(msgDecoded, _secretKey);
  return encodeUint8ArrayToBaseN(msgSigned);
}

export function signObjectWithIdAndSecretKey<T>(obj: T, userId: string, secretKey: string): T & ISigned {
  const signedObj = obj as T & ISigned;
  delete signedObj.signature;
  signedObj.signer = userId;
  const hash = hashObject(signedObj);
  signedObj.signature = signMessageWithSecretKey(hash, secretKey);
  return signedObj;
}

export function signMessage(msg: string) {
  if (!secretKey) {
    throw new Error('secret key not set, have you called `init`?')
  }
  return signMessageWithSecretKey(msg, secretKey);
}

export function signObject<T>(obj: T): T & ISigned {
  if (!secretKey) {
    throw new Error('secret key not set, have you called `init`?')
  }
  return signObjectWithIdAndSecretKey(obj, userId, secretKey);
}

export function openMessage(signedMsg: string, publicKey: (Uint8Array | string)) {
  const msgDecoded = decodeUint8ArrayFromBaseN(signedMsg);
  const _publicKey = (typeof publicKey === 'string') ? decodeUint8ArrayFromBaseN(publicKey) : publicKey;
  const msgOpened = nacl.sign.open(msgDecoded, _publicKey);
  return naclUtil.encodeUTF8(msgOpened);
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
