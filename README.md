# peerstack
A library for building decentralized, peer-to-peer web applications.

## Motivations

Censorship, data ownership, robust infrastructure, power to the people.

## How It Works

Note: secret key and private key are used interchangeably. 

UUIDs are used as unique identifiers to track data as it changes (the standard model of an ID).  A particular snapshot of data is identified with sha2 hashes, if the hash is different we know the data has changed even if it has the same id.

User identity is done with public/private keys.  When two users want to connect, they can confirm each other's identity by signing data with their secret key and sending it to the other user who can open it with the matching public key.  A user never has to share their secret key (or any other secrets like passwords or personal information) with other users or servers.

In this same way, data can be verified to be from a particular user.  The data is hashed and then the hash is signed and included with the data.  This allows the data to come from any source, including untrusted sources, but if the signature is valid other users know this data was from the user who signed it.

Note that signed data is not encrypted.  So even though data can come from untrusted sources, data should not be _sent_ to untrusted sources unless the data is meant to be shared publicly.  Non public data should only be sent across encrypted channels where the identity of the user on the other side has already been verified.

Peer-to-peer connections are made via WebRTC data connections.  To establish these connections we still need a signalling channel.  That is currently done with a server using web sockets.  For the sake of simplicity and to get things up and running this has been baked into the library.  There is no reason the signalling (or the entire connection) can't be done via other methods.  This is just the most practical method for web apps right now.  I fully plan to add more options for connecting to other peers as they become feasible in the web ecosystem.

If a native app is made, many more options for finding peers, establishing connections, and transferring data become available.  As long as they use the same method for verifying identity and signatures, they can all work together to create a rich, robust, ubiquitous network of peers.

## Peer Host

A supporting project is [peerhost](https://github.com/mark-archer/peerhost).  This is meant to allow users to easily instantiate sudo-servers that they own and operate.  The idea is these, although not required, would be the heavy lifters of the peers network. Operators would have more control over where and how the data is stored, and users could help ensure the availability of at least their part of the network (which is all they care about for the most part anyway).

An important function of a host is it can provide the signalling channel for peers to establish secure data channels with each other.  The goal is that if the host has a public ip address it could even be the initial point of connection via web sockets and provide STUN and TURN services for the WebRTC connections.  This reduces peers reliance on servers in the cloud even more and allows users to take additional ownership over the infrastructure.  

Another eventual use case is that users could write custom applications and use one or more hosts to provide any necessary server type functionality.  The big advantage to this over just writing an application from scratch is the only coding that would need to be done would be the business logic and UI.  Security, authentication, targeting different platforms, establishing connections between devices, and almost every other pain point in developing and deploying a production application would already be provided by the peers network.  Application development would become as simple as declaring a javascript function. 

## Areas of Concern

Keeping the user's secret key stored locally but securely is not a trivial problem.  It can be done by asking the user to encrypt it with a password but now that password is the weak link and the user also has to log in every time they reload the page.  I'm hoping there is some method the browser will give me but I haven't found it yet. 

Users have ids and public keys as separate identifiers.  This is to try to plan for the situation where a user's secret key is lost or stolen. But when a user's keys change they'll have to resign all of their data and then via some secure and trusted channel send their new public key to all of their contacts (e.g. hand delivering it, emailing, texting, etc) and then resend all of their newly signed data to who ever needs it.  That seems like an incredibly expensive and involved operation but still doable and I think better than having no fallback if a private key is lost or stolen.  But there is still the problem that changing a user's keys is vastly more costly than changing a password.

Because a user's id is listed as the signer, it's much more complicated to verify a signature because we have to look up the public key associated with that user id.  If we don't have access to that information at the point when we receive the data then we can't verify it and are left with the choice of rejecting the data or assuming it's valid and risk propagating bad data.

Verifying what public key belongs to what user id is still a fairly weak process.  The easiest method is just to rely on a server as the source of truth for this but that opens up a lot of the problems with centralization that peerstack is trying to solve.  This is left up to the individual apps and the hope is they'll be very thoughtful and careful about it.  A server acting as a central registrar (for the scope of that app) seems to be the most secure method. 

Without a central registrar of user ids, depending on the method of users learning of other new users, a malicious user could hijack another user's id in the eyes of third parties.  In other words, when two users claim the same user id but have different public keys, some method is needed to decide which one is the real user. 

If apps are much less promiscuous with their user discovery, stolen user ids are less likely to be a problem. For example, if users' public keys are hand delivered by the user themselves, there is almost no chance of ending up with a user id associated with the wrong public key. 

Data is stored in IndexedDB in the browser.  This has awkward upper limits on the amount of data that can be stored and can easily be wiped unintentionally by the user (just clearing all their browser data).

## Notes
to publish new version to npm 

```
npm run-script deploy
```