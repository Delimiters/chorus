/**
 * A chore on the agenda.
 *
 * Two tap targets on one row: the checkbox completes, the body opens the sheet.
 * Ticking is the thing you do twenty times a week, so it gets its own target
 * rather than hiding behind a long-press — and skip / reschedule / edit stay one
 * tap away instead of being undiscoverable.
 *
 * Ink appears on the checkbox and the turn chip only, and **never alone**: a
 * blue box always sits beside the words "Your turn". See docs/DESIGN_SYSTEM.md.
 */

import { useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import type { AgendaItem, FloatingGroup } from '@/core/occurrence/agenda';
import { inkColor, inkSoft } from './inks';
import { useTheme } from './theme';
import { MIN_TARGET, radius, space } from './tokens';
import { Txt } from './components';
import { formatLateness, formatMissedBefore } from './format';
import type { Priority } from '@/core/chore/priority';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

/** Stable identity, so a row without ticks does not re-render on every parent render. */
const EMPTY_TICKS: ReadonlySet<string> = new Set();

// ── Checkbox ────────────────────────────────────────────────────────────────

interface CheckboxProps {
  checked: boolean;
  /** The owner's ink, or null when anyone can do it. */
  ink: string | null;
  onPress: () => void;
  label: string;
  disabled?: boolean;
}

export function Checkbox({ checked, ink, onPress, label, disabled = false }: CheckboxProps) {
  const { colors, isDark } = useTheme();
  const tint = ink === null ? colors.textFaint : inkColor(ink, isDark);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      // Generous target around a small mark; the box is 22px but the tap area
      // meets the 44px minimum.
      hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 1 })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.sm,
          borderWidth: 1.5,
          borderColor: checked ? colors.text : tint,
          backgroundColor: checked ? colors.text : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <View
            style={{
              width: 9,
              height: 5,
              marginTop: -2,
              borderLeftWidth: 2,
              borderBottomWidth: 2,
              borderColor: colors.surface,
              transform: [{ rotate: '-45deg' }],
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

// ── Chip ────────────────────────────────────────────────────────────────────

export function Chip({
  children,
  ink,
  tone = 'quiet',
}: {
  children: React.ReactNode;
  ink?: string | null;
  tone?: 'quiet' | 'ink' | 'overdue' | 'flexible';
}) {
  const { colors, isDark } = useTheme();

  const background =
    tone === 'overdue'
      ? colors.overdue
      : tone === 'flexible'
        ? colors.overprintSoft
        : tone === 'ink' && ink != null
          ? inkSoft(ink, isDark)
          : colors.raised;

  const color =
    tone === 'overdue'
      ? colors.onOverdue
      : tone === 'flexible'
        ? colors.overprint
        : tone === 'ink' && ink != null
          ? inkColor(ink, isDark)
          : colors.textMuted;

  return (
    <View
      style={{
        backgroundColor: background,
        borderRadius: radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Txt variant="label" style={{ color, letterSpacing: 0.7, fontSize: 10 }}>
        {children}
      </Txt>
    </View>
  );
}

/** Progress pips for a floating chore: ● ○ ○ */
export function Pips({ done, total }: { done: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}
      // No label: the visible "N of M" sits right beside it, and announcing the
      // same fact twice is worse than not announcing it.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            borderWidth: 1.2,
            borderColor: colors.overprint,
            backgroundColor: i < done ? colors.overprint : 'transparent',
          }}
        />
      ))}
    </View>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

