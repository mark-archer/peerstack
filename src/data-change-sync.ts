import { set, uniq } from "lodash";
import { hashObject } from "./common";
import { getDB } from "./db";


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

export const invalidatedBlockIds: { [groupId: string]: { [blockId: string]: true } } = {};

function invalidateCacheForModified(groupId: string, modified: number) {
  let blockId = getBlockId(modified);
  // invalidatedBlockIds[groupId][blockId] = true;
  set(invalidatedBlockIds, `${groupId}.${blockId}`, true);
}

export function invalidateCache(groupId: string, modified: number, oldModified?: number) {
  if (groupId === 'users') {
    // users are synced in a different way so we don't need to worry about maintaining the cache for them
    // NOTE: I'm not sure this is true, we do sync users for the group but I think we're sending partial changes for users so the users' aren't signed which is no good
    return;
  }
  invalidateCacheForModified(groupId, modified);
  if (oldModified) {
    invalidateCacheForModified(groupId, oldModified);
  }
}

export const prefixHashDetails: {
  [groupId: string]: {
    [prefix: string]: {
      [subPrefix: string]: string
    }
  }
} = {};

export async function populateGroupHashes(groupId: string) {
  let blockIds: string[];
  let blockIdHashes: { [blockId: string]: string };
  if (!prefixHashDetails[groupId]) {
    // initial populate
    blockIdHashes = await getDetailHashes(groupId);
    blockIds = Object.keys(blockIdHashes);
    invalidatedBlockIds[groupId] = {};
  } else {
    // recompute any invalidated blockIds
    // TODO theoretically there could be a situation where we don't want to repopulate _all_ invalidated blockIds
    blockIds = Object.keys(invalidatedBlockIds[groupId]);
    blockIdHashes = {};
    invalidatedBlockIds[groupId] = {};
    for (const blockId of blockIds) {
      blockIdHashes[blockId] = (await getDetailHashes(groupId, blockId))[blockId];
    }
  }
  let parents: string[] = [];
  for (const blockId of blockIds) {
    const hash = blockIdHashes[blockId];
    const parent = blockId.substring(0, blockId.length - 1);
    parents.push(parent);
    if (hash) {
      set(prefixHashDetails, `${groupId}.${parent}.${blockId}`, hash);
    } else {
      delete prefixHashDetails?.[groupId]?.[parent]?.[blockId];
    }
  }
  while (parents.length) {
    const prefixes = uniq(parents);
    parents.length = 0;
    for (const prefix of prefixes) {
      const parent = prefix.substring(0, prefix.length - 1);
      if (!parent) break;
      parents.push(parent);
      const hashDetails = prefixHashDetails[groupId][prefix];
      if (Object.keys(hashDetails).length > 0) {
        const hash = hashObject(hashDetails);
        set(prefixHashDetails, `${groupId}.${parent}.${prefix}`, hash);
      } else {
        delete prefixHashDetails[groupId]?.[parent]?.[prefix];
      }
    }
  }
  // console.log(prefixHashDetails[groupId])
}

export async function getPrefixHashes(groupId: string, blockPrefix = 'B'): Promise<{ [subPrefix: string]: string }> {
  await populateGroupHashes(groupId);
  let hashes = prefixHashDetails[groupId]?.[blockPrefix] ?? {};
  // if (!hashes) ...
  let prefixes: string[] = Object.keys(hashes);
  while (prefixes.length === 1 && prefixes[0].length < 9) {
    hashes = prefixHashDetails[groupId][prefixes[0]];
    prefixes = Object.keys(hashes);
  }
  return hashes;
}

let getDetailHashPromises: { [promiseId: string]: Promise<{ [blockId: string]: string; }> } = {};

export function getDetailHashes(groupId: string, blockId_?: string) {
  const promiseId = `${groupId}-${blockId_ || "all"}`;
  if (!getDetailHashPromises[promiseId]) {
    getDetailHashPromises[promiseId] = new Promise(async resolve => {
      const minModified = getBlockRange(blockId_ || MIN_BLOCK_ID).min;
      const maxModified = getBlockRange(blockId_ || MAX_BLOCK_ID).max;
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

export async function getBlockChangeInfo(groupId: string, blockId: string) {
  const range = getBlockRange(blockId);
  const minModified = range.min;
  const maxModified = range.max;
  const db = await getDB();
  const cursor = await db.changes.openCursor(groupId, minModified);
  const data: { id: string, modified: number}[] = [];
  while (await cursor.next()) {
    const change = cursor.value;
    if (change.modified > maxModified) {
      break;
    }
    data.push({ id: cursor.value.id, modified: cursor.value.modified });
  }
  return data;
}