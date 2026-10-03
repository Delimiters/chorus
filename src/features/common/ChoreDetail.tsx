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
 * inside it would make the actions below look like a separate screen.
 *
 * It used to draw its own hairline underneath — "above it you read, below it
 * you act". The sheet's pinned footer now draws that line itself, in the right
 * place, so keeping this one as well left two rules with a gap of nothing
 * between them.
 *
 * It renders nothing at all when there is nothing to say, so a bare chore's
 * sheet keeps the shape it has always had instead of growing an empty region.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Checkbox } from '@/design/ChoreRow';
import { Txt } from '@/design/components';
import { NoteText } from '@/design/NoteText';
import { useColors } from '@/design/theme';
import { raisedGround } from '@/design/grounds';
import { MIN_TARGET, radius, space } from '@/design/tokens';

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

/**
 * How many steps a sheet shows before it offers to show the rest.
 *
 * Jake, on a chore with a lot of them: *"it took up the whole screen and was
 * too big for it and I couldn't back out of it."* The sheet is capped now so
 * that cannot happen again — but a cap alone just means the actions get
 * squeezed to a sliver, and the steps were what grew without limit.
 *
 * Five is roughly where a glance stops being a glance, and it is also what
 * fits above the actions on an iPhone without the list needing to scroll at
 * all — checked on the simulator, because jest-expo does no layout and this is
 * exactly the kind of number a test cannot tell you. Collapsing rather than
 * nesting a second scroll view inside the sheet's own: two scroll areas in the
 * same direction fight each other, and a tap is a better answer than a
 * gesture that sometimes moves the wrong thing.
 */
const STEPS_BEFORE_COLLAPSE = 5;

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
  const [showAllSteps, setShowAllSteps] = useState(false);

  const note = (notes ?? '').trim();
  const stepsDone = subtasks.filter((s) => ticked.has(s.id)).length;
  const collapsed = subtasks.length > STEPS_BEFORE_COLLAPSE && !showAllSteps;
  const shownSteps = collapsed ? subtasks.slice(0, STEPS_BEFORE_COLLAPSE) : subtasks;

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
          {shownSteps.map((subtask) => {
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

          {subtasks.length <= STEPS_BEFORE_COLLAPSE ? null : (
            /*
              A control that looks like one.
            
              It began as a line of muted text, which Jake read as prose:
              *"it hardly looks like something clickable."* So it has a ground,
              a pill edge and a chevron — the same chevron a chore row already
              uses to open its steps, so the two disclosures read as the same
              gesture in two places.
            
              `raised` rather than `sunken` for the ground. On the light theme
              `sunken` is #F4F4F1 against #F3F2EE paper, a one-unit difference
              that renders as nothing — which is exactly how an earlier
              "subtle" background on the chore chart disappeared.
            
              `alignSelf: 'flex-start'` so it is as wide as its label. A
              full-width bar would read as a section, not a button.
            */
            <Pressable
              onPress={() => setShowAllSteps(!showAllSteps)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showAllSteps }}
              hitSlop={8}
              style={({ pressed }) => ({
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
                minHeight: MIN_TARGET,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: raisedGround(colors, pressed),
              })}
            >
              <MaterialCommunityIcons
                name={collapsed ? 'chevron-down' : 'chevron-up'}
                size={18}
                color={colors.textFaint}
              />
              <Txt variant="small" style={{ fontWeight: '600' }}>
                {collapsed ? `Show all ${subtasks.length} steps` : 'Show fewer'}
              </Txt>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
