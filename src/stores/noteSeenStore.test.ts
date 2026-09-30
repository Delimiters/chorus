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

  /*
   * Null, not "now". The store used to seed the device clock here, which put a
   * reading of this phone's time into a value compared against Postgres
   * timestamps — and `markSeen` only moves forward, so a phone that briefly
   * thought it was 2027 would have killed its own badge for a year. The tab
   * bar seeds from the newest note instead.
   */
  it('stays empty on a device with nothing stored, rather than guessing at the time', async () => {
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2027-01-01T00:00:00.000Z');

    await useNoteSeenStore.getState().hydrate();

    expect(useNoteSeenStore.getState().lastSeenAt).toBeNull();
    await expect(AsyncStorage.getItem(KEY)).resolves.toBeNull();
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
    useNoteSeenStore.getState().markSeen('2026-10-01T09:00:00.000Z');

    expect(useNoteSeenStore.getState().lastSeenAt).toBe('2026-10-01T09:00:00.000Z');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('2026-10-01T09:00:00.000Z');
  });

  it('ignores a stale mark, so nothing already seen comes back', async () => {
    await AsyncStorage.setItem(KEY, '2026-09-30T12:00:00.000Z');
    await useNoteSeenStore.getState().hydrate();

    useNoteSeenStore.getState().markSeen('2026-09-30T11:00:00.000Z');

    expect(useNoteSeenStore.getState().lastSeenAt).toBe('2026-09-30T12:00:00.000Z');
  });
});
