import { newid, user } from ".";
import { connections, emit, onMessage } from "./connections";
import { getDB, IData } from "./db";
import * as remoteCalls from "./remote-calls";
import { boxDataForPublicKey, IDevice, IDataBox, openBoxWithSecretKey, openBox } from "./user";


export interface INotification extends NotificationOptions {
  title: string
  data?: IData
}

onMessage('notify', (message: string) => {
  const box: IDataBox = JSON.parse(message);
  openBox(box).then((notification: INotification) => {
    processNotification(notification);
  })
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

export async function notifyDevice(device: IDevice, notification: INotification, toPublicBoxKey: string) {
  // check if we have a connection to the device, if so just send through that
  const conn = connections.find(c => c.remoteDeviceId === device.id);
  if (conn) {
    await remoteCalls.RPC(conn, processNotification)(notification);
    return true;
  }

  const subscription = device.pushSubscription;
  if (subscription) {
    const messageId = newid();
    const box = boxDataForPublicKey(notification, toPublicBoxKey);
    const message = JSON.stringify(box);
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
  await user.init();
  const box: IDataBox = JSON.parse(notification);
  const notificationHydrated: INotification = await user.openBox(box);
  const shouldShow = await isFirstTimeSeen(notificationHydrated);
  if (shouldShow) {
    serviceWorkerSelf.registration.showNotification(notificationHydrated.title, notificationHydrated);
  }  
}



