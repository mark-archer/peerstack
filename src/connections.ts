import * as _ from 'lodash';
import { newid, toJSON } from "./common";
import { IMe, IUser } from "./user";
import { onRemoteMessage, IConnection } from "./remote-calls";
import { getIndexedDB, IGroup } from './db';

export interface ISDIExchange {
  connectionId: string
  fromDevice: string
  toDevice: string
  iceCandidates: RTCIceCandidate[]
  sdi: RTCSessionDescriptionInit,
  user?: IUser
}

export interface IDeviceRegistration {
  deviceId: string
  user: IUser,
  groups: string[],
}

export interface IDeviceConnection extends IConnection {
  id: string
  pc: RTCPeerConnection
  dc: RTCDataChannel
  lastAck: number
  onAnswer: ((sdi: ISDIExchange) => void)
  handlers: { [key: string]: ((err: any, result: any) => void) }
  remoteUser?: IUser
}

let deviceId: string = null;
let me: IMe = null;
let user: IUser = null;
let io;
export let connections: IDeviceConnection[] = [];

let initialized = false;
export function init(_deviceId: string, _me: IMe) {
  if (initialized) throw new Error('initialized should only be called once');
  initialized = true;
  console.log('initializing peerIO')
  deviceId = _deviceId;
  me = _me;
  user = Object.assign({}, me, { secretKey: undefined });

  io = require('socket.io-client')();

  let resolveConnected;
  const connectedPromise = new Promise(resolve => resolveConnected = resolve);
  io.on('connect', async () => {
    console.log('connected to server', io.id);
    const db = await getIndexedDB();
    const allGroups = (await db.find('Group', 'type')) as IGroup[];
    const allGroupIds = allGroups.map(g => g.id);
    allGroupIds.push(_me.id);
    await registerDevice({ deviceId, user, groups: allGroupIds  })
    resolveConnected();
  });
  // // reconnect is called in addition to connect so redundant for now
  // io.on('reconnect', async () => {
  //   console.log('reconnected to server');
  //   registerDevice({ deviceId, user });
  // });
  io.on('disconnect', async () => {
    console.log('disconnected from server');
  })

  io.on('offer', (offer: ISDIExchange) => handelOffer(offer));

  io.on('answer', (answer: ISDIExchange) => handelAnswer(answer));

  io.on('iceCandidate', async (iceCandidate: ISDIExchange) => {
    console.log('received ice candidate', iceCandidate.iceCandidates);
    const conn = connections.find(c => c.id == iceCandidate.connectionId)
    if (!conn) {
      console.warn('no connection found for iceCandidate', iceCandidate);
      return;
    }
    try {
      for (const ic of iceCandidate.iceCandidates) {
        await conn.pc.addIceCandidate(ic)
      }
    } catch (err) {
      console.log('error adding ice candidate', iceCandidate.iceCandidates, err);
    }
  });

  // // TODO this isn't working so commenting it out for now
  // const heartBeatInterval = _.random(2000, 3000); // more than this leaves them hanging around for some reason
  // console.log('heartbeat interval', heartBeatInterval)
  // const maxAck = heartBeatInterval * 3;
  // const heartbeat = setInterval(() => {
  //   console.log('heartbeat', connections.length)
  //   connections = connections.filter(c => {
  //     // if (['closed' || 'closing'].includes(c.dc.readyState) || (Date.now() - c.lastAck) > maxAck) {
  //     //   console.log('closing connection', c.device)
  //     //   c.dc.close();
  //     //   c.pc.close();
  //     //   return false;
  //     // }    
  //     // if (c.dc.readyState === 'open') c.dc.send('ack');
  //     // else c.lastAck = Date.now() // wait for the connection to open before starting Ack timer
  //     if (c.dc && c.dc.readyState.match(/closed|closing/i))
  //     // || ['disconnected', 'failed'].includes(c.pc.iceConnectionState)) 
  //     {
  //       console.log('connection closed, removing from list', c)
  //       c.dc.close();
  //       c.pc.close();
  //       return false;
  //     } else if(c.dc.readyState === 'open') {
  //       c.dc.send('ack');        
  //     } else {
  //       console.log('other state', c);
  //     }
  //     return true;
  //   })
  // }, heartBeatInterval);

  return connectedPromise;
}

