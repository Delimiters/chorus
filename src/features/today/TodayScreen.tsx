/**
 * Today.
 *
 * Nine times out of ten this is the only screen either person opens. It answers
 * one question — what needs doing, and is it mine — and gets out of the way.
 *
 * Yours first, then everyone else's, then what is due merely sometime this
 * week, then what has already been done. Dated before floating, because a
 * chore due today is a stronger claim on the next ten minutes than one due by
 * Sunday. Seeing what your housemate did is half the reason to share a list,
 * and it's the thing that stops you having to ask.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ADD_BUTTON_CLEARANCE, AddChoreButton } from '@/design/AddButton';
import { ModeSwitch } from '@/features/common/ModeSwitch';
import { useRoutineStore } from '@/stores/routineStore';
import { useMyRoutineItems } from '@/data/hooks/useRoutines';

import type { AgendaItem, FloatingGroup } from '@/core/occurrence/agenda';
import { describeRule } from '@/core/recurrence/describe';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import {
  useOccurrenceActions,
  useToday_View,
  useToggleCompletion,
} from '@/data/hooks/useOccurrences';
import { ChoreRow, FloatingRow, SectionHeader, SubHeader } from '@/design/ChoreRow';
import { groupItems } from '@/core/occurrence/grouping';
import { useCategoryList } from '@/data/hooks/useCategories';
import { toIconName } from '@/design/icons';
import { useViewPreference, useViewStore } from '@/stores/viewStore';
import { ViewControls } from '@/features/common/ViewControls';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { useUserId } from '@/stores/sessionStore';
import { EmptyToday } from './EmptyToday';
import { OccurrenceSheet } from '@/features/common/OccurrenceSheet';
import { formatDayLong, formatFlexibleWindow } from '@/features/common/format';

export function TodayScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const userId = useUserId();
  const members = useMembers();

  /** Your own accent, so the add button wears your colour rather than a generic one. */
  const myInk = members.data?.find((m) => m.userId === userId)?.accent ?? null;
  const household = useHousehold();
  const { skip, reschedule, clear } = useOccurrenceActions();
  const [open, setOpen] = useState<AgendaItem | null>(null);
  const { view, chores, today, isLoading, error, unreadable, refetch } = useToday_View();
  const categories = useCategoryList();
  const viewPref = useViewPreference();
  const setGroupBy = useViewStore((s) => s.setGroupBy);
  const setSortBy = useViewStore((s) => s.setSortBy);
  const setTodayMode = useRoutineStore((s) => s.setTodayMode);

  /**
   * Which of your routine items already points at a chore.
   *
   * A second link would be refused by the partial unique index, and a rejected
   * insert is a worse answer than taking somebody to the one they already have.
   */
  const myRoutineItems = useMyRoutineItems();
  const linkedRoutineFor = (choreId: string): string | null =>
    myRoutineItems.find((i) => i.linkedChoreId === choreId)?.id ?? null;

  /** The two grouping axes per chore, and the categories by id, for the rows. */
  const choreMeta = useMemo(
    () =>
      new Map(
        chores.map((c) => [
          c.id,
          { categoryId: c.categoryId, priority: c.priority, notes: c.notes },
        ]),
      ),
    [chores],
  );
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const choreIcons = useMemo(
    () => new Map(chores.map((c) => [c.id, toIconName(c.icon)])),
    [chores],
  );
  const toggle = useToggleCompletion();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  /** Who is who, for ink and name lookups. */
  const byMember = useMemo(() => {
    const map = new Map<string, { name: string; ink: string }>();
    for (const member of members.data ?? []) {
      map.set(member.userId, { name: member.displayName, ink: member.accent });
    }
    return map;
  }, [members.data]);

  const scheduleFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const chore of chores) map.set(chore.id, describeRule(chore.schedule.rule));
    return map;
  }, [chores]);

  /**
   * Ink and turn label for a row.
   *
   * The two always travel together: a coloured mark without words would leave
   * anyone with colour vision deficiency guessing. See docs/DESIGN_SYSTEM.md.
   */
  const ownership = (
    assignee: AgendaItem['assignee'],
  ): { ink: string | null; turnLabel: string | null } => {
    if (assignee.kind !== 'member') return { ink: null, turnLabel: null };
    const member = byMember.get(assignee.memberId);
    if (member === undefined) return { ink: null, turnLabel: null };
    return {
      ink: member.ink,
      // "Your turn" for you, first name for everyone else — nobody says
      // "Jake's turn" about themselves.
      turnLabel: assignee.memberId === userId ? 'Your turn' : `${member.name}'s turn`,
    };
  };

  const renderRow = (item: AgendaItem) => {
    const { ink, turnLabel } = ownership(item.assignee);
    const meta = choreMeta.get(item.choreId);
    const category = categoryById.get(meta?.categoryId ?? '') ?? null;
    return (
      <ChoreRow
        key={item.occurrenceKey}
        item={item}
        ink={ink}
        turnLabel={turnLabel}
        scheduleLabel={scheduleFor.get(item.choreId) ?? ''}
        notes={meta?.notes ?? null}
        category={category === null ? null : { name: category.name, ink: category.ink }}
        priority={meta?.priority ?? 'normal'}
        icon={choreIcons.get(item.choreId) ?? null}
        onToggle={() => toggle.mutate({ item, complete: item.status !== 'completed' })}
        onOpen={() => setOpen(item)}
      />
    );
  };

  /**
   * Today's outstanding work, arranged by the chosen axis.
   *
   * An earlier version kept Yours / Everyone else here and refused to group by
   * category, on the grounds that ownership is what a two-person household
   * looks for. That reasoning does not survive contact with the screen: every
   * row already carries a "Your turn" / "Sam's turn" chip, so category headers
   * cost no ownership information at all. And a chip is a weaker signal than a
   * heading when the question is "what kind of thing is left today".
   *
   * So the control means what it says. Group by Category or Priority and the
   * headings change; Group by None falls back to Yours / Everyone else, which
   * is the right shape when there is no other axis to organise by.
   */
  const grouped = (items: readonly AgendaItem[]) =>
    groupItems(items, choreMeta, categories, viewPref);

  const sorted = (items: readonly AgendaItem[]): readonly AgendaItem[] =>
    grouped(items)[0]?.items ?? [];

  /**
   * Mine and theirs together, for the grouped views.
   *
   * Grouping by category and *also* splitting by owner would nest, which is the
   * header explosion this design exists to avoid.
   */
  /**
   * The two ownership groups, each then split by the chosen axis.
   *
   * Nesting, which this design otherwise avoids — but the objection was
   * calibrated to three priorities inside five categories, and ownership is
   * two groups. Two times a handful stays readable, and it keeps "is this
   * mine" as the first question the screen answers while still giving
   * categories real headings rather than a chip.
   */
  const ownershipGroups = useMemo(
    () => [
      { title: 'Yours', items: view.mine },
      { title: 'Everyone else', items: view.theirs },
    ],
    [view.mine, view.theirs],
  );

  /**
   * Whether to fall back to Yours / Everyone else.
   *
   * Grouping by category before any category exists puts every row under a
   * single "Other" heading, which says nothing and is strictly worse than the
   * ownership split it replaced. A household that has not used the feature
   * should not be punished for the default. Caught by a test that expected
   * "Yours" and found "Other".
   */
  const byOwnership =
    viewPref.groupBy === 'none' || (viewPref.groupBy === 'category' && categories.length === 0);

  const renderFloating = (group: FloatingGroup) => {
    const next = group.nextSlot;
    const { ink, turnLabel } = next ? ownership(next.assignee) : { ink: null, turnLabel: null };
    return (
      <FloatingRow
        key={`${group.choreId}:${group.periodKey}:${group.subject ?? '-'}`}
        group={group}
        ink={ink}
        turnLabel={turnLabel}
        windowLabel={formatFlexibleWindow(group.flexibleFrom, group.flexibleUntil, today)}
        onToggle={() => {
          if (next) toggle.mutate({ item: next, complete: true });
        }}
        // A floating group's row acts on its next outstanding slot, so that is
        // the occurrence the sheet is about.
        onOpen={() => setOpen(next ?? group.slots[0] ?? null)}
      />
    );
  };

  if (isLoading) return <LoadingState label="Loading your chores" />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  const nothingToDo = view.outstandingCount === 0;

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
        <ModeSwitch mode="chores" onChange={setTodayMode} />

        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
          <Txt variant="display" accessibilityRole="header">
            Today
          </Txt>
          <Txt variant="mono" tone="faint">
            {formatDayLong(today).toUpperCase()}
            {view.doneCount > 0 ? ` · ${view.doneCount} DONE` : ''}
          </Txt>
        </Stack>

        {unreadable.length > 0 ? (
          <View style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
            <Txt variant="small" tone="danger">
              {unreadable.length} chore{unreadable.length === 1 ? '' : 's'} could not be read and{' '}
              {unreadable.length === 1 ? 'is' : 'are'} hidden.
            </Txt>
          </View>
        ) : null}

        {nothingToDo ? (
          <EmptyToday
            done={view.done}
            byMember={byMember}
            userId={userId}
            hasAnyChores={chores.length > 0}
            onAddChore={() => router.push('/chore/new')}
          />
        ) : null}

        {/* Only when there is something to arrange. Controls above an empty
            screen are furniture. */}
        {nothingToDo ? null : (
          <View style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
            <ViewControls
              groupBy={viewPref.groupBy}
              sortBy={viewPref.sortBy}
              onChangeGroupBy={setGroupBy}
              onChangeSortBy={setSortBy}
            />
          </View>
        )}

        {byOwnership ? (
          <>
            {view.mine.length > 0 ? (
              <>
                <SectionHeader title="Yours" count={view.mine.length} />
                <Stack gap={space.xs}>{sorted(view.mine).map(renderRow)}</Stack>
              </>
            ) : null}

            {view.theirs.length > 0 ? (
              <>
                <SectionHeader title="Everyone else" count={view.theirs.length} />
                <Stack gap={space.xs}>{sorted(view.theirs).map(renderRow)}</Stack>
              </>
            ) : null}
          </>
        ) : (
          <>
            {ownershipGroups.map(({ title, items }) =>
              items.length === 0 ? null : (
                <View key={title}>
                  <SectionHeader title={title} count={items.length} />
                  {grouped(items).map((section) => (
                    <View key={section.key}>
                      <SubHeader
                        title={section.title}
                        ink={section.ink}
                        count={section.items.length}
                      />
                      <Stack gap={space.xs}>{section.items.map(renderRow)}</Stack>
                    </View>
                  ))}
                </View>
              ),
            )}
          </>
        )}

        {/*
          Below the dated sections, not above them.
          
          A floating chore is due *sometime* this week; the things in Yours are
          due today. Leading with the looser commitment pushed the actual
          answer to "what should I do now" below the fold on a phone.
        */}
        {view.floating.length > 0 ? (
          <>
            <SectionHeader title={formatFlexibleWindow.sectionTitle} />
            <Stack gap={space.xs}>{view.floating.map(renderFloating)}</Stack>
          </>
        ) : null}

        {view.done.length > 0 ? (
          <>
            <SectionHeader title="Done" count={view.done.length} />
            <Stack gap={space.xs}>{view.done.map(renderRow)}</Stack>
          </>
        ) : null}

        {/* Skipping is a decision, not a failure — but it is undoable, and undo
            has to be reachable from somewhere. */}
        {view.skipped.length > 0 ? (
          <>
            <SectionHeader title="Skipped" count={view.skipped.length} />
            <Stack gap={space.xs}>{view.skipped.map(renderRow)}</Stack>
          </>
        ) : null}
      </ScrollView>

      <AddChoreButton onPress={() => router.push('/chore/new')} ink={myInk} />

      <OccurrenceSheet
        item={open}
        today={today}
        weekStartsOn={(household.data?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6}
        onClose={() => setOpen(null)}
        onToggleComplete={(item) => toggle.mutate({ item, complete: item.status !== 'completed' })}
        error={
          ((skip.error ?? reschedule.error ?? clear.error ?? toggle.error) as Error | null)
            ?.message ?? null
        }
        onSkip={(item) => skip.mutate(item)}
        onReschedule={(item, movedTo) => reschedule.mutate({ item, movedTo })}
        onClearException={(item) => clear.mutate(item)}
        onEditChore={(choreId) => router.push(`/chore/${choreId}`)}
        onAddToRoutine={(item) => {
          const existing = linkedRoutineFor(item.choreId);
          router.push(
            existing === null
              ? `/routine/new?choreId=${item.choreId}&title=${encodeURIComponent(item.choreTitle)}`
              : `/routine/${existing}`,
          );
        }}
        inRoutine={open !== null && linkedRoutineFor(open.choreId) !== null}
      />
    </SafeAreaView>
  );
}
