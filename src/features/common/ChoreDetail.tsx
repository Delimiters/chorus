/**
 * What a chore *is*, for the top of a sheet.
 *
 * Jake: *"when you click a chore and the little menu comes out from the bottom
 * that can really just be like a mini chore view, you see the notes and steps
 * and any details you might want to see at a glance and then below that you
 * have the buttons to flag or edit or what have you."*
 *
 * One component for both sheets — Today's occurrence sheet and the plan's row
 * sheet — because two copies of "how a chore reads" is how they come to
 * disagree, and this file already has a docblock's worth of cases where that
 * happened.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 *
 * A quiet block, not a card. The sheet is already a card; boxing the detail
 * inside it would make the actions below look like a separate screen. The
 * hairline under it is the only divider, and it is doing real work: above it
 * you read, below it you act.
 *
 * It renders nothing at all when there is nothing to say, so a bare chore's
 * sheet keeps the shape it has always had instead of growing an empty region.
 */

import { View } from 'react-native';

import { Checkbox } from '@/design/ChoreRow';
import { Txt } from '@/design/components';
import { NoteText } from '@/design/NoteText';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';

interface Props {
  readonly notes?: string | null;
  readonly subtasks?: readonly { readonly id: string; readonly title: string }[];
  readonly ticked?: ReadonlySet<string>;
  readonly onToggleSubtask?: (subtaskId: string, ticked: boolean) => void;
  readonly category?: { readonly name: string; readonly ink: string | null } | null;
  /** "Every Monday", "Twice a week" — the rule in words. */
  readonly scheduleLabel?: string | null;
  /** Whose turn, when it is somebody's in particular. */
  readonly turnLabel?: string | null;
}

const NO_TICKS: ReadonlySet<string> = new Set();

export function ChoreDetail({
  notes = null,
  subtasks = [],
  ticked = NO_TICKS,
  onToggleSubtask,
  category = null,
  scheduleLabel = null,
  turnLabel = null,
}: Props) {
  const colors = useColors();

  const note = (notes ?? '').trim();
  const stepsDone = subtasks.filter((s) => ticked.has(s.id)).length;

  /*
   * Assembled and joined rather than three conditional nodes, so a chore with
   * only a category does not get two stray separators beside it.
   */
  const meta = [category?.name, scheduleLabel, turnLabel].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );

  if (meta.length === 0 && note.length === 0 && subtasks.length === 0) return null;

  return (
    <View
      testID="chore-detail"
      style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}
    >
      {meta.length === 0 ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {category?.ink == null ? null : (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: radius.pill,
                backgroundColor: category.ink,
              }}
            />
          )}
          <Txt variant="small" tone="faint">
            {meta.join(' · ')}
          </Txt>
        </View>
      )}

      {note.length === 0 ? null : <NoteText note={note} variant="body" />}

      {subtasks.length === 0 ? null : (
        <View style={{ gap: space.xs }}>
          <Txt variant="label" tone="faint">
            {`${stepsDone} OF ${subtasks.length} STEPS`}
          </Txt>
          {subtasks.map((subtask) => {
            const isDone = ticked.has(subtask.id);
            return (
              <View
                key={subtask.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
              >
                <Checkbox
                  checked={isDone}
                  ink={null}
                  disabled={onToggleSubtask === undefined}
                  onPress={() => onToggleSubtask?.(subtask.id, !isDone)}
                  label={isDone ? `Mark ${subtask.title} not done` : `Mark ${subtask.title} done`}
                />
                <Txt
                  variant="body"
                  {...(isDone ? { tone: 'faint' as const } : {})}
                  style={isDone ? { textDecorationLine: 'line-through' } : undefined}
                >
                  {subtask.title}
                </Txt>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: 1, backgroundColor: colors.rule, marginTop: space.xs }} />
    </View>
  );
}
