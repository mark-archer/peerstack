import { IData } from "./db"
import { ISigned } from "./user"


export interface IKeyRegistry extends IData {
  type: 'KeyRegistry'
  url: string        // a location to retrieve public keys, e.g. https://peers.app/keys/{ownerId}/{?keyId}
  trustOrder: number // when conflicts arise, the order in which they are resolved.  Two registries with the same trustLevel is not allowed
  token?: string     // an optional secret that is used to verify the client (TODO give this more thought)
  desc?: string      // optional description about this registry
}

interface IUserKey extends IData, ISigned {
  type: 'PublicKey' | 'SecretKey'
  subject: string         // user, group, device, etc. that owns this key (note that it's required vs optional in IData)
  publicKey: string       // to verify the identity of the owner of this key
  publicBoxKey: string    // to encrypt data to be sent to the owner of this key
  refreshed: number       // the timestamp this key was last confirmed to be in the registry
  keyRegistryId?: string  // the registry that was used to discover this key (undefined if added manually)
  desc?: string           // optional description about this key
  sourceUrl?: string      // the url that should be checked for updates to this key (instead of registry)
  expires?: number        // timestamp that the key expires
  compromised?: number    // timestamp that the key was compromised (must be in past)
}

export interface IPublicKey extends IUserKey {
  type: 'PublicKey'  
}

export interface ISecretKey extends IUserKey {
  type: 'SecretKey'
  secretKey: string
}

/*

  registries are top level objects in a user's personal group so only they can add them 
  and they will be propagated to all their other devices
    Peers.app will be added as the default registry initially when a new user is created but it can be removed
    Other registries are added by "me" so "I" can say "I trust this registry in addition to Peers" 
      or "I trust this registry more than Peers"
      or even "I trust this registry and I _don't_ trust Peers" (by deleting the Peers.app registry)

  public keys are also top level objects in a user's personal group so only they can add them 
  and they will be propagated to all their other devices
    sourceUrl allows publishing one key to many registries but retaining update permissions
      i.e. allow user to add their public key in Peers.app but also put the "source of truth url" as something else
    Most users will get the key and sourceUrl from Peers.app 
      so they know it's not being highjacked (assuming they don't remove their public key from Peers.app)
      but will then use sourceUrl for updates so owning user retains control of updates

Scenarios I want to support
  terms
    normal user: a user that primarily relies on Peers.app registry
  scenarios
    A group of users that don't want to rely on Peers.app at all
      they can just delete the Peers.app key registry out of their personal group
      add their own registry and host*     
    Normal user that connects with another user that is registered at Peers.app but manages keys at a different registry
      They will download the key from Peers.app but use the new registry url to check for validity
        This means normal user can rely on Peers.app to prevent getting a highjacked user
        And the other user doesn't have to worry about Peers.app disabling their keys at some later date
    Normal user connects with a user that doesn't use Peers.app registry
      They won't see the user as valid until they manually add the user's key
      or they add the user's registry
      or the other user publishes their key to Peers.app
    
  When a key is discovered to be compromised (marked as compromised in a registry) a notification will be sent to all
  devices that might be affected.  When another device receives it, it'll independently confirm with the registry 
  that the key is bad, then forward the message to their own list of devices that could be affected.  

  When a user tries to use a compromised key the other user should send them the "key compromised" message which will
  kick off another round of flooding the network with those messages but it won't be propagated by any device that 
  already knows the key is compromised.  This means several rounds of "key compromised" messages will be kicked off 
  but only the first one will be widely propagated and they rest will most just be stragglers catching up




*/
