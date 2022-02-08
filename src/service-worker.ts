import * as notifications from './notifications';

export async function init(self) {
  self.addEventListener('push', function(event) {
    event.waitUntil(new Promise<void>(async (resolve, reject) => {
      try {
        const payload = event.data?.text();
        await notifications.processWebPushNotification(self, payload);
        resolve();
      } catch (err) {
        console.error('error receiving push message', err)
        reject(err);
      }
    }))
  });
  
  self.addEventListener('notificationclick', event => {
    const rootUrl = new URL('/', location as any).href;
    event.notification.close();
    // Enumerate windows, and call window.focus(), or open a new one.
    event.waitUntil(new Promise<void>(async (resolve, reject) => {
      try {
        const clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true
        });
        let client;
        for(let _client of clients) {
          if (_client.url === rootUrl) {
            // "matched a client via url so focusing on that
            client = _client;
          }
        }
        if (clients[0]) {
          // didn't match any clients via url but have at least one so focusing on last one
          client = clients[clients.length-1]; // TODO test this
        }
        if (client) {
          await client.focus();
          // await client.postMessage({ type: "UpdateLocationHash", hash: event.notification.data?.subject });
        } else {
          // no clients found so opening new window
          // const db = await peerstack.db.init();
          // await peerstack.user.init();
          // const dbNotification = await db.get(notification.data.id);
          
          // client = await self.clients.openWindow(`/#${event.notification.data?.subject}`);
          
          client = await self.clients.openWindow(`/`); // try to let the client decide what to do, don't assume urls to open
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        await client.postMessage({ type: "NotificationClicked", notification: event.notification.data });
        return resolve();
      } catch (err) {
        console.error('Error handling notification click', err);
        reject(err);
      }
    }));
  });
}