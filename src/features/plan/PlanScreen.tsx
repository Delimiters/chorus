/**
 * The day you have committed to.
 *
 * This screen exists because the other one answers the wrong question. Today
 * lists what is due — fifty true statements — and Emily's response to fifty
 * true statements was to close the app and write ten lines in Notes instead.
 * The ten lines were a decision. This is where the decision lives.
 *
 * Three states, and the third is the point:
 *
 *   **Empty** — nothing chosen yet, so the screen asks rather than lists.
 *   **In progress** — a short ordered list, with what is done still in place.
 *   **Finished** — "That's today." A backlog can never say that, because there
 *   is always more of it; a plan can, and being able to finish is most of why
 *   this is worth building.
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { planFor, progressOf } from '@/core/plan/plan';
import { partitionSettled } from '@/core/plan/settle';
import { celebrationFor } from '@/core/plan/celebrate';
import { Confetti } from '@/design/Confetti';
import { celebrated, finished as finishedHaptic, tapped } from '@/design/haptics';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ChoreRow, SectionHeader } from '@/design/ChoreRow';
import { DragList } from '@/design/DragList';
import { positionBetween } from '@/core/plan/reorder';
import { Sheet, SheetAction } from '@/design/Sheet';
import { Button, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { toIconName } from '@/design/icons';
import { useCategoryList } from '@/data/hooks/useCategories';
import { useMembers } from '@/data/hooks/useHousehold';
import { useToggleCompletion } from '@/data/hooks/useOccurrences';
import {
  useMyPlanEntries,
  useRemoveFromPlan,
  useTheirPlanCount,
  useReorderPlan,
  useTheirPlanEntries,
  useTheirPlanTotal,
} from '@/data/hooks/usePlan';
import { toPriority } from '@/core/chore/priority';
import { useUserId } from '@/stores/sessionStore';
import { formatDayLong } from '@/features/common/format';
import { ModeSwitch } from '@/features/common/ModeSwitch';
import { useRoutineStore } from '@/stores/routineStore';

/**
 * How long a just-finished row stays where it is before sinking.
 *
 * Long enough to watch the tick land and to think better of it, short enough
 * that the list is tidy again by the time you look back up. Three seconds is a
 * guess made on the sofa rather than a measurement; it is one number to change.
 */
const SETTLE_MS = 3000;

interface PlanScreenProps {
  /** Everything outstanding or done today, from Today's own query. */
  readonly available: readonly AgendaItem[];
  readonly chores: readonly {
    id: string;
    title: string;
    categoryId: string | null;
    priority: string;
    notes: string | null;
    icon: string | null;
  }[];
  readonly today: string;
  readonly refetch: () => Promise<unknown>;
  /**
   * The day the app would propose, and how to accept it.
   *
   * Null when there is nothing to offer. Handed in rather than computed here
   * so the screen stays testable without a `QueryClient`, and so the ranking —
   * the riskiest part of this whole redesign — lives somewhere it can be
   * argued with on its own.
   */
  readonly proposal?: { items: readonly AgendaItem[]; reason: string } | null;
  readonly onAcceptProposal?: (items: readonly AgendaItem[]) => void;
  readonly onAdd: () => void;
}

