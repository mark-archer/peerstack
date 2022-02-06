import { isObject, user } from ".";
import { connections, emit, onMessage } from "./connections";
import { getDB, IData } from "./db";
import * as remoteCalls from "./remote-calls";
import { boxDataForPublicKey, IDevice, IDataBox, openBox, verifySignedObject, IUser, signObject } from "./user";

export type INotificationStatus = 'dontShow' | 'read' | 'dismissed'

export interface INotification extends NotificationOptions, IData {
  type: 'Notification'
  title: string
  received?: number
  data?: IData
  status?: INotificationStatus
}

export const eventHandlers = {
  onNotificationReceived: (notification: INotification) => Promise.resolve(void 0)
};

async function processNotification(notification: INotification) {
  const db = await getDB();
  const dbNote = await db.get(notification.id);
  if (dbNote) {
    return false;
  }
  const sender: IUser = await db.get(notification.signer);
  verifySignedObject(notification, sender.publicKey);
  if (isObject(notification.data)) {
    await db.save(notification.data);
    notification.subject = notification.data.id;
    delete notification.data;
  }
  notification.ttl = Date.now() + (1000 * 60 * 60 * 24 * 14) // 14 days
  notification.group = await user.init(); // put all notifications in my personal group
  notification.received = Date.now();
  signObject(notification);
  await db.save(notification);
  eventHandlers.onNotificationReceived(notification);
  if (notification.dontShow) {
    return false;
  }
  // TODO this should maybe be reduced to notification id and subject
  notification.data = JSON.parse(JSON.stringify(notification));
  return true;
}

onMessage('notify', (message: string) => {
  const box: IDataBox = JSON.parse(message);
  openBox(box).then((notification: INotification) => {
    notify(notification);
  })
});

export async function notify(notification: INotification) {
  try {
    const shouldShow = await processNotification(notification);
    if (shouldShow) {
      // This may not work on android? 
      const n = new Notification(notification.title, notification);
    }    
  } catch (err) {
    console.error('Error processing notification', notification, err);
  }
}

remoteCalls.remotelyCallableFunctions.notify = notify;

export async function notifyDevice(device: IDevice, notification: INotification, toPublicBoxKey: string) {
  signObject(notification);
  
  // check if we have a connection to the device, if so just send through that
  const conn = connections.find(c => c.remoteDeviceId === device.id);
  if (conn) {
    await remoteCalls.RPC(conn, notify)(notification);
    return true;
  }

  // check if we have a web-push subscription, if so use that
  const messageId = notification.id;
  const box = boxDataForPublicKey(notification, toPublicBoxKey);
  const message = JSON.stringify(box);
  // Note that the server may push the notification through socket.io if available
  const result = await emit('notify', { device, messageId, message })
  console.log('notifyDevice result', result)
  return result === 'success';  
}

export interface INotificationPart {
  id: string
  type: 'NotificationPart'
  partNum: number
  totalParts: number
  data: string
  ttl: number
}

const notificationPartsCache: { [partId: string]: INotificationPart } = {};

const buildPartId = (id, partNum) => `${id}:part${partNum}`;

async function getNotificationPart(id: string, partNum: number) {
  const partId = buildPartId(id, partNum);
  if (!notificationPartsCache[partId]) {
    const db = await getDB();
    notificationPartsCache[partId] = await db.local.get(partId);
  }
  return notificationPartsCache[partId];
}

export async function processWebPushNotification(serviceWorkerSelf: any, notification: string) {
  if (notification.startsWith('part:')) {
    // ex `part:1,5,{id}:qwerty....`
    const iColon = notification.indexOf(':', 6);
    const metaData = notification.substring(0, iColon);
    const [_partNum, _totalParts, id] = metaData.replace("part:", '').split(',');
    const [partNum, totalParts] = [_partNum, _totalParts].map(s => Number(s));
    const partId = buildPartId(id, partNum);
    const data = notification.substring(iColon+1);
    const part: INotificationPart = {
      id: partId, 
      type: 'NotificationPart',
      partNum, 
      totalParts,
      data, 
      ttl: Date.now() + (1000 * 60 * 60 * 24 * 14) // 14 days
    };
    notificationPartsCache[partId] = part;
    const parts: INotificationPart[] = [];
    const db = await getDB();
    for (let iPart = 1; iPart <= totalParts; iPart++) {
      const _part = await getNotificationPart(id, iPart);
      if (!_part) {
        await db.local.save(part);
        return;
      }
      parts.push(_part);
    }
    await Promise.all(parts.map(p => db.local.delete(p.id)));
    notification = parts.map(p => p.data).join('');
  }
  await user.init();
  const box: IDataBox = JSON.parse(notification);
  const notificationHydrated: INotification = await openBox(box);
  const shouldShow = await processNotification(notificationHydrated);
  if (shouldShow) {
    serviceWorkerSelf.registration.showNotification(notificationHydrated.title, notificationHydrated);
  }
  const clients = await serviceWorkerSelf.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });
  clients.forEach(client => {
    client.postMessage(notificationHydrated);
  });
}


