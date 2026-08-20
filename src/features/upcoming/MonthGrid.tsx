/**
 * The month grid.
 *
 * This earns its place in a way a calendar wouldn't in an ordinary planner:
 * **the dots make the rotation visible.** Trash reads in one person's ink for a
 * week, then another's — you can see the hand-over coming without reading a
 * word, which is the one thing this app knows that a to-do list doesn't.
 *
 * Collapsed it is a week strip; expanded, the full month. See
 * docs/DESIGN_SYSTEM.md.
 */

import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import {
  addDays,
  daysInMonth,
  endOfMonth,
  partsOf,
  startOfMonth,
  startOfWeek,
} from '@/core/civil/date';
import type { CivilDate, Weekday } from '@/core/civil/types';
import { inkColor } from '@/design/inks';
import { Txt } from '@/design/components';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';
import { dayOfMonth, monthName, weekdayShort } from '@/features/common/format';

/** One dot per chore on a day, in the owner's ink. */
export interface DayMark {
  readonly date: CivilDate;
  /** Ink names, or null for "anyone". At most a few — the rest are elided. */
  readonly inks: readonly (string | null)[];
}

const MAX_DOTS = 3;
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  /** Anchor date; the grid shows this date's month, or its week when collapsed. */
  anchor: CivilDate;
  selected: CivilDate;
  today: CivilDate;
  weekStartsOn: Weekday;
  marks: ReadonlyMap<string, DayMark>;
  expanded: boolean;
  onSelect: (date: CivilDate) => void;
  onToggleExpanded: () => void;
}

export function MonthGrid({
  anchor,
  selected,
  today,
  weekStartsOn,
  marks,
  expanded,
  onSelect,
  onToggleExpanded,
}: Props) {
  const { colors, isDark } = useTheme();

  /** Whole weeks covering the month (or just the one week when collapsed). */
  const weeks = useMemo(() => {
    if (!expanded) return [buildWeek(startOfWeek(selected, weekStartsOn))];

    const first = startOfWeek(startOfMonth(anchor), weekStartsOn);
    const last = endOfMonth(anchor);
    const rows: CivilDate[][] = [];
    let cursor = first;
    // Six rows is the maximum any month can span.
    for (let i = 0; i < 6; i += 1) {
      rows.push(buildWeek(cursor));
      cursor = addDays(cursor, 7);
      if (cursor > last) break;
    }
    return rows;
  }, [anchor, selected, weekStartsOn, expanded]);

  const anchorMonth = partsOf(anchor).month;
  const headings = useMemo(
    () => Array.from({ length: 7 }, (_, i) => WEEKDAY_INITIALS[(weekStartsOn + i) % 7] as string),
    [weekStartsOn],
  );

  return (
    <View style={{ paddingBottom: space.sm }}>
      {expanded ? (
        <View style={{ paddingHorizontal: space.sm, paddingBottom: space.xs }}>
          <Txt variant="label" tone="faint">
            {monthName(anchor)} {partsOf(anchor).year}
          </Txt>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
        {headings.map((initial, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Txt variant="label" tone="faint" style={{ fontSize: 9, letterSpacing: 0.5 }}>
              {initial}
            </Txt>
          </View>
        ))}
      </View>

      {weeks.map((week, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {week.map((date) => {
            const isSelected = date === selected;
            const isToday = date === today;
            const outsideMonth = expanded && partsOf(date).month !== anchorMonth;
            const mark = marks.get(date);

            return (
              <Pressable
                key={date}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${weekdayShort(date)} ${dayOfMonth(date)}${
                  mark
                    ? `, ${mark.inks.length} chore${mark.inks.length === 1 ? '' : 's'}`
                    : ', nothing due'
                }`}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: radius.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? colors.text : 'transparent',
                  }}
                >
                  <Txt
                    variant="mono"
                    style={{
                      fontSize: 12,
                      color: isSelected
                        ? colors.surface
                        : outsideMonth
                          ? colors.textFaint
                          : isToday
                            ? colors.inkA
                            : colors.textMuted,
                      fontWeight: isToday || isSelected ? '700' : '600',
                      opacity: outsideMonth ? 0.4 : 1,
                    }}
                  >
                    {dayOfMonth(date)}
                  </Txt>
                </View>

                {/* Dots below the number, one per chore, in the owner's ink. */}
                <View style={{ flexDirection: 'row', gap: 2, height: 5, marginTop: 1 }}>
                  {(mark?.inks ?? []).slice(0, MAX_DOTS).map((ink, i) => (
                    <View
                      key={i}
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: isSelected
                          ? colors.surface
                          : ink === null
                            ? colors.textFaint
                            : inkColor(ink, isDark),
                      }}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      {/*
        A real control, not a nine-point caption with a glyph in it. The old
        one was the size of a footnote and had to be aimed at.
      */}
      <Pressable
        onPress={onToggleExpanded}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Collapse to one week' : 'Expand to the whole month'}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          minHeight: MIN_TARGET,
        }}
      >
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={colors.textMuted}
        />
        <Txt variant="small" tone="faint">
          {expanded ? 'Week' : 'Month'}
        </Txt>
      </Pressable>
    </View>
  );
}

function buildWeek(start: CivilDate): CivilDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Days in a month, for sizing a query window. */
export function monthLength(date: CivilDate): number {
  const { year, month } = partsOf(date);
  return daysInMonth(year, month);
}
