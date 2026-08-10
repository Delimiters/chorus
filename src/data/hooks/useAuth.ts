/**
 * Auth wiring and mutations.
 *
 * `useAuthListener` is mounted exactly once, in the root layout. It is the only
 * writer of session state — see src/stores/sessionStore.ts for why that matters.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useSessionStore } from '@/stores/sessionStore';
import { localTransport } from '../notifications';
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

/**
 * Creating an account.
 *
 * Returns whether the account still needs confirming, and the caller has to say
 * so — because this is the one success case that looks exactly like a failure.
 *
 * With "Confirm email" enabled (the default for a new Supabase project) signup
 * returns **200 with a user and no session**. The first version ignored the
 * response and only checked `error`, so tapping "Create account" against such a
 * project created the account, returned nothing, navigated nowhere and showed no
 * message. The account existed; the app looked broken; trying again would then
 * report the address as already registered.
 */
export function useSignUp() {
  return useMutation({
    mutationFn: async (input: {
      email: string;
      password: string;
      displayName: string;
    }): Promise<{ needsConfirmation: boolean }> => {
      const { data, error } = await supabase.auth.signUp({
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
      // A user without a session means the address has to be confirmed first.
      // The auth listener will not fire, so nothing else is coming.
      return { needsConfirmation: data.session === null };
    },
  });
}

export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      /**
       * Clear the notification queue *first*.
       *
       * Local reminders live in the operating system, not in the session, so
       * signing out does not touch them — up to sixty reminders naming the
       * previous account's chores would keep firing for weeks, on a phone whose
       * app no longer has any of that data to show.
       *
       * Before the sign-out rather than after, because the auth listener tears
       * the app shell down as soon as the session goes and nothing after that
       * point is guaranteed to run.
       */
      await localTransport.cancelAll().catch(() => {
        // A phone that will not let us clear the queue is not a reason to
        // refuse to sign out.
      });

      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(describeError(error));
    },
  });
}

/**
 * Deletes the signed-in account, then signs out.
 *
 * The order matters and is not interchangeable: pending local notifications
 * are cancelled first, because they live on the phone and would otherwise keep
 * firing for chores belonging to a household this person is no longer in — and
 * possibly to a household that no longer exists.
 *
 * What survives is decided in the database, not here. Completions outlive
 * their author with a name snapshot; a household nobody is left in goes. See
 * the account-deletion migration for why.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      await localTransport.cancelAll();
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw new Error(describeError(error));
      // Sign-out clears the session listener and the stores. A failure here
      // leaves a signed-in session pointing at a deleted user, which the next
      // request rejects anyway — so it is not worth failing the deletion over.
      await supabase.auth.signOut();
    },
  });
}
