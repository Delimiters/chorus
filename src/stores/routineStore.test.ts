/**
 * Tests for the routine store's plan markers.
 *
 * This file exists because a review found the whole of `markFlagsAutoPlanned`
 * could be replaced with a no-op and all 1431 tests stayed green — there was no
 * `routineStore` test file at all, and `PlanView.test.tsx` mocks the store
 * wholesale. That is the AGENTS.md failure shape exactly: the pure function is
 * right, the caller is right, and nothing checks the piece in between.
 *
 * A no-op here is not cosmetic. `autoPlannedFlags` is what makes "Take off
 * today" stick for flagged work: without the record, removing a flagged chore
 * hands it straight back on the next render, and a flag lives until the job is
 * done — so the fight would last all day.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_ROUTINE_PREFERENCE, useRoutineStore } from './routineStore';

const STORAGE_KEY = 'chorus.routines.v2';

const flags = () => useRoutineStore.getState().preference.autoPlannedFlags;

beforeEach(async () => {
  useRoutineStore.setState({ preference: DEFAULT_ROUTINE_PREFERENCE, hydrated: false });
  await AsyncStorage.clear();
});

describe('remembering which flagged occurrences have been planned', () => {
  it('records them against the day', () => {
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:gutters']);

    expect(flags()).toEqual({ on: '2026-09-22', keys: ['v1:gutters'] });
  });

  it('adds to the day rather than replacing it', () => {
    /*
     * The case this exists for: a flag raised at nine and another at two. A
     * naive write would drop the first, and the chore recorded in the morning
     * would be handed back the moment you took it off in the afternoon.
     */
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:gutters']);
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:litter']);

    expect([...(flags()?.keys ?? [])].sort()).toEqual(['v1:gutters', 'v1:litter']);
  });

  it('does not store the same occurrence twice', () => {
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:gutters']);
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:gutters']);

    expect(flags()?.keys).toEqual(['v1:gutters']);
  });

  it('starts over on a new day instead of growing forever', () => {
    // Yesterday's keys can never match today's occurrences — the key carries
    // the date — so carrying them would be a list that only ever gets longer.
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-21', ['v1:gutters']);
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:litter']);

    expect(flags()).toEqual({ on: '2026-09-22', keys: ['v1:litter'] });
  });

  it('survives a restart, which is the only reason to persist it', async () => {
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:gutters']);

    // Read back from storage rather than from the store: the in-memory value
    // proves nothing about a cold start, and "Take off today" not surviving a
    // restart is a bug this app has already shipped once.
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw ?? 'null')).toMatchObject({
      autoPlannedFlags: { on: '2026-09-22', keys: ['v1:gutters'] },
    });
  });

  it('leaves the whole-day marker alone', () => {
    // Two markers with two different clocks. Writing one must not disturb the
    // other, or the morning fill would run twice the moment a flag went up.
    useRoutineStore.getState().markAutoPlanned('2026-09-22');
    useRoutineStore.getState().markFlagsAutoPlanned('2026-09-22', ['v1:gutters']);

    expect(useRoutineStore.getState().preference.autoPlannedOn).toBe('2026-09-22');
  });
});

describe('reading a stored blob back', () => {
  it('restores the record', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ autoPlannedFlags: { on: '2026-09-22', keys: ['v1:gutters'] } }),
    );

    await useRoutineStore.getState().hydrate();

    expect(flags()).toEqual({ on: '2026-09-22', keys: ['v1:gutters'] });
  });

  it('ignores a blob written before this field existed', async () => {
    // Which is every phone that already has the app on it. `undefined` must
    // not reach the effect looking like a record.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ showOthers: false }));

    await useRoutineStore.getState().hydrate();

    expect(flags()).toBeNull();
    // And the field it *did* understand is still honoured, which is the whole
    // argument for defending each key separately.
    expect(useRoutineStore.getState().preference.showOthers).toBe(false);
  });

  it('refuses a half-written record rather than half-trusting it', async () => {
    /*
     * A shape check, not `typeof`: an object with no `on` would otherwise
     * arrive as `{ on: undefined }`, match no day, and look present while
     * doing nothing — the silent failure that is worse than a missing key.
     */
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ autoPlannedFlags: { keys: ['x'] } }));

    await useRoutineStore.getState().hydrate();

    expect(flags()).toBeNull();
  });

  it('drops non-string keys instead of the whole record', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ autoPlannedFlags: { on: '2026-09-22', keys: ['v1:gutters', 7, null] } }),
    );

    await useRoutineStore.getState().hydrate();

    expect(flags()).toEqual({ on: '2026-09-22', keys: ['v1:gutters'] });
  });
});
