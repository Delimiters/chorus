/**
 * Auth group. Redirects away if a session already exists, so the back gesture
 * cannot land somebody on the sign-in screen while signed in.
 */

import { Redirect, Stack } from 'expo-router';

import { useColors } from '@/design/theme';
import { useAuthStatus } from '@/stores/sessionStore';

export default function AuthLayout() {
  const status = useAuthStatus();
  const colors = useColors();

  if (status === 'signedIn') return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.paper },
      }}
    />
  );
}
