import { groupBy, set, sortBy } from "lodash";
import { hashObject } from "./common";
import { getDB, getGroupUsers } from "./db";


export const BLOCK_SIZE = 60e3 * 60 * 24; // 1 day

// d = new Date('+050705-08-09T23:40:06.178Z')
// d.getTime() === 1537947128406178
// Math.floor(1537947128406178 / BLOCK_SIZE) === 17800313
// max block number: 17800313 => 
// fixed block id length is 8 digits preceded by a 'B' => 9 chars
const BLOCK_ID_LENGTH = 8;

export function getBlockId(modified: number) {
  return 'B' + String(Math.floor(modified / BLOCK_SIZE)).padStart(BLOCK_ID_LENGTH, "0");
}

const MIN_BLOCK_ID = getBlockId(0);
const MAX_BLOCK_ID = getBlockId(1537947128406178);

export function getBlockRange(blockId: string) {
  if (blockId === 'users') {
    return {
      min: -Infinity,
      max: Infinity,
    }
  }
  const blockNum = Number(blockId.substring(1));
  const min = blockNum * BLOCK_SIZE;
  return {
    min,
    max: min + BLOCK_SIZE,
  }
}

export const prefixHashes: {
  [groupId: string]: {
    [prefixLength: string]: {
      [blockPrefix: string]: string | false
    }
  }
} = {};

function invalidateCacheForModified(groupId: string, modified: number) {
  let blockPrefix = getBlockId(modified);
  const groupPrefixes = prefixHashes[groupId];
  if (groupPrefixes) {
    while (blockPrefix.length > 1) {
      blockPrefix = blockPrefix.substring(0, blockPrefix.length - 2);    
      groupPrefixes[blockPrefix.length.toString()][blockPrefix] = false;
    }
  }
}

export function invalidateCache(groupId: string, modified: number, oldModified?: number) {
  if (groupId === 'users') {
    throw new Error('not implemented');
  }
  invalidateCacheForModified(groupId, modified);
  if (oldModified) {
    invalidateCacheForModified(groupId, oldModified);
  }
}

export async function getPrefixHashes(groupId: string, blockPrefix = 'B'): Promise<{ [subPrefix: string]: string }> {
  if (!prefixHashes[groupId]) {
    prefixHashes[groupId] = await getDetailHashes(groupId);
    const hashes = prefixHashes[groupId];
    for (let key of Object.keys(hashes)) {
      while(key.length > 1) {
        key = key.substring(0, key.length - 1);
        hashes[key] = false;
      }
    }
  }

  if (blockPrefix.length === 9) {
    return { [blockPrefix]: await getPrefixHash(groupId, blockPrefix) }
  }

  const groupHashes = prefixHashes[groupId];
  const hashes: { [subPrefix: string]: string } = {};
  for (let i = 0; i < 10; i++) {
    const childKey = blockPrefix + i;
    let hash = groupHashes[childKey];
    if (typeof hash === 'string') {
      hashes[childKey] = hash;
    } else if (hash === false) {
      hashes[childKey] = await getPrefixHash(groupId, childKey);
    }
  }
  const keys = Object.keys(hashes);
  if (keys.length === 1 && keys[0].length < 9) {
    return getPrefixHashes(groupId, Object.keys(hashes)[0]);
  }
  return hashes;
}

async function getPrefixHash(groupId: string, blockPrefix = 'B'): Promise<string> {
  // Note this function assumes initial hash values have been computed so all prefixes are known
  const groupHashes = prefixHashes[groupId];
  let prefixHash = groupHashes[blockPrefix];
  if (prefixHash) {
    return prefixHash;
  }

  if (blockPrefix.length === 9) {
    const detailHashes = await getDetailHashes(groupId, blockPrefix)
    const hash = hashObject(Object.values(detailHashes));
    groupHashes[blockPrefix] = hash;
    return hash;
  }

  const hashes: { [subPrefix: string]: string } = {};
  for (let i = 0; i < 10; i++) {
    const childKey = blockPrefix + i;
    let hash = groupHashes[childKey];
    if (typeof hash === 'string') {
      hashes[childKey] = hash;
    } else if (hash === false) {
      hashes[childKey] = await getPrefixHash(groupId, childKey);
    }
  }
  const hash = hashObject(hashes);
  groupHashes[blockPrefix] = hash;
  return hash;
}

let getDetailHashPromises: { [promiseId: string]: Promise<{ [blockId: string]: string; }> } = {};

export function getDetailHashes(groupId: string, blockPrefix?: string) {
  const promiseId = `${groupId}-${blockPrefix || "all"}`;
  if (!getDetailHashPromises[promiseId]) {
    getDetailHashPromises[promiseId] = new Promise(async resolve => {
      const minModified = getBlockRange(blockPrefix || MIN_BLOCK_ID).min;
      const maxModified = getBlockRange(blockPrefix || MAX_BLOCK_ID).max;
      const db = await getDB();
      const cursor = await db.changes.openCursor(groupId, minModified);
      const data: { id: string, modified: number }[] = [];
      let blockId: string = "";
      let blockUpperModified = -Infinity;
      const hashes: { [blockId: string]: string } = {};
      while (await cursor.next()) {
        const change = cursor.value;
        if (change.modified > maxModified) {
          break;
        }
        if (blockUpperModified < change.modified) {
          if (data.length) {
            hashes[blockId] = hashObject(data);
            data.length = 0;
          }
          blockId = getBlockId(change.modified);
          blockUpperModified = getBlockRange(blockId).max;
        }
        data.push({ id: change.id, modified: change.modified });
      }
      if (data.length) {
        hashes[blockId] = hashObject(data);
      }
      resolve(hashes);
      delete getDetailHashPromises[promiseId];
    });
  }
  return getDetailHashPromises[promiseId];
}
