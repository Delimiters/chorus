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
const mockLowered: { choreId: string }[] = [];
let mockLowerFails = false;

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
  // Everyone's row on the chore, matching the real one: a flag is shared, so
  // lowering it is not scoped to a person.
  lowerFlag: jest.fn(async (choreId: string) => {
    if (mockLowerFails) throw new Error('nope');
    mockLowered.push({ choreId });
    mockServerRows = mockServerRows.filter((r) => r.choreId !== choreId);
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
  mockLowerFails = false;
});

describe('toggling a flag writes what it says it writes', () => {
  it('raises one on an unflagged chore', async () => {
    const { client, wrapper } = harness();
    seed(client, []);
    const { result } = renderHook(() => useToggleFlag(TODAY), { wrapper });

    act(() => result.current.mutate('dishes'));

    // The write, not the cache. With the decision re-derived after `onMutate`
    // this called `lowerFlag` instead, and the optimistic cache still looked
    // correct — which is exactly why it went unnoticed.
    await waitFor(() => expect(mockRaised).toHaveLength(1));
    expect(mockRaised[0]).toEqual({ choreId: 'dishes', flaggedOn: TODAY });
    expect(mockLowered).toHaveLength(0);
  });

  it('lowers one that is there', async () => {
    const { client, wrapper } = harness();
    seed(client, [{ choreId: 'dishes', userId: ME, flaggedOn: civilDate('2026-08-25') }]);
    const { result } = renderHook(() => useToggleFlag(TODAY), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(mockLowered).toHaveLength(1));
    expect(mockLowered[0]).toEqual({ choreId: 'dishes' });
    expect(mockRaised).toHaveLength(0);
  });

  it('clears an old flag rather than re-raising it', async () => {
    /*
     * The reverse of what this did before. A flag used to go invisible at the
     * end of its week while its row stayed, so tapping had to re-raise it or
     * the first tap appeared to do nothing. Flags no longer lapse, so an old
     * row is a flag the person can see, and tapping it means lower it.
     */
    const { client, wrapper } = harness();
    seed(client, [{ choreId: 'dishes', userId: ME, flaggedOn: civilDate('2026-01-04') }]);
    const { result } = renderHook(() => useToggleFlag(TODAY), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(mockLowered).toHaveLength(1));
    expect(mockLowered[0]).toEqual({ choreId: 'dishes' });
    expect(mockRaised).toHaveLength(0);
  });

  it('lowers a flag your housemate raised', async () => {
    /*
     * The reversal. Their flag used to be visible but not mine to clear, so a
     * tap raised a second row and the "!!" stayed put. A flag is the
     * household's now, so tapping it means lower it.
     */
    const { client, wrapper } = harness();
    seed(client, [{ choreId: 'dishes', userId: 'user-them', flaggedOn: TODAY }]);
    const { result } = renderHook(() => useToggleFlag(TODAY), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(mockLowered).toHaveLength(1));
    expect(mockLowered[0]).toEqual({ choreId: 'dishes' });
    expect(mockRaised).toHaveLength(0);
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
    const { result } = renderHook(() => useToggleFlag(TODAY), { wrapper });

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

describe('what the cache looks like before the write lands', () => {
  /*
   * The optimistic update, which had no assertion at all — reverting it to the
   * per-person filter left all 686 tests green. Its own comment names a
   * symptom nothing was checking: with the housemate's row left in the cache,
   * the "!!" stays on the row until the refetch lands and the tap looks as
   * though it failed.
   *
   * `lowerFlag` is mocked to never settle here, so the assertion lands while
   * the mutation is still in flight — which is the only moment the optimistic
   * value is what the screen is reading.
   */
  it('drops every flag on the chore, not just yours', async () => {
    const { client, wrapper } = harness();
    seed(client, [
      { choreId: 'dishes', userId: ME, flaggedOn: TODAY },
      { choreId: 'dishes', userId: 'user-them', flaggedOn: TODAY },
      { choreId: 'bins', userId: 'user-them', flaggedOn: TODAY },
    ]);
    const { result } = renderHook(() => useToggleFlag(TODAY), { wrapper });

    act(() => result.current.mutate('dishes'));

    await waitFor(() =>
      expect(client.getQueryData<ChoreFlagRow[]>(qk.flags(HOUSE))).toEqual([
        { choreId: 'bins', userId: 'user-them', flaggedOn: TODAY },
      ]),
    );
  });

  it('puts the housemate’s row back when the write fails', async () => {
    /*
     * Rollback restores the snapshot wholesale, so it has to return *both*
     * rows — not merely the one this user owned. Nothing covered the error
     * path at all.
     */
    const { client, wrapper } = harness();
    const before: ChoreFlagRow[] = [
      { choreId: 'dishes', userId: ME, flaggedOn: TODAY },
      { choreId: 'dishes', userId: 'user-them', flaggedOn: TODAY },
    ];
    seed(client, before);
    mockLowerFails = true;

    const { result } = renderHook(() => useToggleFlag(TODAY), { wrapper });
    act(() => result.current.mutate('dishes'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<ChoreFlagRow[]>(qk.flags(HOUSE))).toEqual(before);
  });
});
