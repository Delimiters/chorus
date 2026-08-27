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
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { planFor, progressOf } from '@/core/plan/plan';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ADD_BUTTON_CLEARANCE } from '@/design/AddButton';
import { ChoreRow, SectionHeader } from '@/design/ChoreRow';
import { Sheet, SheetAction } from '@/design/Sheet';
import { Button, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { toIconName } from '@/design/icons';
import { useCategoryList } from '@/data/hooks/useCategories';
import { useMembers } from '@/data/hooks/useHousehold';
import { useToggleCompletion } from '@/data/hooks/useOccurrences';
import { useMyPlanEntries, useRemoveFromPlan, useTheirPlanCount } from '@/data/hooks/usePlan';
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
  readonly onAdd: () => void;
}

export function PlanScreen({ available, chores, today, refetch, onAdd }: PlanScreenProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const userId = useUserId();
  const members = useMembers();
  const categories = useCategoryList();
  const setTodayMode = useRoutineStore((s) => s.setTodayMode);
  const remove = useRemoveFromPlan(today as never);

  const entries = useMyPlanEntries(today as never);
  const theirCount = useTheirPlanCount(today as never, available);
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
        onToggle={() => toggle.mutate({ item, complete: item.status !== 'completed' })}
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
              That&apos;s today.
            </Txt>
            <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>
              {progress.total === 1
                ? 'One thing, done.'
                : `All ${progress.total}, done. Nothing else is planned.`}
            </Txt>
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
          <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
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

      {/*
        Taking something off the day.
        
        Deliberately its own sheet rather than the full occurrence sheet: on the
        plan, the question is almost always "not today" rather than "skip it" or
        "reschedule it", and offering six options for a one-word decision is how
        a plan starts feeling like admin. Editing the chore is still one tap
        further in.
      */}
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
