import * as nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import {
  decodeUint8ArrayFromBaseN,
  encodeUint8ArrayToBaseN,
  decodeUint8ArrayFromUTF,
  encodeUint8ArrayToUTF,
  hashObject,
  newid,
  stringify,
  parseJSON
} from './common';
import { getDB, IData, IGroup } from './db';

module.exports.nacl = nacl;
module.exports.naclUtil = naclUtil;

export interface ISigned {
  signature?: string
  signer?: string
}

export interface IDevice {
  id: string
  userId: string
  app: string
  name?: string
  expires?: number
  pushSubscription?: {
    endpoint: string
    expirationTime: number
    keys: any
  }
  subscriptionExpires?: number
}

export interface IUser extends ISigned, IData {
  type: 'User'
  group: 'users'
  name: string
  publicKey: string
  publicBoxKey: string
  devices?: { [deviceId: string]: IDevice }
}

export function newUser(name?: string): IUser & { secretKey: string } {
  const userId = newid();
  const newKey = nacl.sign.keyPair();
  const boxKey = nacl.box.keyPair.fromSecretKey(newKey.secretKey.slice(0, 32))
  const user: IUser & { secretKey: string } = {
    type: 'User',
    id: userId,
    group: 'users',
    name: name || userId,
    secretKey: encodeUint8ArrayToBaseN(newKey.secretKey),
    publicKey: encodeUint8ArrayToBaseN(newKey.publicKey),
    publicBoxKey: encodeUint8ArrayToBaseN(boxKey.publicKey),
    modified: Date.now(),
  }
  return user;
}

// expose public box key for now to update users if needed
export let publicBoxKey: string;

export let userId: string;
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
    if (config.dontWarn === false) {
      alert("You're about to be asked if you'd like to store a username and password for this site.  It is highly recommend you agree to this unless you're comfortable managing your user id and secret key yourself.")
    }
    const db = await getDB();

    // // don't use navigator to store creds, it creates problems
    // try {
    //   // switch name and id so name is shown
    //   // @ts-ignore
    //   const creds = await navigator.credentials.create({ password: { id: config.name || config.id, password: config.secretKey, name: config.id, iconUrl: config.iconUrl } });
    //   await navigator.credentials.store(creds);
    //   // @ts-ignore
    //   const storedCredentials = await navigator.credentials.get({ password: true })    
    //   if (storedCredentials) {
    //     await db.local.delete(credentialsId);
    //     return userId;
    //   }    
    // } catch { }

    // if `navigator.credentials` fails then store in db.local
    // can't use credential store so fallback to local storage for now 
    // TODO find a more secure way to do this
    await db.local.save({ id: credentialsId, config });
    return userId
  }

  // look up stored credentials - first try credentials then try db.local
  try {
    // @ts-ignore
    const creds = await navigator.credentials.get({ password: true });
    if (creds) {
      // @ts-ignore
      userId = creds.name;
      // @ts-ignore
      secretKey = creds.password;
      publicBoxKey = hydrateUser(userId, secretKey).publicBoxKey;
      return userId
    }
  } catch { }
  // if all else fails try to look it up in db.local
  const db = await getDB();
  config = (await db.local.get(credentialsId))?.config;
  userId = config?.id;
  secretKey = config?.secretKey;
  publicBoxKey = hydrateUser(userId, secretKey).publicBoxKey;
  return userId;
}

