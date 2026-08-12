/**
 * How this device shows routines.
 *
 * On the device rather than in the database, for the same reason the reminder
 * and view preferences are: these are facts about how *you* read the screen,
 * not about the household. The cost is that they do not follow you to a second
 * phone, which is the right trade for something set roughly once.
 *
 * Note what `showOthers` is and is not. It hides housemates' routines
 * wholesale, whether or not they have shared them — a display filter over rows
 * the database already permits you to read. It is not a privacy control, and
 * the Settings copy says so; the privacy control is the other person's own
 * share switch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'chorus.routines.v1';

/** Which half of the Today tab you were last looking at. */
export type TodayMode = 'chores' | 'routines';

const MODES: readonly TodayMode[] = ['chores', 'routines'];

export interface RoutinePreference {
  readonly showOthers: boolean;
  readonly shareByDefault: boolean;
  readonly todayMode: TodayMode;
}

export const DEFAULT_ROUTINE_PREFERENCE: RoutinePreference = {
  showOthers: true,
  // Private by default. Somebody who wants everything shared flips this once
  // and stops thinking about it; the alternative discloses by accident.
  shareByDefault: false,
  todayMode: 'chores',
};

interface RoutineState {
  readonly preference: RoutinePreference;
  /** False until the stored value has been read, so nothing is written over it. */
  readonly hydrated: boolean;
  readonly setShowOthers: (show: boolean) => void;
  readonly setShareByDefault: (share: boolean) => void;
  readonly setTodayMode: (mode: TodayMode) => void;
  readonly hydrate: () => Promise<void>;
}

function persist(preference: RoutinePreference): void {
  // Fire and forget: a failed write costs a preference, not correctness, and
  // blocking a toggle on disk would make it feel broken.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
}

export const useRoutineStore = create<RoutineState>((set, get) => ({
  preference: DEFAULT_ROUTINE_PREFERENCE,
  hydrated: false,

  setShowOthers: (showOthers) => {
    const preference = { ...get().preference, showOthers };
    set({ preference });
    persist(preference);
  },

  setShareByDefault: (shareByDefault) => {
    const preference = { ...get().preference, shareByDefault };
    set({ preference });
    persist(preference);
  },

  setTodayMode: (todayMode) => {
    const preference = { ...get().preference, todayMode };
    set({ preference });
    persist(preference);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const stored = JSON.parse(raw) as Partial<RoutinePreference>;
        set({
          preference: {
            ...DEFAULT_ROUTINE_PREFERENCE,
            // Each field defended on its own. A blob written by an older
            // version is missing keys rather than malformed, and losing every
            // preference because one is absent would be a poor trade.
            ...(typeof stored.showOthers === 'boolean' ? { showOthers: stored.showOthers } : {}),
            ...(typeof stored.shareByDefault === 'boolean'
              ? { shareByDefault: stored.shareByDefault }
              : {}),
            // Membership, not `typeof`: a stored mode from some future version
            // must fall back to the default rather than reaching a switch that
            // matches no branch.
            ...(MODES.includes(stored.todayMode as TodayMode)
              ? { todayMode: stored.todayMode as TodayMode }
              : {}),
          },
        });
      }
    } catch {
      // Unreadable preferences are not worth a crash on launch; the defaults
      // are perfectly usable and the next change overwrites them.
    } finally {
      set({ hydrated: true });
    }
  },
}));

export const useRoutinePreference = (): RoutinePreference => useRoutineStore((s) => s.preference);
