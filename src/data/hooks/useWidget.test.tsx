/**
 * The widget sync, against a recording transport.
 *
 * The projection itself is tested in `src/core/widget/snapshot.test.ts`. What
 * is left here is everything that can only go wrong in a hook: publishing an
 * empty plan before the data arrives, rewriting the file on every render,
 * ending a card that should still be up, and replaying a lock-screen tick
 * twice.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { AgendaItem } from '@/core/occurrence/agenda';
import type { PlanEntry } from '@/core/plan/plan';
import type { ActivityState, WidgetSnapshot } from '@/core/widget/snapshot';
import type { WidgetTransport } from '../widget';
import { useWidgetSync } from './useWidget';

const TODAY = '2026-10-22';
const ME = 'user-me';

let mockHousehold: { data: unknown } = { data: { timeZone: 'UTC', weekStartsOn: 0 } };
let mockMembers: { data: unknown } = { data: [] };
let mockItems: readonly AgendaItem[] = [];
/** The chore rows behind those items, carrying the nag switch. */
let mockChores: readonly { id: string; nagUntilDone: boolean }[] = [];
let mockEntries: readonly PlanEntry[] = [];
/** Whether the queries behind the plan have resolved. */
let mockOccurrencesLoading = false;
let mockPlanLoading = false;
/** Rejects when a test is pretending to be offline. */
let mockToggleFails = false;
const mockToggle = jest.fn(async (_input: { item: AgendaItem; complete: boolean }) => {
  if (mockToggleFails) throw new Error('offline');
});

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'user-me',
}));

jest.mock('./useHousehold', () => ({
  useHousehold: () => mockHousehold,
  useMembers: () => mockMembers,
}));

jest.mock('../today', () => ({ useToday: () => '2026-10-22' }));

jest.mock('./useOccurrences', () => ({
  quantiseWindow: () => ({ start: '2026-10-05', end: '2026-11-01' }),
  useOccurrences: () => ({
    items: mockItems,
    chores: mockChores,
    isLoading: mockOccurrencesLoading,
  }),
  useToggleCompletion: () => ({ mutateAsync: mockToggle }),
}));

/** Chore ids anybody has flagged, as `useFlagsByChore` returns them. */
let mockFlagged: readonly string[] = [];

jest.mock('./useFlags', () => ({
  useFlagsByChore: () => new Map(mockFlagged.map((id) => [id, ['user-them']])),
}));

jest.mock('./usePlan', () => ({
  useMyPlanEntries: () => mockEntries,
  usePlanLoading: () => mockPlanLoading,
}));

/**
 * Every AppState listener the hook has registered, so a test can fire one.
 *
 * A spy rather than `jest.mock('react-native')`: replacing the whole module
 * takes `Platform.select` with it, and `expo-modules-core` reaches for that
 * during jest-expo's own setup — the suite then fails to load with
 * "Cannot read properties of undefined (reading 'select')" pointing at an
 * import that is not the problem.
 */
const listeners: ((state: AppStateStatus) => void)[] = [];

beforeAll(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    fn: (state: AppStateStatus) => void,
  ) => {
    listeners.push(fn);
    return {
      remove: () => {
        const at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      },
    };
  }) as typeof AppState.addEventListener);
});

afterAll(() => {
  jest.restoreAllMocks();
});

const item = (
  key: string,
  title: string,
  opts: { status?: string; member?: string | null } = {},
): AgendaItem =>
  ({
    choreId: key.split(':')[0],
    occurrenceKey: key,
    choreTitle: title,
    status: opts.status ?? 'due',
    assignee:
      opts.member == null ? { kind: 'anyone' } : { kind: 'member', memberId: opts.member, turn: 0 },
    dueOn: TODAY,
    timesOfDay: [],
    completedOn: null,
    completedBy: null,
    daysLate: 0,
    daysOverdue: 0,
    missedBefore: 0,
    rescheduled: false,
    originalDueOn: null,
    displaced: false,
    occurrenceIndex: 0,
    periodKey: TODAY,
    slot: 0,
    subject: null,
    flexibleFrom: TODAY,
    flexibleUntil: TODAY,
    showFrom: null,
  }) as unknown as AgendaItem;

const entry = (key: string, position: number): PlanEntry => ({
  occurrenceKey: key,
  choreId: key.split(':')[0] ?? key,
  plannedFor: TODAY as PlanEntry['plannedFor'],
  position,
});