async function registerDevice(registration: IDeviceRegistration) {
  // TODO try to do it through peers first
  await new Promise((resolve, reject) => {
    io.emit('register-device', registration, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    })
  })
  const otherDevices = await getAvailableDevices();
  console.log('availableDevices', otherDevices);
  otherDevices.forEach(device => connectToDevice(device.deviceId))
  otherDevices.forEach(device => eventHandlers.onDeviceDiscovered(device.deviceId));
}

export async function getAvailableDevices(): Promise<IDeviceRegistration[]> {
  // TODO try to do it through peers first
  return new Promise((resolve, reject) => {
    io.emit('get-available-devices', {}, (err, res) => {
      if (err) reject(err)
      else resolve(res)
    })
  })
}

let iceServers: RTCIceServer[] = null;
async function getIceServers() {
  if (iceServers) return iceServers;
  let _iceServers: RTCIceServer[] = [
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
  try {
    // TODO try to do it through peers first
    iceServers = await new Promise((resolve, reject) =>
      io.emit('getIceServers', {}, (err, res) => err ? reject(err) : resolve(res)));
    _iceServers = iceServers;
  } catch (err) {
    console.warn('failed to get iceServers, using fallback', err)
  }
  return iceServers;
}

async function sendOffer(offer: ISDIExchange) {
  // TODO try to do it through peers first
  await io.emit('offer', offer);
}

async function sendAnswer(answer: ISDIExchange) {
  // TODO try to do it through peers first
  await io.emit('answer', answer);
}

async function sendIceCandidate(iceCandidate: ISDIExchange) {
  // TODO try to do it through peers first
  io.emit('iceCandidate', iceCandidate)
}

export const eventHandlers = {
  onDeviceDiscovered: async (deviceId: string) => {
    // placeholder
  },
  onDeviceConnected: async (connection: IDeviceConnection) => {
    // placeholder
  },
}
export interface IRemoteChunk {
  type: 'chunk',
  id: string,
  iChunk: number,
  totalChunks: number
  chunk: string,
}

const chunkSize = 16384; // this is the safe maximum size but many devices can handle much larger sizes
const strChunkSize = Math.floor(chunkSize / 7);
async function dcSend(connection, data) {
  const id = data?.id || newid();
  const strData = JSON.stringify(toJSON(data));
  if (strData.length < strChunkSize) {
    connection.dc.send(strData);
  } else {
    const totalChunks = Math.ceil(strData.length / strChunkSize);
    for (var i = 0; i < strData.length; i += strChunkSize) {
      // console.log(`sending chunk ${i/strChunkSize} of ${totalChunks}`)
      const chunk = strData.substr(i, strChunkSize);
      const chunkPayload: IRemoteChunk = {
        type: 'chunk',
        id,
        iChunk: i / strChunkSize,
        totalChunks,
        chunk
      }
      connection.dc.send(JSON.stringify(chunkPayload));
      if ((chunkPayload.iChunk % 2) === 0)
        await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
}

export async function connectToDevice(toDeviceId) {
  try {
    const existingConnection = connections.find(c => c.remoteDeviceId === toDeviceId);
    if (existingConnection) return existingConnection;

    const connectionId = newid();

    // get ice servers
    const iceServers: RTCIceServer[] = await getIceServers();

    let rtcConfig: RTCConfiguration = {
      peerIdentity: connectionId,
      iceServers
    }

    // prepare connection   
    let pc = new RTCPeerConnection(rtcConfig);
    let dc = pc.createDataChannel(`${connectionId}-data`);
    const sdi = await pc.createOffer();
    if (!sdi) return alert('generated falsy sdi offer')
    await pc.setLocalDescription(sdi);

    // gather ice candidates
    const iceCandidates: RTCIceCandidate[] = [];

    // send any additional ice candidates through the signalling channel
    pc.onicecandidate = e => {
      if (!e.candidate) return;
      iceCandidates.push(e.candidate)
      sendIceCandidate({
        connectionId,
        fromDevice: deviceId,
        toDevice: toDeviceId,
        iceCandidates,
        sdi: null
      })
    }

    // record offer and setup answer promise
    let onAnswer: ((sdi: ISDIExchange) => void);
    const answerPromise = new Promise<ISDIExchange>(resolve => onAnswer = resolve);

    let connection: IDeviceConnection = {
      id: connectionId,
      remoteDeviceId: toDeviceId,
      send: data => dcSend(connection, data),
      pc,
      dc,
      lastAck: Date.now(),
      onAnswer,
      handlers: {},
      me
    }
    connections.push(connection);

    let resolveConnectionOpen;
    const connectionOpenPromise = new Promise(resolve => resolveConnectionOpen = resolve);
    dc.onmessage = e => onRemoteMessage(connection, e.data);
    dc.onopen = e => {
      console.log('dc connection open to', toDeviceId)
      resolveConnectionOpen();
    }
    dc.onclose = e => {
      console.log("dc.onclose")
      pc.close();
      connections = connections.filter(c => c != connection)
    }

    // setTimeout(() => syncData(connection), 1000);

    // send offer
    console.log('ice candidates at offer time', iceCandidates)
    sendOffer({
      connectionId,
      fromDevice: deviceId,
      toDevice: toDeviceId,
      sdi,
      iceCandidates,
    })

    // wait for answer
    const answer = await answerPromise;
    connection.remoteUser = answer.user;

    if (answer.user) connection.remoteUser = answer.user; // TODO verify user identity with signedObject

    // set answer
    if (!answer.sdi) return alert('sdi falsy on received answer')
    await pc.setRemoteDescription(answer.sdi)

    await connectionOpenPromise;

    // connection is now established and data connection ready to use
    console.log(`connection to peer established!`, connectionId, { connections })

    eventHandlers.onDeviceConnected(connection);

    return connection;
  }
  catch (err) {
    console.error('error connecting to device', toDeviceId, err);
    throw err;
  }
}

async function handelOffer(offer: ISDIExchange) {
  try {
    // build answer connection
    const pc2 = new RTCPeerConnection();

    // add connection to list
    const connection: IDeviceConnection = {
      id: offer.connectionId,
      remoteDeviceId: offer.fromDevice,
      send: null,
      pc: pc2,
      dc: null,
      lastAck: Date.now(),
      onAnswer: null,
      handlers: {},
      remoteUser: offer.user,
      me: me,
    }
    connections.push(connection);

    // gather ice candidates
    const iceCandidates: RTCIceCandidate[] = [];

    // send any additional ice candidates through the signalling channel
    pc2.onicecandidate = e => {
      if (!e.candidate) return;
      iceCandidates.push(e.candidate);
      sendIceCandidate({
        connectionId: offer.connectionId,
        fromDevice: deviceId,
        toDevice: offer.fromDevice,
        iceCandidates: iceCandidates,
        sdi: null
      })
    }

    if (!offer.sdi) return alert('sdi falsy on received offer')
    await pc2.setRemoteDescription(offer.sdi);

    // build answer
    const sdi = await pc2.createAnswer();
    if (!sdi) return alert('generated falsy sdi answer: ' + JSON.stringify(sdi));
    await pc2.setLocalDescription(sdi)

    // send answer
    console.log('ice candidates at answer time', iceCandidates)
    sendAnswer({
      connectionId: offer.connectionId,
      fromDevice: deviceId,
      toDevice: offer.fromDevice,
      iceCandidates,
      sdi
    })

    // listen for data connections
    pc2.ondatachannel = e => {
      let dc: RTCDataChannel = e.channel;
      connection.dc = dc;
      connection.send = data => dcSend(connection, data);
      dc.onmessage = e => onRemoteMessage(connection, e.data);
      dc.onopen = e => {
        console.log('dc2 connection open to', offer.fromDevice)
        eventHandlers.onDeviceConnected(connection);
      }
      dc.onclose = e => {
        console.log("dc2.onclose")
        pc2.close();
        connections = connections.filter(c => c != connection)
      };
    }
  }
  catch (err) {
    console.error('error handling offer');
    throw err;
  }
}

async function handelAnswer(answer: ISDIExchange) {
  const connection = connections.find(c => c.id == answer.connectionId)
  if (connection) connection.onAnswer(answer);
  else console.log('could not find connection for answer', answer);
}

// @ts-ignore
if (typeof window !== 'undefined') window.connections = connections;