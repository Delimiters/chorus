/**
 * The chore library.
 *
 * The edit surface, not a to-do list: every chore with its schedule stated in
 * plain words, plus the Someday section for things with no date. Tapping a row
 * opens it for editing; the button at the bottom adds one.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { describeSchedule } from '@/core/recurrence/describe';
import { type Chore } from '@/data/api/chores';
import type { CivilDate } from '@/core/civil/types';
import { useChoreList, useOneOffCompletions, useToggleSomeday } from '@/data/hooks/useChores';
import { useHousehold, useMembers } from '@/data/hooks/useHousehold';
import { useToday } from '@/data/today';
import { Checkbox, SectionHeader } from '@/design/ChoreRow';
import { Button, ErrorState, LoadingState, Stack, Txt } from '@/design/components';
import { formatDayShort } from '@/features/common/format';
import { groupItems, type Groupable } from '@/core/occurrence/grouping';
import { useCategoryList } from '@/data/hooks/useCategories';
import { useViewPreference, useViewStore } from '@/stores/viewStore';
import { ViewControls } from '@/features/common/ViewControls';
import { inkColor } from '@/design/inks';
import { toIconName } from '@/design/icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export function ChoresScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const members = useMembers();
  const [showArchived, setShowArchived] = useState(false);

  const query = useChoreList({ includeArchived: showArchived });
  const oneOffDone = useOneOffCompletions();
  const toggleSomeday = useToggleSomeday();
  const household = useHousehold();
  const today = useToday(household.data?.timeZone ?? 'UTC');
  const categories = useCategoryList();
  const view = useViewPreference();
  const setGroupBy = useViewStore((s) => s.setGroupBy);
  const setSortBy = useViewStore((s) => s.setSortBy);

  /** When each one-off chore was ticked off, if it was. */
  const doneByChore = useMemo(() => {
    const map = new Map<string, CivilDate>();
    for (const c of oneOffDone.data ?? []) map.set(c.choreId, c.completedOn);
    return map;
  }, [oneOffDone.data]);

  const inkFor = (chore: Chore): string | null => {
    // Only a fixed assignment has a single owner. Rotating and fan-out chores
    // belong to everyone in turn, so the library shows them unmarked.
    const assignment = chore.assignment;
    if (assignment.kind !== 'fixed') return null;
    return members.data?.find((m) => m.userId === assignment.memberId)?.accent ?? null;
  };

  /*
   * A finished one-time chore is done, not active.
   *
   * It used to sit in the active list at full opacity, indistinguishable from
   * something still outstanding, for ever — nothing ever took it out, because
   * completion lives in another table and this screen only asked about
   * Someday. A household that uses one-time chores accumulates them until the
   * list is mostly things that already happened.
   *
   * Moved rather than archived, and deliberately. Archiving would take the
   * chore out of `listChores`, which is what the occurrence projection reads —
   * so the completion would vanish from Today's Done band the instant it was
   * ticked, and out of the stats the completion log exists to feed. Keeping
   * the row live and moving it down the screen costs nothing and loses
   * nothing; archiving it is still one tap away for anyone who wants it gone.
   */
  const { active, someday, finished, archived } = useMemo(() => {
    const all = query.data?.chores ?? [];
    const live = all.filter((c) => !c.archived);
    const isDoneOneTime = (c: Chore) => c.schedule.rule.kind === 'once' && doneByChore.has(c.id);
    return {
      active: live.filter((c) => c.schedule.rule.kind !== 'unscheduled' && !isDoneOneTime(c)),
      someday: live.filter((c) => c.schedule.rule.kind === 'unscheduled'),
      finished: live.filter(isDoneOneTime),
      archived: all.filter((c) => c.archived),
    };
  }, [query.data, doneByChore]);

  /**
   * The active chores, arranged by the device's grouping preference.
   *
   * Chore definitions carry no due date — a weekly chore is not due on any one
   * day — so `dueOn` is null and the ordering falls through to priority and
   * then title. Someday and archived keep their own sections below: they are
   * states rather than categories, and burying "archived" inside "Kitchen"
   * would hide it.
   */
  const activeSections = useMemo(() => {
    const groupable: Groupable[] = active.map((c) => ({
      choreId: c.id,
      dueOn: null,
      choreTitle: c.title,
    }));
    const meta = new Map(
      active.map((c) => [c.id, { categoryId: c.categoryId, priority: c.priority }]),
    );
    return groupItems(groupable, meta, categories, view);
  }, [active, categories, view]);

  const byId = useMemo(() => new Map(active.map((c) => [c.id, c])), [active]);

  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState message={(query.error as Error).message} />;

  const row = (chore: Chore, dashed = false) => {
    const ink = inkFor(chore);
    const somedayRow = chore.schedule.rule.kind === 'unscheduled';
    const doneOn = doneByChore.get(chore.id) ?? null;
    return (
      <View
        key={chore.id}
        style={{
          flexDirection: 'row',
          gap: space.md,
          alignItems: 'flex-start',
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: dashed ? 'transparent' : colors.sunken,
          borderWidth: dashed ? 1 : 0,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: colors.rule,
          opacity: chore.archived || doneOn !== null ? 0.5 : 1,
        }}
      >
        {/*
          A Someday chore gets a real checkbox; everything else gets the inert
          mark it always had. Only Someday can be completed from this screen —
          a repeating chore is ticked off on Today, on the day it is due, and a
          checkbox here would be ambiguous about which occurrence it meant.
        */}
        {somedayRow ? (
          <Checkbox
            checked={doneOn !== null}
            ink={ink}
            onPress={() =>
              toggleSomeday.mutate({ choreId: chore.id, done: doneOn === null, today })
            }
            label={doneOn === null ? `Mark ${chore.title} done` : `Mark ${chore.title} not done`}
          />
        ) : (
          <View
            style={{
              width: 20,
              height: 20,
              marginTop: 1,
              borderRadius: radius.sm,
              borderWidth: 1.5,
              borderColor: ink === null ? colors.textFaint : inkColor(ink, isDark),
            }}
          />
        )}

        <Pressable
          onPress={() => router.push(`/chore/${chore.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`${chore.title}, ${describeSchedule(chore.schedule)}. Edit.`}
          style={{ flex: 1 }}
        >
          <Stack gap={3}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              {toIconName(chore.icon) === null ? null : (
                <View accessibilityElementsHidden importantForAccessibility="no">
                  <MaterialCommunityIcons
                    name={toIconName(chore.icon) as never}
                    size={16}
                    color={colors.textMuted}
                  />
                </View>
              )}
              <Txt
                variant="bodyStrong"
                style={doneOn === null ? undefined : { textDecorationLine: 'line-through' }}
              >
                {chore.title}
              </Txt>
            </View>
            <Txt variant="small" tone="faint">
              {doneOn === null
                ? describeSchedule(chore.schedule)
                : `Done ${formatDayShort(doneOn)}`}
            </Txt>
          </Stack>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        <Stack gap={2} style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
          <Txt variant="display" accessibilityRole="header">
            Chores
          </Txt>
          <Txt variant="mono" tone="faint">
            {active.length} ACTIVE · {someday.length} SOMEDAY
          </Txt>
        </Stack>

        {active.length > 0 ? (
          <>
            <View style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
              <ViewControls
                groupBy={view.groupBy}
                sortBy={view.sortBy}
                onChangeGroupBy={setGroupBy}
                onChangeSortBy={setSortBy}
              />
            </View>
            {activeSections.map((section) => (
              <View key={section.key}>
                {/* Grouping off produces one untitled section, and a blank
                    header would be a rule with nothing above it. */}
                {section.title === '' ? null : <SectionHeader title={section.title} />}
                <Stack gap={space.xs}>
                  {section.items.map((item) => {
                    const chore = byId.get(item.choreId);
                    return chore === undefined ? null : row(chore);
                  })}
                </Stack>
              </View>
            ))}
          </>
        ) : (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <Txt tone="faint">No chores yet.</Txt>
          </View>
        )}

        {someday.length > 0 ? (
          <>
            <SectionHeader title="Someday · no date" />
            <Stack gap={space.xs}>{someday.map((c) => row(c, true))}</Stack>
          </>
        ) : null}

        {finished.length > 0 ? (
          <>
            {/*
              Below Someday and above Archived, because that is the order of
              how much attention each deserves. Counted, so the section is
              worth collapsing later if it grows.
            */}
            <SectionHeader title="Done" count={finished.length} />
            <Stack gap={space.xs}>{finished.map((c) => row(c))}</Stack>
          </>
        ) : null}

        <View style={{ paddingTop: space.xl }}>
          <Button label="Add a chore" onPress={() => router.push('/chore/new')} />
        </View>

        <Pressable
          onPress={() => setShowArchived((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: showArchived }}
          style={{ paddingVertical: space.lg, paddingHorizontal: space.sm }}
        >
          <Txt variant="small" tone="accent">
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Txt>
        </Pressable>

        {showArchived && archived.length > 0 ? (
          <>
            <SectionHeader title="Archived" count={archived.length} />
            <Stack gap={space.xs}>{archived.map((c) => row(c))}</Stack>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
