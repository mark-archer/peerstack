import * as _ from 'lodash';
import * as uuid from 'uuid';
import { sha256 } from 'js-sha256';

const stableStringify = require('fast-json-stable-stringify');

export type anyObject = ({ [key: string]: any });

export const isObject = (x: any) => _.isObject(x) && !_.isArray(x) && !_.isDate(x);
export const guid = uuid.v4;

export function newid(): string {
  return uuid.v4().replace(/-/g, '');
}

export function isid(sid: any) {
  return Boolean(/^[0-9a-f]{32}$/i.exec(sid))
};

export function isEmail(x) {
  return _.isString(x) && /^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(x);
}

export function hashValue(str: string | [] | ArrayBuffer | Uint8Array) {
  return sha256(str)
};

export function hashObject(obj: ({ [key: string]: any })) {
  const sig = obj.signature;
  delete obj.signature;
  const stableJson = stableStringify(obj);
  const hash = hashValue(stableJson);
  if (sig) {
    obj.signature = sig;
  }
  return hash;
}

export function hashBlob(blob: Blob, progressUpdate?: ((a: number) => any), chunkSize: number = 4194304 /*4MB*/) {
  return new Promise((resolve, reject) => { 
    let hash = sha256.create();
    const totalSize = blob.size;
    const fileReader = new FileReader();
    let offset = 0;
    fileReader.addEventListener('error', error => reject(error));
    fileReader.addEventListener('abort', event => reject(event));
    fileReader.addEventListener('load', e => {
      // @ts-ignore
      const part = e.target.result as ArrayBuffer;
      offset += part.byteLength;
      hash = hash.update(part);
      if (offset < totalSize) {
        readNextChunk();
      } else {
        resolve(hash.hex());
      }
      if (progressUpdate) progressUpdate(offset / totalSize);
    });
    const readNextChunk = () => {
      const slice = blob.slice(offset, offset + chunkSize);
      fileReader.readAsArrayBuffer(slice);
    };
    readNextChunk();
  });
};

export function encodeUint8ArrayToBaseN(ary: Uint8Array, radix: number = 36) {
  const nums = ary.toString().split(',').map(sn => Number(sn) + radix);
  const encoded = nums.map(n => n.toString(radix)).join('');
  return encoded;
}

export function decodeUint8ArrayFromBaseN(str: string, radix: number = 36): Uint8Array {
  const nums: number[] = [];
  for (let i = 0; i < str.length; i += 2) {
    const sn = str.substr(i, 2);
    const num = parseInt(sn, radix) - radix;
    nums.push(num);
  }
  return new Uint8Array(nums);
}

export function encodeUint8ArrayToUTF(ary: Uint8Array) {
  return String.fromCharCode.apply(null, ary);
}

export function decodeUint8ArrayFromUTF(strAry: string): Uint8Array {
  var ary = new Uint8Array(strAry.length);
  for (var i=0, strLen=strAry.length; i < strLen; i++) {
    ary[i] = strAry.charCodeAt(i);
  }
  return ary;
}

export function arrayBufferToBase64(ary: ArrayBuffer): string {
  // public method for encoding an Uint8Array to base64
  function encode(input) {
    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var output = "";
    var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
    var i = 0;

    while (i < input.length) {
      chr1 = input[i++];
      chr2 = i < input.length ? input[i++] : Number.NaN; // Not sure if the index 
      chr3 = i < input.length ? input[i++] : Number.NaN; // checks are needed here

      enc1 = chr1 >> 2;
      enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
      enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
      enc4 = chr3 & 63;

      if (isNaN(chr2)) {
        enc3 = enc4 = 64;
      } else if (isNaN(chr3)) {
        enc4 = 64;
      }
      output += keyStr.charAt(enc1) + keyStr.charAt(enc2) +
        keyStr.charAt(enc3) + keyStr.charAt(enc4);
    }
    return output;
  }
  var bytes = new Uint8Array(ary);
  return 'data:image/png;base64,' + encode(bytes);
}

export function blobToBase64(blob: Blob) {
  return new Promise(resolve => {
    var reader = new FileReader();
    reader.readAsDataURL(blob); 
    reader.onloadend = () => resolve(reader.result)
  });
}

export const arrayBufferToObjectURL = (ary: ArrayBuffer) => URL.createObjectURL(new Blob([ary]))

export const objectToURL = (o: any) => URL.createObjectURL(o)

export function arrayBufferToBlob(buffer, type) {
  return new Blob([buffer], {type: type});
}

export function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('loadend', (e) => {
      resolve(reader.result);
    });
    reader.addEventListener('error', reject);
    reader.readAsArrayBuffer(blob)
  });
}

// @ts-ignore
if (typeof window !== 'undefined') window.common = module.exports;