interface Recorder extends WidgetTransport {
  readonly published: WidgetSnapshot[];
  readonly shown: ActivityState[];
  readonly ended: number[];
  pending: string[];
  /** The most ActivityKit calls ever in flight at once. Must stay 1. */
  maxConcurrent: number;
}

const recorder = (): Recorder => {
  const published: WidgetSnapshot[] = [];
  const shown: ActivityState[] = [];
  const ended: number[] = [];
  let inFlight = 0;
  const self: Recorder = {
    published,
    shown,
    ended,
    pending: [],
    maxConcurrent: 0,
    publish(snapshot) {
      published.push(snapshot);
      return true;
    },
    acknowledgeTicks(keys) {
      self.pending = self.pending.filter((key) => !keys.includes(key));
    },
    async showActivity(_day, state) {
      inFlight += 1;
      self.maxConcurrent = Math.max(self.maxConcurrent, inFlight);
      await Promise.resolve();
      shown.push(state);
      inFlight -= 1;
      return true;
    },
    async endActivity() {
      inFlight += 1;
      self.maxConcurrent = Math.max(self.maxConcurrent, inFlight);
      await Promise.resolve();
      ended.push(ended.length);
      inFlight -= 1;
      return true;
    },
    pendingTicks() {
      return self.pending;
    },
  };
  return self;
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const render = (transport: WidgetTransport) =>
  renderHook(() => useWidgetSync({ enabled: true, transport }), { wrapper });

beforeEach(() => {
  mockHousehold = { data: { timeZone: 'UTC', weekStartsOn: 0 } };
  mockMembers = {
    data: [
      { userId: 'user-me', displayName: 'Jake', accent: 'blue' },
      { userId: 'user-them', displayName: 'Emily', accent: 'pink' },
    ],
  };
  mockItems = [];
  /*
   * Nagging by default in this file, because most of these tests are about the
   * publish and drain paths and would otherwise raise no card at all. The
   * tests that care about the switch set it explicitly.
   */
  mockChores = [
    { id: 'a', nagUntilDone: true },
    { id: 'b', nagUntilDone: true },
  ];
  mockEntries = [];
  mockFlagged = [];
  mockOccurrencesLoading = false;
  mockPlanLoading = false;
  mockToggleFails = false;
  mockToggle.mockClear();
});

describe('publishing the plan', () => {
  it('writes the planned rows in the plan’s order', async () => {
    mockItems = [item('a:1', 'Dishes', { member: ME }), item('b:1', 'Litter')];
    // Positions contradict the order the items arrive in.
    mockEntries = [entry('a:1', 2), entry('b:1', 1)];

    const transport = recorder();
    render(transport);

    await waitFor(() => expect(transport.published).toHaveLength(1));
    expect(transport.published[0]?.rows.map((r) => r.title)).toEqual(['Litter', 'Dishes']);
    expect(transport.published[0]?.rows[1]?.ink).toBe('#1E3A9E');
  });

  /*
   * One case per query, because the first version gated on `household.data`
   * alone — which resolves several round trips before the plan does, so every
   * cold start published an empty plan and tore down the live card.
   */
  it.each([
    ['the household', () => (mockHousehold = { data: undefined })],
    ['the members', () => (mockMembers = { data: undefined })],
    ['the occurrences', () => (mockOccurrencesLoading = true)],
    ['the plan entries', () => (mockPlanLoading = true)],
  ])('says nothing at all while %s is still loading', async (_name, unload) => {
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];
    unload();

    const transport = recorder();
    render(transport);

    await act(async () => {});
    expect(transport.published).toHaveLength(0);
    expect(transport.ended).toHaveLength(0);
    expect(transport.shown).toHaveLength(0);
  });

  it('does not rewrite the file when nothing has changed', async () => {
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    const { rerender } = render(transport);

    await waitFor(() => expect(transport.published).toHaveLength(1));
    rerender({});
    rerender({});
    await act(async () => {});

    /*
     * The write time changes on every render and is excluded from the
     * comparison on purpose: iOS budgets roughly 40-70 widget reloads a day.
     */
    expect(transport.published).toHaveLength(1);
  });
});

