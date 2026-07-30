/**
 * The TanStack Query client, wired for React Native.
 *
 * Two pieces of wiring that web apps get for free and React Native does not:
 * `focusManager` needs AppState (there is no window focus event), and
 * `onlineManager` needs NetInfo (there is no `navigator.onLine`). Without them,
 * refetch-on-focus and pause-while-offline silently never happen.
 */

import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A two-person household's data changes rarely and realtime pushes an
        // invalidation the moment it does, so polling would be waste.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 2,
        // The realtime subscription is the primary freshness mechanism; focus
        // refetch is the backstop for events missed while backgrounded.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        // Mutations are user-initiated. Retrying a failed write silently can
        // duplicate an action the user thinks failed; surface it instead.
        retry: 0,
      },
    },
  });
}

/**
 * Connects TanStack Query's focus tracking to AppState.
 *
 * Returns an unsubscribe function.
 */
export function wireFocusManager(): () => void {
  const handle = (state: AppStateStatus): void => {
    focusManager.setFocused(state === 'active');
  };
  const subscription = AppState.addEventListener('change', handle);
  return () => subscription.remove();
}

/**
 * Connects TanStack Query's online tracking to NetInfo, when available.
 *
 * NetInfo is not currently a dependency, so this defaults to "always online" —
 * which is the correct behaviour for now, because assuming offline would pause
 * every query. Wired properly in Phase 7 alongside realtime.
 */
export function wireOnlineManager(): () => void {
  onlineManager.setOnline(true);
  return () => {};
}
