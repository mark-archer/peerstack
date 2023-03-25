import 'should';
import { hashObject } from './common';
import { commitChange } from './data-change';
import { getBlockId, getDetailHashes } from './data-change-sync';
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
    // await db.save(myGroup)
    await commitChange(myGroup);
  });


  describe("getDetailHashes", () => {
    test("returns the same promise for simultaneous calls", async () => {
      const promise = getDetailHashes(me.id);
      const promise2 = getDetailHashes(me.id);
      expect(promise).toBe(promise2);
    });

    test("hashes a single object", async () => {
      const detailHashes = await getDetailHashes(myGroup.id);
      const blockId = getBlockId(myGroup.modified);
      expect(detailHashes).toEqual({
        [blockId]: hashObject([{ id: myGroup.id, modified: myGroup.modified }]),
      });
    });

  });


})