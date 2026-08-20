/**
 * A routine row that can be picked up and dragged.
 *
 * The drag hook is here rather than in `RoutineRow` because that row renders in
 * two places: inside the reorderable list for your own routine, and in a plain
 * list for a housemate's shared one. `useReorderableDrag` throws outside a
 * provider — "please consume ReorderableList context within its provider" —
 * so calling it in the shared row took the whole Routines screen down the
 * moment somebody switched sharing on.
 *
 * Splitting it means the hook is only ever called where the provider exists,
 * which the type system cannot check and a component boundary can.
 */

import { useReorderableDrag } from 'react-native-reorderable-list';

import type { RoutineOccurrence } from '@/core/routines/project';
import { RoutineRow } from './RoutineRow';

interface Props {
  item: RoutineOccurrence;
  ink: string | null;
  canTick: boolean;
  /** False on a past day, where reordering would rewrite the record. */
  draggable: boolean;
  onToggle: () => void;
  onOpen?: (() => void) | undefined;
}

export function DraggableRoutineRow({ draggable, ...rest }: Props) {
  const drag = useReorderableDrag();
  return <RoutineRow {...rest} onDrag={draggable ? drag : undefined} />;
}
