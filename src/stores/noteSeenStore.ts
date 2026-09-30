/**
 * When this device last had the note board open.
 *
 * One timestamp, on the device, behind the badge on the Notes tab. See
 * `src/core/notes/unseen.ts` for why it is derived rather than stored per
 * person per note.
 *
 * The value is **always a stamp copied off a note**, never a reading of this
 * phone's clock. That is what makes the monotonic rule below safe: two phones
 * whose clocks disagree still write comparable values, and a phone that
 * briefly thinks it is 2027 cannot write a moment nothing will ever exceed.
 *
 * `null` until a list has been seen, which the counter reads as "nothing is
 * new" — the right answer for a fresh install, where every note predates it.
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
   * Record that the board has been seen up to `at` — a note's own `updatedAt`.
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
      if (raw !== null && raw !== '') set({ lastSeenAt: raw });
      // Nothing stored: left null on purpose. The tab bar seeds it from the
      // newest note as soon as a list arrives, which is a server stamp rather
      // than a guess at what this phone thinks the time is.
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
