/**
 * The routing decision.
 *
 * Three states, and the order matters:
 *   loading    — a persisted session may exist; render nothing rather than
 *                flashing the sign-in screen at somebody who is already signed in
 *   signedOut  — the auth screens
 *   signedIn   — onboarding if they have no household yet, otherwise the app
 */

import { Redirect } from 'expo-router';

import { useBootstrapHousehold } from '@/data/hooks/useHousehold';
import { LoadingState } from '@/design/components';
import { useAuthStatus } from '@/stores/sessionStore';

export default function Index() {
  const status = useAuthStatus();
  const { resolved, hasHousehold } = useBootstrapHousehold();

  if (status === 'loading') return <LoadingState />;
  if (status === 'signedOut') return <Redirect href="/sign-in" />;

  // Signed in, but we don't yet know whether they have a household. Holding here
  // avoids showing onboarding to someone who does.
  if (!resolved) return <LoadingState />;

  return hasHousehold ? <Redirect href="/today" /> : <Redirect href="/welcome" />;
}