export function hydrateUser(id: string, secretKey: string, displayName?: string): IUser {
  let secretKeyAry = decodeUint8ArrayFromBaseN(secretKey);
  if (secretKeyAry.length !== 64) {
    secretKeyAry = decodeUint8ArrayFromBaseN(secretKey, 36);
  }
  const keyPartLength = secretKeyAry.length / 2; // should be 32
  const publicKeyAry = secretKeyAry.slice(keyPartLength);
  const publicKey = encodeUint8ArrayToBaseN(publicKeyAry);
  const boxKey = nacl.box.keyPair.fromSecretKey(secretKeyAry.slice(0, keyPartLength));
  const publicBoxKey = encodeUint8ArrayToBaseN(boxKey.publicKey);
  return {
    id,
    publicKey,
    publicBoxKey,
    name: displayName || id,
    group: 'users',
    modified: 1, // don't want to overwrite data in the database with this most minimal user object
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

export interface IDataBox {
  fromUserId: string
  contents: string
  nonce: string
}

export function boxDataWithKeys(data: any, toPublicBoxKey: string, fromSecretKey: string, fromUserId: string): IDataBox {
  let _secretKey: Uint8Array;
  if (fromSecretKey.length == 128) {
    _secretKey = decodeUint8ArrayFromBaseN(fromSecretKey, 36)
  } else {
    _secretKey = decodeUint8ArrayFromBaseN(fromSecretKey)
  }
  const fromSecretBoxKey = _secretKey.slice(0, 32);
  const _toPublicBoxKey: Uint8Array = decodeUint8ArrayFromBaseN(toPublicBoxKey);
  const nonce = nacl.randomBytes(24);
  data = stringify(data);
  const dataDecoded = decodeUint8ArrayFromUTF(data);
  const dataBoxed = nacl.box(dataDecoded, nonce, _toPublicBoxKey, fromSecretBoxKey)
  return {
    fromUserId,
    contents: encodeUint8ArrayToBaseN(dataBoxed),
    nonce: encodeUint8ArrayToBaseN(nonce)
  }
}

export function getSignature(msg: string, secretKey: string) {
  let _secretKey: Uint8Array;
  if (secretKey.length == 128) {
    _secretKey = decodeUint8ArrayFromBaseN(secretKey, 36)
  } else {
    _secretKey = decodeUint8ArrayFromBaseN(secretKey)
  }
  const msgDecoded = naclUtil.decodeUTF8(msg);
  const sig = nacl.sign.detached(msgDecoded, _secretKey);
  return encodeUint8ArrayToBaseN(sig);
}

export function signObjectWithIdAndSecretKey<T>(obj: T, userId: string, secretKey: string): T & ISigned {
  const signedObj = obj as T & ISigned;
  delete signedObj.signature;
  signedObj.signer = userId;
  const hash = hashObject(signedObj);
  // signedObj.signature = signMessageWithSecretKey(hash, secretKey);
  signedObj.signature = getSignature(hash, secretKey);
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

export function boxDataForPublicKey(data: any, toPublicBoxKey: string) {
  const fromSecretKey = secretKey;
  const fromUserId = userId;
  return boxDataWithKeys(data, toPublicBoxKey, fromSecretKey, fromUserId);
}

export async function boxDataForUser(data: any, toUserId: string) {
  const fromSecretKey = secretKey;
  const fromUserId = userId;
  const db = await getDB();
  const toUser: IUser = await db.get(toUserId);
  return boxDataWithKeys(data, toUser.publicBoxKey, fromSecretKey, fromUserId);
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

export function openBoxWithSecretKey(box: IDataBox, fromPublicBoxKey: string, toSecretKey: string): any {
  let _secretKey: Uint8Array;
  if (toSecretKey.length == 128) {
    _secretKey = decodeUint8ArrayFromBaseN(toSecretKey, 36)
  } else {
    _secretKey = decodeUint8ArrayFromBaseN(toSecretKey)
  }
  const _toSecretKey = _secretKey.slice(0, 32);
  const boxedData = decodeUint8ArrayFromBaseN(box.contents);
  const nonce = decodeUint8ArrayFromBaseN(box.nonce);
  const fromPublicKey = decodeUint8ArrayFromBaseN(fromPublicBoxKey);

  const dataAry = nacl.box.open(boxedData, nonce, fromPublicKey, _toSecretKey);
  if (dataAry === null) {
    console.log('Message was null or verification failed', box)
    throw new Error('Message was null or verification failed');
  }
  const dataStr = encodeUint8ArrayToUTF(dataAry);
  return parseJSON(dataStr);
}

export async function openBox(box: IDataBox) {
  const db = await getDB();
  const fromUser: IUser = await db.get(box.fromUserId);
  if (!fromUser) {
    throw new Error('box sent by unknown user');
  }
  return openBoxWithSecretKey(box, fromUser.publicBoxKey, secretKey);
}

export function verifySignature(message: string, signature: string, publicKey: string) {
  const messageAry = naclUtil.decodeUTF8(message);
  const sig = decodeUint8ArrayFromBaseN(signature);
  let _publicKey: Uint8Array;
  if (publicKey.length == 64) {
    _publicKey = decodeUint8ArrayFromBaseN(publicKey, 36)
  } else {
    _publicKey = decodeUint8ArrayFromBaseN(publicKey);
  }
  return nacl.sign.detached.verify(messageAry, sig, _publicKey);
}

export function verifySignedObject(obj: ISigned, publicKey: string) {
  try {
    const signature = obj.signature;
    delete obj.signature;
    const hash = hashObject(obj);
    obj.signature = signature;
    let error;
    try {
      if (verifySignature(hash, signature, publicKey)) {
        return true;
      }
    } catch (err) {
      error = err;
    }
    const sigHash = openMessage(signature, publicKey);
    if (hash !== sigHash) {
      if (error) {
        throw error;
      }
      throw new Error('signature hash does not match');
    }
  } catch (err) {
    throw new Error('Object signature verification failed: ' + String(err));
  }
}

// TODO maybe cache the results to speed up duplicate calls
export async function verifySigner(obj: ISigned) {
  const db = await getDB();
  const signer: IUser = await db.get(obj.signer);
  try {
    verifySignedObject(obj, signer.publicKey);
  } catch (err) {
    throw new Error(`Could not verify object signature: ${JSON.stringify({ obj, signer }, null, 2)}`)
  }
}

// This tries to convert keys in old format to new format before comparing
export function keysEqual(publicKey1: string, publicKey2: string) {
  if (publicKey1.length == 64) {
    const keyAry = decodeUint8ArrayFromBaseN(publicKey1, 36);
    publicKey1 = encodeUint8ArrayToBaseN(keyAry)
  }
  if (publicKey2.length == 64) {
    const keyAry = decodeUint8ArrayFromBaseN(publicKey2, 36);
    publicKey2 = encodeUint8ArrayToBaseN(keyAry)
  }
  return publicKey1 === publicKey2;
}

export function newData<T>(fields?: Partial<IData> & T): IData & T {
  if (!userId) {
    console.warn('user has not been initialized so group may be uninitialized')
  }
  const value: IData & T = {
    id: newid(),
    type: 'Data',
    group: userId,
    modified: Date.now(),
    ...fields
  }
  return value
}

export function newGroup(fields?: Partial<IGroup>): IGroup {
  const group: IGroup = newData({
    type: 'Group',
    blockedUserIds: [],
    members: [],
    name: 'New Group',
    owner: userId,
    ...fields
  });
  group.group = group.id;
  return group;
}

export function generateRandomSecureString() {
  const newKey = nacl.sign.keyPair();
  return encodeUint8ArrayToBaseN(newKey.secretKey).replace(/[\/\+\=]/g, '');
}
