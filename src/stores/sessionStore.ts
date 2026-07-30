/**
 * The one place the current user lives.
 *
 * This exists in Zustand rather than React state because three things that are
 * not components need to read it: the Supabase `onAuthStateChange` handler, the
 * notification sync task, and the realtime subscription manager.
 *
 * It is also the direct fix for the previous implementation's worst structural
 * bug. There, `AuthenticationState` held the signed-in user while
 * `DataManager.shared` held the household data, seeded with hardcoded sample
 * users — and the two never met. You signed in as one person and saw another
 * family's chores. See docs/POSTMORTEM-SWIFT.md #6.
 *
 * The rule: this store is written **only** by the auth listener and the
 * household selector. Nothing else sets it, and no server data is mirrored into
 * it — chores, members and completions belong to TanStack Query.
 */

import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

export type AuthStatus =
  /** Restoring a persisted session from the keychain. Nothing should render yet. */
  | 'loading'
  /** No session. Show the auth screens. */
  | 'signedOut'
  /** Signed in. `session` and `userId` are guaranteed present. */
  | 'signedIn';

interface SessionState {
  readonly status: AuthStatus;
  readonly session: Session | null;
  readonly userId: string | null;
  /**
   * Which household the app is currently showing.
   *
   * Separate from the session because a user can belong to more than one, and
   * because the app is unusable without one — the router refuses to render the
   * main tabs until it is set. Null means "signed in but not yet in a household",
   * which is the onboarding state.
   */
  readonly activeHouseholdId: string | null;

  /** Called by the auth listener. The only writer of session state. */
  setSession(session: Session | null): void;
  /** Called once at startup if there was no persisted session to restore. */
  markSignedOut(): void;
  setActiveHousehold(householdId: string | null): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  session: null,
  userId: null,
  activeHouseholdId: null,

  setSession: (session) =>
    set((prev) => ({
      session,
      userId: session?.user.id ?? null,
      status: session === null ? 'signedOut' : 'signedIn',
      // Signing out must clear the household, or the next user would briefly see
      // the previous one's data before the queries refetch.
      activeHouseholdId: session === null ? null : prev.activeHouseholdId,
    })),

  markSignedOut: () =>
    set({ status: 'signedOut', session: null, userId: null, activeHouseholdId: null }),

  setActiveHousehold: (householdId) => set({ activeHouseholdId: householdId }),
}));

/**
 * Reads the store outside React.
 *
 * Used by the realtime manager and the notification planner, neither of which is
 * a component and so cannot use the hook.
 */
export const sessionSnapshot = (): {
  userId: string | null;
  activeHouseholdId: string | null;
} => {
  const { userId, activeHouseholdId } = useSessionStore.getState();
  return { userId, activeHouseholdId };
};

// ── Selectors ───────────────────────────────────────────────────────────────
// Narrow selectors so a component re-renders only when the field it reads
// changes, rather than on every session refresh.

export const useAuthStatus = (): AuthStatus => useSessionStore((s) => s.status);
export const useUserId = (): string | null => useSessionStore((s) => s.userId);
export const useActiveHouseholdId = (): string | null =>
  useSessionStore((s) => s.activeHouseholdId);
