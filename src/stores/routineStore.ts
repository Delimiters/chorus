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

/**
 * Bumped so the plan actually becomes the default.
 *
 * `todayMode` defaulting to `'plan'` reaches nobody who has already used the
 * app: both phones have a stored `'chores'` from the Chores/Routines switch, and
 * hydrate restores it. The default would have applied only to installs that do
 * not exist.
 *
 * So the mode is re-decided once, and the preferences that have nothing to do
 * with it are carried across rather than reset.
 */
const STORAGE_KEY = 'chorus.routines.v2';
const LEGACY_KEY = 'chorus.routines.v1';

/** Which half of the Today tab you were last looking at. */
export type TodayMode = 'plan' | 'chores' | 'routines';

const MODES: readonly TodayMode[] = ['plan', 'chores', 'routines'];

export interface RoutinePreference {
  readonly showOthers: boolean;
  readonly todayMode: TodayMode;
  /**
   * The last day whose due recurring chores were folded into the plan.
   *
   * **Persisted**, and that is the whole point. It was in memory only, with a
   * comment claiming a relaunch could only ever re-add things you had not
   * removed. That was backwards: `useRemoveFromPlan` deletes the row, so after
   * a relaunch the marker is gone, the row is gone, and the chore is added
   * straight back. "Take off today" survived a re-render and not a restart —
   * a chore that keeps coming back.
   */
  readonly autoPlannedOn: string | null;
}

export const DEFAULT_ROUTINE_PREFERENCE: RoutinePreference = {
  showOthers: true,
  autoPlannedOn: null,
  /*
   * The plan, not the backlog.
   *
   * Whichever mode you were last on is remembered, but a fresh install opens
   * on the plan — the whole argument for building it is that "what am I doing
   * today" should be the question the app opens with, and defaulting to the
   * backlog would put the fifty-row list back in front of you every morning.
   */
  todayMode: 'plan',
};

interface RoutineState {
  readonly preference: RoutinePreference;
  /** False until the stored value has been read, so nothing is written over it. */
  readonly hydrated: boolean;
  /**
   * The last day whose finish moment has already been marked.
   *
   * Here rather than in component state because switching Today's mode
   * unmounts the plan screen, and a `useState` guard therefore replayed the
   * haptic and the confetti every time somebody came back to a finished day.
   * Not persisted to disk: surviving a remount is the whole requirement, and a
   * relaunch is rare enough that a second buzz is a nicety rather than a bug.
   */
  readonly celebratedOn: string | null;
  /**
   * Chores just created with "put it on today" ticked.
   *
   * Each entry carries the day it was queued, and is **kept until it is
   * claimed** or until that day has passed. Clearing unconditionally on the
   * first render afterwards looked reasonable and broke the feature outright:
   * picking a "No date" chore queues it and rewrites its schedule in the same
   * tick, so the very next render still sees an `unscheduled` chore with no
   * occurrence, finds nothing to claim, and threw the intent away before the
   * write had even been issued.
   *
   * A queue of ids rather than plan rows, because a brand-new chore has no
   * occurrence yet — the key is derived from the projected due date, and that
   * does not exist until the schedule has been expanded. Deriving it a second
   * time at the form would be a second recurrence engine, and the two would
   * drift. So the form records the intent and the plan claims it on the next
   * render, where the real key is in hand.
   */
  readonly planOnCreate: readonly { readonly choreId: string; readonly queuedOn: string }[];
  readonly setShowOthers: (show: boolean) => void;
  readonly setTodayMode: (mode: TodayMode) => void;
  readonly markCelebrated: (day: string) => void;
  readonly markAutoPlanned: (day: string) => void;
  readonly queuePlanOnCreate: (choreId: string, queuedOn: string) => void;
  readonly clearPlanOnCreate: (choreIds: readonly string[]) => void;
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
  celebratedOn: null,
  planOnCreate: [],

  setShowOthers: (showOthers) => {
    const preference = { ...get().preference, showOthers };
    set({ preference });
    persist(preference);
  },

  markCelebrated: (celebratedOn) => set({ celebratedOn }),

  markAutoPlanned: (autoPlannedOn) => {
    const preference = { ...get().preference, autoPlannedOn };
    set({ preference });
    persist(preference);
  },

  queuePlanOnCreate: (choreId, queuedOn) =>
    set((state) => ({ planOnCreate: [...state.planOnCreate, { choreId, queuedOn }] })),

  clearPlanOnCreate: (choreIds) =>
    set((state) => ({
      planOnCreate: state.planOnCreate.filter((q) => !choreIds.includes(q.choreId)),
    })),

  setTodayMode: (todayMode) => {
    const preference = { ...get().preference, todayMode };
    set({ preference });
    persist(preference);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);

      /*
       * Nothing under v2 yet, so this is the first launch after the plan
       * landed. Carry the preferences that still mean the same thing and let
       * `todayMode` fall to its new default — which is the whole point of the
       * bump, and the only way the plan reaches a phone that has been used.
       *
       * The v1 blob is left in place rather than deleted: if this ships badly
       * and gets reverted, the old preferences are still there to read.
       */
      if (raw === null) {
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        if (legacy !== null) {
          const old = JSON.parse(legacy) as Partial<RoutinePreference>;
          const carried: RoutinePreference = {
            ...DEFAULT_ROUTINE_PREFERENCE,
            ...(typeof old.showOthers === 'boolean' ? { showOthers: old.showOthers } : {}),
          };
          set({ preference: carried });
          void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(carried));
        }
        return;
      }

      if (raw !== null) {
        const stored = JSON.parse(raw) as Partial<RoutinePreference>;
        set({
          preference: {
            ...DEFAULT_ROUTINE_PREFERENCE,
            // Each field defended on its own. A blob written by an older
            // version is missing keys rather than malformed, and losing every
            // preference because one is absent would be a poor trade.
            ...(typeof stored.showOthers === 'boolean' ? { showOthers: stored.showOthers } : {}),
            ...(typeof stored.autoPlannedOn === 'string'
              ? { autoPlannedOn: stored.autoPlannedOn }
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
