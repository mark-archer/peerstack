/* istanbul ignore file */

import { sha256 } from 'js-sha256';
import * as _ from 'lodash';
import * as base64 from "byte-base64"; // TODO switch this to use `base64-js`
// import * as uuid from 'uuid';

const stableStringify = require('fast-json-stable-stringify');

export type anyObject = ({ [key: string]: any });

export const isObject = (x: any) => _.isObject(x) && !_.isArray(x) && !_.isDate(x);
export const isArray = (x: any) => _.isArray(x);

// export const guid = uuid.v4;
// export function newid_v1(): string {
//   return uuid.v4().replace(/-/g, '');
// }

export function isid_v1(id: any) {
  // valid 
  //      7194ee666e4c4ab18f1f7466ec525a43
  //      7194ee666e4c4ab18f1f7466ec525a43:a
  //      7194ee666e4c4ab18f1f7466ec525a43:a:b
  // invalid
  //      7194ee666e4c4ab18f1f7466ec525a43ab
  //      7194ee666e4c4ab18f1f7466ec525a4
  //      7194ee666e4c4ab18f1f7466ec525a43:
  //      7194ee666e4c4ab18f1f7466ec525a43:a:
  //      a:7194ee666e4c4ab18f1f7466ec525a43
  return Boolean(/^[0-9a-f]{32}(:[0-9a-z]+)*$/i.exec(id)) && id.length <= 128;
};

export function newid(): string {
  // v1 ids do not sort in their natural order.  The goal is to fix that with v2
  // modeled after mongo ids, timestamp + counter + random but we're going to skip counter and have bigger random
  // people can switch to using a counter + random later if they want (or do something else with the random part). 
  
  // This id is going to be a 128 bit number so it fits naturally into memory.
  // 2 ** 128 ~= 3.4e38 is the maximum it can be
  // For efficient transmission and storage we're going to represent this number with base 36 [0-9a-z]
  // (3.4e38).toString(36) == "f55n5nmuuaw00000000000000", this is our max in base 36, 25 characters
  // Date.now() =~ 1625282091498, max without more digits is 9999999999999 == year 2286 ~ 250 years, maybe good enough
  // but we're dealing in base 36 not base 10
  // (1625282091498).toString(36) == "kqn6zrvu" (length 8)
  // Number.parseInt("zzzzzzzz", 36) == 2821109907455 == year 2059.  Way too soon so going up to 9 characters
  // Number.parseInt("zzzzzzzzz", 36) == 101559956668415 == year 5188.  
  // but the max size of 9 left most can only be "f55n5nmuu" == 42720753566838 == 3323.  That could still work but only ~ 1100 years
  // that leaves 16 characters to represent a random number to prevent collisions, 36 ** 16 ~= 8e24
  // this might be a bad idea but I'm going to allocate one more character to the time and one less to the random number
  // the reasoning is I don't want to bake in an upper limit to these numbers that is actually relatively soon in the grand scheme of things
  // now our max time is new Date(Number.parseInt('f55n5nmuua',36)) == +050705-08-09T23:40:06.178Z. 50k years from now.  THAT SHOULD WORK :)
  // We still have 15 chars for our random number. 36 ** 15 ~= 2e23
  // That is still a huge number and I think (hope) the chance of collision is still so small as to be effectively unique
  // It's also worth mentioning that it _technically_ only needs to be unique within a group.  
  // It's intended to be globally unique but knowing things can still work if ids are only unique within a group gives me a lot of comfort
  // These ids are pretty much guaranteed to be unique within a group and, in light of that, it certainly seems worth the extra character to push the max date out so far
    
  const time = Date.now().toString(36).padStart(10,'0'); // e.g: "00kq6xh45f", length == 10
  // Number.parseInt('zzzzzzzz',36).toString().length == 13, 8 digits in base 36 maps to 13 digits in base 10
  const rand1 = _.random(1e14).toString(36).padStart(8,'0').substr(0,8);
  
  // Number.parseInt('zzzzzzz',36).toString().length == 11, 7 digits in base 36 maps to 11 digits in base 10
  const rand2 = _.random(1e12).toString(36).padStart(7,'0').substr(0,7);
  return time + rand1 + rand2;
}

