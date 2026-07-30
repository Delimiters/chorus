/**
 * The Supabase client.
 *
 * Three settings here are load-bearing, and omitting any of them produces a bug
 * that only shows up later:
 *
 *   storage             — without a React Native adapter, supabase-js reaches for
 *                         `localStorage`, which does not exist, so the session is
 *                         never persisted and the user is signed out on relaunch.
 *   detectSessionInUrl  — must be false. It is a web-only OAuth mechanism; left
 *                         on, it tries to parse a URL that isn't there.
 *   autoRefresh + AppState — supabase-js refreshes on a timer, and timers do not
 *                         fire reliably while an app is backgrounded. Without the
 *                         AppState wiring the token silently expires and requests
 *                         start failing after the app has been idle.
 *
 * See docs/ARCHITECTURE.md.
 */

import { createClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';
import 'react-native-url-polyfill/auto';

import { authStorage } from './authStorage';
import type { Database } from './database.types';
import { env } from './env';

export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Starts and stops the refresh timer with the app's foreground state.
 *
 * Returns an unsubscribe function; called once from the root layout.
 */
export function watchAppStateForAuth(): () => void {
  const handle = (state: AppStateStatus): void => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  // The app is already foregrounded when this runs, so prime it.
  handle(AppState.currentState);

  const subscription = AppState.addEventListener('change', handle);
  return () => subscription.remove();
}

/**
 * Maps a Supabase/Postgres error into something a person can read.
 *
 * The codes matter to the app's behaviour rather than only its copy:
 *   23505 — unique violation. For a completion this means "already recorded",
 *           which the mutation layer treats as success. See docs/DATA_MODEL.md.
 *   42501 — insufficient privilege. A policy said no.
 */
export function describeError(error: { code?: string | undefined; message: string }): string {
  switch (error.code) {
    case '23505':
      return 'That was already recorded.';
    case '42501':
      return "You don't have permission to do that.";
    case 'PGRST116':
      return 'Not found.';
    default:
      break;
  }

  // Errors raised by our RPCs, which use the message as the error identity.
  if (error.message.includes('invalid_invite_code')) {
    return "That code doesn't match any invite. Check for typos.";
  }
  if (error.message.includes('invite_already_used')) {
    return 'That invite has already been used.';
  }
  if (error.message.includes('invite_expired')) {
    return 'That invite has expired. Ask for a new one.';
  }
  if (error.message.includes('not_authenticated')) {
    return 'Please sign in again.';
  }

  // Never surface an empty or object-shaped message. A user seeing "{}" learns
  // nothing and has no next action; this at least tells them to retry.
  const message = error.message.trim();
  if (message === '' || message === '{}' || message === '[object Object]') {
    return 'Something went wrong. Please try again.';
  }
  return message;
}

/** True when an insert failed only because the row already existed. */
export function isDuplicate(error: { code?: string | undefined } | null): boolean {
  return error?.code === '23505';
}
