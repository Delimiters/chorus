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
let mockItems: readonly AgendaItem[] = [];
let mockEntries: readonly PlanEntry[] = [];
const mockToggle = jest.fn();

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
  useUserId: () => 'user-me',
}));

jest.mock('./useHousehold', () => ({
  useHousehold: () => mockHousehold,
  useMembers: () => ({
    data: [
      { userId: 'user-me', displayName: 'Jake', accent: 'blue' },
      { userId: 'user-them', displayName: 'Emily', accent: 'pink' },
    ],
  }),
}));

jest.mock('../today', () => ({ useToday: () => '2026-10-22' }));

jest.mock('./useOccurrences', () => ({
  quantiseWindow: () => ({ start: '2026-10-05', end: '2026-11-01' }),
  useOccurrences: () => ({ items: mockItems }),
  useToggleCompletion: () => ({ mutate: mockToggle }),
}));

jest.mock('./usePlan', () => ({ useMyPlanEntries: () => mockEntries }));

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
}

const recorder = (): Recorder => {
  const published: WidgetSnapshot[] = [];
  const shown: ActivityState[] = [];
  const ended: number[] = [];
  const self: Recorder = {
    published,
    shown,
    ended,
    pending: [],
    publish(snapshot) {
      published.push(snapshot);
      return true;
    },
    async showActivity(_day, state) {
      shown.push(state);
      return true;
    },
    async endActivity() {
      ended.push(ended.length);
      return true;
    },
    takePendingTicks() {
      const keys = self.pending;
      self.pending = [];
      return keys;
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
  mockItems = [];
  mockEntries = [];
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

  it('says nothing at all until the household has loaded', async () => {
    /*
     * `useMyPlanEntries` returns [] while loading, which is indistinguishable
     * from an empty plan. Publishing it would blank the widget on every cold
     * start and end the Live Activity before the real plan arrived.
     */
    mockHousehold = { data: undefined };
    mockItems = [item('a:1', 'Dishes')];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    render(transport);

    await act(async () => {});
    expect(transport.published).toHaveLength(0);
    expect(transport.ended).toHaveLength(0);
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
    // Taken, not left behind: the queue is drained even when nothing lands.
    expect(transport.pending).toEqual([]);
  });

  it('ignores a tick for something already completed', async () => {
    mockItems = [item('a:1', 'Dishes', { status: 'completed' })];
    mockEntries = [entry('a:1', 1)];

    const transport = recorder();
    transport.pending = ['a:1'];
    render(transport);

    await act(async () => {});
    expect(mockToggle).not.toHaveBeenCalled();
  });
});
