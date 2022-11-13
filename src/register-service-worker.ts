// tslint:disable:no-console
// In production, we register a service worker to serve assets from local cache.

import { set, random, get } from "lodash";
import { hashObject, cloneClean, PushNotifications_urlBase64ToUint8Array } from "./common";
import { getDB } from "./db";
import { INotification, notifyUsers } from "./notifications";
import { IDevice, IUser, newData, signObject } from "./user";

export function registerServiceWorker(serviceWorkerUrl: string, deviceId: string, me: IUser, vapidPublicKey: string, appName: string) {
  return new Promise<IUser>((resolve, reject) => {
  // if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
    if ('serviceWorker' in navigator) {
      // // The URL constructor is available in all browsers that support SW.
      // const publicUrl = new URL(
      //   process.env.PUBLIC_URL!,
      //   window.location.toString()
      // );
      // if (publicUrl.origin !== window.location.origin) {
      //   // Our service worker won't work if PUBLIC_URL is on a different origin
      //   // from what our page is served on. This might happen if a CDN is used to
      //   // serve assets; see https://github.com/facebookincubator/create-react-app/issues/2374
      //   return reject('origins do not match');
      // }
      function ready(callbackFunction) {
        if (document.readyState != 'loading')
          callbackFunction()
        else
          document.addEventListener("DOMContentLoaded", callbackFunction)
      }
      ready(async () => {
        const registration = await navigator.serviceWorker.register(serviceWorkerUrl)
        const user = await registerPushSubscription(registration, deviceId, me, vapidPublicKey, appName)
        resolve(user);
      })
      // window.addEventListener('load', () => {});
    }  
  });
}

async function registerPushSubscription(registration: ServiceWorkerRegistration, deviceId: string, me: IUser, vapidPublicKey: string, appName: string) {
  let subscription: PushSubscription = await registration.pushManager.getSubscription();
  const db = await getDB();
  const hashBefore = hashObject(me);
  me = await db.get(me.id);

  const device: IDevice = get(me, `devices.${deviceId}`) || { id: deviceId };
  device.app = appName;
  // if device has no expire time, or has expired, or will expire in 4 days, then renew expire 
  const DAY_IN_MS = 1000 * 60 * 60 * 24;
  const expiresMinus4Days = (device.expires || 0) - (DAY_IN_MS * 4)
  if (expiresMinus4Days < Date.now()) {
    device.expires = Date.now() + DAY_IN_MS * 5; // device expires after 5 days
  }
  // clean out expired devices
  Object.keys(me.devices || {}).forEach(deviceId => {
    if ((me.devices[deviceId].expires || 0) < Date.now()) {
      delete me.devices[deviceId];
    }
  })

  if (
    !subscription ||
    (device.subscriptionExpires || 0) < Date.now()
  ) {
    if (subscription) {
      await subscription.unsubscribe();
    }
    // const vapidPublicKey = (await GET('/web-push-public-key')).VAPID_PUBLIC_KEY;
    // TODO change this to use the same functions peerstack uses for keys
    const convertedVapidKey = PushNotifications_urlBase64ToUint8Array(vapidPublicKey);
    // const convertedVapidKey = decodeUint8ArrayFromBaseN(vapidPublicKey);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedVapidKey
    })
      .catch(err => {
        console.error('an error was thrown trying to subscribe to notifications')
        throw err;
      });

    device.pushSubscription = subscription as any;
    device.subscriptionExpires = Date.now() + DAY_IN_MS * 14; // expire subscription in 14 days
  }

  set(me, `devices.${deviceId}`, cloneClean(device));

  // save object if needed
  const hashAfter = hashObject(me);
  if (hashBefore != hashAfter) {
    me.modified += random(100, 1000, false);
    signObject(me);
    await db.save(me);
    // me(me);

    // send updated user object to all users (all of their devices)
    // TODO only send to trusted users (I'm assuming we'll differentiate at some point)
    // TODO test that this is working
    const users = await db.find('User', 'type') as IUser[];
    const notification: INotification = {
      ...newData(),
      type: 'Notification',
      dontShow: true,
      data: me,
      title: 'User Updated',
    }
    signObject(notification);
    notifyUsers(users, notification);
  }
  console.log('my devices', me.devices);
  return me;
}

// export function unregister() {
//   if ('serviceWorker' in navigator) {
//     navigator.serviceWorker.ready.then(registration => {
//       registration.unregister();
//     });
//   }
// }

