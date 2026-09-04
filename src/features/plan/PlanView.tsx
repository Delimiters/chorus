/**
 * The plan, wired to real data.
 *
 * `PlanScreen` renders a day; this decides which occurrences exist, which of
 * them are already committed to, and what the picker should offer. Kept apart
 * so the screen stays testable without a `QueryClient`, the same split
 * `RoutinesView` uses.
 */

import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CivilDate } from '@/core/civil/types';
import { splitByUrgency, type AgendaItem } from '@/core/occurrence/agenda';
import { unfinishedBefore } from '@/core/plan/plan';
import { proposeDay } from '@/core/plan/propose';
import { autoPlannable } from '@/core/plan/autoplan';
import { useUserId } from '@/stores/sessionStore';
import { isRecurring } from '@/core/chore/kind';
import { useMyFlags } from '@/data/hooks/useFlags';
import { useScheduleToday } from '@/data/hooks/useChores';
import { useHousehold } from '@/data/hooks/useHousehold';
import { useRoutinePreference, useRoutineStore } from '@/stores/routineStore';
import { useCategoryList } from '@/data/hooks/useCategories';
import { quantiseWindow, useOccurrences, useToday_View } from '@/data/hooks/useOccurrences';
import { useAddToPlan, useMyPlanEntries, usePlanLoading } from '@/data/hooks/usePlan';
import { ErrorState, LoadingState } from '@/design/components';
import { PlanPicker, type PickerGroup } from './PlanPicker';
import { PlanScreen } from './PlanScreen';

/** A schedule that is definitely not recurring, for a chore that has gone. */
const FALLBACK_SCHEDULE = {
  rule: { kind: 'unscheduled' },
  startsOn: '1970-01-01',
  endsOn: null,
  timesOfDay: [],
} as never;

/**
 * How far ahead the picker can see.
 *
 * Today projects about three weeks, which is right for "what needs doing" and
 * far too short for "let me add anything" — a chore due in October simply did
 * not exist to be picked. Jake: "really anything should be pickable there, just
 * things that are far in the future should maybe be towards the bottom."
 *
 * Thirteen weeks forward, well inside the engine's 400-day ceiling, and one
 * extra query rather than a wider window everywhere: Today staying small is
 * what keeps the screen that gets opened daily fast.
 */
const PICKER_WEEKS_FORWARD = 13;

