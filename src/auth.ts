import { IData } from "./db"

export interface IKeyRegistry extends IData {
  type: 'KeyRegistry'
  url: string        // a location to retrieve public keys, e.g. https://peers.app/keys/{ownerId}/{?keyId}
  trustLevel: number // when conflicts arise, the order in which they are resolved.  Two registries with the same trustLevel is not allowed
  token?: string     // an optional secret that is used to verify the client (TODO give this more thought)
}

export interface IPublicKey extends IData {
  type: 'PublicKey' | 'SecretKey'
  id: string
  keyRegistryId: string
  subject: string       // user, group, device, etc. that owns this key
  publicKey: string     // to verify the identity of the owner of this key
  publicBoxKey: string  // to encrypt data to be sent to the owner of this key
  refreshed: number     // the timestamp this key was last confirmed to be in the registry
  sourceUrl?: string    // the url that should be checked for updates to this key (instead of registry)
  expires?: number      // timestamp that the key expires
  compromised?: number  // timestamp that the key was compromised (must be in past)
}

export interface ISecretKey extends IPublicKey {
  type: 'SecretKey'
  secretKey: string
}

/*

option 1 - rejected
  registry url is in user object so user has complete control over it
  The issue with this is _other_ users are effectively adding registries which opens users up to trojan/man-in-middle attacks

option 2
  registries are top level objects in a user's personal group so only they can add them
  registries are added by "me" so "I" can say "I trust Twitter in addition to Peers" and even which they trust more
  The issue is this is harder for users to tell their peers where they publish their public keys

option 3 - extension of option 2
  allow redirection from Peers registry
  allow user to specify their public key in Peers.app but also put the "source of truth url" as something else
  other users will get the key and registry url from Peers.app (so it can't be highjacked) but will then rely on 
    custom url for updates
  

Scenarios I want to support
  terms
    normal user: a user that primarily relies on Peers.app registry
  scenarios
    A group of users that don't want to rely on Peers.app at all
      they can just delete the Peers.app key registry out of their personal group      
    Normal user connects with a user that doesn't use Peers.app registry
      they can choose to add the other user's registry and specify the trust level (defaults to lowest)
      if they don't add the registry (and the other user is not registered at a registry they already have)
      they can't connect with that user
    Normal user that connects with another user that is registered at Peers.app but manages keys at a different registry
      They will download the key from Peers.app but use the new registry url to check for validity
        This means normal user can rely on Peers.app to prevent getting a highjacked user
        And the other user doesn't have to worry about Peers.app disabling their keys at some later date

  When a key is discovered to be compromised (marked as so in a registry) a notification will be sent to all
  devices that might be affected.  When another device receives it, it'll  independently confirm with the registry 
  that the key is bad, then forward the message to their own list of devices that could be affected




*/
