/**
 * When this device last had the note board open.
 *
 * One timestamp, on the device, behind the badge on the Notes tab. See
 * `src/core/notes/unseen.ts` for why it is derived rather than stored per
 * person per note.
 *
 * The seeding is the part worth reading. `lastSeenAt` starts as `null`, and a
 * first hydrate that finds nothing stored **writes the current moment** rather
 * than leaving it null: every note on the board predates the install, none of
 * it is news, and a "9+" on a phone that has never shown the board is the
 * opposite of a notification. From then on the value only moves forward, as
 * the board is looked at.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'chorus.notes.seen.v1';

interface NoteSeenState {
  /** ISO-8601, or null until hydrate has run. */
  readonly lastSeenAt: string | null;
  /** False until the stored value has been read, so nothing is written over it. */
  readonly hydrated: boolean;
  /**
   * Record that the board has been seen as of `at`.
   *
   * Monotonic: an earlier timestamp is ignored. The board marks itself seen on
   * focus *and* whenever the list changes while it is open, so two marks can
   * arrive out of order — a stale one must not un-see newer notes.
   */
  readonly markSeen: (at: string) => void;
  readonly hydrate: () => Promise<void>;
}

export const useNoteSeenStore = create<NoteSeenState>((set, get) => ({
  lastSeenAt: null,
  hydrated: false,

  markSeen: (at) => {
    const current = get().lastSeenAt;
    if (current !== null && at <= current) return;
    set({ lastSeenAt: at });
    // Fire and forget: a failed write costs one badge, and blocking the board's
    // first render on disk would be far worse.
    void AsyncStorage.setItem(STORAGE_KEY, at);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw !== null && raw !== '') {
        set({ lastSeenAt: raw });
        return;
      }
      // Nothing stored: this device has never opened the board. Treat
      // everything already on it as read — see the note above.
      const now = new Date().toISOString();
      set({ lastSeenAt: now });
      void AsyncStorage.setItem(STORAGE_KEY, now);
    } catch {
      /*
       * Unreadable storage leaves `lastSeenAt` null, which the counter reads as
       * "nothing is new". Deliberately the quiet failure: a badge that never
       * appears is a missing nicety, where one that never clears is a
       * permanent red dot nobody can dismiss.
       */
    } finally {
      set({ hydrated: true });
    }
  },
}));

export const useLastSeenNotes = (): string | null => useNoteSeenStore((s) => s.lastSeenAt);
