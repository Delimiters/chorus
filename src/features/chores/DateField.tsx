/**
 * Picking a civil date.
 *
 * Built from the month grid the Upcoming screen already uses, rather than
 * `@react-native-community/datetimepicker`. Three reasons, in order of weight:
 * the native picker returns a `Date`, which is precisely the type this app
 * refuses to let near a due date; it needs a native module, and Expo Go is the
 * only place this app can run on the dev machine; and the grid is already built
 * and already understands `weekStartsOn`.
 *
 * Quick options first, because "tomorrow" and "next week" cover most of what
 * anybody picks, and neither needs a calendar.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { addDays, compareCivil, startOfWeek } from '@/core/civil/date';
import type { CivilDate, Weekday } from '@/core/civil/types';
import { Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { MonthGrid } from '../upcoming/MonthGrid';
import { formatDayShort, formatRelativeDay } from '../today/format';

interface Props {
  value: CivilDate;
  onChange: (date: CivilDate) => void;
  today: CivilDate;
  label: string;
  weekStartsOn?: Weekday;
  /** Dates before this cannot be chosen. Defaults to allowing any date. */
  earliest?: CivilDate;
}

export function DateField({ value, onChange, today, label, weekStartsOn = 0, earliest }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const quick: readonly { label: string; date: CivilDate }[] = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: addDays(startOfWeek(today, weekStartsOn), 7) },
  ];

  const allowed = (date: CivilDate) => earliest === undefined || compareCivil(date, earliest) >= 0;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {quick
          .filter((option) => allowed(option.date))
          .map((option) => {
            const selected = option.date === value;
            return (
              <Pressable
                key={option.label}
                onPress={() => onChange(option.date)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${label}: ${option.label}`}
                style={{
                  minHeight: 40,
                  justifyContent: 'center',
                  paddingHorizontal: space.md,
                  borderRadius: radius.sm,
                  backgroundColor: selected ? colors.text : colors.sunken,
                }}
              >
                <Txt
                  variant="small"
                  style={{
                    color: selected ? colors.surface : colors.textMuted,
                    fontWeight: selected ? '700' : '500',
                  }}
                >
                  {option.label}
                </Txt>
              </Pressable>
            );
          })}

        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Close the calendar' : 'Pick another date'}
          style={{
            minHeight: 40,
            justifyContent: 'center',
            paddingHorizontal: space.md,
            borderRadius: radius.sm,
            backgroundColor: colors.sunken,
          }}
        >
          <Txt variant="small" tone="muted">
            {open ? '▲ Close' : '▼ Pick a date'}
          </Txt>
        </Pressable>
      </View>

      <View accessibilityLabel={`${label} is ${formatDayShort(value)}`}>
        <Txt variant="small" tone="faint">
          {formatRelativeDay(value, today)} · {formatDayShort(value)}
        </Txt>
      </View>

      {open ? (
        <View
          style={{
            borderRadius: radius.md,
            backgroundColor: colors.sunken,
            paddingHorizontal: space.sm,
            paddingTop: space.sm,
          }}
        >
          <MonthGrid
            anchor={value}
            selected={value}
            today={today}
            weekStartsOn={weekStartsOn}
            marks={EMPTY_MARKS}
            expanded
            onSelect={(date) => {
              if (allowed(date)) onChange(date);
            }}
            onToggleExpanded={() => setOpen(false)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Stable identity, so the grid does not re-memo on every render. */
const EMPTY_MARKS = new Map<string, never>();
