/**
 * Household queries and mutations.
 *
 * `useBootstrapHousehold` is the piece that decides whether a signed-in user goes
 * to onboarding or to the app, and it is the only place `activeHouseholdId` gets
 * set from server data.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Localization from 'expo-localization';
import { useEffect } from 'react';

import { useActiveHouseholdId, useSessionStore, useUserId } from '@/stores/sessionStore';
import {
  createHousehold,
  getHousehold,
  listMembers,
  listMyHouseholds,
  updateHousehold,
  type Household,
  type Member,
} from '../api/households';
import { redeemInvite } from '../api/invites';
import { qk } from '../queryKeys';

/**
 * The device's timezone and week start, used as defaults when creating a
 * household so nobody has to configure them up front.
 *
 * `firstDay` is 1-based with Monday as 1 in the Intl/ICU convention; our schema
 * uses 0 = Sunday to match `Date#getDay`. `firstDay` of 7 means Sunday.
 */
export function deviceCalendarDefaults(): { timeZone: string; weekStartsOn: number } {
  const calendar = Localization.getCalendars()[0];
  const firstDay = calendar?.firstWeekday ?? 7;
  return {
    timeZone: calendar?.timeZone ?? 'UTC',
    weekStartsOn: firstDay === 7 ? 0 : firstDay,
  };
}

export function useMyHouseholds() {
  const userId = useUserId();
  return useQuery({
    queryKey: qk.myHouseholds(),
    queryFn: listMyHouseholds,
    enabled: userId !== null,
  });
}

export function useHousehold() {
  const householdId = useActiveHouseholdId();
  return useQuery({
    queryKey: householdId === null ? qk.myHouseholds() : qk.household(householdId),
    queryFn: () => getHousehold(householdId as string),
    enabled: householdId !== null,
  });
}

export function useMembers() {
  const householdId = useActiveHouseholdId();
  return useQuery({
    queryKey: householdId === null ? qk.myHouseholds() : qk.members(householdId),
    queryFn: () => listMembers(householdId as string),
    enabled: householdId !== null,
  });
}

/**
 * Selects a household once the user's list has loaded.
 *
 * Called from the authenticated layout. Picks the first household when there is
 * exactly one, which is the case for everybody in v1 — multi-household is a
 * roadmap item, and this is where a picker would go.
 *
 * Returns whether the decision has been made, so the router can hold rendering
 * rather than flashing onboarding at someone who does have a household.
 */
export function useBootstrapHousehold(): { resolved: boolean; hasHousehold: boolean } {
  const { data, isSuccess } = useMyHouseholds();
  const activeHouseholdId = useActiveHouseholdId();
  const setActiveHousehold = useSessionStore((s) => s.setActiveHousehold);

  useEffect(() => {
    if (!isSuccess) return;
    const first = data?.[0];

    if (first === undefined) {
      if (activeHouseholdId !== null) setActiveHousehold(null);
      return;
    }
    // Also handles the case where the active household was deleted or left.
    if (activeHouseholdId === null || !data.some((h) => h.id === activeHouseholdId)) {
      setActiveHousehold(first.id);
    }
  }, [isSuccess, data, activeHouseholdId, setActiveHousehold]);

  return {
    resolved: isSuccess,
    hasHousehold: isSuccess && (data?.length ?? 0) > 0,
  };
}

export function useCreateHousehold() {
  const queryClient = useQueryClient();
  const setActiveHousehold = useSessionStore((s) => s.setActiveHousehold);

  return useMutation({
    mutationFn: async (name: string) => {
      const defaults = deviceCalendarDefaults();
      return createHousehold({ name: name.trim(), ...defaults });
    },
    onSuccess: async (householdId) => {
      setActiveHousehold(householdId);
      await queryClient.invalidateQueries({ queryKey: qk.myHouseholds() });
    },
  });
}

export function useJoinHousehold() {
  const queryClient = useQueryClient();
  const setActiveHousehold = useSessionStore((s) => s.setActiveHousehold);

  return useMutation({
    mutationFn: (code: string) => redeemInvite(code),
    onSuccess: async (householdId) => {
      setActiveHousehold(householdId);
      await queryClient.invalidateQueries({ queryKey: qk.myHouseholds() });
    },
  });
}

export function useUpdateHousehold() {
  const householdId = useActiveHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Parameters<typeof updateHousehold>[1]) =>
      updateHousehold(householdId as string, patch),
    onSuccess: async () => {
      if (householdId === null) return;
      await queryClient.invalidateQueries({ queryKey: qk.household(householdId) });
      await queryClient.invalidateQueries({ queryKey: qk.myHouseholds() });
    },
  });
}

export type { Household, Member };
