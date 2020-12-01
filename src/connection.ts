import { newid } from "./common";
import { IUser } from "./user";
import { onPeerMessage, IConnection } from "./remote-calls";

export interface ISDIExchange {
  connectionId: string
  fromDevice: string
  toDevice: string
  iceCandidates: RTCIceCandidate[]
  sdi: RTCSessionDescriptionInit,
  user?: IUser
}

export interface IDeviceConnection extends IConnection  {
  id: string
  pc: RTCPeerConnection
  dc: RTCDataChannel
  lastAck: number
  onAnswer: ((sdi: ISDIExchange) => void)
  handlers: { [key: string]: ((err: any, result: any) => void) }
  remoteUser?: IUser
}

export const deviceId = newid(); // TODO this should probably be persisted with local storage

let connections: IDeviceConnection[] = [];

const server: {
  getIceServers: () => Promise<RTCIceServer[]>
  sendIceCandidate: (data: ISDIExchange) => Promise<void>
} = ({} as any)


type SocketEvent = 'offer' | 'answer' | 'iceCandidate'
const socket: {
  emit: (eventName: SocketEvent, sdi: ISDIExchange) => Promise<void>
  on: (eventName: SocketEvent, handler: ((sdi: ISDIExchange) => Promise<void>)) => void
} = ({} as any)

async function signalOffer(offer: ISDIExchange) {
  // // TODO try to do it through peers first
  // for (const c of openConnections) {
  //   const success = await remoteCall(c, {
  //     type: "offer",
  //     id: newid(),
  //     data: offer,
  //   })
  //   if (success) break;
  // }

  // do it through the server
  socket.emit('offer', offer);
}

async function signalAnswer(answer: ISDIExchange) {
  // MAYBE try to do it through peers first
  socket.emit('answer', answer);
}

async function connectToDevice(toDeviceId) {
  try {
    const connectionId = newid();

    // get seed ice servers
    let iceServers: RTCIceServer[] = [
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
      iceServers = await server.getIceServers();
    } catch (err) { 
      // iceServers = [];
    }
  
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
      server.sendIceCandidate({
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
      send: null,
      receive: null,
      pc,
      dc,
      lastAck: Date.now(),
      onAnswer,
      handlers: {},
    }
    connections.push(connection);
  
    dc.onmessage = e => onPeerMessage(connection, e.data);
    dc.onopen = e => {
      console.log('dc connection open to', toDeviceId)
    }
    dc.onclose = e => {
      console.log("dc.onclose")
      pc.close();
      connections = connections.filter(c => c != connection)
    }
  
    // setTimeout(() => syncData(connection), 1000);
  
    // send offer
    console.log('ice candidates at offer time', iceCandidates)
    signalOffer({
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

    // connection is now established
    console.log(`connection to peer established!`, connectionId, { connections })
  }
  catch (err) {
    console.error('error connecting to device', toDeviceId, err);
    throw err;
  }  
}

async function handelOffer(offer: ISDIExchange) {
  try {
    // build answer connection
    let pc2 = new RTCPeerConnection();

    // add connection to list
    let connection: IDeviceConnection;
    connection = {
      id: offer.connectionId,
      remoteDeviceId: offer.fromDevice,
      send: null,
      receive: null,
      pc: pc2,
      dc: null,
      lastAck: Date.now(),
      onAnswer: null,
      handlers: {},
      remoteUser: offer.user
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
    if (!sdi) return alert('generated falsy sdi answer: ' +  JSON.stringify(sdi));
    await pc2.setLocalDescription(sdi)

    // send answer
    console.log('ice candidates at answer time', iceCandidates)
    signalAnswer({
      connectionId: offer.connectionId,
      fromDevice: deviceId,
      toDevice: offer.fromDevice,
      iceCandidates,
      sdi
    })

    // listen for data connections
    pc2.ondatachannel = e => {
      let dc2: RTCDataChannel = e.channel;
      connection.dc = dc2;
      dc2.onmessage = e => onPeerMessage(connection, e.data);
      dc2.onopen = e => {
        console.log('dc2 connection open to', offer.fromDevice)
      }
      dc2.onclose = e => {
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

function sendIceCandidate(iceCandidate: ISDIExchange) {
  console.log('sending ice candidate', iceCandidate.iceCandidates);
  socket.emit('iceCandidate', iceCandidate)
}

socket.on('offer', (offer: ISDIExchange) => handelOffer(offer));

socket.on('answer', (answer: ISDIExchange) => handelAnswer(answer));

socket.on('iceCandidate', async (iceCandidate: ISDIExchange) => {
  console.log('received ice candidate', iceCandidate.iceCandidates);
  const conn = connections.find(c => c.id == iceCandidate.connectionId)
  if (!conn) {
    console.log('no connection found for iceCandidate', iceCandidate);
    alert('no connection found for iceCandidate');
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