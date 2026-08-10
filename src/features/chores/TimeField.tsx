/**
 * When a chore's reminder fires.
 *
 * A real wheel, not a text box. Typing "6:45pm" works and nobody wants to do
 * it; the presets cover the common answers in one tap and the wheel covers
 * everything else, the way iOS has taught people to expect.
 *
 * This is the project's first native module, and it costs something.
 * `@react-native-community/datetimepicker` cannot load in Expo Go, so that
 * path is gone. It was already vestigial — every build since local signing
 * started has gone straight to a phone — but it is a real trade rather than a
 * free upgrade, and docs/RELEASE.md says so.
 *
 * The picker deals in `Date` because the OS does. That never escapes this
 * file: the value arrives and leaves as a `CivilTime`, so nothing downstream
 * sees an instant. A reminder at 7pm is a fact about the clock on the wall
 * rather than a moment, and the conversion lives here precisely so the rest of
 * the app can keep believing that.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { formatCivilTime, parseCivilTime } from '@/core/civil/time';
import type { CivilTime } from '@/core/civil/types';
import { Txt } from '@/design/components';
import { FieldGroup, SegmentedControl } from '@/design/controls';
import { REMINDER_TIMES } from '@/design/times';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

/** Null is "use whatever this phone's default is", not "never remind me". */
const DEFAULT_VALUE = 'default';
const PICK_VALUE = 'pick';

const CHOICES: readonly { value: string; label: string }[] = [
  { value: DEFAULT_VALUE, label: 'Default' },
  ...REMINDER_TIMES,
  { value: PICK_VALUE, label: 'Pick…' },
];

const isPreset = (time: CivilTime): boolean => REMINDER_TIMES.some((p) => p.value === time);

/**
 * A `Date` carrying the given wall time, on a day that does not matter.
 *
 * Only hours and minutes are ever read back. The date part is today so the
 * wheel opens somewhere sensible rather than in 1970.
 */
function toPickerDate(time: CivilTime): Date {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
}

function fromPickerDate(date: Date): CivilTime {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  // Through the parser rather than trusting the format, so the app has exactly
  // one definition of a valid CivilTime.
  return parseCivilTime(`${hh}:${mm}`) ?? ('09:00' as CivilTime);
}

interface Props {
  value: CivilTime | null;
  onChange: (value: CivilTime | null) => void;
  /** The device default, so the hint can name it rather than say "the default". */
  defaultTime: CivilTime;
  /**
   * Why this chore would never remind you, or null if it would.
   *
   * Shown here because this is where the silence was: a chore assigned to
   * "anyone", with unassigned chores excluded by default, is never scheduled —
   * so setting a time did nothing and said nothing.
   */
  silence?: string | null;
}

export function TimeField({ value, onChange, defaultTime, silence = null }: Props) {
  const { colors } = useTheme();

  /**
   * Whether the wheel is showing. Inferred on open for a chore whose time is
   * not a preset, or the segmented control would sit on nothing and the time
   * would look lost.
   */
  const [picking, setPicking] = useState(value !== null && !isPreset(value));

  const selected = value === null ? DEFAULT_VALUE : picking ? PICK_VALUE : value;

  const choose = (next: string) => {
    if (next === DEFAULT_VALUE) {
      setPicking(false);
      onChange(null);
      return;
    }
    if (next === PICK_VALUE) {
      setPicking(true);
      // Seed from the device default so the wheel opens on something real and
      // the chore immediately has the time the wheel is showing.
      if (value === null) onChange(defaultTime);
      return;
    }
    setPicking(false);
    onChange(next as CivilTime);
  };

  return (
    <FieldGroup
      label="Remind at"
      hint={
        value === null
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

        <SegmentedControl
          segments={CHOICES}
          value={selected}
          onChange={choose}
          label="Reminder time"
          scrollable
        />

        {picking ? (
          <View
            style={{
              borderRadius: radius.md,
              backgroundColor: colors.sunken,
              paddingVertical: space.xs,
              alignItems: 'center',
            }}
          >
            <DateTimePicker
              value={toPickerDate(value ?? defaultTime)}
              mode="time"
              // The wheel rather than the compact tap-to-expand field: this is
              // already inside a disclosure, and nesting another would put the
              // time two taps away for nothing.
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                if (date !== undefined) onChange(fromPickerDate(date));
                // Android's dialog dismisses itself; leaving `picking` true
                // there would reopen it on the next render.
                if (Platform.OS !== 'ios') setPicking(false);
              }}
              accessibilityLabel="Pick a reminder time"
            />
          </View>
        ) : null}

        {value === null ? null : (
          <Txt variant="small" tone="muted">
            {formatCivilTime(value)}
          </Txt>
        )}
      </View>
    </FieldGroup>
  );
}
