/**
 * Where the auth session lives on disk.
 *
 * ## Why not plain AsyncStorage
 *
 * AsyncStorage is unencrypted plain text. On a rooted or jailbroken device the
 * refresh token — which is a long-lived credential to the account — is readable.
 * `expo-secure-store` is backed by the iOS Keychain and the Android Keystore,
 * which is where a credential belongs.
 *
 * ## Why chunking
 *
 * SecureStore documents a 2048-byte limit per value, and a Supabase session
 * (access token + refresh token + user object) routinely exceeds it. Writes past
 * the limit can fail — sometimes silently — which shows up as "the user is
 * mysteriously signed out on next launch".
 *
 * Supabase's own docs work around this by encrypting the session with AES and
 * keeping only the key in SecureStore, with the ciphertext in AsyncStorage. That
 * works, but it means hand-rolling crypto and pulling in `aes-js` plus a CSPRNG
 * polyfill. Splitting the value across several Keychain entries achieves the
 * same thing — everything stays in the Keychain, nothing is written in the clear,
 * and there is no custom cryptography to get wrong.
 *
 * ## Write ordering
 *
 * Chunks are written first and the manifest last. A write interrupted halfway
 * leaves no manifest, so the value reads as absent rather than as a truncated
 * session that would fail in a confusing way. Absent means "sign in again";
 * corrupt could mean anything.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Chunk size in **characters**, chosen against a 2048-**byte** limit.
 *
 * The previous value of 1536 characters was justified as "leaving headroom for
 * multi-byte UTF-8" — which had it backwards: 1536 characters of 3-byte UTF-8 is
 * 4608 bytes, more than double the limit the chunking exists to respect. Any
 * session carrying a CJK or emoji display name could have exceeded it, producing
 * exactly the silent-signout failure described above.
 *
 * 512 characters is safe for the worst realistic case: 4 bytes per character
 * (astral-plane emoji) is 2048 bytes exactly, and typical JWT payloads are ASCII
 * at 1 byte each.
 */
const CHUNK_SIZE = 512;

/** Suffix for the entry recording how many chunks a value occupies. */
const MANIFEST = '.chunks';

/** How many stale chunks to attempt to clear when a value shrinks. */
const MAX_STALE_SWEEP = 32;

/**
 * The interface `supabase-js` expects for `auth.storage`. Declared locally
 * rather than imported so this module stays independently testable.
 */
export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The SecureStore surface we use, narrowed so tests can substitute a fake. */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

/** Splits a string into pieces of at most `size` characters. */
export function splitChunks(value: string, size = CHUNK_SIZE): string[] {
  if (value.length === 0) return [''];
  const out: string[] = [];
  for (let i = 0; i < value.length; i += size) {
    out.push(value.slice(i, i + size));
  }
  return out;
}

/**
 * Builds a chunked storage adapter over any SecureStore-like backend.
 *
 * Exported as a factory so tests can drive it with an in-memory fake instead of
 * a real Keychain.
 */
export function createChunkedStore(backend: SecureStoreLike, chunkSize = CHUNK_SIZE): AuthStorage {
  return {
    async getItem(key) {
      const manifest = await backend.getItemAsync(key + MANIFEST);
      if (manifest === null) return null;

      const count = Number(manifest);
      if (!Number.isInteger(count) || count < 1) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await backend.getItemAsync(chunkKey(key, i));
        // A missing chunk means the value is incomplete. Report absent rather
        // than handing back a truncated session.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const chunks = splitChunks(value, chunkSize);

      for (const [index, chunk] of chunks.entries()) {
        await backend.setItemAsync(chunkKey(key, index), chunk);
      }

      // Manifest last: an interrupted write leaves the value readable as absent.
      await backend.setItemAsync(key + MANIFEST, String(chunks.length));

      // Clear anything left by a previously longer value.
      for (let i = chunks.length; i < chunks.length + MAX_STALE_SWEEP; i += 1) {
        const stale = await backend.getItemAsync(chunkKey(key, i));
        if (stale === null) break;
        await backend.deleteItemAsync(chunkKey(key, i));
      }
    },

    async removeItem(key) {
      const manifest = await backend.getItemAsync(key + MANIFEST);
      const count = manifest === null ? 0 : Number(manifest);

      // Delete the manifest first so a partial delete reads as absent.
      await backend.deleteItemAsync(key + MANIFEST);

      const upTo = Number.isInteger(count) && count > 0 ? count : 0;
      for (let i = 0; i < upTo + MAX_STALE_SWEEP; i += 1) {
        if (i >= upTo) {
          const stale = await backend.getItemAsync(chunkKey(key, i));
          if (stale === null) break;
        }
        await backend.deleteItemAsync(chunkKey(key, i));
      }
    },
  };
}

/**
 * Web fallback.
 *
 * SecureStore does not exist in a browser. The app is iOS-first, but expo-router
 * builds for web and a hard crash on import would be a poor way to discover
 * that. `localStorage` is the standard web behaviour and is what supabase-js
 * would use by default there anyway.
 */
const webStorage: AuthStorage = {
  async getItem(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(key);
  },
};

/** The adapter to hand to `supabase-js`. */
export const authStorage: AuthStorage =
  Platform.OS === 'web' ? webStorage : createChunkedStore(SecureStore);
