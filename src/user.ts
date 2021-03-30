import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import { decodeUint8ArrayFromBaseN, encodeUint8ArrayToBaseN, hashObject, newid } from './common';
import { getIndexedDB, IData } from './db';

export interface ISigned {
  signature?: string
  signer?: string
}

export interface IUser extends ISigned, IData {
  type: 'User',
  group: 'users',
  id: string,
  name: string,
  publicKey: string,
  modified: number
}

export function newUser(name?: string): IUser & { secretKey: string } {
  const userId = newid();
  const newKey = nacl.sign.keyPair();
  return {
    type: 'User',
    id: userId,
    owner: userId,
    group: 'users',
    name: name || userId,
    secretKey: encodeUint8ArrayToBaseN(newKey.secretKey),
    publicKey: encodeUint8ArrayToBaseN(newKey.publicKey),
    modified: Date.now(),
  }
}

let userId: string;
let secretKey: string;
export async function init(config?: { id: string, secretKey: string, name?: string, iconUrl?: string, dontWarn?: boolean, dontStore?: boolean }): Promise<string> {
  if (!config && userId && secretKey) {
    return userId;
  }
  const credentialsId = 'credentials';
  if (config) {
    userId = config.id;
    secretKey = config.secretKey;
    if (config.dontStore) {
      return userId;
    }
    if (!config.dontWarn) {
      alert("You're about to be asked if you'd like to store a username and password for this site.  It is highly recommend you agree to this unless you're comfortable managing your user id and secret key yourself.")
    }
    try {
      // switch name and id so name is shown
      // @ts-ignore
      const creds = await navigator.credentials.create({ password: { id: config.name, password: config.secretKey, name: config.id, iconUrl: config.iconUrl } });
      await navigator.credentials.store(creds);
    } catch { }
    // @ts-ignore
    const storedCredentials = await navigator.credentials.get({ password: true }).catch(() => 0)
    const db = await getIndexedDB();
    if (!storedCredentials) {
      // can't use credential store so fallback to local storage for now 
      // TODO find a more secure way to do this
      await db.local.save({ id: credentialsId, config });
    } else {
      await db.local.delete(credentialsId);
    }
    return userId
  }
  // @ts-ignore
  const creds = await navigator.credentials.get({ password: true }).catch(() => 0);
  if (creds) {
    // @ts-ignore
    userId = creds.name;
    // @ts-ignore
    secretKey = creds.password;
  } else {
    const db = await getIndexedDB();
    config = (await db.local.get(credentialsId)).config;
    userId = config?.id;
    secretKey = config?.secretKey;
  }
  return userId;
}

export function hydrateUser(id: string, secretKey: string, displayName?: string): IUser {
  const secretKeyAry = decodeUint8ArrayFromBaseN(secretKey);
  const publicKeyAry = secretKeyAry.slice(secretKeyAry.length / 2);
  const publicKey = encodeUint8ArrayToBaseN(publicKeyAry);
  return {
    id,
    publicKey,
    name: displayName || id,
    group: 'users',
    modified: 1, // don't want to overwrite data in the database with this most minimal user object
    owner: id,
    type: 'User',
  }
}

export function signMessageWithSecretKey(msg: string, secretKey: string) {
  let _secretKey: Uint8Array;
  if (secretKey.length == 128) {
    _secretKey = decodeUint8ArrayFromBaseN(secretKey, 36)
  } else {
    _secretKey = decodeUint8ArrayFromBaseN(secretKey)
  }
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

export function openMessage(signedMsg: string, publicKey: string) {
  let _publicKey: Uint8Array;
  if (publicKey.length == 64) {
    _publicKey = decodeUint8ArrayFromBaseN(publicKey, 36)
  } else {
    _publicKey = decodeUint8ArrayFromBaseN(publicKey);
  }
  let msgDecoded: Uint8Array;
  let msgOpened: Uint8Array;
  try {
    msgDecoded = decodeUint8ArrayFromBaseN(signedMsg);
    msgOpened = nacl.sign.open(msgDecoded, _publicKey);
    if (!msgOpened) throw 'failed';
  } catch {
    msgDecoded = decodeUint8ArrayFromBaseN(signedMsg, 36);
    msgOpened = nacl.sign.open(msgDecoded, _publicKey);
  }
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
