import AsyncStorage from '@react-native-async-storage/async-storage';

import { useNoteSeenStore } from './noteSeenStore';

const KEY = 'chorus.notes.seen.v1';

function reset(): void {
  useNoteSeenStore.setState({ lastSeenAt: null, hydrated: false });
}

describe('noteSeenStore', () => {
  beforeEach(async () => {
    reset();
    await AsyncStorage.clear();
  });

  // After, not before. A spy on AsyncStorage set up in one test survived a
  // `restoreAllMocks()` at the top of the next one and made two later tests
  // fail on "no disk" — which read as the store being broken.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds the current moment on a device with nothing stored', async () => {
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-30T12:00:00.000Z');

    await useNoteSeenStore.getState().hydrate();

    expect(useNoteSeenStore.getState().lastSeenAt).toBe('2026-09-30T12:00:00.000Z');
    // Persisted, not just held: a relaunch must not re-seed to a later moment
    // and hide notes written in between.
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('2026-09-30T12:00:00.000Z');
  });

  it('restores a stored moment rather than seeding over it', async () => {
    await AsyncStorage.setItem(KEY, '2026-09-01T08:00:00.000Z');

    await useNoteSeenStore.getState().hydrate();

    expect(useNoteSeenStore.getState().lastSeenAt).toBe('2026-09-01T08:00:00.000Z');
  });

  it('marks hydrated even when storage throws', async () => {
    // `Once`, deliberately: `jest.spyOn` keeps calling through to the real
    // implementation afterwards, whereas a permanent `mockRejectedValue`
    // survived `restoreAllMocks()` here and failed the two tests below on
    // "no disk" — which read as the store being broken.
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('no disk'));

    await useNoteSeenStore.getState().hydrate();

    expect(useNoteSeenStore.getState().hydrated).toBe(true);
    // Null, which the counter reads as "nothing new" — a missing badge rather
    // than one that can never be cleared.
    expect(useNoteSeenStore.getState().lastSeenAt).toBeNull();
  });

  it('moves the moment forward and persists it', async () => {
    await useNoteSeenStore.getState().hydrate();
    useNoteSeenStore.getState().markSeen('2027-01-01T00:00:00.000Z');

    expect(useNoteSeenStore.getState().lastSeenAt).toBe('2027-01-01T00:00:00.000Z');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('2027-01-01T00:00:00.000Z');
  });

  it('ignores a stale mark, so nothing already seen comes back', async () => {
    await AsyncStorage.setItem(KEY, '2026-09-30T12:00:00.000Z');
    await useNoteSeenStore.getState().hydrate();

    useNoteSeenStore.getState().markSeen('2026-09-30T11:00:00.000Z');

    expect(useNoteSeenStore.getState().lastSeenAt).toBe('2026-09-30T12:00:00.000Z');
  });
});
