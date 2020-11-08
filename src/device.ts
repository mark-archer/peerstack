import { newid } from "./common";

export interface IDevice {
  id: string
  userId?: string
}

export function newDevice(): IDevice {
  return {
    id: newid()
  }
}