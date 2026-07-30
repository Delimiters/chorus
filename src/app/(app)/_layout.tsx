/**
 * The authenticated app.
 *
 * Refuses to render without BOTH a session and an active household. That is the
 * structural guarantee replacing the previous implementation's disconnected
 * singletons: no screen inside here can be reached with an ambiguous "who am I,
 * which household" answer. See docs/POSTMORTEM-SWIFT.md #6.
 */

import { Redirect, Stack } from 'expo-router';

import { useBootstrapHousehold } from '@/data/hooks/useHousehold';
import { LoadingState } from '@/design/components';
import { useColors } from '@/design/theme';
import { useActiveHouseholdId, useAuthStatus } from '@/stores/sessionStore';

export default function AppLayout() {
  const status = useAuthStatus();
  const householdId = useActiveHouseholdId();
  const colors = useColors();
  const { resolved, hasHousehold } = useBootstrapHousehold();

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
