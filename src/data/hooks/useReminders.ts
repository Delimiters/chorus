/**
 * Keeping the notification queue in step with the agenda.
 *
 * Replans whenever the data behind it changes, which is the whole trick: the
 * plan is a pure function of occurrences, so "did anything change that should
 * change my reminders?" is answered by React re-rendering rather than by
 * bookkeeping.
 *
 * It plans from `useOccurrences`, the same hook the screens use, rather than
 * projecting separately. A reminder for something already ticked off is the
 * worst failure this feature has, and a second projection with its own idea of
 * which completions exist is exactly how that happens.
 *
 * Debounced and deduplicated: rewriting sixty OS notifications on every
 * keystroke of an edit would be slow and almost always a no-op.
 */

import { useEffect, useMemo, useRef } from 'react';

import {
  keepAliveFor,
  planReminders,
  type PlannedReminder,
  type ReminderPolicy,
} from '@/core/notify/plan';
import { useUserId } from '@/stores/sessionStore';
import { localTransport, notificationsAvailable } from '../notifications';
import { useToday } from '../today';
import { useHousehold } from './useHousehold';
import { quantiseWindow, useOccurrences } from './useOccurrences';

/** How long to wait for the dust to settle before touching the OS queue. */
const SETTLE_MS = 750;

/** Five weeks forward. Past the cap in any realistic household, and bounded. */
const WEEKS_AHEAD = 5;

interface Options {
  readonly policy: ReminderPolicy;
  /** Off in tests and on web, where there is nothing to schedule. */
  readonly enabled?: boolean;
}

export function useReminderSync({ policy, enabled = notificationsAvailable }: Options): void {
  const userId = useUserId();
  const household = useHousehold();
  const timeZone = household.data?.timeZone ?? 'UTC';
  const today = useToday(timeZone);
  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  /**
   * Forward only. Reminders never point at the past, so there is no reason to
   * project it — and `quantiseWindow` keeps the query key stable for a week at
   * a time, so this shares its cache with nothing and churns nothing.
   */
  const window = useMemo(
    () => quantiseWindow(today, weekStartsOn, 0, WEEKS_AHEAD),
    [today, weekStartsOn],
  );

  // `items`, not `agenda`: the collapse rule hides superseded misses, which is
  // right for a screen and wrong here — every future occurrence is a real thing
  // to be reminded about.
  const { items } = useOccurrences(window);

  const plan = useMemo<readonly PlannedReminder[]>(() => {
    if (!enabled || userId === null) return [];
    const reminders = planReminders({ occurrences: items, today, userId, policy });
    // The keep-alive rides along with the rest so it is cancelled and rewritten
    // by the same reconcile — a queue-topping reminder that outlives the queue
    // it was meant to top up would be its own small joke.
    const keepAlive = keepAliveFor(reminders, policy);
    return keepAlive === null ? reminders : [...reminders, keepAlive];
  }, [enabled, items, today, userId, policy]);

  /** The last plan actually written to the OS, so an identical one is skipped. */
  const written = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Bumped on every attempt, so a slow reconcile that has been overtaken stops
   * instead of finishing.
   *
   * `reconcile` cancels everything and then schedules up to sixty items one
   * await at a time, which can outlast the debounce on a real device. Without
   * this, an overtaken run resumes after the newer one has finished and
   * schedules the *rest of its stale plan* — including a chore that was
   * completed in between.
   */
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const fingerprint = plan.map((r) => `${r.id}@${r.onDate}T${r.atTime}`).join('|');
    if (fingerprint === written.current) return;

    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const mine = (generation.current += 1);
      void (async () => {
        if (plan.length > 0) {
          const allowed = await localTransport.ensurePermission();
          if (!allowed || mine !== generation.current) return;
        }
        await localTransport.reconcile(plan, () => mine === generation.current);
        if (mine !== generation.current) return;
        written.current = fingerprint;
      })();
    }, SETTLE_MS);

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [plan, enabled]);
}
