/**
 * One routine item, on one day.
 *
 * A new component rather than a widened `ChoreRow`. That one is typed to
 * `AgendaItem`, and making its prop a union would mean every reader of
 * `assignee`, `missedBefore` and `daysOverdue` needs a narrowing the compiler
 * will happily let you forget on the branch you did not think about. This is
 * eighty lines of the same primitives.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, View } from 'react-native';

import { formatCivilTime } from '@/core/civil/time';
import type { RoutineOccurrence } from '@/core/routines/project';
import { Checkbox, Chip } from '@/design/ChoreRow';
import { Txt } from '@/design/components';
import { toIconName } from '@/design/icons';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';

interface Props {
  item: RoutineOccurrence;
  /** The owner's accent, for the checkbox. */
  ink: string | null;
  /**
   * False for somebody else's routine.
   *
   * Read-only for others is enforced by the database — this only stops the
   * screen offering something the server would refuse.
   */
  canTick: boolean;
  /**
   * Whether a long press picks the row up to reorder it.
   *
   * Off for a housemate's routine and for any day but today: a past day is a
   * record of what happened, and rearranging it would rewrite that.
   */
  /**
   * Picks the row up to reorder it, when it is inside a reorderable list.
   *
   * Passed in rather than taken from `useReorderableDrag` here: this row also
   * renders a housemate's shared routine, which is a plain list with no
   * provider above it, and calling that hook there throws — taking the whole
   * Routines screen down the moment somebody shares.
   */
  onDrag?: (() => void) | undefined;
  onToggle: () => void;
  onOpen?: (() => void) | undefined;
}

export function RoutineRow({ item, ink, canTick, onDrag, onToggle, onOpen }: Props) {
  const { colors } = useTheme();
  const done = item.status === 'completed';
  const missed = item.status === 'missed';
  const icon = toIconName(item.icon);

  const body = (
    <View style={{ flex: 1, gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {icon === null ? null : (
          <View accessibilityElementsHidden importantForAccessibility="no">
            <MaterialCommunityIcons name={icon} size={16} color={colors.textMuted} />
          </View>
        )}
        <Txt variant="bodyStrong" style={done ? { textDecorationLine: 'line-through' } : undefined}>
          {item.title}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        {item.timeOfDay === null ? null : (
          <Txt variant="small" tone="faint">
            {formatCivilTime(item.timeOfDay)}
          </Txt>
        )}
        {/* Stated on the day it belongs to, and never carried into the next
            one — a routine skipped on Tuesday is not work owed on Wednesday. */}
        {missed ? <Chip tone="overdue">Missed</Chip> : null}
        {item.linkedChoreId === null ? null : <Chip>Linked</Chip>}
      </View>
    </View>
  );

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
        opacity: done ? 0.55 : 1,
      }}
    >
      <Checkbox
        checked={done}
        ink={ink}
        disabled={!canTick}
        onPress={onToggle}
        label={done ? `Mark ${item.title} not done` : `Mark ${item.title} done`}
      />

      {onOpen === undefined ? (
        body
      ) : (
        <Pressable
          onPress={onOpen}
          // The drag comes from the same press the row already handles, so a
          // tap still opens the item and a hold picks it up. A separate grab
          // handle would cost a column of width on every row to serve a
          // gesture used once in a while.
          onLongPress={onDrag}
          delayLongPress={220}
          accessibilityRole="button"
          accessibilityLabel={
            onDrag === undefined
              ? `${item.title}. Edit.`
              : `${item.title}. Edit, or hold to reorder.`
          }
          style={{ flex: 1 }}
        >
          {body}
        </Pressable>
      )}
    </View>
  );
}
