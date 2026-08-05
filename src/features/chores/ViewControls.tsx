/**
 * The "Group by" and "Sort by" controls.
 *
 * Two independent one-of-N choices rather than a single list of combinations,
 * because the combinations multiply: three groupings times two sorts is six
 * options to read, where two controls is three plus two.
 *
 * The preference is per-device (see `stores/viewStore`), so changing it here
 * never alters what the other person sees.
 */

import { View } from 'react-native';

import type { GroupBy, SortBy } from '@/core/occurrence/grouping';
import { SegmentedControl } from '@/design/controls';
import { space } from '@/design/tokens';

const GROUP_SEGMENTS: readonly { value: GroupBy; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'priority', label: 'Priority' },
  { value: 'none', label: 'None' },
];

const SORT_SEGMENTS: readonly { value: SortBy; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Date' },
];

interface Props {
  groupBy: GroupBy;
  sortBy: SortBy;
  onChangeGroupBy: (groupBy: GroupBy) => void;
  onChangeSortBy: (sortBy: SortBy) => void;
}

export function ViewControls({ groupBy, sortBy, onChangeGroupBy, onChangeSortBy }: Props) {
  return (
    <View style={{ gap: space.sm }}>
      <SegmentedControl
        segments={GROUP_SEGMENTS}
        value={groupBy}
        onChange={onChangeGroupBy}
        label="Group by"
      />
      <SegmentedControl
        segments={SORT_SEGMENTS}
        value={sortBy}
        onChange={onChangeSortBy}
        label="Sort by"
      />
    </View>
  );
}
