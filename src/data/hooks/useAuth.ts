/**
 * Auth wiring and mutations.
 *
 * `useAuthListener` is mounted exactly once, in the root layout. It is the only
 * writer of session state — see src/stores/sessionStore.ts for why that matters.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useSessionStore } from '@/stores/sessionStore';
import { describeError, supabase, watchAppStateForAuth } from '../supabase';

/**
 * Subscribes to auth changes and restores any persisted session.
 *
 * Order matters: `onAuthStateChange` is registered *before* `getSession()` so an
 * event firing during restoration cannot be missed.
 */
export function useAuthListener(): void {
  const setSession = useSessionStore((s) => s.setSession);
  const markSignedOut = useSessionStore((s) => s.markSignedOut);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);

      // Signing out must drop every cached query, or the next person to sign in
      // on this device sees the previous user's household until refetch lands.
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session === null) markSignedOut();
      else setSession(data.session);
    });

    const stopAppStateWatch = watchAppStateForAuth();

    return () => {
      subscription.subscription.unsubscribe();
      stopAppStateWatch();
    };
  }, [setSession, markSignedOut, queryClient]);
}

export function useSignIn() {
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: input.email.trim(),
        password: input.password,
      });
      if (error) {
        // Supabase returns the same message for a wrong password and an unknown
        // address, deliberately — confirming which emails exist is an
        // enumeration vector. Keep that property in the copy.
        throw new Error(
          error.message.toLowerCase().includes('invalid login')
            ? 'That email and password combination is not right.'
            : describeError(error),
        );
      }
    },
  });
}

export function useSignUp() {
  return useMutation({
    mutationFn: async (input: { email: string; password: string; displayName: string }) => {
      const { error } = await supabase.auth.signUp({
        email: input.email.trim(),
        password: input.password,
        options: { data: { display_name: input.displayName.trim() } },
      });
      // `display_name` lands in raw_user_meta_data, which the signup trigger
      // reads to create the profile row. See the migration.
      if (error) {
        throw new Error(
          error.message.toLowerCase().includes('already registered')
            ? 'There is already an account with that email. Try signing in.'
            : describeError(error),
        );
      }
    },
  });
}

export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(describeError(error));
    },
  });
}
