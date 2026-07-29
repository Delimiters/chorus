/**
 * Clients for the integration suite.
 *
 * Three roles, and the distinction between them is the whole point:
 *
 *   admin  — the secret key. Bypasses RLS entirely. Setup and teardown ONLY.
 *   alice  — a real signed-in user in household A.
 *   bob    — a real signed-in user in household B.
 *
 * A lint rule fails the build if `admin` appears inside an `expect()`, because
 * an RLS test that asserts through the service role passes forever while
 * proving nothing. See docs/TESTING.md.
 */

import { execFileSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/data/database.types';

export type Client = SupabaseClient<Database>;

interface LocalStack {
  readonly apiUrl: string;
  readonly publishableKey: string;
  readonly secretKey: string;
}

/**
 * Reads the local stack's URL and keys from the Supabase CLI.
 *
 * Preferring the CLI over hardcoded constants means the suite keeps working when
 * the CLI rotates its local demo keys, and it fails with a clear message rather
 * than a confusing 401 when the stack simply isn't running.
 */
export function localStack(): LocalStack {
  const fromEnv = process.env['SUPABASE_API_URL'];
  if (fromEnv !== undefined) {
    return {
      apiUrl: fromEnv,
      publishableKey: requireEnv('SUPABASE_PUBLISHABLE_KEY'),
      secretKey: requireEnv('SUPABASE_SECRET_KEY'),
    };
  }

  let raw: string;
  try {
    raw = execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error(
      'Could not read the local Supabase stack. Start it first:\n' +
        '  colima start\n' +
        '  supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit',
    );
  }

  const status = JSON.parse(raw) as Record<string, string>;
  return {
    apiUrl: required(status, 'API_URL'),
    publishableKey: required(status, 'PUBLISHABLE_KEY'),
    secretKey: required(status, 'SECRET_KEY'),
  };
}

function required(obj: Record<string, string>, key: string): string {
  const value = obj[key];
  if (value === undefined) throw new Error(`Missing ${key} in supabase status output`);
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const NO_PERSIST = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/** Service-role client. Bypasses RLS. Setup and teardown only — never assertions. */
export function adminClient(): Client {
  const { apiUrl, secretKey } = localStack();
  return createClient<Database>(apiUrl, secretKey, NO_PERSIST);
}

/** An anonymous client with no session. */
export function anonClient(): Client {
  const { apiUrl, publishableKey } = localStack();
  return createClient<Database>(apiUrl, publishableKey, NO_PERSIST);
}

/**
 * Creates a user via the admin API and returns a client signed in as them.
 *
 * `email_confirm` short-circuits the confirmation email, which the local stack
 * would otherwise require before password sign-in works.
 */
export async function createUser(
  email: string,
  displayName: string,
): Promise<{ client: Client; userId: string }> {
  const admin = adminClient();
  const password = 'test-password-123';

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  const userId = data.user.id;

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Could not sign in ${email}: ${signIn.error.message}`);

  return { client, userId };
}

/** Removes users created by a test, cascading to their households. */
export async function deleteUsers(userIds: readonly string[]): Promise<void> {
  const admin = adminClient();
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
}

/** A unique email per run, so repeated local runs don't collide. */
export function uniqueEmail(prefix: string): string {
  const suffix = process.hrtime.bigint().toString(36);
  return `${prefix}-${suffix}@example.test`;
}

/**
 * A random invite code matching the schema's alphabet.
 *
 * No vowels and no ambiguous glyphs, so it survives being read aloud. Unique per
 * call so repeated local runs don't collide on the unique constraint.
 */
export function uniqueInviteCode(): string {
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)] as string;
  }
  return out;
}
