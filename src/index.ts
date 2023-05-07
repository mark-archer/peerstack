import { connections, deviceId } from './connections';
import { commitChange, IDataChange } from './data-change';
import { pushDataChange } from './data-sync';
import { getDB, getGroupUsers, hasPermission, IData } from './db';
import { dataChangeToNotification, notifyDevice } from './notifications';
import { registerServiceWorker } from './register-service-worker';
import { RPC } from './remote-calls';
import { signObject } from './user';

export * from './common';
// export * as connectionsServer from './connections-server'
export * as connections from './connections';
export * as db from './db';
export * as remoteCalls from './remote-calls';
export * as remoteFiles from './remote-files';
export * as notifications from './notifications';
export * as invitations from './invitations';
export * as user from './user';
export * as serviceWorker from './service-worker';
export * as dataChange from "./data-change";
export * as dataSync from "./data-sync";
export * as events from "./events";

export { registerServiceWorker };

/*
  This is meant to be the primary mechanism to save data moving forward.
  With one call we save the data to the db, push to connected peers, then web-push to disconnected peers.
*/
export async function saveDataAndPushToPeers(data: IData, preserveModified = false) {
  const changes = await commitChange(data, { preserveModified })

  for (const change of changes) {
    // we don't want this client waiting for the push to peers
    pushChangeToPeers(change);
  }

  return data;
}

/*
  NOTE this is very similar to notifications.pushDataAsNotification but there are some important differences and optimizations so this is preferred
*/
export async function pushChangeToPeers(change: IDataChange) {
  // first - push to all active connections that have read access to group
  //  this is good because it starts propagating data as quickly as possible without any servers
  //  this will also pushes to users that aren't returned by `getGroupUsers` (e.g. users that have subscribed to public groups)
  const db = await getDB();
  for (const connection of connections()) {
    if (
      connection.remoteUserVerified &&
      // TODO connection.groups isn't apparently set, figure out why
      // connection.groups?.includes(change.group) && 
      await hasPermission(connection.remoteUser?.id, change.group, 'read', db)
    ) {
      // don't need to await each peer connection push
      RPC(connection, pushDataChange)(change)
        .catch(err => console.error("Error pushing data via peer connection", err));
    }
  }

  // second - push data via web-push to all explicit group members's devices that aren't currently connected
  //  this is particularly good for getting data to mobile devices which don't keep open connections
  const notification = dataChangeToNotification(change);
  signObject(notification);
  const groupUsers = await getGroupUsers(change.group);
  for (const user of groupUsers) {
    for (const device of Object.values(user.devices || {})) {
      if (
        device.id !== deviceId &&
        !connections().some(c => c.remoteDeviceId === device.id)
      ) {
        // _DO_ await pushes through server so we're not slamming it all at once
        await notifyDevice(device, notification, user.publicBoxKey)
          .catch(err => console.error("Error pushing data via server/web-push", err));
      }
    }
  }
}
