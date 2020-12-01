import * as _ from 'lodash';
import { Socket } from 'socket.io';
import { IMe, IUser, verifySignedObject } from './user';
import { Server } from 'http';
import { IDeviceRegistration, ISDIExchange } from './connection';


export function init(server: Server, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) {
  
  let token;
  try {
    const client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    client.tokens.create().then(_token => token = _token);
  } catch (err) {
    console.error(err);
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

  let deviceSocket: { [key: string]: Socket } = {};
  //let socketDevice: { [key: string]: string } = {};
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
        const availableDevices =
          devices.filter(d => d.user.id === user.id && d.deviceId !== deviceId);
          //devices.filter(d => d.device !== deviceId);  
        callback(null, availableDevices);
      } catch (err) {
        console.error('getAvailableDevices failed', err);
        callback('getAvailableDevices failed: ' + String(err))
      }
    })

    socket.on('register-device', async (registration: IDeviceRegistration, callback: Function) => {
      try {
        verifySignedObject(registration.user as any, registration.user.publicKey);
        user = registration.user;
        deviceSocket[registration.deviceId] = socket;
        deviceId = registration.deviceId
        devices = devices.filter(d => d.deviceId != deviceId);
        devices.push(registration);
        console.log('device registered', user.id);
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
        console.error('offer failed', err);
      }
    })

    socket.on('iceCandidate', (iceCandidate: ISDIExchange) => {
      try {
        deviceSocket[iceCandidate.toDevice].emit('iceCandidate', iceCandidate);
      } catch (err) {
        console.error('iceCandidate failed', err);
      }
    })

    // socket.on('call', (msg: IRemoteCallIO) => {
    //   try {
    //     deviceSocket[msg.toDevice].emit('call', msg);
    //   } catch (err) {
    //     console.error('call failed', err);
    //   }
    // });

    // socket.on('response', (msg: IRemoteResponseIO) => {
    //   try {
    //     deviceSocket[msg.toDevice].emit('response', msg);
    //   } catch (err) {
    //     console.error('response failed', err);
    //   }
    // });
  }

  const io = require('socket.io')(server);
  io.on('connection', onSocketConnection);  
}
