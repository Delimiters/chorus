/**
 * Registering this device as somewhere a push can be sent.
 *
 * ADR-0005 deferred remote push behind a `NotificationTransport` seam because
 * it needs an APNs key, which needs a paid Apple Developer membership. Jake
 * enrolled on 2026-09-23 and it activated the next day, so the one thing local
 * notifications structurally cannot do — *"tell you your housemate completed
 * something"* — is now reachable.
 *
 * The table has existed since the first migration, unused. This is the first
 * thing to write to it, and it is deliberately the *whole* of this change: a
 * token has to have been collected before the first send can work, and tokens
 * arrive one app-launch at a time. Shipping the address book ahead of the
 * sender means the sender works for both of them on its first day rather than
 * on their next launch.
 */

import { supabase } from '../supabase';

/**
 * Remember this device, or update what we already knew.
 *
 * Upserted on `token`, which is unique: a device that re-registers must update
 * in place. Re-registration is ordinary — Expo reissues a token after a
 * reinstall, an OS upgrade, or occasionally for no visible reason.
 *
 * `last_seen_at` is bumped every time, so a token nobody has launched in
 * months can eventually be told apart from a live one. Nothing prunes yet;
 * Expo reports unregistered tokens in its send receipts, which is the honest
 * place to learn a device is gone.
 */
export async function registerPushToken(input: {
  userId: string;
  token: string;
  platform: 'ios' | 'android';
  deviceName: string | null;
}): Promise<void> {
  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: input.userId,
      token: input.token,
      platform: input.platform,
      device_name: input.deviceName,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'token' },
  );
  if (error) throw new Error(error.message);
}

/**
 * Forget this device.
 *
 * Called on sign-out. A phone somebody has signed out of must stop receiving
 * the household's business, and the alternative — leaving the row and
 * filtering at send time — puts the mistake one forgotten `where` away.
 */
export async function forgetPushToken(token: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  if (error) throw new Error(error.message);
}
