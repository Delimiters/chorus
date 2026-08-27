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
  categories: (householdId: string) => [...qk.household(householdId), 'categories'] as const,

  /**
   * Routines nest under the household key like everything else, so the realtime
   * handler's broad invalidation picks them up with no extra wiring — even
   * though most rows in them are private to one person.
   */
  /** Every subtask in the household; the screens filter by chore themselves. */
  flags: (householdId: string) => [...qk.household(householdId), 'flags'] as const,
  subtasks: (householdId: string) => [...qk.household(householdId), 'subtasks'] as const,
  /** Ticks for one occurrence; a new occurrence simply has none. */
  subtaskTicks: (householdId: string, occurrenceKey: string) =>
    [...qk.subtasks(householdId), 'ticks', occurrenceKey] as const,
  /** Ticks for everything on screen, sorted so the key is stable. */
  subtaskTicksFor: (householdId: string, occurrenceKeys: readonly string[]) =>
    [...qk.subtasks(householdId), 'ticks-for', [...occurrenceKeys].sort()] as const,
  routines: (householdId: string) => [...qk.household(householdId), 'routines'] as const,
  routineList: (householdId: string, filters: Record<string, unknown>) =>
    [...qk.routines(householdId), 'list', filters] as const,
  routineCompletionsAll: (householdId: string) =>
    [...qk.routines(householdId), 'completions'] as const,
  /** Windows are quantised to whole weeks, so paging a day does not refetch. */
  routineCompletions: (householdId: string, from: CivilDate, to: CivilDate) =>
    [...qk.routineCompletionsAll(householdId), from, to] as const,
  invites: (householdId: string) => [...qk.household(householdId), 'invites'] as const,
  chores: (householdId: string) => [...qk.household(householdId), 'chores'] as const,
  chore: (householdId: string, choreId: string) => [...qk.chores(householdId), choreId] as const,
  /** Chores filtered client-side — archived, and any other list variants. */
  choreList: (householdId: string, filters: Record<string, unknown>) =>
    [...qk.chores(householdId), 'list', filters] as const,
  /**
   * One-time chores, fetched without a date bound because no window contains
   * them. See `listOneTimeChores`.
   */
  oneTimeChores: (householdId: string) => [...qk.household(householdId), 'one-time'] as const,
  completionsForChores: (householdId: string, choreIds: readonly string[]) =>
    [...qk.completionsAll(householdId), 'for-chores', [...choreIds].sort()] as const,
  exceptionsForChores: (householdId: string, choreIds: readonly string[]) =>
    [...qk.exceptionsAll(householdId), 'for-chores', [...choreIds].sort()] as const,

  /**
   * Every completions query, whatever its window.
   *
   * Exists so an optimistic patch can target completions **and nothing else**.
   * Patching the whole `household` prefix instead was a real bug: `members` is
   * also an array under that prefix, so an `Array.isArray` guard let a
   * completion row be appended to the member list, and the House tab then read
   * `displayName` off it and threw mid-render.
   */
  completionsAll: (householdId: string) => [...qk.household(householdId), 'completions'] as const,
  /**
   * Windows are quantized to whole weeks by the caller, so the key does not
   * churn on every render and trigger a refetch storm.
   */
  completions: (householdId: string, from: CivilDate, to: CivilDate) =>
    [...qk.completionsAll(householdId), from, to] as const,

  exceptionsAll: (householdId: string) => [...qk.household(householdId), 'exceptions'] as const,
  exceptions: (householdId: string, from: CivilDate, to: CivilDate) =>
    [...qk.exceptionsAll(householdId), from, to] as const,
} as const;
