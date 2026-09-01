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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { planFor, progressOf } from '@/core/plan/plan';
import { celebrationFor } from '@/core/plan/celebrate';
import { Confetti } from '@/design/Confetti';
import { celebrated, finished as finishedHaptic, tapped } from '@/design/haptics';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ADD_BUTTON_CLEARANCE, AddChoreButton } from '@/design/AddButton';
import { ChoreRow, SectionHeader } from '@/design/ChoreRow';
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
  useTheirPlanTotal,
} from '@/data/hooks/usePlan';
import { toPriority } from '@/core/chore/priority';
import { useUserId } from '@/stores/sessionStore';
import { formatDayLong } from '@/features/common/format';
import { ModeSwitch } from '@/features/common/ModeSwitch';
import { useRoutineStore } from '@/stores/routineStore';

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

  const entries = useMyPlanEntries(today as never);
  const theirCount = useTheirPlanCount(today as never, available);
  const theirTotal = useTheirPlanTotal(today as never, available);
  const toggle = useToggleCompletion();

  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<AgendaItem | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const planned = useMemo(
    () => planFor(entries, today as never, available),
    [entries, today, available],
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
          paddingBottom: space.xxxl + ADD_BUTTON_CLEARANCE,
          gap: 2,
        }}
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
          {theirCount > 0 ? (
            <Txt variant="small" tone="muted">
              {`${theirName} has ${theirCount} planned`}
            </Txt>
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
            <Stack gap={space.xs}>{planned.map(renderRow)}</Stack>

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
        Adding a chore from the plan.
        
        "You should be able to create chores from today screen" — and the plan
        is where you notice something is missing, so making you navigate to the
        library to add it is the same friction the whole redesign is removing.
      */}
      <AddChoreButton onPress={() => router.push('/chore/new')} ink={null} />

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