export function PlanView() {
  const router = useRouter();
  const userId = useUserId();
  const { view, chores, today, isLoading, error, refetch } = useToday_View();
  const categories = useCategoryList();
  const entries = useMyPlanEntries(today);
  const entriesLoading = usePlanLoading(today);
  const add = useAddToPlan(today);
  const [picking, setPicking] = useState(false);
  const household = useHousehold();
  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const horizon = useOccurrences(
    useMemo(
      () => quantiseWindow(today, weekStartsOn, 0, PICKER_WEEKS_FORWARD),
      [today, weekStartsOn],
    ),
  );
  const myFlags = useMyFlags(
    today,
    (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  );

  /**
   * Everything the plan could name, including what is already done today.
   *
   * `view.floating` matters here and was missing: `buildTodayView` splits
   * floating groups out of `mine`/`theirs`, so every "3× a week" chore was
   * invisible to the plan — not offered by the picker, not renderable if
   * somehow planned. A floating group's `nextSlot` is the occurrence you would
   * actually do next, so that is the one the plan can hold.
   */
  const floatingSlots = useMemo(
    () =>
      view.floating
        .map((group) => group.nextSlot)
        .filter((slot): slot is AgendaItem => slot !== null),
    [view.floating],
  );

  /**
   * Dated work between tomorrow and the horizon, soonest first.
   *
   * `agenda` rather than `items`: collapsing superseded misses is what stops a
   * chore missed nine times offering nine identical rows to pick from.
   */
  const horizonUpcoming = useMemo(() => {
    const soonestPerChore = new Map<string, AgendaItem>();
    for (const item of horizon.agenda) {
      if (item.status !== 'upcoming' && item.status !== 'due') continue;
      if (item.dueOn <= today) continue;
      const held = soonestPerChore.get(item.choreId);
      if (held === undefined || item.dueOn < held.dueOn) soonestPerChore.set(item.choreId, item);
    }
    return [...soonestPerChore.values()].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  }, [horizon.agenda, today]);

  /**
   * Chores with no date, presented as pickable rows.
   *
   * Synthetic: there is no occurrence behind them, and the key is never
   * written anywhere — picking one schedules the chore instead. The key exists
   * only so the picker's selection set has something to hold.
   */
  const somedayItems = useMemo(
    () =>
      chores
        .filter((c) => c.schedule.rule.kind === 'unscheduled')
        .map(
          (c) =>
            ({
              occurrenceKey: `someday:${c.id}`,
              choreId: c.id,
              choreTitle: c.title,
              dueOn: today,
              status: 'due',
              daysOverdue: 0,
              missedBefore: 0,
              completedOn: null,
              completedBy: null,
              assignee: { kind: 'anyone' },
            }) as unknown as AgendaItem,
        ),
    [chores, today],
  );

  const recurringChoreIds = useMemo(
    () => new Set(chores.filter((c) => isRecurring(c.schedule)).map((c) => c.id)),
    [chores],
  );

  const available = useMemo(
    () => [
      ...view.mine,
      ...view.theirs,
      ...view.done,
      ...view.skipped,
      ...view.upcoming,
      ...floatingSlots,
      ...horizonUpcoming,
    ],
    [
      view.mine,
      view.theirs,
      view.done,
      view.skipped,
      view.upcoming,
      floatingSlots,
      horizonUpcoming,
    ],
  );

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const choreCategory = useMemo(() => new Map(chores.map((c) => [c.id, c.categoryId])), [chores]);

  /**
   * What the picker offers, grouped by *why you might pick it*.
   *
   * Deliberately not grouped by category: "Kitchen" answers "what kind of
   * thing is this", which is a question for the library. Here the question is
   * "what should be on today", and left-over, late and due are the answers to
   * that one.
   *
   * Anything already planned is excluded rather than shown ticked — the picker
   * is for adding, and a list where half the rows do nothing is a list you
   * have to read twice.
   */
  const groups = useMemo((): readonly PickerGroup[] => {
    const planned = new Set(
      entries.filter((e) => e.plannedFor === today).map((e) => e.occurrenceKey),
    );
    const outstanding = [...view.mine, ...view.theirs, ...floatingSlots].filter(
      (item) => !planned.has(item.occurrenceKey),
    );

    const leftOver = unfinishedBefore(entries, today, outstanding);
    const leftKeys = new Set(leftOver.map((i) => i.occurrenceKey));
    const rest = outstanding.filter((item) => !leftKeys.has(item.occurrenceKey));
    const urgency = splitByUrgency(rest, today);

    const nearby = new Set(
      [...leftOver, ...urgency.late, ...urgency.dueToday, ...urgency.comingUp].map(
        (i) => i.occurrenceKey,
      ),
    );

    const candidates: readonly PickerGroup[] = [
      // First, because you already decided these mattered once and did not get
      // to them. That is a stronger signal than anything the app can compute.
      { key: 'left', title: 'Left from before', items: leftOver as readonly AgendaItem[] },
      { key: 'late', title: 'Late', items: urgency.late },
      { key: 'today', title: 'Due today', items: urgency.dueToday },
      { key: 'soon', title: 'Coming up', items: urgency.comingUp },
      /*
       * Not due yet, and offerable anyway.
       *
       * "What am I doing today" legitimately includes getting ahead of
       * something due Thursday. Without this the picker could only offer work
       * already late or due — which on this household hid 129 occurrences and
       * is why "Water hallway pothos" could not be found at all.
       */
      /*
       * Everything else that is dated, out to the horizon, furthest last.
       *
       * Deduplicated against the groups above by key: the horizon overlaps
       * Today's window, so without this the same occurrence would be offered
       * twice and ticking one copy would leave the other looking unpicked.
       */
      {
        key: 'later',
        title: 'Later',
        items: horizonUpcoming.filter(
          (item) => !planned.has(item.occurrenceKey) && !nearby.has(item.occurrenceKey),
        ),
      },
      /*
       * "No date" chores, which otherwise have no way onto a day at all.
       *
       * `unscheduled` produces no occurrences by design — a someday chore is a
       * plain list, not part of the schedule — so it could never be planned,
       * ticked, or finished. You could create one and then never act on it,
       * which makes the whole "one-off with no deadline" idea a dead end.
       *
       * Picking one *gives it today's date*, which is the honest reading of
       * what the tap means: deciding to do it today is deciding when. It then
       * becomes an ordinary one-off and the plan claims it through the same
       * queue a newly created chore uses.
       */
      {
        key: 'someday',
        title: 'No date yet',
        items: somedayItems,
      },
      /*
       * Shown rather than omitted.
       *
       * Leaving already-planned work out made "it's not in the list" mean two
       * different things, and Jake hit the ambiguity directly: he went to add
       * "Water upstairs plants", could not find it, and reported it missing —
       * it was already on his plan that day.
       */
      {
        key: 'already',
        title: 'Already on today',
        locked: true,
        items: [
          ...view.mine,
          ...view.theirs,
          ...view.upcoming,
          ...floatingSlots,
          ...horizonUpcoming,
        ].filter((item) => planned.has(item.occurrenceKey)),
      },
    ];
    return candidates.filter((group) => group.items.length > 0);
  }, [
    entries,
    today,
    view.mine,
    view.theirs,
    view.upcoming,
    floatingSlots,
    horizonUpcoming,
    somedayItems,
  ]);

  /**
   * The day the app would offer, if asked.
   *
   * Built from the same candidates the picker groups, minus anything already
   * planned — so accepting the proposal and picking by hand can never disagree
   * about what is available.
   */
  const proposal = useMemo(() => {
    const planned = new Set(
      entries.filter((e) => e.plannedFor === today).map((e) => e.occurrenceKey),
    );
    /*
     * Yours only.
     *
     * The picker offers everything because that is you choosing; the proposal
     * is the app being *directive*, and it must not quietly hand you your
     * housemate's turn. The rows on the plan carry no turn label, so an
     * accepted proposal containing Sam's chores would silently reassign work
     * with nothing on screen saying so.
     */
    const outstanding = [...view.mine, ...floatingSlots].filter(
      (item) => !planned.has(item.occurrenceKey),
    );
    const leftOver = new Set(
      unfinishedBefore(entries, today, outstanding).map((i) => i.occurrenceKey),
    );

    // `isRecurring` rather than an inline check against `'once'`, which
    // counted an undated chore as recurring and so ranked it *below* the
    // litter box — the opposite of the point.
    const recurring = new Map(chores.map((c) => [c.id, isRecurring(c.schedule)]));
    const { items, reason } = proposeDay(
      outstanding.map((item) => ({
        occurrenceKey: item.occurrenceKey,
        choreId: item.choreId,
        choreTitle: item.choreTitle,
        dueOn: item.dueOn,
        daysOverdue: item.daysOverdue,
        missedBefore: item.missedBefore,
        recurring: recurring.get(item.choreId) ?? true,
      })),
      { flagged: myFlags, leftOver },
    );

    const byKey = new Map(outstanding.map((item) => [item.occurrenceKey, item]));
    return {
      items: items
        .map((i) => byKey.get(i.occurrenceKey))
        .filter((i): i is AgendaItem => i !== undefined),
      reason,
    };
  }, [entries, today, view.mine, floatingSlots, chores, myFlags]);

  /*
   * Recurring chores that are due today, or late, go on the plan by themselves.
   *
   * Jake asked for this and it is right: the litter box is not a decision. The
   * argument for "proposed, not pre-filled" was about the *backlog* — fifty
   * one-off things you have to choose between — and today's recurring
   * housework is not that. It is the baseline the day starts from.
   *
   * One-off work is still chosen, which is where the proposal earns its keep.
   *
   * Exactly once per day, so removing something sticks. Without the marker the
   * next render would put it straight back and "Take off today" would be a
   * button that does nothing.
   */
  const autoPlannedOn = useRoutinePreference().autoPlannedOn;
  const markAutoPlanned = useRoutineStore((s) => s.markAutoPlanned);

  /*
   * In flight, and failed-today, both as refs.
   *
   * `useAddToPlan` is optimistic: `onMutate` writes the new rows into the plan
   * cache before the request is even sent. `entries` is a dependency of this
   * effect, so the write immediately re-runs it, `due` comes out empty — every
   * key is now "planned" — and the empty branch below marked the day done with
   * the request still open. `autoPlannedOn` is persisted, so a write that then
   * failed left the day marked, the rollback restored the rows, and the
   * auto-plan silently never happened again that day. Precisely the failure the
   * comment on the mutation claims to prevent.
   *
   * `failedFor` exists because the obvious guard loops: on failure the cache
   * rolls back, `due` refills, and the effect resubmits forever.
   */
  const inFlight = useRef(false);
  const failedFor = useRef<CivilDate | null>(null);

  useEffect(() => {
    // Waits for the *plan* too, not only the chores. They are separate queries
    // with no ordering between them, and acting while `entries` is still empty
    // means every already-planned chore looks unplanned and gets re-added.
    if (isLoading || entriesLoading || autoPlannedOn === today) return;
    if (inFlight.current || failedFor.current === today) return;

    const planned = new Set(
      entries.filter((e) => e.plannedFor === today).map((e) => e.occurrenceKey),
    );

    /*
     * Due today **or late**, which is Jake's call and a reversal of the
     * previous rule here.
     *
     * The argument for today-only was that `view.mine` is everything
     * outstanding, so auto-adding it was the wall of fifty wearing the plan's
     * clothes. What changed is the cause of that wall: interval chores were
     * being held against a fixed grid, so being three days late meant being
     * permanently late and the backlog only ever grew. Completion-anchoring
     * means a late chore re-anchors to when you actually did it, so "overdue"
     * is now a handful of real things rather than a standing accusation.
     *
     * A late chore is work you already agreed to and did not get to. Leaving it
     * out of the day and waiting for the proposal to rank it back in made you
     * choose it twice.
     *
     * `dueOn <= today` rather than a status test, because `view.mine` also
     * carries anything `showFrom` has pulled forward — those are not late, they
     * are early, and auto-adding them puts next week on today.
     */
    /*
     * The rule itself lives in `core/plan/autoplan`, because the plan screen
     * also previews a housemate's day with it — what will be added when they
     * open the app. Two copies would drift, and the preview would quietly stop
     * matching what actually lands.
     */
    const due = autoPlannable(view.mine, {
      userId: userId ?? '',
      on: today,
      planned,
      recurring: (item) =>
        isRecurring(chores.find((c) => c.id === item.choreId)?.schedule ?? FALLBACK_SCHEDULE),
    });

    if (due.length === 0) {
      markAutoPlanned(today);
      return;
    }

    // Marked on success, not before: a failed insert used to leave the day
    // marked done, so the auto-plan silently never happened and nothing said so.
    inFlight.current = true;
    add.mutate(
      due.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })),
      {
        onSuccess: () => markAutoPlanned(today),
        onError: () => {
          failedFor.current = today;
        },
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  }, [
    isLoading,
    entriesLoading,
    autoPlannedOn,
    today,
    entries,
    view.mine,
    chores,
    add,
    markAutoPlanned,
    userId,
  ]);

  /*
   * Chores just created with "put it on today" ticked.
   *
   * Claimed here rather than written at the form, because a new chore has no
   * occurrence key until its schedule has been expanded — and deriving one at
   * the form would be a second recurrence engine drifting from the first.
   *
   * Cleared whether or not a match was found: a chore created with a date in
   * three weeks has no occurrence today, and the intent should not sit in the
   * queue waiting to surprise somebody on a later morning.
   */
  const planOnCreate = useRoutineStore((s) => s.planOnCreate);
  const clearPlanOnCreate = useRoutineStore((s) => s.clearPlanOnCreate);
  const queuePlanOnCreate = useRoutineStore((s) => s.queuePlanOnCreate);
  const scheduleToday = useScheduleToday(today);

  useEffect(() => {
    if (isLoading || entriesLoading || planOnCreate.length === 0) return;

    const planned = new Set(
      entries.filter((e) => e.plannedFor === today).map((e) => e.occurrenceKey),
    );
    /*
     * Yours only.
     *
     * `useAddToPlan` writes `user_id = me`, so pulling from `theirs` put your
     * housemate's chore on *your* plan — silently reassigning work, which the
     * proposal thirty lines up explicitly refuses to do. Creating a chore for
     * Emily with the switch on should not make it Jake's.
     */
    /*
     * Stale intents go; live ones wait.
     *
     * Anything queued on an earlier day is dropped — a chore created for next
     * month must not ambush somebody on a later morning. Anything queued today
     * is kept until its occurrence actually turns up, because for a "No date"
     * chore the occurrence does not exist until the schedule rewrite lands, and
     * clearing on the next render threw the intent away first.
     */
    const stale = planOnCreate.filter((q) => q.queuedOn !== today).map((q) => q.choreId);
    const live = planOnCreate.filter((q) => q.queuedOn === today).map((q) => q.choreId);

    const wanted = [...view.mine, ...view.upcoming].filter(
      (item) => live.includes(item.choreId) && !planned.has(item.occurrenceKey),
    );

    const settled = [...stale, ...wanted.map((i) => i.choreId)];
    if (settled.length > 0) clearPlanOnCreate(settled);
    if (wanted.length > 0) {
      add.mutate(wanted.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })));
    }
  }, [
    isLoading,
    planOnCreate,
    entries,
    today,
    view.mine,
    view.upcoming,
    add,
    clearPlanOnCreate,
    entriesLoading,
  ]);

  if (isLoading) return <LoadingState label="Loading your day" />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <>
      <PlanScreen
        available={available}
        chores={chores}
        /*
         * Which chores recur, decided here because this is the layer that has
         * their schedules — the screen's `chores` prop is a lighter shape. The
         * screen needs it to forecast a housemate's day with the same rule that
         * fills it.
         */
        recurringChoreIds={recurringChoreIds}
        today={today}
        refetch={refetch}
        onAdd={() => setPicking(true)}
        proposal={proposal}
        onAcceptProposal={(items) =>
          add.mutate(items.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })))
        }
      />
      <PlanPicker
        open={picking}
        groups={groups}
        categoryFor={(choreId) => {
          const category = categoryById.get(choreCategory.get(choreId) ?? '');
          return category === undefined ? null : { name: category.name, ink: category.ink };
        }}
        onClose={() => setPicking(false)}
        /*
         * `?plan=1` so the form's "put it on today" switch defaults on here and
         * nowhere else — the same reason the floating + on this sub-tab used to
         * pass it, before it was removed for looking like the "add to today"
         * button it sat beside.
         */
        onCreate={(title) => {
          setPicking(false);
          const suffix = title.length === 0 ? '' : `&title=${encodeURIComponent(title)}`;
          router.push(`/chore/new?plan=1${suffix}`);
        }}
        onAdd={(items) => {
          /*
           * Two kinds of pick, told apart by the synthetic key.
           *
           * An undated chore has no occurrence to plan, so choosing it sets its
           * date to today; the plan then claims it through the same queue a
           * newly created chore uses, once the occurrence actually exists.
           */
          const someday = items.filter((i) => i.occurrenceKey.startsWith('someday:'));
          const real = items.filter((i) => !i.occurrenceKey.startsWith('someday:'));

          if (real.length > 0) {
            add.mutate(real.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })));
          }
          for (const item of someday) {
            queuePlanOnCreate(item.choreId, today);
            scheduleToday.mutate(item.choreId);
          }
        }}
      />
    </>
  );
}
