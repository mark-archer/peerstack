import 'should';
import { hashObject } from './common';
import { commitChange, IDataChange } from './data-change';
import { BLOCK_SIZE, getBlockId, getDetailHashes, getPrefixHashes, invalidateCache } from './data-change-sync';
import { IDB, IGroup } from './db';
import { initDBWithMemoryMock } from "./db-mock.test";
import { init as initUser, newData, newGroup, newUser, signObject, signObjectWithIdAndSecretKey } from './user';

describe("data-change-sync", () => {

  const me = newUser('me');
  const peer = newUser('peer');
  let myGroup: IGroup;
  let db: IDB;
  beforeAll(async () => {
    db = await initDBWithMemoryMock()
    await initUser(me);
    signObject(me);
    await db.save(me);
    const dbPeer = { ...peer, secretKey: undefined };
    signObjectWithIdAndSecretKey(dbPeer, peer.id, peer.secretKey);
    await db.save(dbPeer);
    myGroup = newGroup();
    signObject(myGroup);
    await commitChange(myGroup);
  });

  describe("getBlockId", () => {
    test("min block id", () => {
      const minBlockId = getBlockId(0);
      expect(minBlockId).toBe("B00000000")
    });

    test("block id 1", () => {
      const minBlockId = getBlockId(BLOCK_SIZE);
      expect(minBlockId).toBe("B00000001")
    });

    test("block id 2", () => {
      const minBlockId = getBlockId(BLOCK_SIZE * 2);
      expect(minBlockId).toBe("B00000002")
    });

    test("max block id", () => {
      const maxDate = new Date('+050705-08-09T23:40:06.178Z');
      const maxTime = maxDate.getTime();
      expect(maxTime).toBe(1537947128406178);
      const maxBlockId = getBlockId(maxTime);
      expect(maxBlockId).toBe("B17800313")
    });
  });

  describe("getDetailHashes", () => {
    test("returns the same promise for simultaneous calls", async () => {
      const promise = getDetailHashes(me.id);
      const promise2 = getDetailHashes(me.id);
      expect(promise).toBe(promise2);
    });

    test("hash for single change in a group", async () => {
      const groupChanges = await db.changes.getSubjectChanges(myGroup.id);
      expect(groupChanges.length).toEqual(1);
      const groupChange = groupChanges[0];
      expect(groupChange.modified).toEqual(myGroup.modified);
      const detailHashes = await getDetailHashes(myGroup.id);
      const blockId = getBlockId(groupChange.modified);
      expect(detailHashes).toEqual({
        [blockId]: hashObject([{ id: groupChange.id, modified: groupChange.modified }]),
      });
    });

    test("hashes for changes across multiple blocks", async () => {
      const m1 = Date.now() / 4;
      const m2 = m1 * 2;
      const d1 = newData({ group: myGroup.id, name: 'd1', v: 1 });
      d1.modified = m1
      await commitChange(d1, { preserveModified: true });
      d1.v = 2;
      d1.modified = m2;
      await commitChange(d1, { preserveModified: true });
      const [c1_1, c1_2] = await db.changes.getSubjectChanges(d1.id);

      const d2 = newData({ group: myGroup.id, name: 'd2', v: 1 });
      d2.modified = m1;
      await commitChange(d2, { preserveModified: true });
      d2.v = 2;
      d2.modified = m2;
      await commitChange(d2, { preserveModified: true });
      const [c2_1, c2_2] = await db.changes.getSubjectChanges(d2.id);

      const detailHashes = await getDetailHashes(myGroup.id);
      const b1 = getBlockId(m1);
      const b2 = getBlockId(m2);
      expect(detailHashes).toMatchObject({
        [b1]: hashObject([
          { id: c1_1.id, modified: m1 },
          { id: c2_1.id, modified: m1 },
        ]),
        [b2]: hashObject([
          { id: c1_2.id, modified: m2 },
          { id: c2_2.id, modified: m2 },
        ]),
      });
    });

  });

  describe("getPrefixHashes", () => {
    let myGroup: IGroup;
    let myGroupChange: IDataChange;
    beforeEach(async () => {
      myGroup = newGroup();
      myGroup.modified = Math.round(Date.now() / 4);
      signObject(myGroup);
      await commitChange(myGroup, { preserveModified: true });
      myGroupChange = (await db.changes.getSubjectChanges(myGroup.id))[0];
    });

    test("when single change exists, return the hash of all details", async () => {
      const groupChanges = await db.changes.getSubjectChanges(myGroup.id);
      expect(groupChanges.length).toEqual(1);
      const groupChange = groupChanges[0];
      expect(groupChange.modified).toEqual(myGroup.modified);
      const detailHashes = await getDetailHashes(myGroup.id);
      const prefixHashes = await getPrefixHashes(myGroup.id);
      const blockId = getBlockId(groupChange.modified);
      expect(prefixHashes).toMatchObject({
        [blockId.substring(0, 8)]: hashObject(detailHashes),
        [blockId]: hashObject([{ id: groupChange.id, modified: groupChange.modified }]),
      });
    })

    test("return all prefixes until there are two or more prefixes at the same detail level", async () => {
      const m2 = myGroup.modified;
      const m1 = m2 / 2;
      const d1 = newData({ group: myGroup.id, name: 'd1', v: 1 });
      d1.modified = m1
      await commitChange(d1, { preserveModified: true });
      d1.v = 2;
      d1.modified = m2;
      await commitChange(d1, { preserveModified: true });
      const [c1_1, c1_2] = await db.changes.getSubjectChanges(d1.id);

      const d2 = newData({ group: myGroup.id, name: 'd2', v: 1 });
      d2.modified = m1;
      await commitChange(d2, { preserveModified: true });
      d2.v = 2;
      d2.modified = m2;
      await commitChange(d2, { preserveModified: true });
      const [c2_1, c2_2] = await db.changes.getSubjectChanges(d2.id);

      const b1 = getBlockId(m1);
      const b2 = getBlockId(m2);

      let iCharDiff = 0;
      while (b1[iCharDiff] === b2[iCharDiff]) iCharDiff++;

      const prefixHashes = await getPrefixHashes(myGroup.id);

      let prefixes = Object.keys(prefixHashes)
      prefixes = prefixes.filter(p => prefixes.filter(p2 => p2.startsWith(p)).length < 2);
      expect(prefixes.length).toBe(2);
      const prefix1 = prefixes[0];
      const prefix2 = prefixes[1];
      expect(b1.startsWith(prefix1) || b1.startsWith(prefix2)).toBeTruthy();
      expect(b2.startsWith(prefix1) || b2.startsWith(prefix2)).toBeTruthy();
      expect(prefix1.length).toBe(iCharDiff + 1);
      expect(prefix2.length).toBe(iCharDiff + 1);

      const hashes1 = await getPrefixHashes(myGroup.id, prefix1);
      const hashes2 = await getPrefixHashes(myGroup.id, prefix2);

      const hashes1Details = await getDetailHashes(myGroup.id, b1);
      const hashes2Details = await getDetailHashes(myGroup.id, b2);

      expect(hashes1).toMatchObject(hashes1Details);
      expect(hashes2).toMatchObject(hashes2Details);

      expect(hashes1).toMatchObject({
        [b1]: hashObject([
          { id: c1_1.id, modified: m1 },
          { id: c2_1.id, modified: m1 },
        ]),
      });

      expect(hashes2).toMatchObject({
        [b2]: hashObject([
          { id: myGroupChange.id, modified: m2 },
          { id: c1_2.id, modified: m2 },
          { id: c2_2.id, modified: m2 },
        ]),
      });
    });

    test("correctly recalculates all prefix hashes when data changes", async () => {
      const groupChanges = await db.changes.getSubjectChanges(myGroup.id);
      const groupChange = groupChanges[0];
      const prefixHashes = await getPrefixHashes(myGroup.id);
      const blockId = getBlockId(groupChange.modified);
      expect(prefixHashes).toMatchObject({
        [blockId]: hashObject([{ id: groupChange.id, modified: groupChange.modified }]),
      });
      myGroup.name = "new name";
      myGroup.modified++;
      await commitChange(myGroup, { preserveModified: true });
      const groupChange2 = (await db.changes.getSubjectChanges(myGroup.id))[1];
      const prefixHashes2 = await getPrefixHashes(myGroup.id);
      expect(prefixHashes2).toMatchObject({
        [blockId]: hashObject([
          { id: groupChange.id, modified: groupChange.modified },
          { id: groupChange2.id, modified: groupChange2.modified },
        ]),
      });
    })

    test("correctly recalculates prefixes that no longer have underlying data", async () => {
      const groupChanges = await db.changes.getSubjectChanges(myGroup.id);
      const groupChange = groupChanges[0];
      const prefixHashes = await getPrefixHashes(myGroup.id);
      const blockId = getBlockId(groupChange.modified);
      expect(prefixHashes).toMatchObject({
        [blockId]: hashObject([{ id: groupChange.id, modified: groupChange.modified }]),
      });

      myGroup.name = "new name";
      myGroup.modified = Date.now();
      await commitChange(myGroup, { preserveModified: true });
      await db.changes.delete(groupChange.id);
      invalidateCache(myGroup.id, groupChange.modified);

      const blockId2 = getBlockId(myGroup.modified);
      // const sTime = Date.now();
      const prefixHashes2 = await getPrefixHashes(myGroup.id);
      // const eTime = Date.now();
      // console.log(`getPrefixHashes recalc - ${eTime-sTime}ms`);
      // expect(eTime-sTime).toBeLessThan(10);
      const prefixes = Object.keys(prefixHashes2);
      expect(prefixes.includes(blockId)).toBeFalsy();
      expect(prefixes.includes(blockId2)).toBeTruthy();
    })
  });

})