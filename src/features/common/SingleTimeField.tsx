/**
 * One time, chosen from a few presets or a wheel.
 *
 * Distinct from `TimeField`, which edits a *list* of reminder times for a
 * chore. This is for the places where exactly one time is the answer and
 * "none" is not an option — the four routine bucket reminders, so far.
 *
 * The presets exist because a bucket reminder is a nudge rather than an alarm:
 * the useful distinction is "morning" or "after work", not 07:12. The wheel is
 * there for anyone who disagrees.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import type { CivilTime } from '@/core/civil/types';
import { Txt } from '@/design/components';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatCivilTime } from '@/core/civil/time';
import { fromPickerDate, toPickerDate } from './TimeField';

interface Props {
  value: CivilTime;
  onChange: (time: CivilTime) => void;
  /** Shown above the row. */
  label: string;
  /** A few one-tap choices sensible for this particular field. */
  presets: readonly CivilTime[];
}

export function SingleTimeField({ value, onChange, label, presets }: Props) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<CivilTime>(value);

  const chip = (
    text: string,
    selected: boolean,
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <Pressable
      key={text}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={{
        minHeight: 36,
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
        {text}
      </Txt>
    </Pressable>
  );

  return (
    <View style={{ gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.xs }}>
      <Txt variant="small" tone="faint">
        {`${label} — ${formatCivilTime(value)}`}
      </Txt>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {presets.map((preset) =>
          chip(
            formatCivilTime(preset),
            preset === value,
            () => onChange(preset),
            `${label} at ${formatCivilTime(preset)}`,
          ),
        )}
        {chip(
          picking ? '× Close' : 'Other…',
          false,
          () => {
            setPicking((open) => !open);
            setDraft(value);
          },
          picking ? `Close the ${label} picker` : `Pick another time for ${label}`,
        )}
      </View>

      {picking ? (
        <View
          style={{
            borderRadius: radius.md,
            backgroundColor: colors.sunken,
            paddingVertical: space.xs,
            alignItems: 'center',
            gap: space.xs,
          }}
        >
          <DateTimePicker
            value={toPickerDate(draft)}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_event, date) => {
              if (date === undefined) return;
              const picked = fromPickerDate(date);
              setDraft(picked);
              // Android's dialog dismisses itself and reports once, so the
              // choice is committed there rather than on a second tap.
              if (Platform.OS !== 'ios') {
                onChange(picked);
                setPicking(false);
              }
            }}
            accessibilityLabel={`Pick a time for ${label}`}
          />
          {Platform.OS === 'ios'
            ? chip(
                `Use ${formatCivilTime(draft)}`,
                false,
                () => {
                  onChange(draft);
                  setPicking(false);
                },
                `Use ${formatCivilTime(draft)} for ${label}`,
              )
            : null}
        </View>
      ) : null}
    </View>
  );
}
