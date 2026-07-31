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

import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import type { AgendaItem, FloatingGroup } from '@/core/occurrence/agenda';
import { inkColor, inkSoft } from './inks';
import { useTheme } from './theme';
import { MIN_TARGET, radius, space } from './tokens';
import { Txt } from './components';
import { formatLateness } from './format';

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
  onToggle: () => void;
  onOpen: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ChoreRow({
  item,
  ink,
  turnLabel,
  scheduleLabel,
  onToggle,
  onOpen,
  style,
}: ChoreRowProps) {
  const { colors } = useTheme();
  const done = item.status === 'completed';
  const overdue = item.status === 'overdue';

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.md,
          paddingHorizontal: space.md,
          paddingVertical: 11,
          borderRadius: radius.md,
          minHeight: MIN_TARGET,
          // Overdue is an outline, not a red wash. A red list makes an ordinary
          // Tuesday feel like an incident.
          backgroundColor: overdue ? 'transparent' : colors.sunken,
          borderWidth: overdue ? 1 : 0,
          borderColor: colors.overdue,
          opacity: done ? 0.55 : 1,
        },
        style,
      ]}
    >
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
        <Txt variant="bodyStrong" style={done ? { textDecorationLine: 'line-through' } : undefined}>
          {item.choreTitle}
        </Txt>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {overdue ? <Chip tone="overdue">{formatLateness(item.daysOverdue)}</Chip> : null}

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
              · missed last time
            </Txt>
          ) : null}
        </View>
      </Pressable>
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
