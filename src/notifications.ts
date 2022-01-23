import { newid } from ".";
import { connections, emit, onMessage } from "./connections";
import { getDB, IData } from "./db";
import * as remoteCalls from "./remote-calls";
import { IDevice } from "./user";

export interface INotification extends NotificationOptions {
  title: string
  data?: IData
}

onMessage('notify', (notification: string) => {
  // TODO should be encrypted so I can open it
  const _notification: INotification = JSON.parse(notification);
  processNotification(_notification);
})

async function isFirstTimeSeen(notification: INotification) {
  // TODO check if data already exists in db, if no data use hash of notification      
  return true;
}

export async function processNotification(notification: INotification) {
  try {
    const shouldShow = await isFirstTimeSeen(notification);
    if (shouldShow) {
      // This may not work on android? 
      const n = new Notification(notification.title);
    }    
  } catch (err) {
    console.error('Error processing notification', notification, err);
  }
}

remoteCalls.remotelyCallableFunctions.processNotification = processNotification;

export async function notifyDevice(device: IDevice, notification: INotification, theirPublicKey: string) {
  // check if we have a connection to the device
  const conn = connections.find(c => c.remoteDeviceId === device.id);
  if (conn) {
    await remoteCalls.RPC(conn, processNotification)(notification);
    return true;
  }

  const subscription = device.pushSubscription;
  if (subscription) {
    const messageId = newid();
    let message = JSON.stringify(notification);
    // TODO encrypted notification
    // message = signMessageWithSecretKey(message, theirPublicKey)
    const result = await emit('notify', { device, messageId, message })
    console.log('notifyDevice result', result)
    return true;    
  }

  return false;
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
  // TODO check if it's a part - if so, check if we have the rest in db otherwise save in db
  if (notification.startsWith('part')) {
    // ex `part1,5,{id}:qwerty....`
    const iColon = notification.indexOf(':');
    const metaData = notification.substring(0, iColon);
    const [_partNum, _totalParts, id] = metaData.replace("part", '').split(',');
    const [partNum, totalParts] = [_partNum, _totalParts].map(s => Number(s));
    const partId = buildPartId(id, partNum);
    const data = notification.substring(iColon+1);
    const part: INotificationPart = {
      id: partId, 
      type: 'NotificationPart',
      partNum, 
      totalParts,
      data, 
      ttl: Date.now() + (1000 * 60 * 60 * 24 * 30) // 30 days
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
  // TODO open notification using my secret key (it should be signed with my public key)
  const notificationHydrated: INotification = JSON.parse(notification);
  const shouldShow = await isFirstTimeSeen(notificationHydrated);
  if (shouldShow) {
    serviceWorkerSelf.registration.showNotification(notificationHydrated.title, notificationHydrated);
  }  
}



