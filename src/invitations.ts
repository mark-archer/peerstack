import { signObject, newUser, signMessageWithSecretKey, openMessage, init as initUser, keysEqual } from './user';
import { registerDevice } from './connections';
import { getDB, IData, IGroup } from './db';
import { isid, newid } from './common';
import { eventHandlers, getCurrentConnection, IConnection, remotelyCallableFunctions, RPC } from './remote-calls';

export interface IInvitation extends IData {
  type: 'Invitation',
  publicKey: string,
  secretKey: string,
  read?: boolean,
  write?: boolean,
  admin?: boolean,
}

export interface IInviteDetails {
  id: string,
  group: string,
  publicKey: string
}

export const IInviteAcceptType = 'InviteAccept';

export interface IInviteAccept extends IData {
  type: 'InviteAccept'
  invitation: IInviteDetails
}

export async function createInvitation(group: string, expires?: number, read = true, write = true, admin = false): Promise<IInviteDetails> {
  if (!expires) {
    expires = Date.now() + 1000 * 60 * 60 * 24 * 7; // in 7 days
  }
  const userId = await initUser()
  const keys = newUser();
  const invitation: IInvitation = {
    id: newid(),
    type: 'Invitation',
    group,
    owner: userId,
    modified: Date.now(),
    ttl: expires,
    read,
    write,
    admin,
    publicKey: keys.publicKey,
    secretKey: keys.secretKey
  }
  signObject(invitation); // this assumes the current user has permissions (admin) to invite users.  That won't be verified until the invitation is used.
  const db = await getDB();
  await db.save(invitation);
  return {
    id: invitation.id,
    group,
    publicKey: invitation.publicKey,
  };
}

export async function acceptInvitation(invite: IInviteDetails) {
  const { id, group, publicKey } = invite;
  const userId = await initUser()
  const db = await getDB();

  const inviteAccept: IInviteAccept = {
    id: newid(),
    type: IInviteAcceptType,
    group: userId,
    owner: userId,
    modified: Date.now(),
    invitation: {
      id,
      group,
      publicKey
    },
  }
  signObject(inviteAccept);
  await db.save(inviteAccept);
  if (pendingInvites) {
    pendingInvites.push(inviteAccept);
  }
  await registerDevice();
  return inviteAccept;
}

let pendingInvites: IInviteAccept[];
export async function checkPendingInvitations(connection: IConnection) {
  if (!pendingInvites) {
    const db = await getDB();
    pendingInvites = (await db.find(IInviteAcceptType, 'type')) as IInviteAccept[];
  }
  let groupJoined = false;
  for (const pendingInvite of pendingInvites) {
    const { invitation } = pendingInvite;
    // if (connection.groups.includes(invitation.group)) {
    try {
      const idToSign = newid();
      const signedId = await RPC(connection, verifyInvitationSender)(invitation.id, idToSign);
      const openedId = openMessage(signedId, invitation.publicKey);
      if (openedId !== idToSign) {
        continue;
      }
      const group = await RPC(connection, confirmInvitation)(invitation.id, invitation.publicKey);
      const db = await getDB();
      await db.save(group);
      eventHandlers.onRemoteDataSaved(group);

      // @ts-ignore
      pendingInvite.type = "Deleted"
      signObject(pendingInvite);
      await db.save(pendingInvite);
      groupJoined = true;
    } catch (err) { 
      console.error('Error processing invite', pendingInvite, err);
    }
  }
  if (groupJoined) {
    registerDevice();
  }
}

async function verifyInvitationSender(inviteId: string, idToSign: string) {
  if (!isid(idToSign)) {
    throw new Error(`${idToSign} is not an id. Only ids are accepted as prompts to verify identity`)
  }
  const db = await getDB();
  const invite = await db.get(inviteId) as IInvitation;
  if (invite.type === 'Invitation') {
    return signMessageWithSecretKey(idToSign, invite.secretKey);
  } else {
    throw new Error('invalid invitation id');
  }
}

remotelyCallableFunctions.verifyInvitationSender = verifyInvitationSender;

async function confirmInvitation(inviteId: string, publicKey: string) {
  const connection = getCurrentConnection();
  const db = await getDB();
  const invitation = await db.get(inviteId) as IInvitation;
  if (!invitation || invitation.type !== 'Invitation' || !keysEqual(invitation.publicKey, publicKey)) {
    throw new Error('Invalid invitation id or secret');
  }
  if (invitation.ttl < Date.now()) {
    throw new Error('invitation has expired');
  }
  const group = await db.get(invitation.group) as IGroup;
  let member = group.members.find(m => m.userId === connection.remoteUser.id);
  if (!member) {
    member = {
      userId: connection.remoteUser.id
    }
    group.members.push(member)
  }
  member.read = member.read || invitation.read
  member.write = member.write || invitation.write
  member.admin = member.admin || invitation.admin
  group.modified = Date.now();
  signObject(group);
  await db.save(group);
  return group
}

remotelyCallableFunctions.confirmInvitation = confirmInvitation;