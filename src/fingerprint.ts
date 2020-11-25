import { hashObject } from './common';
import Crpytr from 'cryptr';
import Fingerprintjs2 from 'fingerprintjs2';

let fingerprint;
export function getFingerprint(): Promise<string> {
  if (fingerprint) {
    return Promise.resolve(fingerprint);
  }
  return new Promise(resolve => {
    const fingerprinter = new Fingerprintjs2();
    fingerprinter.get(function(_fingerprint, components) {
      const safeComponents = components.filter(i => !['resolution', 'timezone', 'plugins'].some(k => i.key.match(k)))
      fingerprint = hashObject(safeComponents);
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