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
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addDays, compareCivil } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import type { RoutineOccurrence } from '@/core/routines/project';
import { useMembers } from '@/data/hooks/useHousehold';
import { useRoutineDay, useToggleRoutine } from '@/data/hooks/useRoutines';
import { useRoutinePreference, useRoutineStore } from '@/stores/routineStore';
import { SectionHeader, SubHeader } from '@/design/ChoreRow';
import { ADD_BUTTON_CLEARANCE, AddChoreButton } from '@/design/AddButton';
import { ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, space } from '@/design/tokens';
import { formatDayLong } from '@/features/common/format';
import { ModeSwitch } from '@/features/common/ModeSwitch';
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
      <ScrollView
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
          <Arrow label="Previous day" glyph="‹" onPress={() => setDay(addDays(day, -1))} />
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
            glyph="›"
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
              <Stack gap={space.xs}>
                {section.mine.map((item) => (
                  <RoutineRow
                    key={item.occurrenceKey}
                    item={item}
                    ink={myInk}
                    // Only today is tickable: a past day is a record, and a
                    // future one has not happened.
                    canTick={isToday}
                    onToggle={() =>
                      toggle.mutate({
                        occurrence: item,
                        complete: item.status !== 'completed',
                        on: day,
                      })
                    }
                    onOpen={() => onOpen(item)}
                  />
                ))}
              </Stack>

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
      </ScrollView>

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
  glyph: string;
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
      <Txt variant="title" style={{ color: colors.textMuted }}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
