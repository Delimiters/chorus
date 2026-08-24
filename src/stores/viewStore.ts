/**
 * How this device arranges Today.
 *
 * On the device rather than in the household, like the other view preferences:
 * two people looking at the same list may want it organised differently, and
 * neither should be able to rearrange the other's screen.
 *
 * The storage key is versioned. `v1` held `groupBy` and `sortBy`, which have
 * both gone — grouping by category is now carried by the colour on each row,
 * and sorting was a second control doing very little beside the first. A `v1`
 * blob is simply not read.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'chorus.view.v2';

/**
 * The two ways of arranging today's outstanding work.
 *
 * `priority` — Crucial, Normal, Minor. What matters most, first.
 * `when` — Late, then due today. What is most urgent, first.
 *
 * They are two answers to the same question, which is why they are one control
 * rather than two. Whichever is chosen, anything not yet due is collapsed into
 * "Coming up" underneath: that is a property of the screen, not of the mode.
 */
export type TodayArrangement = 'priority' | 'when';

const ARRANGEMENTS: readonly TodayArrangement[] = ['priority', 'when'];

export interface ViewPreference {
  readonly arrangement: TodayArrangement;
}

/**
 * Priority first.
 *
 * Chosen by Emily from the mockups: with a hundred-odd chores, "what matters
 * most" turned out to be a more useful first cut than "what kind of thing is
 * this". `when` is one tap away for the days that question changes.
 */
export const DEFAULT_VIEW: ViewPreference = { arrangement: 'priority' };

interface ViewState {
  readonly view: ViewPreference;
  /** False until the stored value has been read, so nothing is written over it. */
  readonly hydrated: boolean;
  readonly setArrangement: (arrangement: TodayArrangement) => void;
  readonly hydrate: () => Promise<void>;
}

function persist(view: ViewPreference): void {
  // Fire and forget: a failed write costs a preference, not correctness, and
  // blocking the control on disk would make it feel broken.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(view));
}

export const useViewStore = create<ViewState>((set, get) => ({
  view: DEFAULT_VIEW,
  hydrated: false,

  setArrangement: (arrangement) => {
    const view = { ...get().view, arrangement };
    set({ view });
    persist(view);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const stored = JSON.parse(raw) as Partial<ViewPreference>;
        set({
          view: {
            ...DEFAULT_VIEW,
            // Checked against the known values rather than merely for type. A
            // stored arrangement from some future version must fall back to
            // the default instead of reaching the screen, where it would match
            // no branch and render nothing.
            ...(ARRANGEMENTS.includes(stored.arrangement as TodayArrangement)
              ? { arrangement: stored.arrangement as TodayArrangement }
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

export const useViewPreference = (): ViewPreference => useViewStore((s) => s.view);
