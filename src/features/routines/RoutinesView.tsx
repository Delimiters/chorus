/**
 * Your routine for one day.
 *
 * Buckets as sections, yours above each housemate's, and a day you can page
 * backwards through. Forward stops at today: a tickable checkbox on tomorrow
 * would let you complete something that has not happened.
 *
 * Past days are read-only for the same reason. You are looking at what
 * happened, not editing it — and a completion carries the date it was for, so
 * back-filling would quietly rewrite a day you have already lived.
 */

import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addDays, compareCivil } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import type { RoutineOccurrence } from '@/core/routines/project';
import { useMembers } from '@/data/hooks/useHousehold';
import { useReorderRoutine, useRoutineDay, useToggleRoutine } from '@/data/hooks/useRoutines';
import { useToday_View } from '@/data/hooks/useOccurrences';
import type { LinkedChoreTick } from '@/data/api/routines';
import { useRoutinePreference, useRoutineStore } from '@/stores/routineStore';
import { SectionHeader, SubHeader } from '@/design/ChoreRow';
import { ADD_BUTTON_CLEARANCE, AddChoreButton } from '@/design/AddButton';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, space } from '@/design/tokens';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatDayLong } from '@/features/common/format';
import { ModeSwitch } from '@/features/common/ModeSwitch';
import {
  NestedReorderableList,
  reorderItems,
  ScrollViewContainer,
} from 'react-native-reorderable-list';

import { RoutineRow } from './RoutineRow';

interface Props {
  today: CivilDate;
  onAdd: () => void;
  onOpen: (item: RoutineOccurrence) => void;
  /** Your own accent, for the add button and your checkboxes. */
  myInk: string | null;
}

