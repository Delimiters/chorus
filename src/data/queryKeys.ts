/**
 * Query keys, in one place so invalidation is auditable.
 *
 * Keys nest by household, which means a single broad invalidation —
 * `invalidateQueries({ queryKey: qk.household(id) })` — refreshes everything
 * scoped to that household. That is exactly what the realtime handler does. See
 * docs/ARCHITECTURE.md.
 *
 * **There is deliberately no `occurrences` key.** Occurrences are not server
 * state; there is nothing to fetch. `useOccurrences` composes the chores,
 * completions and exceptions queries and runs the pure projector over them. The
 * consequence worth having: editing a chore re-renders the whole agenda with no
 * network round trip.
 */

import type { CivilDate } from '@/core/civil/types';

export const qk = {
  all: ['chorus'] as const,

  /** The signed-in user's own profile. */
  me: () => [...qk.all, 'me'] as const,
  /** Every household the user belongs to. */
  myHouseholds: () => [...qk.all, 'my-households'] as const,

  household: (householdId: string) => [...qk.all, 'household', householdId] as const,

  members: (householdId: string) => [...qk.household(householdId), 'members'] as const,
  invites: (householdId: string) => [...qk.household(householdId), 'invites'] as const,
  chores: (householdId: string) => [...qk.household(householdId), 'chores'] as const,
  chore: (householdId: string, choreId: string) => [...qk.chores(householdId), choreId] as const,

  /**
   * Windows are quantized to whole weeks by the caller, so the key does not
   * churn on every render and trigger a refetch storm.
   */
  completions: (householdId: string, from: CivilDate, to: CivilDate) =>
    [...qk.household(householdId), 'completions', from, to] as const,
  exceptions: (householdId: string, from: CivilDate, to: CivilDate) =>
    [...qk.household(householdId), 'exceptions', from, to] as const,
} as const;
