import { signObject, newUser, signMessageWithSecretKey, openMessage } from './user';
import { registerDevice, me } from './connections';
import { getIndexedDB, IData, IGroup } from './db';
import { newid } from './common';
import { getCurrentConnection, IConnection, remotelyCallableFunctions, RPC } from './remote-calls';

export interface IInvitation extends IData {
  type: 'Invitation',
  publicKey: string, 
  secretKey: string,
  expires: number,
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
    expires = Date.now() + 1000 * 60 * 60 * 24 * 30; // in 30 days
  }
  const keys = newUser();
  const invitation: IInvitation = { 
    id: newid(), 
    type: 'Invitation',   
    group, 
    owner: me.id,
    modified: Date.now(),
    expires,
    read, 
    write, 
    admin,
    publicKey: keys.publicKey,
    secretKey: keys.secretKey
  }
  signObject(invitation); // this assumes the current user has permissions (admin) to invite users.  That won't be verified until the invitation is used.
  const db = await getIndexedDB();
  await db.save(invitation);
  return {
    id: invitation.id,
    group,
    publicKey: invitation.publicKey,
  };
}

export async function acceptInvitation(group: string, id: string, publicKey: string) {
  const db = await getIndexedDB();
  const inviteAccept: IInviteAccept = {
    id: newid(),
    type: IInviteAcceptType,
    group: me.id,
    owner: me.id,
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
}

let pendingInvites: IInviteAccept[];
export async function checkPendingInvitations(connection: IConnection) {
  if (!pendingInvites) {
    const db = await getIndexedDB();
    pendingInvites = (await db.find(IInviteAcceptType, 'type')) as IInviteAccept[];
  }
  for (const pendingInvite of pendingInvites) {
    const { invitation } = pendingInvite;
    if (connection.groups.includes(invitation.group)) {
      const db = await getIndexedDB();
      const idToSign = newid();
      const signedId = await RPC(connection, verifyInvitationSender)(invitation.id, idToSign);
      const openedId = openMessage(signedId, invitation.publicKey);
      if (openedId !== idToSign) {
        continue;
      }
      const group = await RPC(connection, presentInvitation)(invitation.id, invitation.publicKey);
      await db.save(group);
      
      // @ts-ignore
      pendingInvite.type = "Deleted"
      signObject(pendingInvite);
      await db.save(pendingInvite);
    }
  }
}

async function verifyInvitationSender(inviteId: string, idToSign: string) {
  const db = await getIndexedDB();
  const invite = await db.get(inviteId) as IInvitation;
  if (invite.type === 'Invitation') {
    return signMessageWithSecretKey(idToSign, invite.secretKey);
  } else {
    throw new Error('invalid invitation id');
  }
}

remotelyCallableFunctions.presentInvitation = verifyInvitationSender;

async function presentInvitation(inviteId: string, publicKey: string) {
  const connection = getCurrentConnection();
  const db = await getIndexedDB();
  const invitation = await db.get(inviteId) as IInvitation;
  if (!invitation || invitation.type !== 'Invitation' || invitation.publicKey !== publicKey) {
    throw new Error('Invalid invitation id or secret');
  }
  if (invitation.expires < Date.now()) {
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

remotelyCallableFunctions.presentInvitation = presentInvitation;