/**
 * The plan mutations, against a real QueryClient.
 *
 * The harness in `useFlags.test.tsx` exists because a hook that decided what to
 * write by reading a cache `onMutate` had already changed wrote its own inverse
 * on every call. This file exists because the same trap was reintroduced here,
 * one PR later, in a hook written the same afternoon — positions were computed
 * inside `mutationFn`, so every add counted its own optimistic rows and the
 * number the user saw was never the number stored.
 *
 * These assert the **write**. The optimistic cache was correct in both bugs,
 * which is exactly why neither was visible on screen.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { civilDate } from '@/core/civil/date';
import { qk } from '../queryKeys';
import type { PlanEntryRow } from '../api/plan';

const HOUSE = 'house-1';
const ME = 'user-me';
const THEM = 'user-them';
const TODAY = civilDate('2026-08-27');
const FROM = civilDate('2026-08-19'); // today − PLAN_LOOKBACK_DAYS

interface Written {
  readonly occurrenceKey: string;
  readonly position: number;
  readonly plannedFor: string;
  /** Who chose it, or null when the automatic fill did. */
  readonly addedBy: string | null;
}

const mockWrites: Written[] = [];
const mockDeletes: { occurrenceKey: string; userId: string }[] = [];

/**
 * A server that remembers.
 *
 * `onSettled` invalidates, so a `listPlanEntries` that always returned `[]`
 * would wipe the optimistic rows and turn any assertion about the settled cache
 * into a test of the mock.
 */
let mockServer: PlanEntryRow[] = [];

let mockDismissals: { userId: string; occurrenceKey: string; dismissedOn: string }[] = [];
let mockDismissFails = false;
let mockDismissalGate: Promise<void> | null = null;
let mockDismissalsFail = false;
const mockDismissed: { occurrenceKey: string; userId: string }[] = [];
const mockUndismissed: string[] = [];

jest.mock('../api/plan', () => ({
  listPlanEntries: jest.fn(async () => mockServer),
  movePlanEntry: jest.fn(async () => {}),
  /*
   * The dismissal side. Adding and removing both touch it now — a removal
   * records "I took this off on purpose" so the fill cannot hand it back, and
   * an add takes that record away again.
   *
   * Present here because a factory missing a function the hook calls makes the
   * mutation throw and roll back, which reads as a position bug rather than a
   * mock that is shaped differently from the caller.
   */
  listPlanDismissals: jest.fn(async () => {
    if (mockDismissalsFail) throw new Error('offline');
    // Held open only when a test asks, and always released — a never-resolving
    // promise hung the jest worker when this trick was used elsewhere.
    if (mockDismissalGate !== null) await mockDismissalGate;
    return mockDismissals;
  }),
  /*
   * These two keep `mockDismissals` up to date as well as recording the call.
   *
   * It used to only record, so a refetch after a successful dismissal returned
   * a list that did not contain it — the mock server forgot every write. That
   * is fine for "was it called", and useless for anything that asserts what
   * happens once the round trip lands, which is where the bug this file is
   * about actually lives.
   */
  dismissFromPlan: jest.fn(
    async (input: { occurrenceKey: string; userId: string; dismissedOn: string }) => {
      if (mockDismissFails) throw new Error('offline');
      mockDismissed.push(input);
      const already = mockDismissals.some(
        (d) =>
          d.userId === input.userId &&
          d.occurrenceKey === input.occurrenceKey &&
          d.dismissedOn === input.dismissedOn,
      );
      if (!already) {
        mockDismissals = [
          ...mockDismissals,
          {
            userId: input.userId,
            occurrenceKey: input.occurrenceKey,
            dismissedOn: input.dismissedOn,
          },
        ];
      }
    },
  ),
  undismissFromPlan: jest.fn(
    async (input: { occurrenceKeys: readonly string[]; userId: string; dismissedOn: string }) => {
      mockUndismissed.push(...input.occurrenceKeys);
      mockDismissals = mockDismissals.filter(
        (d) =>
          !(
            d.userId === input.userId &&
            input.occurrenceKeys.includes(d.occurrenceKey) &&
            d.dismissedOn === input.dismissedOn
          ),
      );
    },
  ),
  addToPlan: jest.fn(
    async (entries: readonly (Written & { userId: string; choreId: string })[]) => {
      for (const entry of entries) {
        mockWrites.push(entry);
        mockServer = [
          ...mockServer,
          {
            id: `db:${entry.occurrenceKey}`,
            userId: entry.userId,
            choreId: entry.choreId,
            occurrenceKey: entry.occurrenceKey,
            plannedFor: entry.plannedFor as PlanEntryRow['plannedFor'],
            position: entry.position,
          },
        ];
      }
    },
  ),
  removeFromPlan: jest.fn(async (userId: string, occurrenceKey: string) => {
    mockDeletes.push({ userId, occurrenceKey });
    mockServer = mockServer.filter(
      (r) => !(r.userId === userId && r.occurrenceKey === occurrenceKey),
    );
  }),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => HOUSE,
  useUserId: () => ME,
}));

