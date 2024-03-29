import { errorAfterTimeout, isObject, user } from ".";
import { deviceConnections, deviceId, emit, onMessage } from "./connections";
import { getDB, IData } from "./db";
import * as dataSync from "./data-sync";
import * as remoteCalls from "./remote-calls";
import { boxDataForPublicKey, IDevice, IDataBox, openBox, IUser, signObject, verifySigner } from "./user";
import { newid } from "./common";
import { IDataChange, ingestChange } from "./data-change";
import { Event } from "./events";

export type INotificationStatus = 'read' | 'dismissed'

export interface INotification extends NotificationOptions, IData {
  type: 'Notification'
  title: string
  received?: number
  change?: IDataChange
  status?: INotificationStatus
  dontShow?: boolean
}

export function dataChangeToNotification(change: IDataChange): INotification {
  const notification: INotification = {
    type: 'Notification',
    id: newid(),
    group: change.group,
    modified: Date.now(),
    title: '',
    change,
    dontShow: true
  };
  return notification;
}

export const events = {
  notificationReceived: new Event<INotification>('NotificationReceived'),
  notificationClicked: new Event<INotification>('NotificationClicked'),
}

const seenNotificationIds: string[] = []

async function processNotification(notification: INotification): Promise<boolean> {
  if (seenNotificationIds.includes(notification.id)) {
    return false;
  }
  seenNotificationIds.push(notification.id);
  const db = await getDB();
  const dbNote = await db.get(notification.id);
  if (dbNote) {
    return false;
  }
  await verifySigner(notification);
  if (isObject(notification.change)) {
    const data = await ingestChange(notification.change);
    if (data) {
      dataSync.events.remoteDataSaved.emit(data);
    }
    notification.subject = notification.change.id;
    delete notification.change;
  }
  notification.ttl = Date.now() + (1000 * 60 * 60 * 24 * 14); // 14 days
  notification.group = await user.init(); // put all notifications in my personal group
  notification.received = Date.now();
  signObject(notification);
  await db.save(notification);
  const result = await events.notificationReceived.emit(notification);
  if (!result) {
    console.error('emitting notification received returned false');
  }
  if (notification.dontShow || notification.status) {
    return false;
  }
  notification.data = { id: notification.id, subject: notification.subject };
  return true;
}

onMessage('notify', (message: string) => {
  const box: IDataBox = JSON.parse(message);
  openBox(box).then((notification: INotification) => {
    receiveNotification(notification);
  })
});

export async function receiveNotification(notification: INotification) {
  try {
    const shouldShow = await processNotification(notification);
    if (shouldShow) {
      const serviceWorker = await navigator?.serviceWorker?.ready;
      if (serviceWorker) {
        serviceWorker.showNotification(notification.title, notification);
      } else {
        // This doesn't work on android
        const n = new Notification(notification.title, notification);
        n.onclick = (evt) => {
          events.notificationClicked.emit(notification);
        }
      }
    }
  } catch (err) {
    console.error('Error processing notification', notification, err);
  }
}

remoteCalls.setRemotelyCallableFunction(receiveNotification);

export async function notifyUsers(users: IUser[], notification: INotification) {
  for (const user of users) {
    for (const device of Object.values(user.devices || {})) {
      notifyDevice(device, notification, user.publicBoxKey);
    }
  }
}

export async function notifyDevice(device: IDevice, notification: INotification, toPublicBoxKey: string) {
  if (deviceId === device.id) {
    console.warn('not notifying device because remote device is the same as local device');
    return;
  }
  try {
    if (!notification.signature) {
      signObject(notification);
    }

    // check if we have a connection to the device, if so just send through that
    const conn = deviceConnections[device.id];
    if (conn) {
      try {
        await errorAfterTimeout(
          remoteCalls.RPC(conn, receiveNotification)(notification),
          2000
        )
        return;
      } catch (err) {
        console.log('failed to send notification through peer connection', err);
      }
    }

    // check if we have a web-push subscription, if so use that
    if (!toPublicBoxKey) {
      console.warn('not notifying device because no public key was given', { device, notification, toPublicBoxKey });
      return;
    }    
    const messageId = notification.id;
    const box = boxDataForPublicKey(notification, toPublicBoxKey);
    const message = JSON.stringify(box);
    if (message.length > 30e3) {
      console.warn(`not sending notification because it's greater than 30k characters which will require 10 or more individual web-push notifications`);
      return false;
    }
    // Note that the server may push the notification through socket.io if connection available
    const result = await emit('notify', { device, messageId, message })
    console.log('notifyDevice result', result)
    return result === 'success';
  } catch (err) {
    console.log('Error notifying device: ', err)
    return false;
  }
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
    // ex `part:1,5,{id}:gibberish....`
    const iColon = notification.indexOf(':', 6);
    const metaData = notification.substring(0, iColon);
    const [_partNum, _totalParts, id] = metaData.replace("part:", '').split(',');
    const [partNum, totalParts] = [_partNum, _totalParts].map(s => Number(s));
    const partId = buildPartId(id, partNum);
    const data = notification.substring(iColon + 1);
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

if (typeof navigator !== 'undefined') {
  navigator?.serviceWorker?.addEventListener('message', async event => {
    const data: { type: string, [key: string]: any } = event.data;
    if (data?.type === 'Notification') {
      const notification = data as INotification;
      events.notificationReceived.emit(notification);
      if (notification.subject) {
        const db = await getDB();
        const _data = await db.get(notification.subject);
        if (_data) {
          // I'm not sure why this is here but it looks pretty intentional 
          //    I suspect this is so event will be emitted in the "main" app thread instead of the background worker
          dataSync.events.remoteDataSaved.emit(_data);
        }
      }
    } else if (data?.type === "NotificationClicked") {
      // TODO notifications can have different actions so we'll probably need a different or more specific event handler for that
      events.notificationClicked.emit(data as INotification);
    }
  });
}
