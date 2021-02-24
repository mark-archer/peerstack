import { newid, toJSON } from "./common";
import { getIndexedDB, IGroup } from './db';
import { IConnection, onRemoteMessage } from "./remote-calls";
import { IUser, signObject, init as initUser } from "./user";

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
  waitForDataChannel: (label: string) => Promise<RTCDataChannel>
}

let deviceId: string = null;
let me: IUser = null;
let socket;
export const connections: IDeviceConnection[] = [];

let initialized = false;
export async function init(_deviceId: string, _me: IUser, serverUrl?: string) {
  if (initialized) throw new Error('initialized should only be called once');
  const userId = await initUser();
  if (userId != _me.id) {
    throw new Error('Connection must be initialized with the same user that is currently signed in');
  }
  initialized = true;
  console.log('initializing peerIO')
  deviceId = _deviceId;
  me = _me;
  signObject(me);

  if (serverUrl) {
    socket = require('socket.io-client')(serverUrl, { secure: true, rejectUnauthorized: false });
  } else {
    socket = require('socket.io-client')();
  }

  socket.on('connect', async () => {
    console.log('connected to server', socket.id);
    const db = await getIndexedDB();
    const allGroups = (await db.find('Group', 'type')) as IGroup[];
    const allGroupIds = allGroups.map(g => g.id);
    allGroupIds.push(_me.id);
    await registerDevice({ deviceId, user: me, groups: allGroupIds });
    console.log('registered device', { deviceId, groups: allGroupIds })
  });
  // reconnect is called in addition to connect so redundant for now
  socket.on('reconnect', async () => {
    console.log('reconnected to server');
    eventHandlers.onSignalingReconnected();
  });
  socket.on('disconnect', async () => {
    console.log('disconnected from server');
  })

  socket.on('offer', (offer: ISDIExchange) => handelOffer(offer));

  socket.on('answer', (answer: ISDIExchange) => handelAnswer(answer));

  socket.on('iceCandidate', async (iceCandidate: ISDIExchange) => {
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
}

async function registerDevice(registration: IDeviceRegistration) {
  // TODO try to do it through peers first
  await new Promise((resolve, reject) => {
    socket.emit('register-device', registration, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    })
  })
  const otherDevices = await getAvailableDevices();
  console.log('availableDevices', otherDevices);
  // otherDevices.forEach(device => connectToDevice(device.deviceId))
  otherDevices.forEach(device => eventHandlers.onDeviceDiscovered(device.deviceId));
}

export async function getAvailableDevices(): Promise<IDeviceRegistration[]> {
  // TODO try to do it through peers first
  return new Promise((resolve, reject) => {
    socket.emit('get-available-devices', {}, (err, res) => {
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
      socket.emit('getIceServers', {}, (err, res) => err ? reject(err) : resolve(res)));
    _iceServers = iceServers;
  } catch (err) {
    console.warn('failed to get iceServers, using fallback', err)
  }
  return _iceServers;
}

async function sendOffer(offer: ISDIExchange) {
  // TODO try to do it through peers first
  await socket.emit('offer', offer);
}

async function sendAnswer(answer: ISDIExchange) {
  // TODO try to do it through peers first
  await socket.emit('answer', answer);
}

async function sendIceCandidate(iceCandidate: ISDIExchange) {
  // TODO try to do it through peers first
  socket.emit('iceCandidate', iceCandidate)
}

export const eventHandlers: {
  onDeviceDiscovered: (deviceId: string) => any,
  onDeviceConnected: (connection: IDeviceConnection) => any,
  onDeviceDisconnected: (connection: IDeviceConnection) => any,
  onSignalingReconnected: () => any,
} = {
  onDeviceDiscovered: (deviceId: string) => {
    // placeholder
  },
  onDeviceConnected: (connection: IDeviceConnection) => {
    // placeholder
  },
  onDeviceDisconnected: (connection: IDeviceConnection) => {
    // placeholder
  },
  onSignalingReconnected: () => {
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

export const chunkSize = 16384; // this is the safe maximum size but many devices can handle much larger sizes
const strChunkSize = Math.floor(chunkSize / 7);
async function dcSend(connection: IDeviceConnection, data) {
  const id = data?.id || newid();
  const strData = JSON.stringify(toJSON(data));
  if (strData.length < strChunkSize) {
    dcSendAndCloseOnError(connection, strData);
  } else {
    const totalChunks = Math.ceil(strData.length / strChunkSize);
    for (var i = 0; i < strData.length; i += strChunkSize) {
      const chunk = strData.substr(i, strChunkSize);
      const chunkPayload: IRemoteChunk = {
        type: 'chunk',
        id,
        iChunk: i / strChunkSize,
        totalChunks,
        chunk
      }
      dcSendAndCloseOnError(connection, JSON.stringify(chunkPayload));
      // TODO we should find a better way to apply back pressure (and only if needed)
      if ((chunkPayload.iChunk % 2) === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
  }
}

function dcSendAndCloseOnError(connection: IDeviceConnection, strData: string) {
  try {
    connection.dc.send(strData);
  } catch (err) {
    connection.dc.close();
    connection.pc.close();
    connections.splice(connections.indexOf(connection), 1);
    throw err;
  }
}

function garbageCollectConnections() {
  for (let i = connections.length - 1; i >= 0; i--) {
    const c = connections[i];
    if (['closed', 'closing'].includes(c.dc?.readyState)) {
      connections.splice(i, 1)
    }
  }
}

export async function connectToDevice(toDeviceId): Promise<IConnection> {
  try {
    garbageCollectConnections();
    const existingConnection = connections.find(c => c.remoteDeviceId === toDeviceId);
    if (existingConnection) {
      console.log('already have a connection to this device so just returning that')
      return existingConnection;
    }
    const connectionId = newid();

    const rtcConfig: RTCConfiguration = {
      // peerIdentity: connectionId,
      iceServers: await getIceServers()
    }

    // prepare connection   
    let pc = new RTCPeerConnection(rtcConfig);
    let dc = pc.createDataChannel(`${connectionId}-data`);
    const sdi = await pc.createOffer();
    await pc.setLocalDescription(sdi);
    // await sleep(2000);

    // gather ice candidates
    const iceCandidates: RTCIceCandidate[] = [];

    // send any additional ice candidates through the signaling channel
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

    const pendingDCConns: { [label: string]: ((dc: RTCDataChannel) => any) } = {};

    let connection: IDeviceConnection = {
      id: connectionId,
      remoteDeviceId: toDeviceId,
      send: data => dcSend(connection, data),
      pc,
      dc,
      lastAck: Date.now(),
      onAnswer,
      handlers: {},
      me,
      waitForDataChannel: label => new Promise<RTCDataChannel>((resolve) => pendingDCConns[label] = resolve),
    }
    // listen for data connections
    pc.ondatachannel = e => {
      let dc = e.channel;
      if (pendingDCConns[dc.label]) {
        pendingDCConns[dc.label](dc);
        delete pendingDCConns[dc.label];
      } else {
        console.log(`unexpected data channel opened ${dc.label}`)
      }
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
      connections.splice(connections.indexOf(connection), 1);
      eventHandlers.onDeviceDisconnected(connection);
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

    if (answer.user) connection.remoteUser = answer.user;

    // set answer
    if (!answer.sdi) throw new Error('sdi falsy on received answer')
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
    garbageCollectConnections();

    const rtcConfig: RTCConfiguration = {
      // peerIdentity: offer.connectionId,
      iceServers: await getIceServers()
    }
    // build answer connection
    const pc2 = new RTCPeerConnection(rtcConfig);

    const pendingDCConns: { [label: string]: ((dc: RTCDataChannel) => any) } = {};

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
      waitForDataChannel: label => new Promise<RTCDataChannel>((resolve) => pendingDCConns[label] = resolve),
    }
    // connections = connections.filter(c => !['closed', 'closing'].includes(c.dc?.readyState) && c.remoteDeviceId != connection.remoteDeviceId);
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
      if (dc.label == `${connection.id}-data`) {
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
          connections.splice(connections.indexOf(connection), 1);
          eventHandlers.onDeviceDisconnected(connection);
        };
      } else if (pendingDCConns[dc.label]) {
        dc.onopen = e => {
          pendingDCConns[dc.label](dc);
          delete pendingDCConns[dc.label];
        };
      } else {
        console.log(`unexpected data channel ${dc.label}`)
      }
    }
  }
  catch (err) {
    console.error('error handling offer', err);
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