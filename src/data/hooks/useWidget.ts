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

import { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { useMyPlanEntries, usePlanLoading } from './usePlan';

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
  const { items, chores, isLoading: occurrencesLoading } = useOccurrences(window);
  const entries = useMyPlanEntries(today);
  const planLoading = usePlanLoading(today);

  /**
   * Whether the plan on screen is the real one yet.
   *
   * **This is the guard that matters, and the first version got it wrong.** It
   * gated on `household.data`, which is one fast query — while
   * `useMyPlanEntries` returns `[]` and `useOccurrences` returns `[]` for
   * several round trips after that. So every cold start published a
   * `totalCount: 0` snapshot, which the widget renders as the confident lie
   * "Nothing left today.", and called `endActivity()` on a card that should
   * still have been up — then raised a fresh one a moment later.
   *
   * The same shape as the bug that seeded the chore chart from a household
   * that had not loaded yet: an empty result and an unloaded query are
   * indistinguishable unless you ask.
   */
  const ready =
    enabled &&
    userId !== null &&
    household.data !== undefined &&
    members.data !== undefined &&
    !occurrencesLoading &&
    !planLoading;

  const planned = useMemo(() => planFor(entries, today, items), [entries, today, items]);

  /**
   * Which chores asked to be insisted on.
   *
   * The same switch and the same set the reminder ladder uses — one checkbox,
   * one meaning — and from the query the window already pulled, so it costs no
   * fetch. It is what decides whether there is a persistent card at all: the
   * first version raised one whenever anything was outstanding, which put a
   * permanent box on the lock screen for an ordinary day.
   */
  const insistChoreIds = useMemo(
    () => new Set(chores.filter((chore) => chore.nagUntilDone).map((chore) => chore.id)),
    [chores],
  );

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
  /**
   * Serialises calls into ActivityKit.
   *
   * Two unawaited `showActivity` calls can each observe an empty
   * `Activity.activities` and each reach `Activity.request`, leaving two cards
   * for the same day — after which only the first one found is ever updated and
   * the other sits there with a frozen chore. Reachable on a cold start, where
   * the snapshot changes once when the occurrences land and again when the
   * member inks do.
   */
  const activityQueue = useRef<Promise<unknown>>(Promise.resolve());

  const pushActivity = useCallback((fn: () => Promise<unknown>) => {
    activityQueue.current = activityQueue.current.then(fn, fn).catch(() => {
      /*
       * Swallowed on purpose, and explicitly. Expo rejects on an argument
       * mismatch, and an unhandled rejection in a side-effect hook is a
       * red-box in dev over an accessory feature. The transport's own
       * failures are already reported as `false`.
       */
    });
  }, []);

  useEffect(() => {
    if (!ready) return;

    const { writtenAt: _ignored, ...comparable } = snapshot;
    const fingerprint = JSON.stringify(comparable);
    if (fingerprint === published.current) return;
    published.current = fingerprint;

    transport.publish(snapshot);

    const state = activityState(planned, inkByMember, insistChoreIds);
    if (state === null) {
      /*
       * Ends the card when no outstanding chore has asked to insist — which
       * covers a finished plan, an empty one, and the ordinary case of a day
       * with work on it and nothing urgent enough to pin to the lock screen.
       * A card that outlives its reason is worse than no card.
       */
      pushActivity(() => transport.endActivity());
    } else {
      pushActivity(() => transport.showActivity(today, state));
    }
  }, [ready, snapshot, planned, inkByMember, insistChoreIds, today, transport, pushActivity]);

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
  /**
   * The mutation, behind a ref.
   *
   * `useMutation` returns a fresh object every render, so depending on it made
   * the drain effect tear down its `AppState` listener and read the native
   * queue on *every render of the root layout*. Kept current in an effect
   * rather than during render, which the React Compiler would bail out of.
   */
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const draining = useRef(false);

  const drain = useCallback(async () => {
    /*
     * One drain at a time. This one is real: the loop awaits each write, so a
     * second drain started by a foreground event mid-flight would try the same
     * keys again. (The first version held this flag across a loop with no
     * `await` in it, where it could never be observed as set.)
     */
    if (draining.current) return;

    const keys = transport.pendingTicks();
    if (keys.length === 0) return;

    draining.current = true;
    try {
      /**
       * Acknowledged one at a time, after the write lands.
       *
       * Nothing is forgotten until the database has it, which is the whole
       * point of the two-call protocol: a tick made on the lock screen and
       * replayed while offline stays queued for the next launch instead of
       * disappearing.
       */
      for (const key of keys) {
        const item = itemsRef.current.find((candidate) => candidate.occurrenceKey === key);

        /*
         * A key with nothing behind it is acknowledged and dropped. It means
         * the chore was archived, or rescheduled so its key changed, and the
         * tick has nowhere to land — keeping it would retry it forever.
         *
         * Safe only because this runs when the queries have resolved: the
         * earlier version drained on the first render, where *every* key
         * looked unknown, and silently threw away every tick made before the
         * app was opened.
         */
        if (item === undefined || item.status === 'completed' || item.status === 'skipped') {
          transport.acknowledgeTicks([key]);
          continue;
        }

        try {
          await toggleRef.current.mutateAsync({ item, complete: true });
          transport.acknowledgeTicks([key]);
        } catch {
          /*
           * Left in the queue, and the drain stops. Offline is the usual
           * cause, and the rest of the batch would fail the same way.
           */
          break;
        }
      }
    } finally {
      draining.current = false;
    }
  }, [transport]);

  useEffect(() => {
    if (!ready) return;

    /*
     * `.catch` on both, and not decoratively: `pendingTicks` and
     * `acknowledgeTicks` are synchronous Expo `Function`s, which *throw*
     * rather than reject — and `pendingTicks` is called outside the
     * try/finally. Inside an async function that becomes an unhandled
     * rejection, which red-boxes in dev over an accessory feature.
     */
    void drain().catch(() => {});

    /*
     * On every foreground, which is also what keeps the Live Activity honest:
     * its `staleDate` is four hours out, and iOS dims a card past it to say
     * "this may be out of date". Re-publishing on foreground is what the
     * staleDate comment claims happens — it did not, before this.
     */
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void drain().catch(() => {});
      const state = activityState(planned, inkByMember, insistChoreIds);
      if (state !== null) pushActivity(() => transport.showActivity(today, state));
    });
    return () => subscription.remove();
  }, [ready, drain, planned, inkByMember, insistChoreIds, today, transport, pushActivity]);
}
