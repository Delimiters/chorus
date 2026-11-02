/**
 * The realtime subscription, and what it does when joining fails.
 *
 * There was no test file here at all, which is how the first version of the
 * retry shipped with a backoff that did not back off: `attempt` lived in the
 * effect's closure, and the retry works by re-running the effect, so the
 * counter reset every time and the "1s, 2s, 4s" in its own comment was a flat
 * one-second loop. On a phone with no signal that is a websocket torn down and
 * thirteen subscription filters re-sent once a second, all night.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

/** Every `subscribe` callback handed to a channel, newest last. */
const mockJoins: ((status: string) => void)[] = [];
const mockRemoved: string[] = [];
let mockChannels = 0;

jest.mock('../supabase', () => ({
  supabase: {
    channel: (topic: string) => {
      mockChannels += 1;
      return {
        topic,
        on: () => ({ on: () => ({}) }),
        subscribe: (cb: (status: string) => void) => {
          mockJoins.push(cb);
          return {};
        },
      };
    },
    removeChannel: (channel: { topic: string }) => {
      mockRemoved.push(channel.topic);
      return Promise.resolve('ok');
    },
  },
}));

jest.mock('@/stores/sessionStore', () => ({
  useActiveHouseholdId: () => 'house-1',
}));

// Chainable `on`, so the real loop over the table list works unchanged.
jest.mock('../queryKeys', () => ({ qk: { household: (id: string) => ['household', id] } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useRealtimeHousehold } = require('./useRealtime') as typeof import('./useRealtime');

function Probe() {
  useRealtimeHousehold();
  return null;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  jest.useFakeTimers();
  mockJoins.length = 0;
  mockRemoved.length = 0;
  mockChannels = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

/** Fails the most recent join and runs the timers up to `ms`. */
const failJoin = (ms: number) => {
  act(() => {
    mockJoins[mockJoins.length - 1]?.('CHANNEL_ERROR');
  });
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe('when a channel fails to join', () => {
  it('backs off, rather than retrying at a flat rate for ever', () => {
    render(<Probe />, { wrapper });
    expect(mockChannels).toBe(1);

    /*
     * One millisecond short of each delay, then past it. Asserting the
     * boundaries is what distinguishes a growing backoff from a flat one — a
     * test that only counted retries passed against the bug.
     */
    failJoin(999);
    expect(mockChannels).toBe(1);
    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(mockChannels).toBe(2);

    // Second failure waits two seconds, not one.
    failJoin(1999);
    expect(mockChannels).toBe(2);
    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(mockChannels).toBe(3);

    // Third waits four.
    failJoin(3999);
    expect(mockChannels).toBe(3);
    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(mockChannels).toBe(4);
  });

  it('starts over after a join succeeds', () => {
    render(<Probe />, { wrapper });

    failJoin(1001);
    failJoin(2001);
    expect(mockChannels).toBe(3);

    act(() => {
      mockJoins[mockJoins.length - 1]?.('SUBSCRIBED');
    });

    // A later failure is one second again, not eight.
    failJoin(1001);
    expect(mockChannels).toBe(4);
  });

  it('schedules nothing more once it has been torn down', () => {
    const { unmount } = render(<Probe />, { wrapper });

    act(() => {
      mockJoins[mockJoins.length - 1]?.('CHANNEL_ERROR');
    });
    unmount();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    // The one it started with, and no replacement built after unmounting.
    expect(mockChannels).toBe(1);
    expect(mockRemoved).toHaveLength(1);
  });

  it('leaves no timer behind when a teardown reports CLOSED', () => {
    /*
     * `CLOSED` is both "the connection dropped" and how a deliberate
     * `removeChannel` reports itself — and it arrives *during* cleanup, after
     * the cleanup has already cleared the pending retry. Without the disposed
     * flag that callback schedules a fresh timer nothing will ever clear, and
     * then calls `setGeneration` on an unmounted component.
     *
     * Asserted on the timer count rather than on the channel count: an
     * unmounted component's state update is a silent no-op in React 19, so
     * counting channels cannot see this — which is exactly why an earlier
     * version of this test passed with the guard deleted.
     */
    const { unmount } = render(<Probe />, { wrapper });
    const join = mockJoins[mockJoins.length - 1];

    unmount();
    expect(jest.getTimerCount()).toBe(0);

    act(() => {
      join?.('CLOSED');
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('catching up after a gap', () => {
  it('invalidates on a successful join, because realtime does not replay', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    act(() => {
      mockJoins[mockJoins.length - 1]?.('SUBSCRIBED');
    });
    // Debounced, so it has not fired yet…
    expect(invalidate).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // …and then exactly once.
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('does not storm when the connection flaps', () => {
    /*
     * The catch-up used to call `invalidate` directly, skipping the debounce
     * the change handlers go through — so a flapping connection refetched the
     * whole household on every join.
     */
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    act(() => {
      const join = mockJoins[mockJoins.length - 1];
      join?.('SUBSCRIBED');
      join?.('SUBSCRIBED');
      join?.('SUBSCRIBED');
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
