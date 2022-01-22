import { connections, emit, onMessage } from "./connections";
import { IData } from "./db";
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
    let message = JSON.stringify(notification);
    // TODO encrypted notification
    // message = signMessageWithSecretKey(message, theirPublicKey)
    const result = await emit('notify', { device, message })
    console.log('notifyDevice result', result)
    return true;    
  }

  return false;
}

export async function processWebPushNotification(serviceWorkerSelf: any, notification: string) {
  // TODO check if it's a part - if so, check if we have the rest in db otherwise save in db
  if (notification.startsWith('part')) {
    // ex `part1,5,{id}:qwerty....`
    const iColon = notification.indexOf(':');
    const dataData = notification.substring(iColon);
    const metaData = notification.substring(0, iColon);
    const [partNum, totalNum, id] = metaData.replace("part", '').split(':').map(s => Number(s));
    // ...
    throw new Error('not implemented yet')
  }
  // TODO open notification using my secret key (it should be signed with my public key)
  const notificationHydrated: INotification = JSON.parse(notification);
  const shouldShow = await isFirstTimeSeen(notificationHydrated);
  if (shouldShow) {
    serviceWorkerSelf.registration.showNotification(notificationHydrated.title, notificationHydrated);
  }  
}