// eslint-disable-next-line import/first
import {
  useAddToPlan,
  usePlanDismissals,
  useRemoveFromPlan,
  useReorderPlan,
  useTheirPlanEntries,
  useTheirPlanTotal,
} from './usePlan';

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const row = (
  occurrenceKey: string,
  position: number,
  userId = ME,
  plannedFor = TODAY,
): PlanEntryRow => ({
  id: `db:${occurrenceKey}`,
  userId,
  choreId: occurrenceKey.replace('v1:', ''),
  occurrenceKey,
  plannedFor,
  position,
});

const seed = (client: QueryClient, rows: PlanEntryRow[]) => {
  mockServer = [...rows];
  client.setQueryData(qk.plan(HOUSE, FROM, TODAY), rows);
};

beforeEach(() => {
  mockWrites.length = 0;
  mockDeletes.length = 0;
  mockDismissed.length = 0;
  mockUndismissed.length = 0;
  mockDismissals = [];
  mockDismissFails = false;
  mockDismissalGate = null;
  mockDismissalsFail = false;
  mockServer = [];
});

describe('adding to the plan writes the positions it shows', () => {
  it('starts at one on an empty day', async () => {
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:a', choreId: 'a' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.position).toBe(1);
  });

  it('does not count its own optimistic rows', async () => {
    /*
     * The defect. With positions computed inside `mutationFn`, which runs after
     * `onMutate`, adding two items on top of one existing row wrote 6 and 7
     * while the screen showed 4 and 5 — the add double-counted itself.
     */
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 3)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() =>
      result.current.mutate([
        { occurrenceKey: 'v1:b', choreId: 'b' },
        { occurrenceKey: 'v1:c', choreId: 'c' },
      ]),
    );

    await waitFor(() => expect(mockWrites).toHaveLength(2));
    expect(mockWrites.map((w) => w.position)).toEqual([4, 5]);
  });

  it('agrees with what it put in the cache', async () => {
    // The two numbers must be the same number. They were not.
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 3)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:b', choreId: 'b' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    await waitFor(() => {
      const cached =
        client.getQueryData<readonly PlanEntryRow[]>(qk.plan(HOUSE, FROM, TODAY)) ?? [];
      const settled = cached.find((r) => r.occurrenceKey === 'v1:b');
      expect(settled?.position).toBe(mockWrites[0]?.position);
    });
  });

  it('ignores the other person when finding the end of my day', async () => {
    /*
     * `nextPosition` ran over every row in the household under a variable named
     * `mine`, so a housemate with a long day pushed my first item to position
     * 52. Harmless to order, wrong on its face, and the name is how it survived.
     */
    const { client, wrapper } = harness();
    seed(client, [row('v1:theirs', 50, THEM)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:mine', choreId: 'mine' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.position).toBe(1);
  });

  it('ignores another day when finding the end of this one', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:yesterday', 90, ME, civilDate('2026-08-26'))]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:a', choreId: 'a' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.position).toBe(1);
  });

  it('does not write something already planned today', async () => {
    // The unique index makes it a no-op anyway; not writing it keeps the
    // optimistic list from briefly showing a duplicate that the refetch then
    // removes, which reads as a dropped tap.
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1)]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() =>
      result.current.mutate([
        { occurrenceKey: 'v1:a', choreId: 'a' },
        { occurrenceKey: 'v1:b', choreId: 'b' },
      ]),
    );

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.occurrenceKey).toBe('v1:b');
  });

  it('always plans for today, never for the day a row came from', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:old', 1, ME, civilDate('2026-08-20'))]);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:old', choreId: 'old' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.plannedFor).toBe(TODAY);
  });
});

