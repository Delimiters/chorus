/**
 * The plan or your routines, on the same tab.
 *
 * Both answer "what am I doing today", and Today is the screen that actually
 * gets opened — so they share a tab rather than competing for another one.
 *
 * The chores list used to be a third segment here. It moved to the Upcoming
 * tab, which held a calendar Jake never used, because it answers a different
 * question: not "what am I doing today" but "what is coming". Today is now the
 * two answers, and Upcoming is where they come from.
 *
 * The two lists stay completely separate. Mixing personal routines into the
 * household feed was considered and rejected: with a housemate's shared
 * routines in the mix, "whose is this and does it concern me" stops being
 * answerable at a glance.
 *
 * The Routines segment carries a count of what has come due and is not done,
 * because Emily *"kinda thought the routine tab would be more prominent"* —
 * sitting next to Plan with nothing to say it holds anything, it reads as the
 * half you have already dealt with.
 */

import { View } from 'react-native';

import { SegmentedControl, type Segment } from '@/design/controls';
import { useRoutineOwedBadge } from '@/features/routines/useRoutineOwed';
import type { TodayMode } from '@/stores/routineStore';
import { space } from '@/design/tokens';

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: TodayMode;
  onChange: (mode: TodayMode) => void;
}) {
  /*
   * Called here rather than in either screen, deliberately. `useRoutineOwedBadge`
   * polls the clock once a minute, and this component is a leaf — putting it in
   * `PlanScreen` would redraw the whole of Today sixty times an hour for a
   * number that changes about four times a day.
   */
  const badge = useRoutineOwedBadge();

  const segments: readonly Segment<TodayMode>[] = [
    // Plan first, and first for a reason: it is the answer, and the other is
    // where part of the answer comes from.
    { value: 'plan', label: 'Plan' },
    { value: 'routines', label: 'Routines', badge },
  ];

  return (
    <View style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
      <SegmentedControl segments={segments} value={mode} onChange={onChange} label="Show" />
    </View>
  );
}
