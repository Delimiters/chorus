/**
 * Today.
 *
 * Nine times out of ten this is the only screen either person opens. It answers
 * one question — what needs doing — and gets out of the way.
 *
 * Outstanding work first, arranged by priority or by urgency; then what is not
 * yet due, folded away; then what is due merely sometime this week; then what
 * has already been done. Dated before floating, because a chore due today is a
 * stronger claim on the next ten minutes than one due by Sunday.
 *
 * Ownership is no longer the top-level split. "Whose is it" was being answered
 * before "does it matter", which put a crucial chore of hers below every minor
 * one of mine; whose turn it is is on the row instead. Seeing what your
 * housemate did is still half the reason to share a list, so Done stays.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ADD_BUTTON_CLEARANCE, AddChoreButton } from '@/design/AddButton';
import { useSubtaskTicksFor, useSubtasksByChore, useToggleSubtask } from '@/data/hooks/useSubtasks';
import { ModeSwitch } from '@/features/common/ModeSwitch';
import { useRoutineStore } from '@/stores/routineStore';
import { useMyRoutineItems } from '@/data/hooks/useRoutines';

import { splitByUrgency, type AgendaItem, type FloatingGroup } from '@/core/occurrence/agenda';
import { describeRule } from '@/core/recurrence/describe';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import {
  useOccurrenceActions,
  useToday_View,
  useToggleCompletion,
} from '@/data/hooks/useOccurrences';
import { ChoreRow, FloatingRow, SectionHeader } from '@/design/ChoreRow';
import { groupItems } from '@/core/occurrence/grouping';
import { toPriority } from '@/core/chore/priority';
import { useCategoryList } from '@/data/hooks/useCategories';
import { toIconName } from '@/design/icons';
import { useViewPreference, useViewStore } from '@/stores/viewStore';
import { ArrangementControl } from '@/features/common/ArrangementControl';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, space } from '@/design/tokens';
import { useUserId } from '@/stores/sessionStore';
import { EmptyToday } from './EmptyToday';
import { OccurrenceSheet } from '@/features/common/OccurrenceSheet';
import { formatDayLong, formatFlexibleWindow } from '@/features/common/format';

/** Stable identity, so a row without ticks does not re-render needlessly. */
const EMPTY_TICKS: ReadonlySet<string> = new Set();

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
  const setArrangement = useViewStore((s) => s.setArrangement);
  const [comingUpOpen, setComingUpOpen] = useState(false);
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
          // Normalised here, not trusted. An unrecognised value would sort
          // above `crucial` (`indexOf` returns -1) under a section header whose
          // title is `undefined` — a blank heading over the top of the screen.
          { categoryId: c.categoryId, priority: toPriority(c.priority), notes: c.notes },
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

  /*
   * Steps and their ticks for everything on screen.
   *
   * One batched query rather than one per row: the ticks belong to specific
   * occurrences, and Today can hold a couple of dozen.
   */
  const subtasksByChore = useSubtasksByChore();
  const visibleKeys = useMemo(
    () =>
      [...view.mine, ...view.theirs, ...view.done, ...view.skipped]
        .filter((i) => subtasksByChore.has(i.choreId))
        .map((i) => i.occurrenceKey),
    [view.mine, view.theirs, view.done, view.skipped, subtasksByChore],
  );
  const ticksByOccurrence = useSubtaskTicksFor(visibleKeys);
  const toggleSubtask = useToggleSubtask(today);

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
        subtasks={subtasksByChore.get(item.choreId) ?? []}
        tickedSubtasks={ticksByOccurrence.get(item.occurrenceKey) ?? EMPTY_TICKS}
        onToggleSubtask={(subtaskId, ticked) =>
          toggleSubtask.mutate({ subtaskId, ticked, occurrenceKey: item.occurrenceKey })
        }
        category={category === null ? null : { name: category.name, ink: category.ink }}
        priority={meta?.priority ?? 'normal'}
        icon={choreIcons.get(item.choreId) ?? null}
        // A property of this screen rather than of the arrangement: Today is
        // the long list either way, and the rail has to mean the same thing in
        // both modes or it teaches nothing.
        compact
        onToggle={() => toggle.mutate({ item, complete: item.status !== 'completed' })}
        onOpen={() => setOpen(item)}
      />
    );
  };

  /**
   * Today's outstanding work, arranged, with what is not yet due folded away.
   *
   * Two things are happening and they are deliberately separate.
   *
   * **Coming up is always collapsed.** A chore made visible early by `showFrom`
   * is `due`, so it used to render as a peer of work that is genuinely late —
   * and on this household's list thirty-two of about fifty rows were of that
   * kind. The largest block on the screen was the least urgent thing on it.
   * Folding those into one line is what actually shortens the list, so it is a
   * property of the screen rather than of either arrangement.
   *
   * **The arrangement decides the rest.** Priority answers "what matters most",
   * When answers "what is most overdue". They are two cuts of the same
   * remaining work, which is why one control switches between them instead of
   * two controls combining.
   *
   * Category grouping is gone: every row now carries its category as a colour
   * and a name, so a heading said the same thing twice and cost a line.
   */
  const outstanding = useMemo(() => {
    // Sorted *before* splitting, and this line is load-bearing. `view.mine` and
    // `view.theirs` are two lists, so concatenating them leaves ownership as
    // the primary order — which would put a chore of mine one day late above
    // one of Sam's six days late, under a heading that says "Late". Ownership
    // was supposed to stop deciding the order; unsorted concatenation kept it
    // deciding, invisibly, which is worse than the headings it replaced.
    const merged = [...view.mine, ...view.theirs];
    const [all] = groupItems(merged, choreMeta, categories, {
      groupBy: 'none',
      sortBy: 'due',
    });
    return all?.items ?? [];
  }, [view.mine, view.theirs, choreMeta, categories]);
  const urgency = useMemo(() => splitByUrgency(outstanding, today), [outstanding, today]);

  const byPriority = useMemo(() => {
    // `groupItems` is generic over `Groupable`, and an `AgendaItem` is one — so
    // the rows travel through it and come back out unchanged rather than being
    // mapped to keys and rejoined.
    const now = [...urgency.late, ...urgency.dueToday];
    return groupItems(now, choreMeta, categories, {
      groupBy: 'priority',
      sortBy: 'due',
    }).map((section) => ({
      key: section.key,
      title: section.title,
      items: section.items,
    }));
  }, [urgency.late, urgency.dueToday, choreMeta, categories]);

  const sections =
    viewPref.arrangement === 'priority'
      ? byPriority
      : [
          { key: 'late', title: 'Late', items: urgency.late },
          // "Due today" rather than "Today", which is the page's own title —
          // a section heading repeating the screen name reads as a mistake.
          { key: 'today', title: 'Due today', items: urgency.dueToday },
        ];

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

  /*
   * When the only outstanding work is not yet due, the pile *is* the screen.
   *
   * `outstandingCount` counts the coming-up items too, so a household whose
   * dated work is entirely ahead of it is not "nothing to do" — but with every
   * row folded away it rendered as a title, a control that changed nothing in
   * either position, and one collapsed line. Opened by default in that case,
   * and the arrangement control hidden, since there is nothing to arrange.
   */
  const nothingDueNow = sections.every((section) => section.items.length === 0);
  const showComingUp = comingUpOpen || nothingDueNow;

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
        {nothingToDo || nothingDueNow ? null : (
          <View style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
            <ArrangementControl arrangement={viewPref.arrangement} onChange={setArrangement} />
          </View>
        )}

        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <View key={section.key}>
              <SectionHeader title={section.title} count={section.items.length} />
              <Stack gap={space.xs}>{section.items.map(renderRow)}</Stack>
            </View>
          ),
        )}

        {/*
          Not yet due, and folded away.

          These are on the screen at all because `showFrom` brought them
          forward; leaving them expanded is what made the list unreadable. The
          count is on the header, so the size of the pile is visible without
          the pile being.
        */}
        {urgency.comingUp.length > 0 ? (
          <View>
            <Pressable
              onPress={() => setComingUpOpen((open: boolean) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showComingUp }}
              accessibilityLabel={`Coming up, ${urgency.comingUp.length} chore${
                urgency.comingUp.length === 1 ? '' : 's'
              }. ${showComingUp ? 'Hide them' : 'Show them'}.`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: MIN_TARGET }}
            >
              <MaterialCommunityIcons
                name={showComingUp ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.textMuted}
              />
              {/* Muted rather than faint: 11pt faint is 3.75:1, below AA, and
                  this is the only door to the folded rows. */}
              <Txt variant="label" tone="muted">
                {`COMING UP · ${urgency.comingUp.length}`}
              </Txt>
            </Pressable>

            {showComingUp ? <Stack gap={space.xs}>{urgency.comingUp.map(renderRow)}</Stack> : null}
          </View>
        ) : null}

        {/*
          Below the dated sections, and below Coming up, because it is the
          loosest commitment on the screen: due *sometime* this week rather
          than on any particular day.
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