describe('how much the other person has on', () => {
  it('ignores entries whose occurrence no longer exists', () => {
    /*
     * The ghost case, and it is not cosmetic: `bothFinished` is
     * `theirTotal > 0 && theirCount === 0`, so a partner plan made entirely of
     * ghost rows — an archived chore, a schedule edited so the key moved —
     * announces "You both finished" with confetti for a day in which they
     * finished nothing.
     *
     * `useTheirPlanCount` already cross-checks against what exists and its own
     * comment warns about exactly this. The sibling hook shipped without it.
     */
    const { client, wrapper } = harness();
    seed(client, [row('v1:real', 1, THEM), row('v1:ghost', 2, THEM)]);

    const { result } = renderHook(() => useTheirPlanTotal(TODAY, [{ occurrenceKey: 'v1:real' }]), {
      wrapper,
    });

    expect(result.current).toBe(1);
  });

  it('ignores my own entries', () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:mine', 1, ME), row('v1:theirs', 2, THEM)]);

    const { result } = renderHook(
      () =>
        useTheirPlanTotal(TODAY, [{ occurrenceKey: 'v1:mine' }, { occurrenceKey: 'v1:theirs' }]),
      { wrapper },
    );

    expect(result.current).toBe(1);
  });
});

describe('taking something off the plan', () => {
  it('deletes only my own entry', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1), row('v1:a', 1, THEM)]);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate({ occurrenceKey: 'v1:a' }));

    await waitFor(() => expect(mockDeletes).toHaveLength(1));
    expect(mockDeletes[0]).toEqual({ userId: ME, occurrenceKey: 'v1:a' });
  });

  it('leaves my housemate’s copy in the cache', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1), row('v1:a', 1, THEM)]);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate({ occurrenceKey: 'v1:a' }));

    await waitFor(() => {
      const cached =
        client.getQueryData<readonly PlanEntryRow[]>(qk.plan(HOUSE, FROM, TODAY)) ?? [];
      expect(cached.map((r) => r.userId)).toEqual([THEM]);
    });
  });

  it('records that it was deliberate, so the fill cannot hand it back', async () => {
    /*
     * The whole reason the fill can now run on every render. Without the
     * record, the next pass sees the chore outstanding and unplanned and puts
     * it straight back — "Take off today" as a button you fight all day.
     */
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1)]);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate({ occurrenceKey: 'v1:a' }));

    await waitFor(() => expect(mockDismissed).toHaveLength(1));
    expect(mockDismissed[0]).toMatchObject({
      occurrenceKey: 'v1:a',
      userId: ME,
      dismissedOn: TODAY,
    });
  });

  it('records it against whose day it came off, not who did it', async () => {
    // Either housemate may edit either plan, so the row has to name the plan
    // that is now missing the chore rather than the person who removed it.
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1, THEM)]);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate({ occurrenceKey: 'v1:a', ownerId: THEM }));

    await waitFor(() => expect(mockDismissed).toHaveLength(1));
    expect(mockDismissed[0]?.userId).toBe(THEM);
  });
});

