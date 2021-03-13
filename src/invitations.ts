import { ISigned, signObject, verifySignedObject } from './user';
import { registerDevice, me } from './connections';
import { getIndexedDB, IData, IGroup } from './db';
import { newid } from './common';
import { getCurrentConnection, IConnection, remotelyCallableFunctions, RPC } from './remote-calls';

export interface IInvitation extends ISigned {
  group: string,
  expires: number,
  publicKey: string,
  read?: boolean,
  write?: boolean,
  admin?: boolean,
}

export const IInviteAcceptType = 'InviteAccept';

export interface IInviteAccept extends IData {
  type: 'InviteAccept'
  invitation: IInvitation
}

export function createInvitation(groupId: string, expires?: number, read = true, write = true, admin = false) {
  if (!expires) {
    expires = Date.now() + 1000 * 60 * 60 * 24 * 30; // in 30 days
  }
  const invitation: IInvitation = { 
    group: groupId, expires, publicKey: me.publicKey, read, write, admin
  }
  signObject(invitation); // this assumes the current user has permissions (admin) to invite users.  That won't be verified until the invitation is used.
  return invitation;
}

export async function acceptInvitation(invitation: IInvitation) {
  const db = await getIndexedDB();
  const inviteAccept: IInviteAccept = {
    id: newid(),
    type: IInviteAcceptType,
    group: me.id,
    owner: me.id,
    invitation,
    modified: Date.now(),    
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
  for (const invite of pendingInvites) {
    const { invitation } = invite;
    if (invitation.signer == connection.remoteUser.id && invitation.publicKey == connection.remoteUser.publicKey) {
      const db = await getIndexedDB();
      const group = await RPC(connection, presentInvitation)(invitation);
      await db.save(group);
      // @ts-ignore
      invite.type = "Deleted"
      signObject(invite);
      await db.save(invite);
    }
  }
}

async function presentInvitation(invitation: IInvitation) {
  const connection = getCurrentConnection();
  verifySignedObject(invitation, me.publicKey)
  if (invitation.expires < Date.now()) {
    throw new Error('invitation has expired');
  }
  const db = await getIndexedDB();
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
  return group;
}

remotelyCallableFunctions.presentInvitation = presentInvitation;