export function isid(id: any): boolean {
  // valid 
  //      00kqn91s56yt2gu3yf5vnbg67
  //      00kqn91s56yt2gu3yf5vnbg67:a
  //      00kqn91s56yt2gu3yf5vnbg67:a:b
  // invalid
  //      00kqn91s56yt2gu3yf5vnbg67a
  //      00kqn91s56yt2gu3yf5vnbg6
  //      00kqn91s56yt2gu3yf5vnbg67:
  //      00kqn91s56yt2gu3yf5vnbg67:a:
  //      a:00kqn91s56yt2gu3yf5vnbg67
  return Boolean(/^[0-9a-z]{25}(:[0-9a-z]+)*$/i.exec(id)) && id.length <= 128 || isid_v1(id);
};

export function idTime(id: string): number {
  const time36 = id.substr(0,10);
  return Number.parseInt(time36, 36)
}

export function idDate(id: string): Date {
  return new Date(idTime(id));
}

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

export function hashBlob(blob: Blob, progressUpdate?: ((a: number) => any), chunkSize: number = 4194304 /*4MB*/): Promise<string> {
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

export function encodeUint8ArrayToBaseN(ary: Uint8Array, radix: number = 64) {
  if (radix === 64) {
    return base64.bytesToBase64(ary);
  }
  const nums = ary.toString().split(',').map(sn => Number(sn) + radix);
  const encoded = nums.map(n => n.toString(radix)).join('');
  return encoded;
}

export function decodeUint8ArrayFromBaseN(str: string, radix: number = 64): Uint8Array {
  if (radix === 64) {
    // TODO take the try-catch out after all signatures have been converted to new format
    try {
      return base64.base64ToBytes(str);
    } catch {
      return decodeUint8ArrayFromBaseN(str, 36);
    }
  }
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
  for (var i = 0, strLen = strAry.length; i < strLen; i++) {
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
  return new Blob([buffer], { type: type });
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

export function js(jsCode: string, externalReferences?: any) {
  const hideGlobals = [
    'process', 'global'//,'setTimeout','setInterval','setImmediate','clearImmediate','clearInterval','clearTimeout'    
  ];
  const common = module.exports;
  const refNames = ['console', 'common'];
  const refValues = [console, common];
  _.keys(externalReferences).forEach(key => {
    refNames.push(key);
    refValues.push(externalReferences[key]);
  })
  const compiledJs = Function.apply(null, [...refNames, ...hideGlobals, '"use strict";  ' + jsCode.trim()]);
  return compiledJs.apply(null, refValues);
}

// must be done this way so TypeScript doesn't rewrite async keyword
export const AsyncFunction = eval('Object.getPrototypeOf(async function () { }).constructor');

export function jsAsync(jsCode: string, externalReferences: any = {}) {
  jsCode = String(jsCode).trim()
  const hideGlobals = [
    'process', 'global'//,'setTimeout','setInterval','setImmediate','clearImmediate','clearInterval','clearTimeout'    
  ];
  const utils = module.exports;
  const refNames = ['utils', 'utils_1', 'Promise', 'console'];
  const refValues = [utils, utils, Promise, console];
  _.keys(externalReferences).forEach(key => {
    refNames.push(key);
    refValues.push(externalReferences[key]);
  })
  const compiledJs = AsyncFunction.apply(null, [...refNames, ...hideGlobals, '"use strict";\n' + jsCode]);
  return compiledJs.apply(null, refValues);
}

export function toJSON(obj: any) {

  //console.log('toJSON');
  const knownObjs: any[] = [];
  const objRefs: any[] = [];
  const newObjs: any[] = [];
  let refCount = 0;

  function recurse(obj: any) {

    // stringify values
    if (Number.isNaN(obj))
      return "NaN";
    if (obj === undefined)
      return "undefined";
    if (obj === Infinity)
      return "Infinity";
    if (obj instanceof RegExp)
      return ("__REGEXP " + obj.toString());
    //   if(isDate(obj))
    //       return "__DATE " + obj.toISOString();
    if (_.isDate(obj))
      return obj.toISOString();
    if (_.isFunction(obj))
      return '__FUNCTION ' + obj.toString();
    if (_.isElement(obj)) {
      return "__HTML " + obj.outerHTML;
    }
    if (typeof window !== 'undefined' && window && obj === window) {
      return "__WINDOW";
    }
    if (_.isError(obj)) {
      return "__ERROR " + obj.stack;
    }

    // non-objects can just be returned at this point
    if (!(isObject(obj) || _.isArray(obj))) {
      return obj;
    }

    // if we've found a duplicate reference, deal with it
    var iObj = knownObjs.indexOf(obj);
    if (iObj >= 0) {
      var ref = objRefs[iObj];

      var nObj = newObjs[iObj];
      if (_.isArray(nObj) && (!_.isString(nObj[0]) || !nObj[0].match(/^__this_ref:/)))
        nObj.unshift("__this_ref:" + ref);
      else if (isObject(nObj) && !nObj.__this_ref)
        nObj.__this_ref = ref;
      return ref;
    }

    // capture references in case we need them later
    refCount++;
    var newRef = "__duplicate_ref_" + (_.isArray(obj) ? "ary_" : "obj_") + refCount;
    var nObj: (any[] | any) = _.isArray(obj) ? [] : {};
    knownObjs.push(obj);
    objRefs.push(newRef);
    newObjs.push(nObj);

    // recurse on properties
    if (_.isArray(obj))
      for (var i = 0; i < obj.length; i++)
        nObj.push(recurse(obj[i])); // use push so offset from reference capture doesn't mess things up
    else
      for (var key in obj) {
        if (!(obj && obj.hasOwnProperty && obj.hasOwnProperty(key))) continue;
        var value = recurse(obj[key]);
        if (key[0] == '$') // escape leading dollar signs
          key = '__DOLLAR_' + key.substr(1);
        nObj[key] = value;
      }
    return nObj;
  }
  obj = recurse(obj);
  return obj;
}

export function fromJSON(obj: any, externalReferences?: any) {
  //console.log('fromJSON');
  var dup_refs: any = {};

  function recurse(obj: any) {

    if (_.isString(obj)) {

      // restore values
      if (obj === "undefined")
        return undefined;
      if (obj === "NaN")
        return NaN;
      if (obj === "Infinity")
        return Infinity;
      if (obj.match(/^__REGEXP /)) {
        var m: any = obj.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
        return new RegExp(m[1], m[2] || "");
      }
      //   if(obj.match(/^__DATE /)){
      //     return new Date(obj.substr(7))
      //   }
      if (obj.match(/^\d{4}-\d{2}-\d{2}T\d{2}\:\d{2}\:\d{2}\.\d{3}Z$/)) {
        return new Date(obj)
      }
      if (obj.match(/^__FUNCTION /)) {
        //return eval('(' + obj.substring(11) + ')');
        return js(obj.substring(11), externalReferences);
      }
      if (obj.match(/^__HTML /)) {
        //@ts-ignore 
        if (typeof $ !== 'undefined') return $(obj.substring(7))[0];
        else return obj;
      }
      if (obj.startsWith("__ERROR ")) {
        let error = new Error();
        error.stack = obj.substring(8);
        return error;
      }
      if (obj === "__WINDOW") {
        return window;
      }

      // deal with duplicate refs
      if (obj.match(/^__duplicate_ref_/)) {
        if (!dup_refs[obj])
          dup_refs[obj] = obj.match(/_obj_/) ? {} : [];
        return dup_refs[obj];
      }
    }

    if (!(isObject(obj) || _.isArray(obj)))
      return obj;

    // deal with objects that have duplicate refs
    var dup_ref = null;
    obj = _.clone(obj); // don't mess up the original JSON object
    if (_.isArray(obj) && _.isString(obj[0]) && obj[0].match(/^__this_ref:/))
      dup_ref = obj.shift().split(':')[1];
    else if (obj.__this_ref) {
      dup_ref = obj.__this_ref;
      delete obj.__this_ref;
    }

    var mObj: any = _.isArray(obj) ? [] : {};
    if (dup_ref)
      if (!dup_refs[dup_ref])
        dup_refs[dup_ref] = mObj;
      else
        mObj = dup_refs[dup_ref];

    // restore keys and recurse on objects
    for (var key in obj) {
      if (!obj.hasOwnProperty(key)) continue;

      var value = recurse(obj[key]);
      if (key.match(/^__DOLLAR_/))
        key = '$' + key.substr(9);
      mObj[key] = value;
    }
    return mObj;
  }
  obj = recurse(obj);
  return obj;
}

export function stringify(obj: any): string {
  return JSON.stringify(toJSON(obj));
}

export function parseJSON(json: string): any {
  return fromJSON(JSON.parse(json));
}

export function diff(main: any, second: any) {
  const diffs: any = {};
  function diffLvl(main: any, second: any, prefix: string) {
    let names = _.union(_.keys(main), _.keys(second));
    for (let k of names) {
      const v1 = main[k];
      const v2 = second[k];
      if (!_.isEqual(v1, v2)) {
        if (typeof v1 == "object" && typeof v2 == "object") diffLvl(v1, v2, prefix + k + ".");
        else diffs[prefix + k] = [String(v1), String(v2)]
      }
    }
  }
  diffLvl(main, second, "")
  return diffs;
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// @ts-ignore
if (typeof window !== 'undefined') window.common = module.exports;
