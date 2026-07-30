/**
 * Environment configuration, validated once at module load.
 *
 * Expo inlines `EXPO_PUBLIC_*` variables at build time — a variable without that
 * prefix is silently `undefined` at runtime, which produces a confusing 401
 * rather than an obvious error. So these are read statically (not through a
 * computed key, which Expo cannot inline) and checked immediately.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill in your ` +
        `Supabase project's URL and publishable key.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(url, 'EXPO_PUBLIC_SUPABASE_URL'),
  /**
   * The publishable key (`sb_publishable_…`), formerly called the anon key.
   *
   * Safe to ship in a client bundle: it does not bypass row level security. The
   * secret key (`sb_secret_…`) runs as a role with BYPASSRLS and must never
   * appear here. See docs/DATA_MODEL.md.
   */
  supabasePublishableKey: required(publishableKey, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
} as const;