describe('the persistent card', () => {
  it('is about the first unfinished row', async () => {
    mockItems = [
      item('a:1', 'Done already', { status: 'completed' }),
      item('b:1', 'Next up', { member: 'user-them' }),
    ];
    mockEntries = [entry('a:1', 1), entry('b:1', 2)];

    const transport = recorder();
    render(transport);

    await waitFor(() => expect(transport.shown).toHaveLength(1));
    expect(transport.shown[0]).toMatchObject({
      title: 'Next up',
      occurrenceKey: 'b:1',
      remaining: 1,
      total: 2,
      ink: '#C2185B',
    });
    expect(transport.ended).toHaveLength(0);
  });

  it('is never raised when no outstanding chore asked to insist', async () => {
    /*
     * Jake: "it shouldn't just always have a focus box it should be something
     * you check for certain chores". An ordinary day has work on it and should
     * put nothing permanent on the lock screen.
     */
    mockChores = [{ id: 'a', nagUntilDone: false }];
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    render(transport);

    await waitFor(() => expect(transport.published).toHaveLength(1));
    expect(transport.published[0]?.rows).toHaveLength(1);
    expect(transport.shown).toHaveLength(0);
    expect(transport.ended).toHaveLength(1);
  });

  it('is about the chore that asked, not the first one outstanding', async () => {
    mockChores = [
      { id: 'a', nagUntilDone: false },
      { id: 'b', nagUntilDone: true },
    ];
    mockItems = [item('a:1', 'Quiet one'), item('b:1', 'Insistent one')];
    mockEntries = [entry('a:1', 1), entry('b:1', 2)];

    const transport = recorder();
    render(transport);

    await waitFor(() => expect(transport.shown).toHaveLength(1));
    expect(transport.shown[0]?.title).toBe('Insistent one');
  });

  it('follows a flagged chore over the one that is merely next', async () => {
    /*
     * Both chores asked to insist, so plan order would pick `a`. The flag on
     * `b` is what moves it — and it is raised by the *housemate*, because
     * "flagged means flagged" rather than flagged-by-me.
     */
    mockChores = [
      { id: 'a', nagUntilDone: true },
      { id: 'b', nagUntilDone: true },
    ];
    mockItems = [item('a:1', 'Next in the plan'), item('b:1', 'Flagged')];
    mockEntries = [entry('a:1', 1), entry('b:1', 2)];
    mockFlagged = ['b'];

    const transport = recorder();
    render(transport);

    await waitFor(() => expect(transport.shown).toHaveLength(1));
    expect(transport.shown[0]?.title).toBe('Flagged');
  });

  it('moves to a chore flagged mid-session', async () => {
    /*
     * Raising a flag has to move the card, which means `flaggedChoreIds` has
     * to reach the card's own gate — the snapshot does not carry flags any
     * more than it carries the switch, and the same early-return bug would
     * otherwise leave the old chore pinned.
     */
    mockChores = [
      { id: 'a', nagUntilDone: true },
      { id: 'b', nagUntilDone: true },
    ];
    mockItems = [item('a:1', 'Next in the plan'), item('b:1', 'Later')];
    mockEntries = [entry('a:1', 1), entry('b:1', 2)];

    const transport = recorder();
    const { rerender } = render(transport);
    await waitFor(() => expect(transport.shown).toHaveLength(1));
    expect(transport.shown[0]?.title).toBe('Next in the plan');

    mockFlagged = ['b'];
    rerender({});

    await waitFor(() => expect(transport.shown).toHaveLength(2));
    expect(transport.shown[1]?.title).toBe('Later');
    // The plan's content did not change, so the widget was not rewritten.
    expect(transport.published).toHaveLength(1);
  });

  it('comes down when the switch is turned off mid-session', async () => {
    /*
     * The case a green suite missed. There was one fingerprint, over the
     * snapshot, with an early `return` in front of the card decision — and
     * `nagUntilDone` is deliberately not in the snapshot, so turning the
     * switch off changed nothing the gate could see. The card stayed on the
     * lock screen until the app was restarted.
     *
     * Every row is byte-identical across the rerender on purpose: that is what
     * makes the snapshot fingerprint match and the old gate return early.
     */
    mockChores = [{ id: 'a', nagUntilDone: true }];
    mockItems = [item('a:1', 'Mop the floor')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    const { rerender } = render(transport);
    await waitFor(() => expect(transport.shown).toHaveLength(1));
    expect(transport.ended).toHaveLength(0);

    mockChores = [{ id: 'a', nagUntilDone: false }];
    rerender({});

    await waitFor(() => expect(transport.ended).toHaveLength(1));
    // And the snapshot was not rewritten, because its content did not change.
    expect(transport.published).toHaveLength(1);
  });

  it('goes up when the switch is turned on mid-session', async () => {
    mockChores = [{ id: 'a', nagUntilDone: false }];
    mockItems = [item('a:1', 'Mop the floor')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    const { rerender } = render(transport);
    await waitFor(() => expect(transport.ended).toHaveLength(1));
    expect(transport.shown).toHaveLength(0);

    mockChores = [{ id: 'a', nagUntilDone: true }];
    rerender({});

    await waitFor(() => expect(transport.shown).toHaveLength(1));
    expect(transport.shown[0]?.title).toBe('Mop the floor');
    expect(transport.published).toHaveLength(1);
  });

  it('does not re-ask for a card that has not changed', async () => {
    /*
     * The fixtures are *rebuilt*, not reused, so every memo downstream of them
     * gets a new identity and the effect really does run again — while the card
     * it computes is JSON-identical. A version of this test that reused the
     * same arrays passed with the card's dedupe deleted outright, because
     * nothing re-ran at all. Confirmed by deleting it.
     *
     * Not academic: a refetch that returns equal-but-not-shared rows does
     * exactly this, and re-requesting an identical Live Activity makes it
     * flicker on the lock screen.
     */
    const build = () => {
      mockChores = [{ id: 'a', nagUntilDone: true }];
      mockItems = [item('a:1', 'Mop the floor')];
      mockEntries = [entry('a:1', 1)];
    };

    build();
    const transport = recorder();
    const { rerender } = render(transport);
    await waitFor(() => expect(transport.shown).toHaveLength(1));

    build();
    rerender({});
    build();
    rerender({});
    await act(async () => {});

    expect(transport.shown).toHaveLength(1);
    expect(transport.ended).toHaveLength(0);
  });

  it('comes down once the plan is finished', async () => {
    mockItems = [item('a:1', 'Dishes', { status: 'completed' })];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    render(transport);

    await waitFor(() => expect(transport.ended).toHaveLength(1));
    expect(transport.shown).toHaveLength(0);
  });

  it('is never raised for an empty plan', async () => {
    const transport = recorder();
    render(transport);

    await waitFor(() => expect(transport.published).toHaveLength(1));
    expect(transport.shown).toHaveLength(0);
    expect(transport.ended).toHaveLength(1);
  });
});

describe('replaying a tick made from the lock screen', () => {
  it('completes the occurrence the key names', async () => {
    mockItems = [item('a:1', 'Dishes'), item('b:1', 'Litter')];
    mockEntries = [entry('a:1', 1), entry('b:1', 2)];

    const transport = recorder();
    transport.pending = ['b:1'];
    render(transport);

    await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
    expect(mockToggle.mock.calls[0]?.[0]).toMatchObject({
      complete: true,
      item: { occurrenceKey: 'b:1' },
    });
  });

  it('drops a key with no occurrence behind it rather than retrying forever', async () => {
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    transport.pending = ['archived:1'];
    render(transport);

    await act(async () => {});
    expect(mockToggle).not.toHaveBeenCalled();
    // Acknowledged, not left behind — it can never land, so retrying it
    // forever would block everything queued behind it.
    expect(transport.pending).toEqual([]);
  });

  it.each(['completed', 'skipped'])(
    'acknowledges without re-completing a %s row',
    async (status) => {
      /*
       * `skipped` counts as done in the projection, so the widget draws a
       * filled box — and the first version of the drain skipped only
       * `completed`, so tapping that box completed a chore you had explicitly
       * skipped.
       */
      mockItems = [item('a:1', 'Dishes', { status })];
      mockEntries = [entry('a:1', 1)];

      const transport = recorder();
      transport.pending = ['a:1'];
      render(transport);

      await act(async () => {});
      expect(mockToggle).not.toHaveBeenCalled();
      expect(transport.pending).toEqual([]);
    },
  );

  it('leaves the tick queued when the write fails', async () => {
    /*
     * The reason the protocol is read-then-acknowledge rather than one
     * destructive take. Mutations have `retry: 0` and the optimistic update
     * rolls back, so a failed replay used to leave no record anywhere that the
     * tap had happened — and the only feedback, the filled box, lives in
     * another process and would never have been corrected.
     */
    mockItems = [item('a:1', 'Dishes'), item('b:1', 'Litter')];
    mockEntries = [entry('a:1', 1), entry('b:1', 2)];
    mockToggleFails = true;

    const transport = recorder();
    transport.pending = ['a:1', 'b:1'];
    render(transport);

    await waitFor(() => expect(mockToggle).toHaveBeenCalled());
    await act(async () => {});
    expect(transport.pending).toEqual(['a:1', 'b:1']);
    // And it stops rather than failing its way through the batch.
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('does not touch the queue while the plan is still loading', async () => {
    /*
     * The defect this guard exists for: on a cold start every key looked up
     * nothing, was dropped as "archived", and a tick made on the lock screen
     * before opening the app vanished with nothing logged.
     */
    mockOccurrencesLoading = true;
    mockItems = [];
    mockEntries = [];

    const transport = recorder();
    transport.pending = ['a:1'];
    const { rerender } = render(transport);

    await act(async () => {});
    expect(transport.pending).toEqual(['a:1']);

    // The queries resolve; the tick is replayed against real data.
    mockOccurrencesLoading = false;
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];
    rerender({});

    await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
    expect(transport.pending).toEqual([]);
  });
});

describe('coming back to the app', () => {
  it('re-publishes the card, so a stale one stops being dimmed', async () => {
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    render(transport);
    await waitFor(() => expect(transport.shown).toHaveLength(1));

    /*
     * `staleDate` is four hours out and iOS dims a card past it. The comment
     * in the Swift justified that with "the app refreshes it every
     * foreground", which was not true of the first version — nothing but a
     * changed fingerprint could trigger a refresh.
     */
    await act(async () => {
      listeners.forEach((fn) => fn('active'));
    });

    expect(transport.shown.length).toBeGreaterThan(1);
  });

  it('drains the queue, which is the reason this lives in the root layout', async () => {
    /*
     * Deleting the `drain()` call in the AppState handler left every other
     * test green, while both the code comment and the decision note claim the
     * queue is drained on every foreground — and claim it is *why* the hook is
     * mounted in `_layout.tsx` rather than on the plan screen. A tick made on
     * the lock screen while the app sits in the background would have waited
     * for an unrelated re-render.
     */
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    render(transport);
    await act(async () => {});
    expect(mockToggle).not.toHaveBeenCalled();

    // Ticked on the lock screen while the app was in the background.
    transport.pending = ['a:1'];
    await act(async () => {
      listeners.forEach((fn) => fn('active'));
    });

    expect(mockToggle).toHaveBeenCalledTimes(1);
    expect(transport.pending).toEqual([]);
  });

  it('will not start a second drain over a running one', async () => {
    /*
     * The re-entrancy guard had a six-line comment arguing it was load-bearing
     * and could be deleted with the suite staying green. It is load-bearing
     * now that the loop awaits each write: two foregrounds in quick succession
     * would otherwise both read the same unacknowledged key and write it twice.
     */
    mockItems = [item('a:1', 'Dishes'), item('b:1', 'Litter')];
    mockEntries = [entry('a:1', 1), entry('b:1', 2)];

    let release: (() => void) | null = null;
    mockToggle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const transport = recorder();
    transport.pending = ['a:1', 'b:1'];
    render(transport);

    // First drain is parked mid-write; a foreground tries to start another.
    await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
    await act(async () => {
      listeners.forEach((fn) => fn('active'));
    });
    expect(mockToggle).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(transport.pending).toEqual([]));
    // Two keys, two writes. Not three.
    expect(mockToggle).toHaveBeenCalledTimes(2);
  });

  it('asks ActivityKit one thing at a time', async () => {
    /*
     * Two unawaited calls can each see no running activity and each request
     * one, leaving two cards for the same day — after which only the first
     * found is ever updated. Reachable on a cold start, where the snapshot
     * changes when the occurrences land and again when the inks do.
     */
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    render(transport);
    await waitFor(() => expect(transport.shown).toHaveLength(1));

    await act(async () => {
      listeners.forEach((fn) => fn('active'));
      listeners.forEach((fn) => fn('active'));
    });

    expect(transport.maxConcurrent).toBe(1);
  });
});
