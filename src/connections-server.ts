import * as _ from 'lodash';
import { Socket } from 'socket.io';
import { IDevice, IUser } from './user';
import { Server } from 'http';
import { IDeviceRegistration, ISDIExchange } from './connections';
import webPush from 'web-push';


export function init(
  server: Server, 
  options: { 
    TWILIO_ACCOUNT_SID?: string, 
    TWILIO_AUTH_TOKEN?: string,
    VAPID_PUBLIC_KEY?: string, 
    VAPID_PRIVATE_KEY?: string
  }
) {
  const { 
    TWILIO_ACCOUNT_SID, 
    TWILIO_AUTH_TOKEN,
    VAPID_PUBLIC_KEY, 
    VAPID_PRIVATE_KEY,
  } = options
  
  let token;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    try {
      const client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      client.tokens.create().then(_token => token = _token);
    } catch (err) {
      console.error(err);
    }
  }

  if (!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)) {
    console.log("You must set the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY" +
      "environment variables for web-push notifications to work. You can use the following ones:");
    console.log(webPush.generateVAPIDKeys());
  } else {
    webPush.setVapidDetails(
      'https://peers.app/',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
  }

  const getIceServers = () => {
    const iceServers: RTCIceServer[] =
      (token && token.iceServers) ||
      [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302",
            "stun:stun4.l.google.com:19302",
          ],
        }
      ]
    return iceServers;
  }

  let deviceSocket: { [deviceId: string]: Socket } = {};
  let devices: IDeviceRegistration[] = [];

  function onSocketConnection(socket: Socket) {
    const socketId: string = socket.id;
    let deviceId: string;
    let user: IUser;

    console.log('client connected', socketId);

    socket.on('disconnect', function () {
      console.log('client disconnected', socketId);
      devices = devices.filter(d => d.deviceId != deviceId);
      delete deviceSocket[deviceId];
    });

    socket.on('getIceServers', async (na, callback: Function) => {
      try {
        callback(null, getIceServers());
      } catch (err) {
        console.error('getIceServers failed', err);
        callback('getIceServers failed: ' + String(err))
      }
    })

    socket.on('get-available-devices', async (na, callback: Function) => {
      try {
        const myDevice = devices.find(device => device.deviceId == deviceId);
        // any devices that have at least one of my groups
        let availableDevices = devices.filter(device => {
          if (device.deviceId == deviceId) return false;
          return device.groups?.some(groupId => myDevice.groups.includes(groupId))
        });
        availableDevices = _.uniq(availableDevices).reverse(); // reverse so newest first
        callback(null, availableDevices);
      } catch (err) {
        console.error('getAvailableDevices failed', err);
        callback('getAvailableDevices failed: ' + String(err))
      }
    })

    socket.on('register-device', async (registration: IDeviceRegistration, callback: Function) => {
      try {
        // TODO: this is doing nothing to verify the userId is owned by the current user since they are also sending us the public key
        // verifySignedObject(registration.user as any, registration.user.publicKey);
        user = registration.user;
        deviceSocket[registration.deviceId] = socket;
        deviceId = registration.deviceId
        devices = devices.filter(d => d.deviceId != deviceId);
        devices.push(registration);
        console.log('device registered', deviceId);
        console.log(`Total devices registered: ${devices.length}`);
        if (callback) callback(null, 'success');
      } catch (err) {
        console.error('device registration failed', err);
        if (callback) callback('device registration failed: ' + String(err))
        return;
      }
    })

    socket.on('offer', (offer: ISDIExchange) => {
      try {
        offer.user = user;
        deviceSocket[offer.toDevice].emit('offer', offer);
      } catch (err) {
        console.error('offer failed', err);
      }
    })

    socket.on('answer', (answer: ISDIExchange) => {
      try {
        answer.user = user;
        deviceSocket[answer.toDevice].emit('answer', answer);
      } catch (err) {
        console.error('answer failed', err);
      }
    })

    socket.on('iceCandidate', (iceCandidate: ISDIExchange) => {
      try {
        deviceSocket[iceCandidate.toDevice].emit('iceCandidate', iceCandidate);
      } catch (err) {
        console.error('iceCandidate failed', err);
      }
    })

    // message should be an encrypted json string of type INotification 
    const badEndpoints: any = {};
    socket.on('notify', (params: { device: IDevice, messageId: string, message: string }, callback: Function) => {
      // TODO extract this functionality out so it can also be called via `POST`
      const { device, messageId, message } = params;
      try {
        const connectedDevice = deviceSocket[params.device.id];
        if (connectedDevice) {
          // send it through socket connection if available 
          connectedDevice.emit('notify', params.message)
          return callback(null, 'success');

        } else if (device.pushSubscription) {
          // use web push if subscriptions available 
          const subscription = device.pushSubscription;
          if (badEndpoints[subscription.endpoint]) {
            return callback(new Error('not attempting notification because subscription has thrown an error previously'));
          }
          if (typeof message !== 'string') {
            return callback(new Error(`message must be a string encrypted with the receiver's public key`));
          }
          const webPushChunkSize = 3000;
          function chunkMessage(message) {
            let chunks = [];
            if (message.length <= webPushChunkSize) {
              chunks.push(message)
            } else { 
              const nChunks = Math.ceil(message.length / webPushChunkSize);
              const chunkLength = Math.ceil(message.length / nChunks);
              let iChunk = 0;
              while(iChunk < message.length) {
                const chunk = message.substr(iChunk, chunkLength);
                iChunk += chunk.length;
                chunks.push(chunk)
              }
              chunks = chunks.map((chunk, iChunk) => `part:${iChunk+1},${chunks.length},${messageId}:${chunk}`)
            }
            return chunks;
          }
          const chunks = chunkMessage(message);
          
          Promise.all(chunks.map(chunk => webPush.sendNotification(subscription, chunk)))
            .then(() => {
              callback(null, 'success');
            })
            .catch(err => {
              badEndpoints[subscription.endpoint] = true;
              console.error('error during web-push', err);
              callback(err);
            })
        } else {
          console.log('no channel to send notification through', device)
          callback(null, 'no channel')
        }
      } catch (err) {
        console.error('notify failed', err);
        callback(err);
      }
    })
  }

  const io = require('socket.io')(server);
  io.on('connection', onSocketConnection);

  // // the server also needs to expose VAPID_PUBLIC_KEY via a route like this
  // router.get('/web-push-public-key', (req, res: Response) => {
  //   res.send({ VAPID_PUBLIC_KEY })
  // });
  
}
