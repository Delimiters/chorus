/**
 * Root layout. Providers, and nothing else.
 *
 * The auth listener is mounted here — exactly once for the app's lifetime — so
 * there is a single writer of session state. See src/stores/sessionStore.ts.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthListener } from '@/data/hooks/useAuth';
import { configureNotificationHandler } from '@/data/notifications';
import { createQueryClient, wireFocusManager, wireOnlineManager } from '@/data/queryClient';
import { ErrorBoundary } from '@/design/ErrorBoundary';
import { ThemeProvider, useTheme } from '@/design/theme';

/**
 * Once, at module load, before anything renders.
 *
 * It was exported with no caller — its own docstring said "set once at module
 * load" and nothing called it — which meant foreground notification behaviour
 * was whatever the library defaults to, rather than the decision the function
 * exists to express.
 */
configureNotificationHandler();

function Providers() {
  useAuthListener();
  const { isDark } = useTheme();

  useEffect(() => {
    const stopFocus = wireFocusManager();
    const stopOnline = wireOnlineManager();
    return () => {
      stopFocus();
      stopOnline();
    };
  }, []);

  return (
    <>
      <Slot />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  // The client is created once and held in state rather than at module scope, so
  // a fast refresh doesn't blow away the cache mid-session.
  const [queryClient] = useState(createQueryClient);

  return (
    /* Outside every provider: a throw inside one of them is exactly the case
       a boundary nested within them could not catch. */
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider>
            <Providers />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
