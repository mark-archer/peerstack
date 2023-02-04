import { IKeyRegistry } from "./auth"
import { IData } from "./db"

// this should be returned from any host when queried at ${hostRoot}/peer-host-info
export interface IPeerHost extends IData {
  type: "PeerHost"
  socketUrl?: string        // e.g. https://peers.app/ or http://192.168.1.2
  publicIPContext?: string  // helps identify when to try this host if it is only available inside a private network
  registry?: IKeyRegistry
  desc?: string             // optional description about the Host
}

/*
  update connections.init() to take an optional list of hosts
  if an optional list of hosts is given, it should just try to connect to every host in that list
  if a list of hosts wasn't given, it should get every host it has in the database 
  with those hosts it should try to connect to every socketUrl without a publicIPContext.
  With hosts that have a publicIPContext, it should filter them based on the current publicIPContext
  try the ones that match first
  try any others that dont' have conflicting socketUrls just in case their publicIPContext has changed

  After all of this, query every local ip (192.168.1.1-255) that we don't already have a connection to
  to see if it might be a host server.  
  if any are found, save them to the database with the publicIPContext so they can hopefully be 
  connected to faster in the future

*/