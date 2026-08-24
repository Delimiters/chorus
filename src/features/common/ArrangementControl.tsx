/**
 * How Today's outstanding work is arranged.
 *
 * Two answers to one question, so one control rather than two. It replaced a
 * pair — Group by (Category / Priority / None) stacked above Sort by (Priority
 * / Date) — which between them cost two rows at the top of the busiest screen
 * in the app and produced six combinations, most of which nobody wanted.
 *
 * Category is not an option any more: every row carries its category as a
 * colour and a name, so a heading repeated what the row already said.
 */

import { SegmentedControl } from '@/design/controls';
import type { TodayArrangement } from '@/stores/viewStore';

const SEGMENTS: readonly { value: TodayArrangement; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'when', label: 'When' },
];

export function ArrangementControl({
  arrangement,
  onChange,
}: {
  arrangement: TodayArrangement;
  onChange: (arrangement: TodayArrangement) => void;
}) {
  // `SegmentedControl` is generic over the segment type, so `onChange` passes
  // through with its real type rather than through a `string` cast.
  return (
    <SegmentedControl
      segments={SEGMENTS}
      value={arrangement}
      onChange={onChange}
      label="Arrange by"
    />
  );
}
