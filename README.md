# peerstack
A library for building decentralized, peer-to-peer web applications.

## Motivations

- True serverless software
- Robust and resilient infrastructure
- Users own their data
- Prevent censorship
- Democratic web

## Example

### Web App Code
```javascript
const { connections, newid, remoteCalls, user } = require('peerstack');
// this creates a new user - normally you'd use an existing user
const me = user.newUser();
// you should try to use the same deviceId for the life of the device 
const deviceId = newid();
connections.init(deviceId, me, yourServerUrl || "https://peers.app/");
connections.events.deviceDiscovered.subscribe(connections.connectToDevice);
connections.events.deviceConnected.subscribe(async connection => {    
  // syncs data in all shared groups between both devices
  await remoteCalls.syncDBs(connection);
  // TODO whatever else you want to do between this and remote device
})
```

The above is all you need to get your web app connecting to other devices running peerstack.  Currently devices will only connect to other devices with the same user or where the user is in one or more of the same [groups](#groups) as the current user.  There is a much more detailed example at [peerstack-example](https://github.com/mark-archer/peerstack-example).


### Server Code (optional)
```javascript
import http from 'http';
import * as connectionsServer from 'peerstack/dist/connections-server';
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from './config';
const server = http.createServer();
connectionsServer.init(server, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const port = process.env.PORT || 3333;
server.listen(port);
console.log(`server running at http://localhost:${port}/`)
```

Your own server is not necessary. For now you're free to use `https://peers.app/` as your signaling server but that may change in the future depending on usage and the evolution of [peerhost](#peer-host).

## How It Works

Key Concepts
- [UUIDs](https://en.wikipedia.org/wiki/Universally_unique_identifier) are used as the building block for identifiers (id) to match two copies of data even if the data has changed between the two.  Ids can be more than just a UUID but must at least start with a UUID.[^1]
- [SHA-2](https://en.wikipedia.org/wiki/SHA-2) hashes are used to determine if two copies of data are identical. 
- [Unix timestamps](https://en.wikipedia.org/wiki/Unix_time) are stored in the `modified` field on all data.  If two copies of data (same id) are found but they have different hashes (data has changed) then the one with the higher modified value is kept and the other is discarded.  If `modified` is the same on both copies then the local copy is kept and the other copy is discarded.

User identity is done with [public keys](https://en.wikipedia.org/wiki/Public-key_cryptography).  When two users want to connect, they can confirm each other's identity by signing data with their secret key and sending it to the other user who can open it with the matching public key.  A user never has to share their secret key (or any other secrets like passwords or personal information) with other users or servers.

In this same way, data can be verified to be from a particular user.  The data is hashed and then the hash is signed and included with the data.  This allows the data to come from any source, including untrusted sources, but if the signature is valid other users know this data was from the user who signed it and has not been altered.

Note that signed data is not encrypted.  So even though data can come from untrusted sources, data should not be _sent_ to untrusted sources unless the data is meant to be shared publicly.  Non public data should only be sent across encrypted channels where the identity of the user on the other side has already been verified.  If you're using peerstack as is then this is all already taken care of.

Peer-to-peer connections are made via [WebRTC data connections](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel).  To establish these connections we still need a [signaling channel](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling#The_signaling_server).  That is currently done with a server using web sockets.  For the sake of simplicity and to get things up and running this has been baked into the library.  There is no reason the signaling (or the entire connection) can't be done via other methods.  This is just the most practical method for web apps right now.  I fully plan to add more options for connecting to other peers as they become feasible in the web ecosystem.

If a native app is made, many more options for finding peers, establishing connections, and transferring data become available.  As long as they use the same method for verifying identity and signatures, they can all work together to create a rich, robust, ubiquitous network of peers.

[^1]: Peerstack uses its own type of UUID that sorts naturally and requires 7 less characters to represent but it is still ultimately just a 128 bit number.

## Groups

All data must have a group. [Groups](./src/db.ts) are used to define who has access to what data.  A natural side effect of this is it defines how to [shard](https://en.wikipedia.org/wiki/Shard_(database_architecture)) the data across devices.

For every user, an implicit group exists (using the user's own id) and that is defined to be the user's personal group.  Any data in that group should not be sent to another device unless it has the same user logged in.  

Users can create groups and can give other users access to those groups.  This is the default mechanism for determining which devices will connect to each other.  If you are not in any groups with other people, your device will only connect to your other devices.  If you're in a group with your family members, your device will connect any of your family members devices as well as your own, etc, etc.  

This creates a [network topology](https://en.wikipedia.org/wiki/Network_topology) that matches the real world social topology which seems ideal.

## Peer Host

A supporting project is [peerhost](https://github.com/mark-archer/peerhost).  This is meant to allow users to easily instantiate sudo-servers that they own and operate.  The idea is these, although not required, would be the heavy lifters of the peers network. Operators would have more control over where and how the data is stored, and could help ensure the availability of at least their part of the network (which is all they care about for the most part anyway).

An important function of a host is it can provide the signaling channel for peers to establish secure data channels with each other.  The goal is that if the host has a public ip address it could even be the initial point of connection via web sockets and provide STUN and TURN services for the WebRTC connections.  This reduces peers' reliance on central servers even more and allows users to take additional ownership over the infrastructure.  

Another eventual use case (that I'm particularly excited about) is that users could write custom applications and use one or more hosts to provide any necessary server type functionality.  The big advantage of this over just writing an application from scratch is the only coding that would need to be done would be the business logic and UI.  Security, authentication, targeting different platforms, establishing connections between devices, and almost every other pain point in developing and deploying a production application would already be solved by the peers network.  Application development and deployment would become as simple as declaring a javascript function. 

## Areas of Concern

Users have ids and public keys as separate identifiers.  This is to try to plan for the situation where a user's secret key is lost or stolen. But when a user's keys change they'll have to re-sign all of their data and then via some trusted channel send their new public key to all of their contacts (e.g. hand delivering it, emailing, texting, etc) and then resend all of their newly signed data to who ever needs it.  That seems like an incredibly expensive and involved operation but still doable and I think better than having no fallback if a secret key is lost or stolen.  But there is still the problem that changing a user's keys is vastly more costly than changing a password.

Because the value in `signer` is a user's id (not their public key), it's much more complicated to verify a signature because we have to look up the public key associated with that user id.  If we don't have that information when the data is received then we can't verify the signature and have to either reject the data or assume it's valid and risk propagating bad data.

Verifying what public key belongs to what user id is not taken care of by peerstack.  This is left up to the individual apps and the hope is they'll be very thoughtful and careful about it.  A server acting as a central registrar (for the scope of that app) seems to be the most secure method but that opens up some of the problems with centralization that peerstack is trying to solve.  It's possible that users will become accustom to sharing and assigning public keys in a more manual way, similar to how users share things like phone numbers and email addresses but for now this is an open issue.

Without a central registrar of user ids, depending on the method of users learning of other users, a malicious user could hijack another user's id for some subset of users.  In other words, when two users have claimed the same user id but have different public keys, some method is needed to decide which one is the "real" user. If apps are much less promiscuous with their user discovery, hijacked user ids are less likely to be a problem. For example, if users' public keys are hand delivered by the users themselves, there is almost no chance of ending up with a user id associated with the wrong public key. 

Data is stored in IndexedDB in the browser.  This has awkward upper limits on the amount of data that can be stored, is not always clear about when it's full, and can easily be wiped unintentionally by the user just clearing all their browser data. As long as at least one other peer has a copy of the data, it'll be restored as soon as those devices are connected but it's still a serious gotcha to users.  If a user only uses one device, any data in their personal group is almost guaranteed to be lost at some point.  Some mechanism should probably be added to give users some visibility into how well the data has been propagated.  Just storing a record for every device a group has been synced with and the last time it has been synced would be a good first step.  Also giving users some mechanism to save and restore data needs to be implemented.

Users need to be given a way to opt out of a group and shouldn't get added in the first place without their permission.  Currently there is no mechanism for either of these features. 
