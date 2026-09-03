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
import { MIN_TARGET, radius, space } from '@/design/tokens';
import { MonthGrid } from '../upcoming/MonthGrid';
import { formatDayShort, formatRelativeDay } from '@/features/common/format';

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
  const standard: readonly { label: string; date: CivilDate }[] = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: addDays(startOfWeek(today, weekStartsOn), 7) },
  ];

  /**
   * The date it is actually set to, as a chip, whenever none of the standard
   * ones says it.
   *
   * Without this the row showed three *unselected* chips for a chore due on the
   * 14th, and the only place the real date appeared was a small line underneath
   * — so the control looked like one for choosing a date that had never been
   * chosen. Jake: "the proper date should be highlighted. Idk it should just be
   * very clear."
   *
   * First in the row, because it is the answer and the others are alternatives
   * to it.
   */
  const quick: readonly { label: string; date: CivilDate }[] = standard.some(
    (option) => option.date === value,
  )
    ? standard
    : [{ label: formatDayShort(value), date: value }, ...standard];

  const allowed = (date: CivilDate) => earliest === undefined || compareCivil(date, earliest) >= 0;

  /**
   * Open when the current date is not one of the quick options.
   *
   * The calendar was always collapsed, so opening a chore due on, say, the 14th
   * showed three unselected chips and a "▼ Pick a date" toggle — the chore's
   * actual date was legible only in the small line underneath, and changing it
   * meant finding a control that looked like it was for setting a date rather
   * than for correcting one. Jake: "pick a date should show up automatically
   * when editing a chore if it's due on a specific date."
   *
   * A chore due today or tomorrow still opens collapsed, because there the
   * chips *do* say what the date is.
   */
  const [open, setOpen] = useState(() => !standard.some((option) => option.date === value));

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {quick
          // The current value is always shown, even when it is before
          // `earliest`: a chip for the date something is *actually* set to is
          // information, not an offer, and filtering it out returned the field
          // to three unselected chips over an invisible date.
          .filter((option) => option.date === value || allowed(option.date))
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
                  minHeight: MIN_TARGET,
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
            minHeight: MIN_TARGET,
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

      {/* "Sun 9 Aug · Sun 9 Aug" — `formatRelativeDay` falls back to the same
          short date once a day is more than a week out, so the two halves
          collapse into one and the separator has nothing to separate. */}
      <View accessibilityLabel={`${label} is ${formatDayShort(value)}`}>
        <Txt variant="small" tone="faint">
          {formatRelativeDay(value, today) === formatDayShort(value)
            ? formatDayShort(value)
            : `${formatRelativeDay(value, today)} · ${formatDayShort(value)}`}
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
