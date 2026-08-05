/**
 * How this device arranges the chore list.
 *
 * On the device, not in the database, and for the same reason as reminder
 * preferences: this is a fact about how *you* like to read the list, not about
 * the household. Two people sharing chores should be able to look at them
 * differently — one grouping by category, the other by priority — without
 * either silently changing the other's screen.
 *
 * The cost is that it does not follow you to a second device. That is a
 * preference you set roughly once, so a `profiles` column and a write on every
 * toggle would be a poor trade.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { GroupBy, SortBy } from '@/core/occurrence/grouping';

const STORAGE_KEY = 'chorus.view.v1';

const GROUP_BY: readonly GroupBy[] = ['category', 'priority', 'none'];
const SORT_BY: readonly SortBy[] = ['priority', 'due'];

export interface ViewPreference {
  readonly groupBy: GroupBy;
  readonly sortBy: SortBy;
}

/**
 * Grouped by category, sorted by priority within each.
 *
 * Chosen as the default because it answers the two questions people actually
 * ask in order — "what kind of thing is this" then "what matters most" — and
 * because a household that never touches these controls still gets something
 * more useful than a flat list.
 */
export const DEFAULT_VIEW: ViewPreference = { groupBy: 'category', sortBy: 'priority' };

interface ViewState {
  readonly view: ViewPreference;
  /** False until the stored value has been read, so nothing is written over it. */
  readonly hydrated: boolean;
  readonly setGroupBy: (groupBy: GroupBy) => void;
  readonly setSortBy: (sortBy: SortBy) => void;
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

  setGroupBy: (groupBy) => {
    const view = { ...get().view, groupBy };
    set({ view });
    persist(view);
  },

  setSortBy: (sortBy) => {
    const view = { ...get().view, sortBy };
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
            // Each field checked against the known values rather than merely
            // for type. A stored 'nested' from some future version must fall
            // back to the default instead of reaching the grouping function,
            // where it would match no branch and silently return categories.
            ...(GROUP_BY.includes(stored.groupBy as GroupBy)
              ? { groupBy: stored.groupBy as GroupBy }
              : {}),
            ...(SORT_BY.includes(stored.sortBy as SortBy)
              ? { sortBy: stored.sortBy as SortBy }
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
