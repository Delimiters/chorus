/**
 * Invites.
 *
 * Creating one is an ordinary insert. Redeeming one is not: a person who is not
 * yet a member must be able to redeem a code without being able to read it, or
 * they could enumerate every invite in the database. That needs a SECURITY
 * DEFINER RPC. See docs/DATA_MODEL.md.
 */

import { CODE_LENGTH, generateInviteCode, normalizeInviteCode } from '../inviteCode';
import { describeError, supabase } from '../supabase';

export { formatInviteCode, generateInviteCode, normalizeInviteCode } from '../inviteCode';

export interface Invite {
  readonly id: string;
  readonly code: string;
  readonly expiresAt: string;
  readonly redeemedAt: string | null;
}

function fail(error: { code?: string | undefined; message: string }): never {
  throw new Error(describeError(error));
}

export async function createInvite(householdId: string): Promise<Invite> {
  const code = generateInviteCode();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userId === undefined) throw new Error('Please sign in again.');

  const { data, error } = await supabase
    .from('household_invites')
    .insert({ household_id: householdId, code, created_by: userId })
    .select('id, code, expires_at, redeemed_at')
    .single();
  if (error) fail(error);

  return {
    id: data.id,
    code: data.code,
    expiresAt: data.expires_at,
    redeemedAt: data.redeemed_at,
  };
}

/** The most recent unredeemed, unexpired invite, if there is one. */
export async function getActiveInvite(householdId: string): Promise<Invite | null> {
  const { data, error } = await supabase
    .from('household_invites')
    .select('id, code, expires_at, redeemed_at')
    .eq('household_id', householdId)
    .is('redeemed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) fail(error);

  const row = data?.[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    code: row.code,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
  };
}

/**
 * Redeems a code and returns the household joined.
 *
 * Distinguishes invalid / already-used / expired, because "that didn't work" is a
 * dead end and each of these has a different next action.
 */
export async function redeemInvite(rawCode: string): Promise<string> {
  const code = normalizeInviteCode(rawCode);
  if (code.length !== CODE_LENGTH) {
    throw new Error(`An invite code is ${CODE_LENGTH} characters. Check what you typed.`);
  }

  const { data, error } = await supabase.rpc('redeem_invite', { invite_code: code });
  if (error) fail(error);
  return data as string;
}
