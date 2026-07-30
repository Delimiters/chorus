/**
 * Tests for the session store.
 *
 * The behaviour that matters here is the clearing on sign-out. The previous
 * implementation's worst bug was one user seeing another's data; these assertions
 * pin the mechanism that prevents it. See docs/POSTMORTEM-SWIFT.md #6.
 */

import type { Session } from '@supabase/supabase-js';

import { sessionSnapshot, useSessionStore } from './sessionStore';

const session = (userId: string): Session =>
  ({
    access_token: 'a',
    refresh_token: 'r',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId },
  }) as unknown as Session;

beforeEach(() => {
  useSessionStore.setState({
    status: 'loading',
    session: null,
    userId: null,
    activeHouseholdId: null,
  });
});

describe('initial state', () => {
  it('starts loading, so nothing renders before a persisted session is restored', () => {
    // Starting at signedOut would flash the sign-in screen at a signed-in user
    // on every cold start.
    expect(useSessionStore.getState().status).toBe('loading');
  });
});

describe('setSession', () => {
  it('signs in and derives the user id', () => {
    useSessionStore.getState().setSession(session('user-1'));
    const state = useSessionStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.userId).toBe('user-1');
  });

  it('preserves the active household across a token refresh', () => {
    const store = useSessionStore.getState();
    store.setSession(session('user-1'));
    store.setActiveHousehold('house-a');

    // A refresh delivers a new session object for the same user.
    useSessionStore.getState().setSession(session('user-1'));

    expect(useSessionStore.getState().activeHouseholdId).toBe('house-a');
  });

  it('clears the household on sign-out', () => {
    const store = useSessionStore.getState();
    store.setSession(session('user-1'));
    store.setActiveHousehold('house-a');

    useSessionStore.getState().setSession(null);

    const state = useSessionStore.getState();
    expect(state.status).toBe('signedOut');
    expect(state.userId).toBeNull();
    expect(state.session).toBeNull();
    // Without this, the next person to sign in on this device would briefly see
    // the previous user's household.
    expect(state.activeHouseholdId).toBeNull();
  });
});

describe('markSignedOut', () => {
  it('resets everything', () => {
    const store = useSessionStore.getState();
    store.setSession(session('user-1'));
    store.setActiveHousehold('house-a');

    useSessionStore.getState().markSignedOut();

    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedOut',
      session: null,
      userId: null,
      activeHouseholdId: null,
    });
  });
});

describe('sessionSnapshot', () => {
  it('reads the store outside React', () => {
    // The realtime manager and notification planner are not components.
    const store = useSessionStore.getState();
    store.setSession(session('user-9'));
    store.setActiveHousehold('house-z');

    expect(sessionSnapshot()).toEqual({ userId: 'user-9', activeHouseholdId: 'house-z' });
  });
});
