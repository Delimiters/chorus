/**
 * Onboarding group: signed in, but not yet in a household.
 *
 * Guards both directions — no session sends you to auth, and having a household
 * already sends you to the app.
 */

import { Redirect, Stack } from 'expo-router';

import { useBootstrapHousehold } from '@/data/hooks/useHousehold';
import { LoadingState } from '@/design/components';
import { useColors } from '@/design/theme';
import { useAuthStatus } from '@/stores/sessionStore';

export default function OnboardingLayout() {
  const status = useAuthStatus();
  const colors = useColors();
  const { resolved, hasHousehold } = useBootstrapHousehold();

  if (status === 'loading') return <LoadingState />;
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  if (!resolved) return <LoadingState />;
  if (hasHousehold) return <Redirect href="/today" />;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}
    />
  );
}
