import { hashObject } from './common';
import Crpytr from 'cryptr';

let fingerprint;
export function getFingerprint() {
  if (fingerprint) {
    return Promise.resolve(fingerprint);
  }
  return new Promise(resolve => {
    new (require('fingerprintjs2'))().get(function(_fingerprint, components) {
      const safeComponents = components.filter(i => !['resolution', 'timezone', 'plugins'].some(k => i.key.match(k)))
      fingerprint = hashObject(safeComponents);
      fingerprint = hashObject(safeComponents);
      console.log({ _fingerprint,fingerprint, components });
      resolve(fingerprint);
    })
  })
}

export async function encrypt(value: string, password?: string) {
  if (!password) {
    password = await getFingerprint();
  }
  const crypter = new Crpytr(password);
  return crypter.encrypt(value);
}

export async function decrypt(value: string, password?: string) {
  if (!password) {
    password = await getFingerprint();
  }
  const crypter = new Crpytr(password);
  return crypter.decrypt(value);
}