/*
 * ── Emily: "Chorus is glitching I keep taking things off today and they come
 * back lol" ──────────────────────────────────────────────────────────────
 *
 * The removal is two facts — the entry goes, and a dismissal says it was
 * deliberate — and only the first was patched into the cache. The second had to
 * make a round trip.
 *
 * `isLoading` does not cover that gap. On an already-cached query it is false
 * during a background refetch, so the fill's `dismissalsLoading` guard waves it
 * through: the fill sees the entry gone, the dismissal not yet there, decides
 * the chore is unplanned and un-dismissed, and puts it straight back. Then the
 * re-add's `undismissFromPlan` deletes the dismissal that had just landed, so
 * it sticks.
 */
describe('a removal is visible to the fill before the server answers', () => {
  it('patches the dismissal into the cache, not only the entry', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1)]);
    client.setQueryData(qk.planDismissals(HOUSE, FROM, TODAY), []);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate({ occurrenceKey: 'v1:a' }));

    // Immediately: the same tick the entry disappears, not a round trip later.
    const dismissals = client.getQueryData<{ userId: string; occurrenceKey: string }[]>(
      qk.planDismissals(HOUSE, FROM, TODAY),
    );
    expect(dismissals).toEqual([
      expect.objectContaining({ userId: ME, occurrenceKey: 'v1:a', dismissedOn: TODAY }),
    ]);
  });

  it('records it against whoever’s day it came off', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1, THEM)]);
    client.setQueryData(qk.planDismissals(HOUSE, FROM, TODAY), []);
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate({ occurrenceKey: 'v1:a', ownerId: THEM }));

    const dismissals = client.getQueryData<{ userId: string }[]>(
      qk.planDismissals(HOUSE, FROM, TODAY),
    );
    expect(dismissals?.[0]?.userId).toBe(THEM);
  });

  it('puts the dismissal back if the write fails, like the entry', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1)]);
    client.setQueryData(qk.planDismissals(HOUSE, FROM, TODAY), []);
    mockDismissFails = true;
    const { result } = renderHook(() => useRemoveFromPlan(TODAY), { wrapper });

    act(() => result.current.mutate({ occurrenceKey: 'v1:a' }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(qk.planDismissals(HOUSE, FROM, TODAY))).toEqual([]);
  });
});

/*
 * The other half of Emily's report, for the case where the removal happened on
 * the *other* phone.
 *
 * `isLoading` is only ever true for a query that has never resolved. Once the
 * dismissals are cached, every invalidation — her removal arriving over
 * realtime, or any household-wide one — refetches in the background with
 * `isLoading` false and the **old** rows still being handed out. The fill's
 * guard waved that through, so this phone filled from a dismissal set it knew
 * was out of date, and `add` then deleted the dismissal as it landed.
 */
