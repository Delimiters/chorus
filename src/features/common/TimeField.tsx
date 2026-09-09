/**
 * When a chore's reminders fire.
 *
 * A list, because one chore can deserve two nudges — a reminder in the morning
 * and a nag in the evening — and the alternative, a second chore with the same
 * name, would split the completion history that makes the stats meaningful.
 *
 * Empty means "follow the phone default", which is the common case. The
 * shortcuts are two, not five: with more, the row needed a horizontal scroller
 * and the wheel sat off the edge, so the control that does everything was the
 * one you could not see.
 *
 * **Opening the wheel adds the reminder; spinning it moves that reminder.**
 * It used to be a two-step — spin, then press "Add 19:00" — and the second step
 * was easy to miss, so a time that had visibly been chosen was silently
 * discarded on save. Jake: *"for add reminder, once I set the time I should be
 * good to go, and I should only have to press another button if I need to add
 * ANOTHER reminder."* The chip above the wheel is therefore live: it appears at
 * the default the moment the wheel opens and follows every turn of it.
 *
 * Which means the wheel must remember *which* chip is its own — `pending` — or
 * spinning from 09:00 to 09:05 would leave both behind, and a slow scroll
 * through the hour would leave a dozen.
 *
 * The picker deals in `Date` because the OS does. That never escapes this
 * file: values arrive and leave as `CivilTime`, converted at the boundary. A
 * reminder at 7pm is a fact about the clock on the wall rather than a moment,
 * and the conversion lives here so the rest of the app can keep believing it.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { formatCivilTime, parseCivilTime } from '@/core/civil/time';
import type { CivilTime } from '@/core/civil/types';
import { Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { QUICK_TIMES } from '@/design/times';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';

/**
 * A `Date` carrying the given wall time, on a day that does not matter.
 *
 * Only hours and minutes are read back. The date part is today so the wheel
 * opens somewhere sensible rather than in 1970.
 */
/** Shared with SingleTimeField, so the two cannot disagree about a time. */
export function toPickerDate(time: CivilTime): Date {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
}

export function fromPickerDate(date: Date): CivilTime {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  // Through the parser rather than trusting the format, so the app has exactly
  // one definition of a valid CivilTime.
  return parseCivilTime(`${hh}:${mm}`) ?? ('09:00' as CivilTime);
}

/** Sorted and deduplicated, matching what the schema stores. */
function withTime(times: readonly CivilTime[], time: CivilTime): readonly CivilTime[] {
  return [...new Set([...times, time])].sort() as readonly CivilTime[];
}

interface Props {
  value: readonly CivilTime[];
  onChange: (value: readonly CivilTime[]) => void;
  /** The device default, so the hint can name it rather than say "the default". */
  defaultTime: CivilTime;
  /** Why this chore would never remind you, or null if it would. */
  silence?: string | null;
  /** Puts the form back at this control when the wheel closes. */
  onCollapse?: () => void;
}

export function TimeField({ value, onChange, defaultTime, silence = null, onCollapse }: Props) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState(false);
  /** The time this wheel has already added, so spinning moves it rather than piling up. */
  const [pending, setPending] = useState<CivilTime | null>(null);

  const openWheel = () => {
    setPicking(true);
    setPending(defaultTime);
    onChange(withTime(value, defaultTime));
  };

  const closeWheel = () => {
    setPicking(false);
    setPending(null);
    onCollapse?.();
  };

  return (
    <FieldGroup
      label="Remind at"
      hint={
        value.length === 0
          ? `Follows this phone's setting, currently ${formatCivilTime(defaultTime)}. Change it in Settings.`
          : 'Only this chore. Everything else follows the phone default.'
      }
    >
      <View style={{ gap: space.sm }}>
        {silence === null ? null : (
          <Txt variant="small" tone="danger">
            {silence}
          </Txt>
        )}

        {/* The times already chosen. Tapping one removes it, which is also the
            only way back to "follow the default" once any has been picked. */}
        {value.length === 0 ? null : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {value.map((time) => (
              <Pressable
                key={time}
                onPress={() => onChange(value.filter((t) => t !== time))}
                accessibilityRole="button"
                accessibilityLabel={`Remove the reminder at ${formatCivilTime(time)}`}
                style={{
                  minHeight: MIN_TARGET,
                  justifyContent: 'center',
                  paddingHorizontal: space.md,
                  borderRadius: radius.sm,
                  backgroundColor: colors.text,
                }}
              >
                <Txt variant="small" style={{ color: colors.surface, fontWeight: '700' }}>
                  {`${formatCivilTime(time)}  ×`}
                </Txt>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {QUICK_TIMES.filter((preset) => !value.includes(preset.value as CivilTime)).map(
            (preset) => (
              <AddButton
                key={preset.value}
                label={`+ ${preset.label}`}
                accessibilityLabel={`Add a reminder at ${preset.label}`}
                onPress={() => onChange(withTime(value, preset.value as CivilTime))}
              />
            ),
          )}
          {/* "Done" rather than "Close": the reminder is already set, so this
              only tidies the wheel away. Pressing it is never required. */}
          <AddButton
            label={picking ? 'Done' : value.length === 0 ? '+ Pick a time' : '+ Add another'}
            accessibilityLabel={picking ? 'Close the time picker' : 'Pick a reminder time'}
            onPress={() => (picking ? closeWheel() : openWheel())}
          />
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
              value={toPickerDate(pending ?? defaultTime)}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                if (date === undefined) return;
                const picked = fromPickerDate(date);
                // Move this wheel's own reminder rather than adding a second
                // one. Without the filter, every notch of the spinner would
                // leave a chip behind.
                onChange(
                  withTime(
                    value.filter((t) => t !== pending),
                    picked,
                  ),
                );
                setPending(picked);
                // Android's dialog dismisses itself and reports once.
                if (Platform.OS !== 'ios') closeWheel();
              }}
              accessibilityLabel="Pick a reminder time"
            />
          </View>
        ) : null}
      </View>
    </FieldGroup>
  );
}

function AddButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        minHeight: MIN_TARGET,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.sm,
        backgroundColor: colors.sunken,
      }}
    >
      <Txt variant="small" tone="muted">
        {label}
      </Txt>
    </Pressable>
  );
}