export function RoutinesView({ today, onAdd, onOpen, myInk }: Props) {
  const { colors } = useTheme();
  const setTodayMode = useRoutineStore((s) => s.setTodayMode);
  const members = useMembers();
  const preference = useRoutinePreference();

  const [day, setDay] = useState<CivilDate>(today);
  const isToday = compareCivil(day, today) === 0;

  const { summary, isLoading, error, unreadable } = useRoutineDay(day, {
    showOthers: preference.showOthers,
  });
  const toggle = useToggleRoutine();
  const reorder = useReorderRoutine();

  /**
   * The chore occurrence a linked item would tick, if one is due today.
   *
   * Looked up here rather than in SQL: the projected occurrence is already on
   * screen, and re-deriving its key server-side would be a second recurrence
   * engine that could drift from this one. When nothing of that chore is due,
   * the answer is null and the tick is a routine tick alone — inventing a
   * completion for a day the chore was never due would distort the
   * expected-versus-actual figure the stats screen reports.
   */
  const choreToday = useToday_View();
  /*
   * Searched over everything due today, not over what is still outstanding.
   *
   * `view.mine` and `view.theirs` hold outstanding items only, and floating
   * chores are not in either — they are grouped away separately. Reading from
   * them made un-ticking silently asymmetric: your tick completed the chore,
   * which removed the occurrence from those lists, so the un-tick found
   * nothing, passed no chore to the RPC, and left the chore completed with
   * nothing on screen to say so. A chore linked to a floating schedule never
   * ticked at all, in either direction.
   */
  const linkedChoreFor = (linkedChoreId: string | null): LinkedChoreTick | null => {
    if (linkedChoreId === null || !isToday) return null;
    const dueToday = choreToday.agenda.find(
      (occ) => occ.choreId === linkedChoreId && occ.dueOn === today,
    );
    if (dueToday === undefined) return null;
    return {
      choreId: dueToday.choreId,
      occurrenceKey: dueToday.occurrenceKey,
      dueOn: dueToday.dueOn,
    };
  };

  const byMember = useMemo(() => {
    const map = new Map<string, { name: string; ink: string }>();
    for (const member of members.data ?? []) {
      map.set(member.userId, { name: member.displayName, ink: member.accent });
    }
    return map;
  }, [members.data]);

  if (isLoading) return <LoadingState label="Loading your routine" />;
  if (error !== null) return <ErrorState message={error.message} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollViewContainer
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xxxl + ADD_BUTTON_CLEARANCE,
        }}
      >
        <ModeSwitch mode="routines" onChange={setTodayMode} />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: space.sm,
          }}
        >
          <Arrow
            label="Previous day"
            glyph="chevron-left"
            onPress={() => setDay(addDays(day, -1))}
          />
          <Stack gap={2} style={{ alignItems: 'center' }}>
            <Txt variant="heading" accessibilityRole="header">
              {isToday ? 'Today' : formatDayLong(day)}
            </Txt>
            <Txt variant="mono" tone="faint">
              {`${summary.doneCount} OF ${summary.totalCount} DONE`}
            </Txt>
          </Stack>
          {/* Disabled rather than hidden, so the header does not reflow as you
              page back and forth. */}
          <Arrow
            label="Next day"
            glyph="chevron-right"
            disabled={isToday}
            onPress={() => setDay(addDays(day, 1))}
          />
        </View>

        {unreadable.length === 0 ? null : (
          <View style={{ paddingTop: space.md }}>
            <Txt variant="small" tone="danger">
              {unreadable.join('\n')}
            </Txt>
          </View>
        )}

        {summary.sections.length === 0 ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <Txt tone="faint">
              {isToday ? 'Nothing in your routine today.' : 'Nothing was in your routine that day.'}
            </Txt>
          </View>
        ) : (
          summary.sections.map((section) => (
            <View key={section.bucket}>
              <SectionHeader title={section.title} count={section.totalCount} />
              {/*
                Long-press a row to drag it. Only your own list, and only on
                today: a past day is a record of what happened, and reordering
                it would rewrite that.

                `NestedReorderableList` inside a `ScrollViewContainer` is the
                library's supported way to put a draggable list inside a
                scrolling page, and both halves are required. A plain
                `ReorderableList` in a plain `ScrollView` renders, and then the
                page will not scroll at all — the list's pan handler takes the
                gesture and the outer view never sees it, which reads as a
                frozen screen on a routine long enough to need scrolling.

                `scrollable={false}`: the list has no height of its own, so the
                container does the scrolling.
              */}
              <NestedReorderableList
                data={[...section.mine]}
                keyExtractor={(item) => item.occurrenceKey}
                scrollable={false}
                onReorder={({ from, to }) => {
                  const next = reorderItems([...section.mine], from, to);
                  reorder.mutate({ orderedIds: next.map((i) => i.itemId) });
                }}
                renderItem={({ item }) => (
                  <View style={{ paddingBottom: space.xs }}>
                    <RoutineRow
                      item={item}
                      ink={myInk}
                      // Only today is tickable: a past day is a record, and a
                      // future one has not happened.
                      canTick={isToday}
                      draggable={isToday}
                      onToggle={() =>
                        toggle.mutate({
                          occurrence: item,
                          complete: item.status !== 'completed',
                          on: day,
                          chore: linkedChoreFor(item.linkedChoreId),
                        })
                      }
                      onOpen={() => onOpen(item)}
                    />
                  </View>
                )}
              />

              {section.theirs.map((person) => (
                <View key={person.ownerId}>
                  <SubHeader
                    title={byMember.get(person.ownerId)?.name ?? 'Someone'}
                    ink={byMember.get(person.ownerId)?.ink ?? null}
                    count={person.items.length}
                  />
                  <Stack gap={space.xs}>
                    {person.items.map((item) => (
                      <RoutineRow
                        key={item.occurrenceKey}
                        item={item}
                        ink={byMember.get(person.ownerId)?.ink ?? null}
                        // Theirs to tick, not yours. The database refuses it
                        // too; this only stops the screen offering it.
                        canTick={false}
                        onToggle={() => undefined}
                      />
                    ))}
                  </Stack>
                </View>
              ))}
            </View>
          ))
        )}

        {toggle.error ? (
          <View style={{ paddingTop: space.md }}>
            <Txt variant="small" tone="danger">
              {(toggle.error as Error).message}
            </Txt>
          </View>
        ) : null}
      </ScrollViewContainer>

      <AddChoreButton onPress={onAdd} ink={myInk} />
    </SafeAreaView>
  );
}

function Arrow({
  label,
  glyph,
  onPress,
  disabled = false,
}: {
  label: string;
  glyph: 'chevron-left' | 'chevron-right';
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{
        minWidth: MIN_TARGET,
        minHeight: MIN_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {/*
        An icon rather than a ‹ character: the glyph rendered small and thin at
        every text size, which made a 44pt target look like a 10pt one.
      */}
      <MaterialCommunityIcons name={glyph} size={28} color={colors.textMuted} />
    </Pressable>
  );
}