describe('the dismissals hook while it is catching up', () => {
  it('reports itself loading during a refetch, not only on the first fetch', async () => {
    const { client, wrapper } = harness();
    mockDismissals = [{ userId: ME, occurrenceKey: 'v1:a', dismissedOn: TODAY }];

    const { result } = renderHook(() => usePlanDismissals(TODAY), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.dismissals).toHaveLength(1);

    // What a realtime change from the other phone does — with the refetch held
    // open, so the in-flight window is observable rather than a lucky frame.
    let release = () => {};
    mockDismissalGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await act(async () => {
      void client.invalidateQueries({ queryKey: qk.planDismissals(HOUSE, FROM, TODAY) });
    });

    // Stale rows are still being handed out here, so the fill must not act.
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    // Still handing out the old rows while it says so, which is the point: the
    // fill must not read these and conclude nothing was taken off.
    expect(result.current.dismissals).toHaveLength(1);

    await act(async () => {
      release();
      await mockDismissalGate;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});

/*
 * The third face of the same mistake. A failed fetch and a fetch that has not
 * happened are indistinguishable to the fill, because both hand it an empty
 * list — and the fill does not merely render that answer, it writes plan rows
 * from it and deletes dismissals as it goes.
 */
/*
 * What "written first, cancelled second" actually claims, with a fetch open to
 * cancel.
 *
 * The two tests above never mount `usePlanDismissals`, so the query has no
 * observer, there is no fetch in flight, and `cancelQueries` has nothing to do
 * — the harness is shaped differently from the real caller in exactly the
 * dimension the ordering comment is about. Here both hooks are mounted and the
 * fetch is held open, which is the arrangement the app is actually in when
 * somebody taps remove a moment after opening Today.
 */
describe('removing while the dismissals are still in flight', () => {
  it('keeps the optimistic dismissal rather than letting the cancel revert it', async () => {
    const { client, wrapper } = harness();
    seed(client, [row('v1:a', 1)]);

    let release = () => {};
    mockDismissalGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { result } = renderHook(
      () => ({ dismissals: usePlanDismissals(TODAY), remove: useRemoveFromPlan(TODAY) }),
      { wrapper },
    );

    // The first fetch is open, so the removal's `cancelQueries` has a real
    // fetch to abort — which is the case that could revert the patch.
    await waitFor(() => expect(result.current.dismissals.isLoading).toBe(true));

    act(() => result.current.remove.mutate({ occurrenceKey: 'v1:a' }));

    expect(
      client.getQueryData<{ occurrenceKey: string }[]>(qk.planDismissals(HOUSE, FROM, TODAY)),
    ).toEqual([expect.objectContaining({ occurrenceKey: 'v1:a' })]);

    await act(async () => {
      release();
      await mockDismissalGate;
    });

    // And it survives the fetch settling, rather than being overwritten by the
    // answer to a question asked before the removal happened.
    await waitFor(() => expect(mockDismissed).toHaveLength(1));
    expect(
      client.getQueryData<{ occurrenceKey: string }[]>(qk.planDismissals(HOUSE, FROM, TODAY)),
    ).toEqual([expect.objectContaining({ occurrenceKey: 'v1:a' })]);
  });
});

describe('the dismissals hook when the fetch fails', () => {
  it('reports itself loading rather than handing back an empty list', async () => {
    const { client, wrapper } = harness();
    mockDismissalsFail = true;

    const { result } = renderHook(() => usePlanDismissals(TODAY), { wrapper });

    /*
     * Waits for the query to actually be *in* its error state.
     *
     * The first version waited for `dismissals` to equal `[]`, which is true on
     * the very first render — before the fetch has even failed — so it passed
     * while the query was still in flight and `isFetching` was carrying the
     * assertion. Dropping `isError` left it green. The simplest fixture was the
     * vacuous one, again.
     */
    await waitFor(() =>
      expect(client.getQueryState(qk.planDismissals(HOUSE, FROM, TODAY))?.status).toBe('error'),
    );

    // Empty, but never presented as "nothing was taken off".
    expect(result.current.dismissals).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });
});

describe('putting something back on the plan', () => {
  it('takes back the "I do not want this today"', async () => {
    /*
     * Adding by hand is the opposite of having taken it off. Leaving the
     * record behind is harmless while the entry exists and wrong the moment
     * you remove it and expect it back — the fill would skip it silently.
     */
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:a', choreId: 'a' }]));

    await waitFor(() => expect(mockUndismissed).toContain('v1:a'));
  });
});

describe('reordering the day', () => {
  it('shows the new order before it awaits anything', async () => {
    /*
     * The order of the two lines in `onMutate`, which is what a drop's
     * smoothness rests on.
     *
     * Awaiting `cancelQueries` before writing pushed the reordered rows past
     * the frame in which the finger lifted, so the row visibly returned to
     * where it started and then jumped to where it had been put — reported from
     * the phone as "jumpy when you drop it". `cancelQueries` is stubbed here to
     * a promise that never settles, which is the exaggerated version of the
     * same delay: the cache must already be right regardless.
     */
    const { client, wrapper } = harness();
    seed(client, [row('v1:dishes', 10), row('v1:trash', 20)]);

    const positionOf = () =>
      client
        .getQueryData<readonly PlanEntryRow[]>(qk.plan(HOUSE, FROM, TODAY))
        ?.find((r) => r.occurrenceKey === 'v1:trash')?.position;

    // Read at the moment the cancel is *requested*, which is the instant the
    // old ordering had not yet written anything.
    let positionWhenCancelled: number | undefined;
    jest.spyOn(client, 'cancelQueries').mockImplementation(async () => {
      positionWhenCancelled = positionOf();
    });

    const { result } = renderHook(() => useReorderPlan(TODAY), { wrapper });

    act(() => {
      result.current.mutate('v1:trash', 5);
    });

    await waitFor(() => expect(positionWhenCancelled).toBeDefined());
    expect(positionWhenCancelled).toBe(5);
  });
});

describe("your housemate's day, as data", () => {
  /*
   * The hook had no coverage at all: a review replaced its whole body with
   * `return []` and every one of the 1235 tests still passed, because both
   * screen tests mock `usePlan` wholesale. It is the entire data path for the
   * feature, so every clause it makes is asserted here.
   */
  const available = [
    { occurrenceKey: 'v1:bins' },
    { occurrenceKey: 'v1:mopping' },
    { occurrenceKey: 'v1:dishes' },
  ];

  const render = () => {
    const { client, wrapper } = harness();
    return { client, wrapper };
  };

  it('is their rows for today, in their order', async () => {
    const { client, wrapper } = render();
    seed(client, [row('v1:mopping', 20, THEM), row('v1:bins', 10, THEM), row('v1:dishes', 5, ME)]);

    const { result } = renderHook(() => useTheirPlanEntries(TODAY, available), { wrapper });

    await waitFor(() => expect(result.current.length).toBe(2));
    // Sorted by position, and mine is not in it.
    expect(result.current.map((r) => r.occurrenceKey)).toEqual(['v1:bins', 'v1:mopping']);
  });

  it('leaves out another day', async () => {
    const { client, wrapper } = render();
    seed(client, [row('v1:bins', 10, THEM), row('v1:mopping', 20, THEM, civilDate('2026-08-26'))]);

    const { result } = renderHook(() => useTheirPlanEntries(TODAY, available), { wrapper });

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0]?.occurrenceKey).toBe('v1:bins');
  });

  it('drops an entry whose occurrence no longer exists', async () => {
    /*
     * An archived chore, or a schedule edited so the key moved. Without this
     * the sheet renders a row with no title — a blank line in somebody else's
     * day, which is unreadable and unexplainable.
     */
    const { client, wrapper } = render();
    seed(client, [row('v1:bins', 10, THEM), row('v1:ghost', 20, THEM)]);

    const { result } = renderHook(() => useTheirPlanEntries(TODAY, available), { wrapper });

    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0]?.occurrenceKey).toBe('v1:bins');
  });

  it('breaks a tie by key, so both phones show one order', async () => {
    // `position` alone is not a total order. `planFor`, which renders their own
    // device, breaks ties by key; disagreeing here shows the same day two ways.
    const { client, wrapper } = render();
    seed(client, [row('v1:mopping', 10, THEM), row('v1:bins', 10, THEM)]);

    const { result } = renderHook(() => useTheirPlanEntries(TODAY, available), { wrapper });

    await waitFor(() => expect(result.current.length).toBe(2));
    expect(result.current.map((r) => r.occurrenceKey)).toEqual(['v1:bins', 'v1:mopping']);
  });
});

describe('who a plan row records as having chosen it', () => {
  /*
   * The single most important field in this hook, and the one nothing was
   * holding. `added_by` decides whether the *other* phone gets a notification,
   * and the automatic fill writes these rows constantly — both devices fill
   * both plans. Mark the fill as deliberate and Emily gets a push per chore
   * per morning, which is how somebody learns to ignore notifications.
   */
  it('records nobody when the automatic fill is the caller', async () => {
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useAddToPlan(TODAY, undefined, true), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:a', choreId: 'a' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.addedBy).toBeNull();
  });

  it('records the person when a person chose it', async () => {
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useAddToPlan(TODAY), { wrapper });

    act(() => result.current.mutate([{ occurrenceKey: 'v1:a', choreId: 'a' }]));

    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]?.addedBy).toBe(ME);
  });
});
