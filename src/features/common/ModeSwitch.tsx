/**
 * Chores or routines, on the same tab.
 *
 * Both answer "what am I doing today", and Today is the screen that actually
 * gets opened — so they share a tab rather than competing for a fifth one.
 * Five 10pt uppercase labels would have truncated on a phone, and every tab
 * currently wears the same placeholder square, so a fifth would have added no
 * way to tell them apart.
 *
 * The two lists stay completely separate. Mixing personal routines into the
 * household feed was considered and rejected: with a housemate's shared
 * routines in the mix, "whose is this and does it concern me" stops being
 * answerable at a glance.
 */

import { View } from 'react-native';

import { SegmentedControl } from '@/design/controls';
import type { TodayMode } from '@/stores/routineStore';
import { space } from '@/design/tokens';

const SEGMENTS: readonly { value: TodayMode; label: string }[] = [
  // Plan first, and first for a reason: it is the answer, and the other two are
  // where the answer comes from.
  { value: 'plan', label: 'Plan' },
  { value: 'chores', label: 'Chores' },
  { value: 'routines', label: 'Routines' },
];

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: TodayMode;
  onChange: (mode: TodayMode) => void;
}) {
  return (
    <View style={{ paddingHorizontal: space.sm, paddingBottom: space.md }}>
      <SegmentedControl segments={SEGMENTS} value={mode} onChange={onChange} label="Show" />
    </View>
  );
}
