import { IUser } from "./user";

export interface IConnection {
  id: string
  deviceId: string
  lastAck: number
  handlers: { [key: string]: ((err: any, result: any) => void) }
  remoteUser?: IUser
}

export interface IDeviceRegistration {
  deviceId: string
  userId: string
  signature: string
}

export interface ISDIExchange {
  connectionId: string
  fromDeviceId: string
  toDeviceId: string
  iceCandidates: RTCIceCandidate[]
  sdi: RTCSessionDescriptionInit,
  user?: IUser
}

export interface IRTCConnection extends IConnection {
  pc: RTCPeerConnection
  dc: RTCDataChannel
  onAnswer: ((sdi: ISDIExchange) => void)
}