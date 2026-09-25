/**
 * Tests for the routine store's device preferences.
 *
 * This file used to be about `autoPlannedFlags` — the per-occurrence record
 * that stopped the fill handing back a flagged chore you had removed. That
 * mechanism is gone, replaced by `plan_dismissals` in the database, because a
 * device-local record could not survive the other phone: both devices now fill
 * both plans, so Emily removing something on hers lasted only until Jake
 * opened his.
 *
 * What survives is the hydration contract, and it is worth keeping on its own
 * terms: every phone that already has the app has a stored blob written by an
 * older version, and losing somebody's preferences because one key is missing
 * would be a poor trade.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_ROUTINE_PREFERENCE, useRoutineStore } from './routineStore';

const STORAGE_KEY = 'chorus.routines.v2';

const preference = () => useRoutineStore.getState().preference;

beforeEach(async () => {
  useRoutineStore.setState({ preference: DEFAULT_ROUTINE_PREFERENCE, hydrated: false });
  await AsyncStorage.clear();
});

describe('reading a stored blob back', () => {
  it('restores what it understands', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showOthers: false, todayMode: 'routines' }),
    );

    await useRoutineStore.getState().hydrate();

    expect(preference().showOthers).toBe(false);
    expect(preference().todayMode).toBe('routines');
  });

  it('defends each field on its own', async () => {
    /*
     * The whole argument for the spread-per-key shape. A blob from an older
     * version is missing keys rather than malformed, and one unreadable field
     * must not cost somebody every other preference they set.
     */
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showOthers: false, todayMode: 'nonsense-from-the-future' }),
    );

    await useRoutineStore.getState().hydrate();

    expect(preference().showOthers).toBe(false);
    // Membership, not `typeof`: an unknown mode must fall back rather than
    // reach a switch that matches no branch.
    expect(preference().todayMode).toBe(DEFAULT_ROUTINE_PREFERENCE.todayMode);
  });

  it('survives a blob that is not an object at all', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '"not a preference"');

    await useRoutineStore.getState().hydrate();

    expect(preference()).toEqual(DEFAULT_ROUTINE_PREFERENCE);
    expect(useRoutineStore.getState().hydrated).toBe(true);
  });

  it('marks itself hydrated even when there is nothing stored', async () => {
    // Nothing renders until `hydrated` flips, so failing to set it on the
    // empty path would hang a fresh install on the loading state.
    await useRoutineStore.getState().hydrate();

    expect(useRoutineStore.getState().hydrated).toBe(true);
  });
});

describe('what persists', () => {
  it('writes a changed preference straight to storage', async () => {
    // Read back from storage rather than from the store: the in-memory value
    // proves nothing about surviving a cold start.
    useRoutineStore.getState().setShowOthers(false);

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw ?? 'null')).toMatchObject({ showOthers: false });
  });
});
