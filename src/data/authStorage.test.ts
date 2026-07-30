/**
 * Tests for the chunked keychain adapter.
 *
 * This is the piece where a bug means "the user is silently signed out on next
 * launch", which is both infuriating and hard to reproduce — so it gets real
 * coverage, including the interrupted-write cases.
 */

import { createChunkedStore, splitChunks, type SecureStoreLike } from './authStorage';

/** In-memory SecureStore stand-in that can be made to fail mid-write. */
function fakeStore(): SecureStoreLike & {
  entries: Map<string, string>;
  failAfterWrites: number | null;
} {
  const entries = new Map<string, string>();
  let writes = 0;

  return {
    entries,
    failAfterWrites: null,
    async getItemAsync(key) {
      return entries.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      writes += 1;
      if (this.failAfterWrites !== null && writes > this.failAfterWrites) {
        throw new Error('keychain unavailable');
      }
      entries.set(key, value);
    },
    async deleteItemAsync(key) {
      entries.delete(key);
    },
  };
}

const CHUNK = 10;

describe('splitChunks', () => {
  it('splits into pieces of at most the chunk size', () => {
    expect(splitChunks('abcdefghijklmno', 10)).toEqual(['abcdefghij', 'klmno']);
  });

  it('returns a single empty chunk for an empty string', () => {
    // Otherwise an empty value would produce a zero-chunk manifest, which reads
    // back as absent rather than as an empty string.
    expect(splitChunks('', 10)).toEqual(['']);
  });

  it('does not pad the final chunk', () => {
    expect(splitChunks('abc', 10)).toEqual(['abc']);
  });

  it('reassembles to the original for any length', () => {
    for (const length of [0, 1, 9, 10, 11, 100, 1023]) {
      const value = 'x'.repeat(length);
      expect(splitChunks(value, 10).join('')).toBe(value);
    }
  });
});

describe('round trip', () => {
  it('stores and retrieves a value larger than one chunk', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);
    const session = 'a'.repeat(95);

    await store.setItem('session', session);
    expect(await store.getItem('session')).toBe(session);
  });

  it('stores a value that fits in one chunk', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);
    await store.setItem('session', 'short');
    expect(await store.getItem('session')).toBe('short');
  });

  it('handles a realistically sized session', async () => {
    // A Supabase session with two JWTs and a user object comfortably exceeds
    // SecureStore's documented 2048-byte limit, which is the whole reason this
    // adapter exists.
    const backend = fakeStore();
    const store = createChunkedStore(backend);
    // Sizes taken from a real Supabase session: a signed JWT access token runs
    // to roughly a kilobyte on its own, before the user object.
    const session = JSON.stringify({
      access_token: `${'h'.repeat(36)}.${'p'.repeat(1100)}.${'s'.repeat(43)}`,
      refresh_token: 'r'.repeat(64),
      expires_at: 1799999999,
      token_type: 'bearer',
      user: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'someone@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { display_name: 'Someone', extra: 'x'.repeat(900) },
      },
    });
    expect(session.length).toBeGreaterThan(2048);

    await store.setItem('session', session);
    expect(await store.getItem('session')).toBe(session);
  });

  it('returns null for a key never written', async () => {
    const store = createChunkedStore(fakeStore(), CHUNK);
    expect(await store.getItem('nope')).toBeNull();
  });

  it('round-trips unicode without splitting it into mojibake', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);
    const value = 'Zoë—Ünïcodé 🎵🎶 chores';
    await store.setItem('session', value);
    expect(await store.getItem('session')).toBe(value);
  });
});

describe('overwriting', () => {
  it('replaces a longer value with a shorter one, leaving no stale chunks', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);

    await store.setItem('session', 'a'.repeat(95)); // 10 chunks
    await store.setItem('session', 'b'.repeat(15)); // 2 chunks

    expect(await store.getItem('session')).toBe('b'.repeat(15));
    // Stale chunks would otherwise linger and be concatenated if the value grew
    // again later.
    const chunkKeys = [...backend.entries.keys()].filter((k) => /^session\.\d+$/.test(k));
    expect(chunkKeys).toHaveLength(2);
  });

  it('replaces a shorter value with a longer one', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);
    await store.setItem('session', 'short');
    await store.setItem('session', 'c'.repeat(55));
    expect(await store.getItem('session')).toBe('c'.repeat(55));
  });
});

describe('removal', () => {
  it('removes every chunk and the manifest', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);

    await store.setItem('session', 'a'.repeat(45));
    await store.removeItem('session');

    expect(await store.getItem('session')).toBeNull();
    expect([...backend.entries.keys()].filter((k) => k.startsWith('session'))).toEqual([]);
  });

  it('is safe to call for a key that was never written', async () => {
    const store = createChunkedStore(fakeStore(), CHUNK);
    await expect(store.removeItem('nope')).resolves.toBeUndefined();
  });

  it('is idempotent', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);
    await store.setItem('session', 'value');
    await store.removeItem('session');
    await expect(store.removeItem('session')).resolves.toBeUndefined();
  });
});

describe('partial writes read as absent, never as truncated', () => {
  // The reason chunks are written before the manifest. "Signed out" is a state
  // the app handles; a half-parsed session is not.
  it('reads null when the write died before the manifest', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);

    backend.failAfterWrites = 3; // three chunks land, manifest does not
    await expect(store.setItem('session', 'a'.repeat(95))).rejects.toThrow();

    expect(await store.getItem('session')).toBeNull();
  });

  it('reads null when a chunk has gone missing', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);
    await store.setItem('session', 'a'.repeat(95));

    backend.entries.delete('session.4');

    expect(await store.getItem('session')).toBeNull();
  });

  it('reads null for a corrupt manifest', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);
    await store.setItem('session', 'value');

    for (const bogus of ['not-a-number', '0', '-1', '1.5', '']) {
      backend.entries.set('session.chunks', bogus);
      expect(await store.getItem('session')).toBeNull();
    }
  });
});

describe('key isolation', () => {
  it('keeps separate keys separate', async () => {
    const backend = fakeStore();
    const store = createChunkedStore(backend, CHUNK);

    await store.setItem('a', 'a'.repeat(25));
    await store.setItem('b', 'b'.repeat(35));

    expect(await store.getItem('a')).toBe('a'.repeat(25));
    expect(await store.getItem('b')).toBe('b'.repeat(35));

    await store.removeItem('a');
    expect(await store.getItem('b')).toBe('b'.repeat(35));
  });
});
