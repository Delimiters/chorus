/**
 * The flag hook, against a real QueryClient.
 *
 * Written after a review found that `useToggleFlag` performed the *inverse*
 * database write on every single call — flagging deleted, unflagging inserted —
 * because `mutationFn` re-derived the decision from a cache that `onMutate` had
 * already updated. TanStack runs `onMutate` first; the optimistic result is
 * what `mutationFn` saw.
 *
 * The UI showed the right thing for a moment and then reverted, so nothing on
 * screen looked broken enough to notice, and the module had no tests at all.
 * These assert the *write*, not the optimistic state, because the write is what
 * was wrong.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { civilDate } from '@/core/civil/date';
import { qk } from '../queryKeys';
import type { ChoreFlagRow } from '../api/flags';

const HOUSE = 'house-1';
const ME = 'user-me';
const TODAY = civilDate('2026-08-27'); // a Thursday

const mockRaised: { choreId: string; flaggedOn: string }[] = [];
const mockLowered: { choreId: string; userId: string }[] = [];

/**
 * A server that remembers.
 *
 * `onSettled` invalidates, so a `listFlags` that always returned `[]` would
 * wipe the optimistic row and make any assertion about the settled cache a
 * test of the mock rather than of the hook.
 */
let mockServerRows: { choreId: string; userId: string; flaggedOn: string }[] = [];

jest.mock('../api/flags', () => ({
  listFlags: jest.fn(async () => mockServerRows),
  raiseFlag: jest.fn(async (input: { choreId: string; userId: string; flaggedOn: string }) => {
    mockRaised.push({ choreId: input.choreId, flaggedOn: input.flaggedOn });
    mockServerRows = [
      ...mockServerRows.filter((r) => !(r.choreId === input.choreId && r.userId === input.userId)),
      { choreId: input.choreId, userId: input.userId, flaggedOn: input.flaggedOn },
    ];
  }),
  lowerFlag: jest.fn(async (choreId: string, userId: string) => {
    mockLowered.push({ choreId, userId });
    mockServerRows = mockServerRows.filter((r) => !(r.choreId === choreId && r.userId === userId));
  }),
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => HOUSE,
  useUserId: () => ME,
}));

// eslint-disable-next-line import/first
import { useToggleFlag } from './useFlags';

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const seed = (client: QueryClient, rows: ChoreFlagRow[]) =>
  client.setQueryData(qk.flags(HOUSE), rows);

beforeEach(() => {
  mockRaised.length = 0;
  mockLowered.length = 0;
  mockServerRows = [];
});

describe('toggling a flag writes what it says it writes', () => {
  it('raises one on an unflagged chore', async () => {
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useToggleFlag(TODAY, 1), { wrapper });

    act(() => result.current.mutate('dishes'));

    // The write, not the cache. With the decision re-derived after `onMutate`
    // this called `lowerFlag` instead, and the optimistic cache still looked
    // correct — which is exactly why it went unnoticed.
    await waitFor(() => expect(mockRaised).toHaveLength(1));
    expect(mockRaised[0]).toEqual({ choreId: 'dishes', flaggedOn: TODAY });
    expect(mockLowered).toHaveLength(0);
  });

  it('lowers one raised this week', async () => {
    const { client, wrapper } = harness();
    seed(client, [{ choreId: 'dishes', userId: ME, flaggedOn: civilDate('2026-08-25') }]);
    const { result } = renderHook(() => useToggleFlag(TODAY, 1), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(mockLowered).toHaveLength(1));
    expect(mockLowered[0]).toEqual({ choreId: 'dishes', userId: ME });
    expect(mockRaised).toHaveLength(0);
  });

  it('re-raises a stale flag rather than deleting something invisible', async () => {
    // The row exists but is from a past week, so the person sees an unflagged
    // chore. Clearing it would make their first tap appear to do nothing.
    const { client, wrapper } = harness();
    seed(client, [{ choreId: 'dishes', userId: ME, flaggedOn: civilDate('2026-07-01') }]);
    const { result } = renderHook(() => useToggleFlag(TODAY, 1), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(mockRaised).toHaveLength(1));
    expect(mockRaised[0]?.flaggedOn).toBe(TODAY);
    expect(mockLowered).toHaveLength(0);
  });

  it('ignores a flag belonging to the other person', async () => {
    // Their flag is visible but not mine to clear, so tapping raises my own.
    const { client, wrapper } = harness();
    seed(client, [{ choreId: 'dishes', userId: 'user-them', flaggedOn: TODAY }]);
    const { result } = renderHook(() => useToggleFlag(TODAY, 1), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(mockRaised).toHaveLength(1));
    expect(mockLowered).toHaveLength(0);
  });

  it('leaves the cache agreeing with the server once it settles', async () => {
    /*
     * The symptom the inversion actually produced: the row appeared, then
     * vanished when the invalidate returned the truth. Asserting the optimistic
     * state alone would have passed throughout — it was always correct. This
     * asserts they agree at the end, which is what was broken.
     */
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useToggleFlag(TODAY, 1), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(mockRaised).toHaveLength(1));

    // Both, and they must agree. The inversion left the server empty while the
    // cache briefly said otherwise; asserting the optimistic state alone would
    // have passed throughout, because that half was always right.
    expect(mockServerRows.map((r) => r.choreId)).toEqual(['dishes']);
    await waitFor(() => {
      const cached = client.getQueryData<readonly ChoreFlagRow[]>(qk.flags(HOUSE)) ?? [];
      expect(cached.map((f) => f.choreId)).toEqual(['dishes']);
    });
  });
});
