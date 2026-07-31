/**
 * The authenticated app.
 *
 * Refuses to render without BOTH a session and an active household. That is the
 * structural guarantee replacing the previous implementation's disconnected
 * singletons: no screen inside here can be reached with an ambiguous "who am I,
 * which household" answer. See docs/POSTMORTEM-SWIFT.md #6.
 */

import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';

import { useBootstrapHousehold } from '@/data/hooks/useHousehold';
import { useRealtimeHousehold } from '@/data/hooks/useRealtime';
import { useReminderSync } from '@/data/hooks/useReminders';
import { useReminderPolicy, useReminderStore } from '@/stores/reminderStore';
import { LoadingState } from '@/design/components';
import { useColors } from '@/design/theme';
import { useActiveHouseholdId, useAuthStatus } from '@/stores/sessionStore';

export default function AppLayout() {
  const status = useAuthStatus();
  const householdId = useActiveHouseholdId();
  const colors = useColors();
  const { resolved, hasHousehold } = useBootstrapHousehold();

  /**
   * Both of these live here rather than on a screen: one channel and one
   * notification queue per session, not one per tab. Hooks run before the
   * guards below return, which is required — a conditional hook is not a hook —
   * and both no-op until there is a household to watch.
   */
  const hydrateReminders = useReminderStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateReminders();
  }, [hydrateReminders]);

  const reminderPolicy = useReminderPolicy();
  useRealtimeHousehold();
  useReminderSync({ policy: reminderPolicy });

  if (status === 'loading') return <LoadingState />;
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (!resolved) return <LoadingState label="Loading your household" />;
  if (!hasHousehold) return <Redirect href="/welcome" />;
  // Selected on the next tick after the list resolves.
  if (householdId === null) return <LoadingState />;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
    />
  );
}
