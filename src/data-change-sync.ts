import { groupBy, set } from "lodash";
import { hashObject } from "./common";
import { getDB, getGroupUsers } from "./db";


export const BLOCK_SIZE = 60e3 * 60 * 24; // 1 day

export function getBlockId(modified: number) {
  return 'B' + Math.floor(modified / BLOCK_SIZE);
}

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

// export async function getBlockHashData(group: string, level0BlockId: string): Promise<{ id: string, modified: number }[]> {
//   if (level0BlockId === 'users') {
//     return getGroupUsers(group);
//   }
//   const db = await getDB();
//   const blockNum = Number(level0BlockId.substring(1));
//   const lowerTime = blockNum * BLOCK_SIZE;
//   const upperTime = lowerTime + BLOCK_SIZE;
//   // const blockData = await db.find({ lower: [group, lowerTime], upper: [group, upperTime] }, 'group-modified');
//   const cursor = await db.changes.openCursor(group, lowerTime);
//   const blockData: { id: string, modified: number }[] = [];
//   while (await cursor.next() && cursor.value.modified < upperTime) {
//     blockData.push({ id: cursor.value.id, modified: cursor.value.modified });
//   }
//   return blockData;
// }

export const L5BlockHashes: {
  [groupId: string]: { [blockId: string]: string }
} = {};

export const blockHashes: {
  [groupId: string]: {
    [detailLevel: string]: { [blockId: string]: string }
  }
} = {};

export function clearHashCache(groupId: string) {
  // TODO this could be done much cleaner by sending in the old and new L5 block id (old and new modified date)
  //      Then all you have to do is recalculate the old and new block which should be much faster
  if (groupId === 'users') {
    // if a user is changed just clear the entire cache for now
    Object.keys(L5BlockHashes).forEach(_groupId => {
      delete L5BlockHashes[_groupId]['users']
      delete blockHashes[groupId]
    })
  } else {
    delete L5BlockHashes[groupId];
    delete blockHashes[groupId]
  }
}

// l0BlockId example: B18664 | users
export async function getBlockHashes(groupId: string, detailLevel: number = 0) {
  if (detailLevel > 5) {
    // level 0 is the top level hash, level 5 is the most detailed hash
    detailLevel = 5;
  }
  if (blockHashes[groupId]?.[detailLevel]) {
    return blockHashes[groupId][detailLevel];
  }
  if (detailLevel === 5) {
    const _blockHashes = await getDetailHashes(groupId) as any as { [blockId: string]: string }
    set(blockHashes, `${groupId}.${detailLevel}`, _blockHashes);
    return _blockHashes;
  } else {
    const nextLevel = await getBlockHashes(groupId, detailLevel + 1);
    const keyed = Object.entries(nextLevel).map(([blockId, hashes]) => ({
      blockId,
      hashes
    }))
    const grouped = groupBy(keyed, data => data.blockId.substr(0, data.blockId.length - 1) || 'u');
    const _blockHashes = {};
    Object.keys(grouped).forEach(key => {
      set(_blockHashes, key, hashObject(grouped[key]));
    });
    set(blockHashes, `${groupId}.${detailLevel}`, _blockHashes);
    return _blockHashes;
  }
}

// export async function getBlockIdHashes(groupId: string, blockId: string) {
//   const detailLevel = blockId.length || 1;
//   const blockHashes = await getBlockHashes(groupId, detailLevel)
//   const blockIdHashes: { [blockId: string]: string } = {}
//   Object.keys(blockHashes).forEach(key => {
//     if (key.startsWith(blockId)) {
//       blockIdHashes[key] = blockHashes[key];
//     }
//   })
//   return blockIdHashes;
// }

let getDetailHashPromises: { [groupId: string]: Promise<{ [blockId: string]: string; }>} = {};

export function getDetailHashes(groupId: string) {
  if (L5BlockHashes[groupId]) {
    return L5BlockHashes[groupId];
  }
  if (!getDetailHashPromises[groupId]) {
    getDetailHashPromises[groupId] = new Promise(async resolve => {
      const db = await getDB();
      const cursor = await db.openCursor({ lower: [groupId, -Infinity], upper: [groupId, Infinity] }, 'group-modified');
      const data: { id: string, modified: number }[] = [];
      let blockId: string = "";
      let blockUpperModified = -Infinity;
      const hashes: { [blockId: string]: string } = {};
      while(await cursor.next()) {
        const doc = cursor.value;
        if (blockUpperModified < doc.modified) {
          if (data.length) {
            hashes[blockId] = hashObject(data);
            data.length = 0;
          }
          blockId = getBlockId(doc.modified);
          blockUpperModified = getBlockRange(blockId).max;
        }
        data.push({ id: doc.id, modified: doc.modified });
      }
      if (data.length) {
        hashes[blockId] = hashObject(data);
      }
      L5BlockHashes[groupId] = hashes;
      resolve(hashes);
      delete getDetailHashPromises[groupId];
    });
  }
  return getDetailHashPromises[groupId];
}
