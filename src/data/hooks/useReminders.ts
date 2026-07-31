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

import { planReminders, type PlannedReminder, type ReminderPolicy } from '@/core/notify/plan';
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
    return planReminders({ occurrences: items, today, userId, policy });
  }, [enabled, items, today, userId, policy]);

  /** The last plan actually written to the OS, so an identical one is skipped. */
  const written = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const fingerprint = plan.map((r) => `${r.id}@${r.onDate}T${r.atTime}`).join('|');
    if (fingerprint === written.current) return;

    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void (async () => {
        if (plan.length > 0) {
          const allowed = await localTransport.ensurePermission();
          if (!allowed) return;
        }
        await localTransport.reconcile(plan, timeZone);
        written.current = fingerprint;
      })();
    }, SETTLE_MS);

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [plan, enabled, timeZone]);
}