export function PlanScreen({
  available,
  chores,
  today,
  refetch,
  onAdd,
  proposal = null,
  onAcceptProposal,
}: PlanScreenProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const userId = useUserId();
  const members = useMembers();
  const categories = useCategoryList();
  const setTodayMode = useRoutineStore((s) => s.setTodayMode);
  const remove = useRemoveFromPlan(today as never);
  const reorderPlan = useReorderPlan(today as never);

  const entries = useMyPlanEntries(today as never);
  const theirCount = useTheirPlanCount(today as never, available);
  const theirTotal = useTheirPlanTotal(today as never, available);
  const theirEntries = useTheirPlanEntries(today as never, available);
  const [showingTheirs, setShowingTheirs] = useState(false);

  /**
   * Their day, in their order, with what each row has become.
   *
   * Read-only, and the database is what makes it so — every write policy on
   * `plan_entries` requires the row to be yours. This is the *seeing* half,
   * which is the half that was missing: the screen could say "Emily has 3
   * planned" and offer no way to find out what they were.
   */
  /*
   * Skipped counts as finished, matching every other tally on this screen.
   *
   * `useTheirPlanCount` treats a skip as not-outstanding and `progressOf`
   * counts it as done for your own day, but the sheet tested `completed` alone
   * — so a housemate who skipped both their chores got "Sam has finished today"
   * in the header and "0 of 2 done" in the sheet it opens. A skip is a
   * decision, not a failure, and it closes the row either way.
   */
  const isSettled = (item: { status: string }) =>
    item.status === 'completed' || item.status === 'skipped';

  /** Capped against the screen, like the picker's list. */
  const { height: screenHeight } = useWindowDimensions();
  const theirSheetMaxHeight = Math.max(180, Math.min(420, screenHeight - 260));

  const theirPlan = useMemo(() => {
    const byKey = new Map(available.map((item) => [item.occurrenceKey, item]));
    return theirEntries
      .map((entry) => byKey.get(entry.occurrenceKey))
      .filter((item): item is AgendaItem => item !== undefined);
  }, [theirEntries, available]);
  const toggle = useToggleCompletion();

  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<AgendaItem | null>(null);
  // The list and the page cannot both own the finger: a drag inside a
  // ScrollView scrolls the page unless the page is frozen for its duration.
  const [dragging, setDragging] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const inPlanOrder = useMemo(
    () => planFor(entries, today as never, available),
    [entries, today, available],
  );

  /*
   * Rows just ticked, held in place before they sink.
   *
   * A row that leaves the instant you touch it takes its own feedback with it:
   * you never see the tick land, and if it was the wrong row, undoing means
   * hunting for it somewhere else. So completion and movement are two beats,
   * a few seconds apart.
   *
   * Held keys live in state because the order depends on them, and the timers
   * in a ref because they must survive re-renders — this screen re-renders on
   * every query that feeds it.
   */
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const holdTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /*
   * What each row looked like last time, so a *transition* can be recognised.
   *
   * The first attempt used a "have I looked once" flag, and a review showed it
   * cannot survive the load race: the plan and the agenda are separate queries
   * with no ordering between them, so the first run routinely sees an empty
   * plan, burns the flag, and then treats every row that arrives already
   * finished as freshly ticked — held mid-list for three seconds and jumping.
   * The same held for midnight rolling the date over and for switching
   * household, neither of which a one-shot flag re-arms.
   *
   * A key absent last time has just arrived and is not a tick, whatever its
   * status. Only false → true is.
   */
  const wasDone = useRef<ReadonlyMap<string, boolean>>(new Map());

  useEffect(() => {
    const now = new Map(inPlanOrder.map((p) => [p.item.occurrenceKey, isSettled(p.item)] as const));

    for (const [key, done] of now) {
      const before = wasDone.current.get(key);
      // Newly finished: present before, not done then, done now.
      if (!done || before !== false || holdTimers.current.has(key)) continue;
      setHeld((current) => new Set(current).add(key));
      holdTimers.current.set(
        key,
        setTimeout(() => {
          holdTimers.current.delete(key);
          setHeld((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }, SETTLE_MS),
      );
    }

    /*
     * Unticked while still held, or gone from the day: release it. It is not
     * finished any more, so it stays put on its own, and a stale timer would
     * sink it seconds later for no reason anyone could see.
     */
    for (const [key, timer] of holdTimers.current) {
      if (now.get(key) === true) continue;
      clearTimeout(timer);
      holdTimers.current.delete(key);
      setHeld((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }

    wasDone.current = now;
  }, [inPlanOrder]);

  useEffect(
    () => () => {
      for (const timer of holdTimers.current.values()) clearTimeout(timer);
      holdTimers.current.clear();
    },
    [],
  );

  /*
   * Finished work leaves the draggable list rather than moving within it.
   *
   * The first version handed `DragList` a *display* order while positions came
   * from the *stored* order, and once anything had sunk the two disagreed: a
   * review found that picking any row up made every sunk row rise back into the
   * middle of the list before the finger had moved, and that a VoiceOver "move
   * down" on a settled list computed its new position from non-monotonic
   * neighbours and sent the row to the *top* of the day — written to the
   * database, not merely drawn wrong.
   *
   * Splitting them removes the disagreement instead of papering over it. What
   * is draggable is always in stored order, so positions stay monotonic; what
   * is finished is drawn below it and is not draggable, which is also the
   * honest affordance — there is no order left to choose for work that is done.
   */
  const planned = inPlanOrder;

  const { active, sunk } = useMemo(
    () => partitionSettled(inPlanOrder, held, (p) => p.item),
    [inPlanOrder, held],
  );
  const progress = useMemo(() => progressOf(planned), [planned]);

  /** What the day was, for the copy and the tier. */
  const day = useMemo(() => {
    /*
     * Completions only, for what the celebration *says*.
     *
     * A skip still closes the day — it is a decision, not a failure, and it
     * should not hold the plan open. But it is not an achievement, and the
     * loud tier read from `done` including skips: skipping a chore twenty days
     * overdue produced confetti and "Including Get car inspected — 20 days
     * late", which is being congratulated for the thing you just avoided.
     */
    const finishedItems = planned.map((p) => p.item).filter((i) => i.status === 'completed');
    const worst = finishedItems.reduce(
      (worstSoFar, item) => (item.daysOverdue > worstSoFar.daysOverdue ? item : worstSoFar),
      { daysOverdue: 0, choreTitle: null as string | null },
    );
    return {
      planned: finishedItems.length,
      worstLateness: worst.daysOverdue,
      latestTitle: worst.daysOverdue > 0 ? worst.choreTitle : null,
      bothFinished: theirTotal > 0 && theirCount === 0,
      theirCount: theirTotal,
    };
  }, [planned, theirTotal, theirCount]);

  /**
   * The celebration, and firing it exactly once.
   *
   * Keyed on the transition into `finished` rather than on the boolean itself:
   * a re-render while the day is already done must not buzz the phone again,
   * and coming back to a finished day later should be quiet — you already had
   * the moment.
   */
  const celebration = useMemo(
    () => (progress.finished ? celebrationFor(day) : null),
    [progress.finished, day],
  );
  /*
   * The marker outlives the screen.
   *
   * It was component state, and switching to Chores mode and back *unmounts*
   * this screen — so a finished day buzzed and threw confetti again on every
   * return, which is precisely the "coming back should be quiet, you already
   * had the moment" the comment above promises. Keyed by date so tomorrow gets
   * its own moment.
   */
  const celebratedOn = useRoutineStore((s) => s.celebratedOn);
  const markCelebrated = useRoutineStore((s) => s.markCelebrated);
  const alreadyMarked = celebratedOn === today;

  useEffect(() => {
    if (celebration === null || alreadyMarked) return;
    markCelebrated(today as never);
    if (celebration.tone === 'loud') celebrated();
    else finishedHaptic();
  }, [celebration, alreadyMarked, markCelebrated, today]);

  const choreMeta = useMemo(() => new Map(chores.map((c) => [c.id, c])), [chores]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const nameById = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.userId, m.displayName])),
    [members.data],
  );
  const theirName = useMemo(
    () => (members.data ?? []).find((m) => m.userId !== userId)?.displayName ?? 'They',
    [members.data, userId],
  );

  const renderRow = ({ item }: { item: AgendaItem }) => {
    const meta = choreMeta.get(item.choreId);
    const category = categoryById.get(meta?.categoryId ?? '') ?? null;
    return (
      <ChoreRow
        key={item.occurrenceKey}
        item={item}
        ink={null}
        turnLabel={null}
        scheduleLabel=""
        notes={meta?.notes ?? null}
        category={category === null ? null : { name: category.name, ink: category.ink }}
        priority={toPriority(meta?.priority)}
        icon={toIconName(meta?.icon ?? null)}
        compact
        completedByLabel={
          item.completedBy === null || item.completedBy === userId
            ? null
            : (nameById.get(item.completedBy) ?? null)
        }
        onToggle={() => {
          tapped();
          toggle.mutate({ item, complete: item.status !== 'completed' });
        }}
        onOpen={() => setRemoving(item)}
      />
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xxxl,
          gap: 2,
        }}
        scrollEnabled={!dragging}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textFaint}
          />
        }
      >
        <ModeSwitch mode="plan" onChange={setTodayMode} />

        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
          <Txt variant="display" accessibilityRole="header">
            Today
          </Txt>
          <Txt variant="mono" tone="faint">
            {formatDayLong(today as never).toUpperCase()}
            {progress.total > 0 ? ` · ${progress.done} OF ${progress.total}` : ''}
          </Txt>
          {/*
            Tappable, and shown whenever they have a day at all rather than only
            when something is left on it. "Emily has 3 planned" with no way to
            see what they were is a fact you can do nothing with — and once they
            finish, the line used to vanish entirely, which reads as them not
            having planned anything rather than as them being done.
          */}
          {theirTotal > 0 ? (
            <Pressable
              onPress={() => {
                tapped();
                setShowingTheirs(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`See ${theirName}'s day`}
              hitSlop={8}
            >
              <Txt variant="small" tone="muted">
                {theirCount === 0
                  ? `${theirName} has finished today ›`
                  : `${theirName} has ${theirCount} of ${theirTotal} left ›`}
              </Txt>
            </Pressable>
          ) : null}
        </Stack>

        {/*
          A bar, not a spinner. It fills left to right as the day goes, which is
          the one piece of feedback a backlog structurally cannot give: there is
          no denominator when the list never ends.
        */}
        {progress.total > 0 ? (
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
            style={{
              height: 4,
              borderRadius: 3,
              backgroundColor: colors.sunken,
              marginHorizontal: space.sm,
              marginBottom: space.md,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${(progress.done / progress.total) * 100}%`,
                height: '100%',
                backgroundColor: colors.overprint,
              }}
            />
          </View>
        ) : null}

        {progress.finished ? (
          <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
            <Txt variant="display" style={{ color: colors.overprint }}>
              ✓
            </Txt>
            <Txt variant="bodyStrong" accessibilityRole="header">
              {celebration?.headline ?? "That's today."}
            </Txt>
            {celebration?.detail === null || celebration === null ? null : (
              <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>
                {celebration.detail}
              </Txt>
            )}
            <View style={{ paddingTop: space.md }}>
              <Button label="Add something anyway" variant="ghost" onPress={onAdd} />
            </View>
          </View>
        ) : null}

        {/*
          The rows stay, finished or not.
          
          The celebration used to replace them, so a mis-tap on the last item
          left no way to un-tick it — the checkbox, the row and its sheet all
          vanished together, and the only way back was switching modes. That is
          the disappearing-row complaint again, at the exact moment the screen
          is congratulating you.
        */}
        {planned.length === 0 && !progress.finished ? (
          /*
           * Asks rather than lists.
           *
           * An empty plan is the normal state every morning, not an error — so
           * this is an invitation, and deliberately not a wall of suggestions.
           * The proposal that fills it is a separate piece of work.
           */
          <View style={{ paddingVertical: space.lg, gap: space.sm }}>
            {proposal === null || proposal.items.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: space.xl, gap: space.sm }}>
                <Txt variant="bodyStrong" accessibilityRole="header">
                  Nothing planned yet.
                </Txt>
                <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>
                  Pick a few things you actually mean to do today.
                </Txt>
                <View style={{ paddingTop: space.md }}>
                  <Button label="Choose what to do today" onPress={onAdd} />
                </View>
              </View>
            ) : (
              /*
               * Proposed, not pre-filled.
               *
               * Empty asks her to do the work; pre-filled recreates the wall of
               * twenty with extra steps. This is the third option — a day she
               * accepts in one tap, or edits, or throws away — and it is the
               * only shape that answers both "tell me what to do" and "let me
               * pick" at once.
               */
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.overprintSoft,
                  backgroundColor: colors.overprintSoft,
                  borderRadius: radius.md,
                  padding: space.md,
                  gap: space.xs,
                }}
              >
                <Txt variant="bodyStrong" accessibilityRole="header">
                  Here&apos;s a day.
                </Txt>
                <Txt variant="small" tone="muted">
                  {proposal.reason}
                </Txt>

                <View style={{ gap: 2, paddingVertical: space.sm }}>
                  {proposal.items.map((item) => (
                    <Txt key={item.occurrenceKey} variant="body" numberOfLines={1}>
                      {item.choreTitle}
                    </Txt>
                  ))}
                </View>

                <Button label="Start the day" onPress={() => onAcceptProposal?.(proposal.items)} />
                <Button label="Pick my own" variant="ghost" onPress={onAdd} />
              </View>
            )}
          </View>
        ) : (
          <>
            {/* Outstanding, not planned: a heading reading "Doing today · 5"
                over five struck-through rows counts the wrong thing. */}
            <SectionHeader
              title={progress.finished ? 'Done today' : 'Doing today'}
              count={progress.finished ? progress.done : progress.total - progress.done}
            />
            <DragList
              items={active}
              keyOf={(p) => p.item.occurrenceKey}
              labelOf={(p) => p.item.choreTitle}
              renderItem={(p) => renderRow(p)}
              onDragStateChange={setDragging}
              onReorder={(orderedKeys, movedKey) => {
                /*
                 * One row moves, so one row is written: the moved row takes the
                 * average of its new neighbours' positions. Renumbering the day
                 * would be N writes and would turn two people reordering at once
                 * into a conflict.
                 */
                const byKey = new Map(active.map((p) => [p.item.occurrenceKey, p]));
                const positions = orderedKeys.map((k) => byKey.get(k)?.position ?? 0);
                const movedAt = orderedKeys.indexOf(movedKey);
                if (movedAt === -1) return;

                const before = positions[movedAt - 1] ?? null;
                const after = positions[movedAt + 1] ?? null;
                let next = positionBetween(before, after);

                /*
                 * At either end, clear the *whole* day rather than the
                 * draggable part of it.
                 *
                 * Finished rows keep their stored positions while sitting below
                 * the list, so moving something to the top of what is left
                 * would otherwise land on the same number as something already
                 * done — a tie that is invisible until that row is unticked and
                 * the two swap for reasons nobody can see.
                 */
                const stored = planned.map((p) => p.position);
                if (before === null && stored.length > 0) {
                  next = Math.min(next, Math.min(...stored) - 1);
                }
                if (after === null && stored.length > 0) {
                  next = Math.max(next, Math.max(...stored) + 1);
                }

                reorderPlan.mutate(movedKey, next);
              }}
            />

            {/*
              Finished work, below the line and not draggable.
            
              There is no order left to choose for something that is done, and
              offering to reorder it is what let the display order and the
              stored order drift apart in the first place.
            */}
            {sunk.map((entry) => (
              <View key={entry.item.occurrenceKey} testID={`done-row:${entry.item.occurrenceKey}`}>
                {renderRow(entry)}
              </View>
            ))}

            <View
              style={{
                marginTop: space.md,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.rule,
                borderRadius: radius.md,
              }}
            >
              <Button label="Add something" variant="ghost" onPress={onAdd} />
            </View>
          </>
        )}
      </ScrollView>

      <Confetti running={celebration?.tone === 'loud' && !alreadyMarked} />

      {/*
        Taking something off the day.
        
        Deliberately its own sheet rather than the full occurrence sheet: on the
        plan, the question is almost always "not today" rather than "skip it" or
        "reschedule it", and offering six options for a one-word decision is how
        a plan starts feeling like admin. Editing the chore is still one tap
        further in.
      */}
      {/*
        No floating + here, and that is the point.

        It is the *create a new chore* button, but on this screen it sits
        directly beside "Add something", which picks from chores you already
        have — so the most prominent control on the plan looked like the common
        action and did the rare one. Jake read it exactly that way.

        Creating still happens from the plan, without a second step: the picker
        opens with "Create a new chore" as its first row. The button stays on
        the Chores and Routines sub-tabs, where nothing else competes with it.
      */}

      {/*
        Their day, to look at.

        A sheet rather than a section on this screen, because the plan's job is
        to be *your* day and to be finishable — "That's today" stops being true
        the moment somebody else's outstanding work is listed under it. This is
        a glance, and glances belong in something you dismiss.
      */}
      <Sheet
        visible={showingTheirs}
        onClose={() => setShowingTheirs(false)}
        title={`${theirName}'s day`}
        subtitle={
          theirPlan.length === 0
            ? undefined
            : `${theirPlan.filter(isSettled).length} of ${theirPlan.length} done · only ${theirName} can change this`
        }
      >
        {/*
          Scrolls, and is capped against the screen.
        
          `Sheet` says in its own header that it assumes short, static lists of
          actions — and this list is neither. The plan auto-adds every recurring
          chore due or late, so an uncurated day is the whole due list. Because
          the sheet grows upward from the bottom, overflow clips the *top* of
          their order: exactly the rows you opened it to see. Same shape as the
          picker next door, for the same reason.
        */}
        <ScrollView
          style={{ maxHeight: theirSheetMaxHeight }}
          contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }}
        >
          {theirPlan.map((item) => {
            const done = isSettled(item);
            return (
              <View
                key={item.occurrenceKey}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                // `accessible` as well as the label: a plain View is not an
                // accessibility element, so the label was ignored and VoiceOver
                // read the bullet as its own item.
                accessible
                accessibilityLabel={`${item.choreTitle}${done ? ', done' : ''}`}
              >
                {/*
                  A mark, not a checkbox. A checkbox you cannot tick is an
                  invitation to try, and the answer would have to be a refusal;
                  the database would refuse it too, which is worse to discover
                  by tapping.
                */}
                {/* `accessible` on the row merges these children into one
                    element, so the bullet is not announced on its own. */}
                <Txt variant="small" tone={done ? 'muted' : 'faint'}>
                  {done ? '✓' : '·'}
                </Txt>
                <Txt
                  variant="body"
                  tone={done ? 'muted' : 'default'}
                  numberOfLines={2}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {item.choreTitle}
                </Txt>
              </View>
            );
          })}
        </ScrollView>
      </Sheet>

      <Sheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing?.choreTitle ?? ''}
        subtitle="On today's plan"
      >
        <View style={{ gap: 2 }}>
          <SheetAction
            label="Take off today"
            hint="It goes back to the list with its date and lateness unchanged. Nothing is skipped or completed."
            onPress={() => {
              if (removing !== null) remove.mutate(removing.occurrenceKey);
              setRemoving(null);
            }}
          />
          <SheetAction
            label="Edit the chore"
            onPress={() => {
              const choreId = removing?.choreId;
              setRemoving(null);
              if (choreId !== undefined) router.push(`/chore/${choreId}`);
            }}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
