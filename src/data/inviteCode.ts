/**
 * Invite code formatting and generation.
 *
 * Deliberately separate from `api/invites.ts`: this is pure string handling with
 * no imports at all, so it can be tested without constructing a Supabase client.
 * The network calls live next door.
 */

/**
 * The code alphabet: digits and letters minus vowels and the glyphs that get
 * misread aloud (I, O, U). Codes get read across a kitchen, so ambiguity between
 * 0/O and 1/I is a real usability problem rather than a theoretical one.
 *
 * Must stay in step with the CHECK constraint on `household_invites.code`.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;

/**
 * Generates a code.
 *
 * Uses `crypto.getRandomValues` where available. A guessable code would let a
 * stranger join the household, so this must not come from `Math.random` in
 * practice — the fallback exists only so an unexpected environment degrades
 * rather than crashes.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let out = '';
  for (const byte of bytes) {
    out += CODE_ALPHABET[byte % CODE_ALPHABET.length] as string;
  }
  return out;
}

/** Formats for display: `7K4M-92XB`. Easier to read back accurately. */
export function formatInviteCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Accepts what a person might actually type — lowercase, spaces, any dash. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}
