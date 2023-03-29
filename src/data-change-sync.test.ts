import 'should';
import { hashObject } from './common';
import { commitChange } from './data-change';
import { BLOCK_SIZE, getBlockId, getDetailHashes } from './data-change-sync';
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
          {id: c1_1.id, modified: m1 },
          {id: c2_1.id, modified: m1 },
        ]),
        [b2]: hashObject([ 
          {id: c1_2.id, modified: m2 },
          {id: c2_2.id, modified: m2 },
        ]),
      });
    });

  });


})