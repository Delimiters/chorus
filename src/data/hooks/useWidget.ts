/**
 * Keeping the home screen and the lock screen in step with the plan.
 *
 * Same shape as `useReminderSync`, and for the same reason: the snapshot is a
 * pure function of the plan, so "has anything changed that the widget should
 * show?" is answered by React re-rendering rather than by bookkeeping.
 *
 * It projects from the queries the plan screen itself uses. A second projection
 * with its own idea of which completions exist is how a widget ends up showing
 * a chore that was ticked an hour ago — the same failure `useReminderSync`
 * guards against, and the reason neither of them owns a query.
 */

import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { safeDayStart } from '@/core/civil/daybreak';
import { planFor } from '@/core/plan/plan';
import { activityState, widgetSnapshot, type InkByMember } from '@/core/widget/snapshot';
import { inkByName } from '@/design/inks';
import { useUserId } from '@/stores/sessionStore';
import { nativeWidget, widgetAvailable, type WidgetTransport } from '../widget';
import { useToday } from '../today';
import { useHousehold, useMembers } from './useHousehold';
import { quantiseWindow, useOccurrences, useToggleCompletion } from './useOccurrences';
import { useMyPlanEntries } from './usePlan';

interface Options {
  /** Off on web and in tests, where there is no widget to talk to. */
  readonly enabled?: boolean;
  /** Swapped in tests. */
  readonly transport?: WidgetTransport;
}

export function useWidgetSync({
  enabled = widgetAvailable,
  transport = nativeWidget,
}: Options = {}): void {
  const userId = useUserId();
  const household = useHousehold();
  const members = useMembers();
  const timeZone = household.data?.timeZone ?? 'UTC';
  const dayStartsAtHour = safeDayStart(household.data?.dayStartsAtHour);
  const today = useToday(timeZone, dayStartsAtHour);
  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  /*
   * `items`, not `agenda`: the collapse rule hides superseded misses, which is
   * right for a screen and wrong for matching plan entries by key — a planned
   * occurrence that the collapse hid would simply vanish from the widget.
   *
   * Two weeks back and one forward, quantised, which is a subset of the window
   * the plan screen already holds. So this costs no extra fetch.
   */
  const window = useMemo(() => quantiseWindow(today, weekStartsOn, 2, 1), [today, weekStartsOn]);
  const { items } = useOccurrences(window);
  const entries = useMyPlanEntries(today);

  const planned = useMemo(() => planFor(entries, today, items), [entries, today, items]);

  const inkByMember = useMemo<InkByMember>(() => {
    const map: Record<string, { light: string; dark: string }> = {};
    for (const member of members.data ?? []) {
      const ink = inkByName(member.accent);
      map[member.userId] = { light: ink.light, dark: ink.dark };
    }
    return map;
  }, [members.data]);

  /*
   * The write time is deliberately *not* in the comparison below.
   *
   * It changes on every render, so including it would make every fingerprint
   * unique and rewrite the file — and ask WidgetKit for a reload — on each one.
   * iOS budgets roughly 40-70 reloads a day; spending them on no-ops is how a
   * widget ends up stale all evening.
   */
  const snapshot = useMemo(
    () => widgetSnapshot(planned, today, inkByMember, new Date().toISOString()),
    [planned, today, inkByMember],
  );

  const published = useRef<string>('');

  useEffect(() => {
    if (!enabled || userId === null) return;
    /*
     * Hold off until the plan query has actually resolved.
     *
     * `useMyPlanEntries` returns an empty array while loading, which is
     * indistinguishable from "nothing planned today" — and publishing that
     * would blank the widget on every cold start and end the Live Activity
     * before the data arrived. The same shape as the bug that seeded the chart
     * from a household that had not loaded yet.
     */
    if (household.data === undefined) return;

    const { writtenAt: _ignored, ...comparable } = snapshot;
    const fingerprint = JSON.stringify(comparable);
    if (fingerprint === published.current) return;
    published.current = fingerprint;

    transport.publish(snapshot);

    const state = activityState(snapshot);
    if (state === null) {
      /*
       * Ends the card when the plan is finished *and* when it is empty. Both
       * are "nothing to be persistent about", and a card that outlives its
       * list is worse than no card.
       */
      void transport.endActivity();
    } else {
      void transport.showActivity(today, state);
    }
  }, [enabled, userId, household.data, snapshot, today, transport]);

  /*
   * Ticks made from the home screen or the lock screen.
   *
   * The widget writes an occurrence key and reloads its own timeline; the real
   * completion — right day, right key, interval chores re-anchored — happens
   * here, through the same mutation the app's own checkbox uses. Doing the
   * write in Swift would mean a second copy of the completion rules, and the
   * two would disagree about exactly the things this project has been bitten
   * by: which day a tick belongs to, and what it does to the next due date.
   */
  const toggle = useToggleCompletion();
  const replaying = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const drain = () => {
      /*
       * One drain at a time. `takePendingTicks` is destructive, so two
       * overlapping drains would each take half the queue and the second would
       * fire while the first is still awaiting — losing nothing, but doubling
       * the writes.
       */
      if (replaying.current) return;
      const keys = transport.takePendingTicks();
      if (keys.length === 0) return;

      replaying.current = true;
      try {
        for (const key of keys) {
          const item = items.find((candidate) => candidate.occurrenceKey === key);
          /*
           * A key with nothing behind it is dropped, not retried. It means the
           * chore was archived or rescheduled since the tap, and the tick has
           * nowhere to land. Keeping it would replay it forever.
           */
          if (item === undefined) continue;
          if (item.status === 'completed') continue;
          /*
           * No `completedOn`: it defaults to today, which is right. A tick from
           * the lock screen happens now, and `exactOptionalPropertyTypes` makes
           * passing an explicit undefined a type error rather than a shrug.
           */
          toggle.mutate({ item, complete: true });
        }
      } finally {
        replaying.current = false;
      }
    };

    drain();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') drain();
    });
    return () => subscription.remove();
  }, [enabled, items, toggle, transport]);
}