interface ChoreRowProps {
  item: AgendaItem;
  /** Ink of the assignee, or null when anyone can do it. */
  ink: string | null;
  /** "Your turn" / "Sam's turn" / null. Always present when `ink` is. */
  turnLabel: string | null;
  scheduleLabel: string;
  /**
   * The chore's category, or null for "Other".
   *
   * A chip rather than a section, because Today is already sectioned by who
   * owns the chore and what state it is in. Nesting categories inside those
   * would multiply the headers; a chip puts the same information on the row
   * without restructuring the screen.
   */
  category?: { name: string; ink: string | null } | null;
  /**
   * Badged only when `crucial`.
   *
   * Normal is the default and needs no label, and marking every minor chore
   * "Minor" would add a chip to most rows to say nothing. A badge that appears
   * on everything stops being a signal.
   */
  priority?: Priority;
  /**
   * A glyph name, or null. Decorative: the chore's title says what it is, so
   * the icon is hidden from screen readers rather than read out twice.
   */
  icon?: string | null;
  /**
   * The chore's note, shown on demand.
   *
   * Notes were reachable only by opening the chore to edit it, so anything put
   * in one — "by 4pm Monday", "conflicts with the Uribe appointment" — was
   * invisible exactly where the task is read. Collapsed by default, because a
   * note is detail for when you are actually doing the job and would otherwise
   * make every row two lines taller.
   */
  notes?: string | null;
  /**
   * The chore's steps, drawn under the row.
   *
   * On the row rather than behind a tap: a step is ticked while you are doing
   * the chore, so putting the list one interaction away made it something you
   * had to go looking for. Expanded by default for the same reason — a
   * collapsed list of things to do is a list nobody reads.
   */
  subtasks?: readonly { id: string; title: string }[];
  /** Which of them are ticked for *this* occurrence. */
  tickedSubtasks?: ReadonlySet<string>;
  onToggleSubtask?: (subtaskId: string, ticked: boolean) => void;
  onToggle: () => void;
  onOpen: () => void;
  /**
   * Tighter, and the category becomes a colour rather than a chip.
   *
   * Today runs to a hundred rows on a bad week, and the category chip was the
   * widest thing on the meta line while being the least likely to change what
   * you do next. Compact keeps the information and spends fewer pixels on it:
   * the category's ink is a rail down the left edge, its name sits faint at the
   * right of the title line, and the chip goes.
   */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ChoreRow({
  item,
  ink,
  turnLabel,
  scheduleLabel,
  category = null,
  priority = 'normal',
  icon = null,
  notes = null,
  subtasks = [],
  tickedSubtasks,
  onToggleSubtask,
  onToggle,
  onOpen,
  compact = false,
  style,
}: ChoreRowProps) {
  const { colors, isDark } = useTheme();
  const rail =
    compact && category !== null && category.ink !== null ? inkColor(category.ink, isDark) : null;
  const note = notes === null ? '' : notes.trim();
  /*
   * Expanded means "show me everything about this chore".
   *
   * On a roomy row it has only ever governed the steps, and they start open —
   * a collapsed list of things to do is a list nobody reads. A compact row
   * starts closed, because the whole point of it is to be one line until you
   * ask for more.
   */
  const [stepsOpen, setStepsOpen] = useState(!compact);
  const slim = compact && !stepsOpen;
  const ticked = tickedSubtasks ?? EMPTY_TICKS;
  const stepsDone = subtasks.filter((s) => ticked.has(s.id)).length;
  const done = item.status === 'completed';
  const overdue = item.status === 'overdue';
  const skipped = item.status === 'skipped';

  return (
    <View
      style={[
        {
          paddingHorizontal: space.md,
          paddingVertical: slim ? 7 : compact ? 8 : 11,
          borderRadius: radius.md,
          // Only when there is a rail to clip. Unconditional `hidden` also
          // clips touch dispatch to the container's bounds on Android, and
          // compact's tighter padding pushes 3px of the checkbox's hitSlop
          // past the top edge — the most-tapped target in the app.
          overflow: compact ? 'hidden' : 'visible',
          // A slim row is as tall as its contents. `minHeight: 44` was holding
          // every row open to a control's height around a single line of text,
          // which is where the empty band under each chore came from; the
          // checkbox keeps its 44pt target through `hitSlop`, not through the
          // row's geometry.
          ...(slim ? {} : { minHeight: MIN_TARGET }),
          // Overdue is an outline, not a red wash. A red list makes an ordinary
          // Tuesday feel like an incident.
          backgroundColor: overdue ? 'transparent' : colors.sunken,
          borderWidth: overdue ? 1 : 0,
          borderColor: colors.overdue,
          opacity: done || skipped ? 0.55 : 1,
        },
        style,
      ]}
    >
      {/*
        The category, as a colour on the edge of the cell. Not a border: a
        border would have to run all four sides, and an outline in the category
        ink would compete with the overdue outline, which is the one thing on
        this screen that must stay unambiguous.
      */}
      {rail === null ? null : (
        <View
          testID="category-rail"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: rail,
          }}
        />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <Checkbox
          checked={done}
          ink={ink}
          onPress={onToggle}
          label={done ? `Mark ${item.choreTitle} not done` : `Mark ${item.choreTitle} done`}
        />

        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${item.choreTitle}, ${turnLabel ?? 'anyone can do it'}. Open options.`}
          style={{ flex: 1, gap: 4 }}
        >
          <View
            style={{
              flexDirection: 'row',
              // Top-aligned, so a two-line title keeps its category and
              // lateness beside the *first* line rather than floating them to
              // the vertical middle of the row.
              alignItems: slim ? 'flex-start' : 'center',
              gap: space.xs,
            }}
          >
            {icon === null ? null : (
              <View accessibilityElementsHidden importantForAccessibility="no">
                <MaterialCommunityIcons name={icon as never} size={16} color={colors.textMuted} />
              </View>
            )}
            {/*
              Never truncated. A slim row is about not wasting space, not about
              fitting on one line at any cost — "Resubmit penelope appe…" tells
              you less than the extra line costs, and a chore whose name really
              needs two lines is allowed to be the taller row.

              `flex: 1` rather than `flexShrink`, so the title claims the space
              first and the category name takes what is left.
            */}
            <Txt
              variant="bodyStrong"
              style={[
                slim ? { flex: 1 } : null,
                done || skipped ? { textDecorationLine: 'line-through' } : null,
              ]}
            >
              {item.choreTitle}
            </Txt>

            {/*
              The name as well as the rail. A colour alone is a legend you have
              to have learnt — and one that says nothing at all to anyone who
              cannot tell these two greens apart. Faint and right-aligned, so it
              is there when looked for and out of the way when not.
            */}
            {compact && category !== null ? (
              // Muted, not faint. 13pt faint is 3.75:1 against paper — below
              // AA — and this is now the category's only textual carrier,
              // where the chip it replaced was ink on a tinted ground.
              <Txt
                variant="small"
                tone="muted"
                numberOfLines={1}
                // Capped, and never at the title's expense: the category is
                // context, the name is the thing being read.
                style={{ marginLeft: 'auto', paddingLeft: space.xs, maxWidth: '32%', marginTop: 2 }}
              >
                {category.name}
              </Txt>
            ) : null}

            {/*
              How late, shortened to `6d`, and only on a slim row.

              Lateness is the one thing that cannot fold away — it is why a row
              is worth looking at at all — but "6 days late" is a chip's worth
              of width for one number. Expanded, the full chip returns.
            */}
            {slim && overdue ? (
              <Txt
                variant="small"
                tone="danger"
                style={
                  category === null ? { marginLeft: 'auto', paddingLeft: space.xs } : undefined
                }
              >
                {`${item.daysOverdue}d`}
              </Txt>
            ) : null}
          </View>

          {/*
            Everything below the title, which a slim row does not show.

            A slim row is the name, its category colour, and how late it is —
            enough to decide whether to do it. Chips, schedule text, the missed
            count and the note are all detail for when you are actually doing
            the job, and folding them roughly halves the row.
          */}
          {slim ? null : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
              {overdue ? <Chip tone="overdue">{formatLateness(item.daysOverdue)}</Chip> : null}

              {priority === 'crucial' ? <Chip tone="overdue">Crucial</Chip> : null}

              {category === null || compact ? null : (
                <Chip tone={category.ink === null ? 'quiet' : 'ink'} ink={category.ink}>
                  {category.name}
                </Chip>
              )}

              {turnLabel !== null ? (
                <Chip tone="ink" ink={ink}>
                  {turnLabel}
                </Chip>
              ) : null}

              {done && item.completedBy !== null ? null : (
                <Txt variant="small" tone="faint">
                  {scheduleLabel}
                </Txt>
              )}

              {/* Quiet, not a reproach — see the overdue rule in DESIGN_SYSTEM.md. */}
              {item.missedBefore > 0 && !done ? (
                <Txt variant="small" tone="faint">
                  {`· ${formatMissedBefore(item.missedBefore)}`}
                </Txt>
              ) : null}
            </View>
          )}

          {note.length > 0 && !slim ? (
            <Txt variant="small" tone="faint" numberOfLines={2} style={{ marginTop: 1 }}>
              {note}
            </Txt>
          ) : null}
        </Pressable>

        {/*
          The disclosure, on the right of the cell and sized like a control.
          It began as a chevron inside the steps line — sixteen points, faint,
          with a text glyph for an arrow — which read as decoration and was
          barely tappable.

          On a slim row it keeps the 44pt target and gives up the 44pt *box*.
          A laid-out 44 square was setting the height of every row on Today —
          the content is one line of about twenty-two points, so the rest was
          empty space under every chore — and taking 44 points of width from
          the title, which is what was clipping the long ones. `hitSlop` buys
          the target back without the geometry.
        */}
        {subtasks.length > 0 || compact ? (
          <Pressable
            onPress={() => setStepsOpen((wasOpen: boolean) => !wasOpen)}
            accessibilityRole="button"
            accessibilityState={{ expanded: stepsOpen }}
            accessibilityLabel={
              compact
                ? `${item.choreTitle}. ${stepsOpen ? 'Hide details' : 'Show details'}.`
                : `${stepsDone} of ${subtasks.length} steps done. ${
                    stepsOpen ? 'Hide them' : 'Show them'
                  }.`
            }
            // 20 laid out, 44 tappable. `hitSlop` grows the target without
            // growing the box, which is the only way to have both on a row
            // this tight — the gap either side is real space, not padding
            // inside a button, so the words stop short of it.
            hitSlop={slim ? { top: 14, bottom: 14, left: 12, right: 12 } : undefined}
            style={{
              width: slim ? 20 : MIN_TARGET,
              height: slim ? 20 : MIN_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
              // Pulled into the row's own padding so the icon sits on the
              // edge of the cell rather than inset from it.
              marginTop: slim ? 1 : -8,
              marginRight: slim ? 0 : -space.sm,
            }}
          >
            <MaterialCommunityIcons
              name={stepsOpen ? 'chevron-up' : 'chevron-down'}
              size={slim ? 20 : 26}
              color={colors.textFaint}
            />
          </Pressable>
        ) : null}
      </View>

      {/*
        Indented under the chore, not inside the row's tappable body — a step's
        checkbox and the row's "open options" press must not compete.
      */}
      {subtasks.length > 0 && stepsOpen ? (
        <View style={{ gap: 2, marginTop: 6, paddingLeft: space.xl }}>
          <Txt variant="small" tone="faint">
            {`${stepsDone} of ${subtasks.length} steps`}
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
                  ink={ink}
                  disabled={onToggleSubtask === undefined}
                  onPress={() => onToggleSubtask?.(subtask.id, !isDone)}
                  label={isDone ? `Mark ${subtask.title} not done` : `Mark ${subtask.title} done`}
                />
                {isDone ? (
                  <Txt variant="small" tone="faint" style={{ textDecorationLine: 'line-through' }}>
                    {subtask.title}
                  </Txt>
                ) : (
                  <Txt variant="small">{subtask.title}</Txt>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

interface FloatingRowProps {
  group: FloatingGroup;
  ink: string | null;
  turnLabel: string | null;
  windowLabel: string;
  onToggle: () => void;
  onOpen: () => void;
}

/**
 * A floating chore, as one row.
 *
 * "3× a week" produces three occurrences sharing a date; three identical rows
 * would be noise. One row with pips shows progress, and ticking it completes the
 * next outstanding slot.
 */
export function FloatingRow({
  group,
  ink,
  turnLabel,
  windowLabel,
  onToggle,
  onOpen,
}: FloatingRowProps) {
  const { colors } = useTheme();
  const finished = group.nextSlot === null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: 11,
        borderRadius: radius.md,
        minHeight: MIN_TARGET,
        backgroundColor: colors.sunken,
        opacity: finished ? 0.55 : 1,
      }}
    >
      <Checkbox
        checked={finished}
        ink={ink}
        disabled={finished}
        onPress={onToggle}
        label={`Mark one ${group.choreTitle} done. ${group.done} of ${group.total} done.`}
      />

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${group.choreTitle}, ${group.done} of ${group.total} done, ${
          turnLabel ?? 'anyone can do it'
        }. Open options.`}
        style={{ flex: 1, gap: 4 }}
      >
        <Txt
          variant="bodyStrong"
          style={finished ? { textDecorationLine: 'line-through' } : undefined}
        >
          {group.choreTitle}
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Pips done={group.done} total={group.total} />
          <Txt variant="small" tone="faint">
            {group.done} of {group.total} · {windowLabel}
          </Txt>
          {turnLabel !== null ? (
            <Chip tone="ink" ink={ink}>
              {turnLabel}
            </Chip>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

/** An uppercase section rule, with an optional count on the right. */
export function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingHorizontal: space.sm,
        paddingTop: space.md,
        paddingBottom: 2,
      }}
    >
      <Txt variant="label" tone="faint" accessibilityRole="header">
        {title}
      </Txt>
      {count !== undefined ? (
        <Txt variant="label" tone="faint">
          {count}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * A second-level heading, for a category nested inside an ownership section.
 *
 * Indented and quieter than `SectionHeader`, so the two levels read as a
 * hierarchy rather than as two competing lists. Carries the category's ink as
 * a dot, which is the cheapest way to make a group recognisable without
 * colouring the text and fighting contrast in one theme or the other.
 */
export function SubHeader({
  title,
  ink,
  count,
}: {
  title: string;
  ink?: string | null;
  count?: number;
}) {
  const { colors, isDark } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingLeft: space.lg,
        paddingRight: space.sm,
        paddingTop: space.sm,
        paddingBottom: 2,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: ink == null ? colors.textFaint : inkColor(ink, isDark),
        }}
      />
      <Txt variant="small" tone="faint" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </Txt>
      {count === undefined ? null : (
        <Txt variant="small" tone="faint">
          {count}
        </Txt>
      )}
    </View>
  );
}
