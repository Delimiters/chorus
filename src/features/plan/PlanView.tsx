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
import { autoPlannable, belongsTo } from '@/core/plan/autoplan';
import { useUserId } from '@/stores/sessionStore';
import { isRecurring } from '@/core/chore/kind';
import { useFlagsByChore } from '@/data/hooks/useFlags';
import { useScheduleToday } from '@/data/hooks/useChores';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import { useRoutineStore } from '@/stores/routineStore';
import { useCategoryList } from '@/data/hooks/useCategories';
import { quantiseWindow, useOccurrences, useToday_View } from '@/data/hooks/useOccurrences';
import {
  useAddToPlan,
  useMyPlanEntries,
  usePlanDismissals,
  usePlanEntries,
  usePlanLoading,
} from '@/data/hooks/usePlan';
import { ErrorState, LoadingState } from '@/design/components';
import { PlanPicker, type PickerGroup } from './PlanPicker';
import { PlanScreen } from './PlanScreen';

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
  /*
   * Whose day the picker is filling. `null` is your own.
   *
   * The picker itself is unchanged — what it offers is the household's
   * outstanding work either way — but where the rows land is not, and adding to
   * your housemate's day silently landing on yours is a dead button.
   */
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const add = useAddToPlan(today);
  /*
   * A second instance, bound to whoever the picker is currently filling for.
   *
   * The auto-plan and the create-queue always mean *your* day, so they keep
   * `add`. Only the picker can be pointed elsewhere.
   */
  const addForPicked = useAddToPlan(today, pickingFor ?? undefined);

  const [picking, setPicking] = useState(false);
  const household = useHousehold();
  const members = useMembers();

  /**
   * The housemate, and the whole household's plan rows.
   *
   * `undefined` covers both "living alone" and "members have not loaded", and
   * both must mean "fill nobody else's day" — `useAddToPlan(today, undefined)`
   * falls back to *you*, so a fill issued before members land would write your
   * housemate's chores onto your own plan.
   */
  const housemateId = useMemo(
    () => (members.data ?? []).find((m) => m.userId !== userId)?.userId,
    [members.data, userId],
  );
  const allEntries = usePlanEntries(today);
  const addForThem = useAddToPlan(today, housemateId);
  const weekStartsOn = (household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const horizon = useOccurrences(
    useMemo(
      () => quantiseWindow(today, weekStartsOn, 0, PICKER_WEEKS_FORWARD),
      [today, weekStartsOn],
    ),
  );
  /*
   * The household's flags, not just yours. `propose.ts` already documents this
   * argument as "what either of you" has flagged, and the ranking gives it 500
   * points — but this passed `useMyFlags`, so a chore Emily flagged never got
   * the boost on Jake's proposal. Shared flags make the mismatch plain.
   */
  const flagsByChore = useFlagsByChore();
  const householdFlags = useMemo(() => new Set(flagsByChore.keys()), [flagsByChore]);

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
      { flagged: householdFlags, leftOver },
    );

    const byKey = new Map(outstanding.map((item) => [item.occurrenceKey, item]));
    return {
      items: items
        .map((i) => byKey.get(i.occurrenceKey))
        .filter((i): i is AgendaItem => i !== undefined),
      reason,
    };
  }, [entries, today, view.mine, floatingSlots, chores, householdFlags]);

  /**
   * Everything due or late that is not on your plan yet.
   *
   * The manual counterpart to the setting above, and computed from the same
   * `autoPlannable` rule on purpose: if the button offered a different set from
   * the one auto-fill would add, the two would be describing different days and
   * the label would be a lie.
   *
   * Jake asked for this alongside turning the filling off — *"maybe there can
   * be a button that says like 'Add all due/overdue'"*. Off by default means
   * the wall is gone; this is how you get it back deliberately on a morning
   * when you do want everything.
   */
  const dueOrLate = useMemo(() => {
    /*
     * Empty while the plan is still loading, not "everything".
     *
     * `entries` is `EMPTY` until the plan query lands, so `planned` would be
     * empty and the count would include occurrences already on today's plan —
     * and in that same window the screen's own `planned` is empty too, so the
     * empty-plan branch renders and offers the button. The result was an
     * inflated number on a day that is already full.
     *
     * Pressing it could not create duplicate rows — the upsert ignores
     * conflicts — but the entire justification for putting the count in the
     * label is that you are told how big the commitment is before you tap.
     * `usePlanLoading` exists for exactly this: anything that acts on "what is
     * already planned" has to wait for it.
     *
     * The auto-fill effect below has had this guard since #90 — an earlier
     * version of this sentence said "always", which is wrong by eight PRs: the
     * effect arrived in #82 and the guard was added to it later, for this same
     * reason. Sharing the rule but not the gating is where the two diverged.
     */
    if (entriesLoading) return [];
    const planned = new Set(
      entries.filter((e) => e.plannedFor === today).map((e) => e.occurrenceKey),
    );
    return autoPlannable(view.mine, { userId: userId ?? '', on: today, planned });
  }, [entries, entriesLoading, today, view.mine, userId]);

  /*
   * What goes onto the plan without being chosen — which, by default, is only
   * what one of you has flagged.
   *
   * This used to be "recurring chores that are due or late", then everything
   * due or late once one-off work was folded in, and now nothing at all unless
   * the household opts in — because filling it was what made the plan too big
   * to read. Flagged work is the exception, and it is the one thing here that
   * somebody actually decided.
   *
   * What stops the fill undoing a deliberate removal is the record of the
   * removal itself, in the database where both phones can see it. There were
   * two device-local markers here — a day marker for the bulk fill and a
   * per-occurrence one for flagged work — and both are gone: neither could
   * survive the other phone, and together they meant the plan went stale the
   * moment it had run.
   */
  const dismissals = usePlanDismissals(today);

  /*
   * In flight, and failed-today, both as refs.
   *
   * `useAddToPlan` is optimistic: `onMutate` writes the new rows into the plan
   * cache before the request is even sent. `entries` is a dependency of this
   * effect, so the write immediately re-runs it, `due` comes out empty — every
   * key is now "planned" — while the request is still open. Without the guard
   * the effect would re-enter and write the same rows again.
   *
   * `failedFor` exists because the obvious guard loops: on failure the cache
   * rolls back, `due` refills, and the effect resubmits forever.
   */
  /**
   * Whoever opens the app first fills *both* plans.
   *
   * Jake: *"I thought I asked to make it so that if either person opens the
   * app it goes ahead and auto populates both people's daily plan? Seems like
   * that still doesn't happen, if Emily hasn't opened the app today hers is
   * just empty."*
   *
   * He had asked, and docs/DECISIONS.md recorded it as raised and undecided:
   * the fill ran on *your* device for *your* day, so a housemate who had not
   * opened Chorus had no plan at all — which is not a decision they made. It
   * is the same complaint that produced the housemate section in the first
   * place: *"Did you push it? I don't see Emily's plan."*
   *
   * Done from the client rather than server-side, which is the other half of
   * that open question. A scheduled job would be the better answer and needs
   * infrastructure this project does not have; this needs one more mutation
   * and is correct whenever either phone is opened, which in a two-person
   * house is every day.
   *
   * Idempotent by construction: it plans only what is outstanding and not
   * already on their day, so the second person's own run finds the work there
   * and adds nothing.
   *
   * ── The limit worth knowing ───────────────────────────────────────────
   *
   * With more than two people this fills only the earliest-joined other
   * member. The app is two-person by design; a third would need a loop.
   *
   * The other limit is gone: this used to run once per device per day, so a
   * flag raised afterwards did not reach their plan until they opened the app
   * themselves. It is now idempotent against `plan_dismissals` like your own
   * fill, so it can run whenever and a flag lands as soon as either phone
   * notices it.
   */
  const theirInFlight = useRef(false);
  const theirFailedFor = useRef<CivilDate | null>(null);

  useEffect(() => {
    if (household.data == null || housemateId === undefined) return;
    if (isLoading || entriesLoading) return;
    if (theirInFlight.current || theirFailedFor.current === today) return;

    const theirPlanned = new Set(
      allEntries
        .filter((e) => e.userId === housemateId && e.plannedFor === today)
        .map((e) => e.occurrenceKey),
    );

    /*
     * What she took off her own plan, which is the thing a device-local marker
     * could never see.
     *
     * This branch used to refuse to touch a non-empty day at all, as a proxy
     * for "she has already curated this" — necessary while the only record of
     * her removals lived on her phone. With the record in the database the
     * proxy can go, so her day now fills as work becomes due through the day
     * rather than only when it happens to be empty.
     */
    const theirDismissed = new Set(
      dismissals
        .filter((d) => d.userId === housemateId && d.dismissedOn === today)
        .map((d) => d.occurrenceKey),
    );

    /*
     * Both sides of the split, filtered by `belongsTo` against *their* id.
     *
     * Not `view.theirs`, which is the obvious choice and the wrong one:
     * `isMine` in `buildTodayView` counts `kind: 'anyone'` as *yours*, so
     * shared work is always in `view.mine` and can never appear in
     * `view.theirs` on either phone. Sourcing from `theirs` alone meant the
     * housemate's auto-filled day got their own assigned chores and none of
     * the shared ones — exactly the category Jake named when he asked for this
     * behaviour: *"any chore assigned to 'Anyone' or 'Everyone does' to appear
     * automatically in the daily plan."*
     *
     * `belongsTo` is then what decides, and it is true for `anyone` and for
     * their own member turns, false for yours. That is the same rule your own
     * fill uses, asked about a different person.
     */
    const theirDue = autoPlannable([...view.mine, ...view.theirs], {
      userId: housemateId,
      on: today,
      planned: theirPlanned,
    });

    // The same rule their own device would apply, or the two would disagree
    // about what their morning looks like depending on who opened first.
    const theirBaseline = household.data.autoPlan
      ? theirDue
      : theirDue.filter((i) => i.dueOn === today);
    const theirFlagged = theirDue.filter((item) => householdFlags.has(item.choreId));

    const wanted = new Map<string, (typeof theirDue)[number]>();
    for (const item of [...theirBaseline, ...theirFlagged]) wanted.set(item.occurrenceKey, item);

    const due = [...wanted.values()].filter((item) => !theirDismissed.has(item.occurrenceKey));

    if (due.length === 0) return;

    theirInFlight.current = true;
    addForThem.mutate(
      due.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })),
      {
        onError: () => {
          theirFailedFor.current = today;
        },
        onSettled: () => {
          theirInFlight.current = false;
        },
      },
    );
  }, [
    household.data,
    housemateId,
    isLoading,
    entriesLoading,
    dismissals,
    today,
    allEntries,
    view.mine,
    view.theirs,
    householdFlags,
    addForThem,
  ]);

  const inFlight = useRef(false);
  const failedFor = useRef<CivilDate | null>(null);

  useEffect(() => {
    // Waits for the *plan* too, not only the chores. They are separate queries
    // with no ordering between them, and acting while `entries` is still empty
    // means every already-planned chore looks unplanned and gets re-added.
    /*
     * Waits for the household, because what gets added depends on its setting.
     *
     * `== null` covers both "still loading" and "no household row". Optional
     * chaining would collapse those into `false` and happen to be right, since
     * the default is off — but only by luck. Waiting costs one render and means
     * the branch is never taken on data nobody has read yet.
     */
    if (household.data == null) return;
    if (isLoading || entriesLoading) return;
    if (inFlight.current || failedFor.current === today) return;

    /*
     * Your plan only, so shared work lands on both days.
     *
     * This briefly claimed `anyone` work for whichever phone opened the app
     * first, to stop the same chore appearing in both sections of the plan
     * screen. Jake, seeing the result: *"The daily plan seems to be randomly
     * distributing the 'Anyone can do' tasks between us? They should all go to
     * both of us, and if somebody's not going to do them they can remove them
     * from their plan."*
     *
     * He is right, and "randomly" is exactly what it was — the assignment
     * depended on who happened to open Chorus first that morning, which is not
     * a decision either of you made. A shared chore on both days is not a
     * duplicate: each row is one person's intention, and taking it off your own
     * day is how you say it is not yours today.
     */
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
     * The rule itself lives in `core/plan/autoplan`, and is now shared with the
     * "Add everything due or late" button below — the two must agree about what
     * counts as due, or the button would offer a different day from the one the
     * setting fills.
     *
     * An earlier version of this comment said the screen also previewed a
     * housemate's day with it. Nothing does; `autoPlannable` has exactly one
     * other caller and it is in this file.
     */
    const dueToday = autoPlannable(view.mine, {
      userId: userId ?? '',
      on: today,
      planned,
    });

    /*
     * One fill, and it can run as often as it likes.
     *
     * This used to be two mechanisms with two clocks: a device-local day
     * marker so the whole-day fill ran once, and a per-occurrence device
     * record so flagged work could still land in the afternoon. Both existed
     * for the same reason — the fill and "Take off today" pull in opposite
     * directions, and something had to stop the second run handing back what
     * you removed.
     *
     * Recording the *removals* instead makes the whole question go away. Jake:
     *
     *   *"maybe my plan just recalculates every time you open it (leaving off
     *   things you specifically took off the plan manually). That way if you
     *   mess with something midday you're not confused why it's not there."*
     *
     * So: no markers. Create a chore at two in the afternoon and it appears;
     * reassign one and it moves; flag one and it lands. Take one off and it
     * stays off, because the dismissal is a row in the database that both
     * phones can see — which the device-local markers could not manage, and
     * is why Emily removing something on her phone used to survive only until
     * Jake opened his.
     */
    const dismissed = new Set(
      dismissals
        .filter((d) => d.userId === userId && d.dismissedOn === today)
        .map((d) => d.occurrenceKey),
    );

    /*
     * Today's work, not the backlog — which is the distinction Emily drew.
     *
     * *"have the my day autopopulate the flagged ones or the ones that are due
     * that day specifically like it's time to do dishes or this event is
     * happening this day."*
     *
     * Her "specifically" is the whole of it. What made the plan unreadable was
     * never the dishes being due; it was the pile of things that had been late
     * for weeks arriving alongside them. The household setting widens this to
     * the backlog as well.
     */
    const baseline = household.data.autoPlan ? dueToday : dueToday.filter((i) => i.dueOn === today);

    /*
     * Flagged work lands whatever the setting says, and is not an exception to
     * "if I added it to the plan I'm doing it" — it is the clearest case of it.
     * Every other row here came from a schedule nobody looked at this morning;
     * a flag is a person deciding by hand, and flags are shared, so it is also
     * how Emily tells Jake something needs doing without a conversation.
     *
     * Narrowed by the same due-or-late rule rather than taking every flagged
     * chore: a flag lasts until the work is done, so one raised now on
     * something due in three weeks would otherwise sit on every day between.
     */
    const flagged = dueToday.filter((item) => householdFlags.has(item.choreId));

    const wanted = new Map<string, (typeof dueToday)[number]>();
    for (const item of [...baseline, ...flagged]) wanted.set(item.occurrenceKey, item);

    const due = [...wanted.values()].filter((item) => !dismissed.has(item.occurrenceKey));

    if (due.length === 0) return;

    /*
     * `inFlight` is the only thing between a constantly re-evaluating effect
     * and a second identical write: `add` is optimistic, so its `onMutate`
     * lands in the cache this effect reads, but the request is still open and
     * `entries` has not yet been refetched.
     */
    inFlight.current = true;
    add.mutate(
      due.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })),
      {
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
    dismissals,
    today,
    entries,
    view.mine,
    chores,
    add,
    userId,
    household.data,
    householdFlags,
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

    /*
     * One row per chore, and this is where "added three times" came from.
     *
     * Matching on `choreId` alone matches *every* occurrence of that chore:
     * `view.upcoming` holds each future one inside the horizon, so creating a
     * recurring chore with "put it on today" ticked queued today's occurrence
     * and next week's and the one after — three rows, each with a different
     * occurrence key, so the table's `unique (user_id, occurrence_key,
     * planned_for)` could not collapse them and neither could the upsert.
     *
     * Jake, on the phone: *"I created a new chore called vacuum downstairs and
     * checked the Add to today's plan box, and it got added to my plan 3 times."*
     *
     * The soonest occurrence is the one meant: "put it on today" is about today,
     * and `view.mine` is dated on or before today while `view.upcoming` is
     * after, so the earliest `dueOn` is today's whenever today's exists.
     */
    const candidates = [...view.mine, ...view.upcoming].filter(
      (item) => live.includes(item.choreId) && !planned.has(item.occurrenceKey),
    );

    const soonestPerChore = new Map<string, (typeof candidates)[number]>();
    for (const item of candidates) {
      const held = soonestPerChore.get(item.choreId);
      if (held === undefined || item.dueOn < held.dueOn) soonestPerChore.set(item.choreId, item);
    }
    const wanted = [...soonestPerChore.values()];

    /*
     * Onto the plan of whoever the chore is actually for.
     *
     * `view.upcoming` is deliberately unfiltered by ownership — the picker
     * offers everything — so a chore created with "add to today's plan" ticked
     * and assigned to your housemate landed on *your* day. Jake: *"it
     * shouldn't autopopulate in your plan at all if it's assigned specifically
     * to someone else. And then you can just see it on their plan if you
     * need."*
     *
     * Routed rather than dropped: the tick is an explicit "this is for today",
     * and the honest reading of "for today, and it's Emily's" is that it goes
     * on Emily's today. Silently doing nothing would be the dead-button shape
     * this screen keeps producing.
     *
     * Shared work still lands on yours, because it is yours as much as theirs
     * and you are the one who asked for it.
     */
    const mine = wanted.filter((i) => belongsTo(i, userId ?? ''));
    const forThem =
      housemateId === undefined
        ? []
        : wanted.filter((i) => i.assignee.kind === 'member' && i.assignee.memberId === housemateId);

    const settled = [...stale, ...[...mine, ...forThem].map((i) => i.choreId)];
    if (settled.length > 0) clearPlanOnCreate(settled);
    if (mine.length > 0) {
      add.mutate(mine.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })));
    }
    if (forThem.length > 0) {
      addForThem.mutate(
        forThem.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })),
      );
    }
  }, [
    isLoading,
    planOnCreate,
    entries,
    today,
    view.mine,
    view.upcoming,
    add,
    addForThem,
    housemateId,
    userId,
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
         * Which chores recur, decided here because this layer has their
         * schedules — the screen's `chores` prop is a lighter shape. The plan
         * splits its rows on it: recurring housework and one-off tasks are
         * different kinds of work and reading them as one list is what made a
         * fifty-row day overwhelming.
         */
        recurringChoreIds={recurringChoreIds}
        today={today}
        refetch={refetch}
        onAdd={() => {
          setPickingFor(null);
          setPicking(true);
        }}
        onAddFor={(ownerId) => {
          setPickingFor(ownerId);
          setPicking(true);
        }}
        proposal={proposal}
        // The column's default, so the housemate's empty-day sentence does not
        // say the wrong thing for the frame before the query lands.
        autoPlan={household.data?.autoPlan ?? true}
        dueOrLateCount={dueOrLate.length}
        onAddAllDue={() =>
          add.mutate(dueOrLate.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })))
        }
        onAcceptProposal={(items) =>
          add.mutate(items.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })))
        }
      />
      <PlanPicker
        open={picking}
        /*
         * Undated work is not offered when filling somebody else's day.
         *
         * Choosing it dates the chore and then claims it through the
         * plan-on-create queue, which always means *your* day — so it was
         * offered, selectable, counted by the button, and then did nothing at
         * all. That is the dead-button shape this area keeps producing; not
         * offering it is honest, and dating a chore on their behalf is a
         * different feature.
         */
        groups={pickingFor === null ? groups : groups.filter((g) => g.key !== 'someday')}
        categoryFor={(choreId) => {
          const category = categoryById.get(choreCategory.get(choreId) ?? '');
          return category === undefined ? null : { name: category.name, ink: category.ink };
        }}
        onClose={() => {
          setPicking(false);
          setPickingFor(null);
        }}
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
            addForPicked.mutate(
              real.map((i) => ({ occurrenceKey: i.occurrenceKey, choreId: i.choreId })),
            );
          }
          /*
           * An undated chore is dated and then claimed through the queue, which
           * is always *your* day — so it is offered only when filling your own.
           * Dating a chore on your housemate's behalf and having it land on
           * yours is the dead-button shape this whole change is about.
           */
          // Not reachable while filling their day — the group is not offered —
          // but the guard stays, because "offered" and "handled" drifting apart
          // is exactly how this became a silent no-op.
          for (const item of someday) {
            if (pickingFor !== null) continue;
            queuePlanOnCreate(item.choreId, today);
            scheduleToday.mutate(item.choreId);
          }
        }}
      />
    </>
  );
}
