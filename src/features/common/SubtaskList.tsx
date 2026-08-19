/**
 * The steps inside a chore, tickable one at a time.
 *
 * Ticking every step deliberately does **not** complete the chore. The steps
 * record where you got to; the chore is finished when the person doing it says
 * so. "Follow up with John when you're done" is a step you tick afterwards,
 * which is also why nothing here marks steps done on the chore's behalf.
 *
 * Ticks belong to the occurrence on screen, so opening last week's instance on
 * Upcoming shows what was done then, and a new occurrence starts empty.
 */

import { View } from 'react-native';

import type { Subtask } from '@/data/api/subtasks';
import { Checkbox } from '@/design/ChoreRow';
import { Txt } from '@/design/components';
import { space } from '@/design/tokens';

interface Props {
  subtasks: readonly Subtask[];
  /** Ids ticked for this occurrence. Absence is "not done". */
  ticked: ReadonlySet<string>;
  /** Your accent, so the boxes match the rest of the row. */
  ink: string | null;
  onToggle: (subtask: Subtask, ticked: boolean) => void;
}

export function SubtaskList({ subtasks, ticked, ink, onToggle }: Props) {
  if (subtasks.length === 0) return null;

  const done = subtasks.filter((s) => ticked.has(s.id)).length;

  return (
    <View style={{ gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm }}>
      <Txt variant="small" tone="faint">
        {`Steps · ${done} of ${subtasks.length}`}
      </Txt>

      {subtasks.map((subtask) => {
        const isDone = ticked.has(subtask.id);
        return (
          <View
            key={subtask.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
          >
            <Checkbox
              checked={isDone}
              ink={ink}
              onPress={() => onToggle(subtask, !isDone)}
              label={isDone ? `Mark ${subtask.title} not done` : `Mark ${subtask.title} done`}
            />
            <Txt
              variant="small"
              style={isDone ? { textDecorationLine: 'line-through', opacity: 0.6 } : undefined}
            >
              {subtask.title}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}
