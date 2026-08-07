/**
 * When a chore's reminder fires.
 *
 * The engine has honoured `schedule.timeOfDay` since reminders were built and
 * the planner falls back to the device default when it is null — but nothing
 * ever *set* it. The column existed, the planner read it, the tests covered it,
 * and no screen wrote it.
 *
 * Presets plus exact entry, rather than one or the other. The presets cover
 * what people actually pick and cost one tap; the field is there because
 * "7pm or nothing" is a strange thing for an app to insist on, and a chore
 * that has to happen at 6:45 is not an unusual chore.
 *
 * No native time picker. `@react-native-community/datetimepicker` returns a
 * `Date` — the one type this app refuses to let near a schedule — and, more
 * decisively, it is a native module, which would stop the app running in Expo
 * Go at all. SDK 54 was chosen specifically to keep that path open
 * (docs/RELEASE.md), so giving it up is a call worth making deliberately
 * rather than in passing to gain a wheel.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { formatCivilTime, parseCivilTime } from '@/core/civil/time';
import type { CivilTime } from '@/core/civil/types';
import { Field, Txt } from '@/design/components';
import { FieldGroup, SegmentedControl } from '@/design/controls';
import { REMINDER_TIMES } from '@/design/times';
import { space } from '@/design/tokens';

/** Null is "use whatever this phone's default is", not "never remind me". */
const DEFAULT_VALUE = 'default';
const EXACT_VALUE = 'exact';

const CHOICES: readonly { value: string; label: string }[] = [
  { value: DEFAULT_VALUE, label: 'Default' },
  ...REMINDER_TIMES,
  { value: EXACT_VALUE, label: 'Exact…' },
];

const isPreset = (time: CivilTime): boolean => REMINDER_TIMES.some((p) => p.value === time);

interface Props {
  value: CivilTime | null;
  onChange: (value: CivilTime | null) => void;
  /** The device default, so the hint can name it rather than say "the default". */
  defaultTime: CivilTime;
}

export function TimeField({ value, onChange, defaultTime }: Props) {
  /**
   * Exact mode sticks once chosen, and is inferred on open for a chore whose
   * time is not one of the presets — otherwise editing "6:45pm" would show the
   * segmented control sitting on nothing, with no clue where the time went.
   */
  const [exact, setExact] = useState(value !== null && !isPreset(value));
  const [typed, setTyped] = useState(value === null ? '' : formatCivilTime(value));

  const selected = value === null ? DEFAULT_VALUE : exact ? EXACT_VALUE : value;

  const parsed = parseCivilTime(typed);
  const showError = typed.trim().length > 0 && parsed === null;

  const choose = (next: string) => {
    if (next === DEFAULT_VALUE) {
      setExact(false);
      onChange(null);
      return;
    }
    if (next === EXACT_VALUE) {
      setExact(true);
      // Seed from whatever is already chosen, so switching to exact starts
      // from the current time rather than from an empty box.
      if (value !== null) setTyped(formatCivilTime(value));
      return;
    }
    setExact(false);
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
        <SegmentedControl
          segments={CHOICES}
          value={selected}
          onChange={choose}
          label="Reminder time"
          scrollable
        />

        {exact ? (
          <View style={{ gap: space.xs }}>
            <Field
              label="Exact time"
              value={typed}
              onChangeText={(next) => {
                setTyped(next);
                // Committed only when it reads as a time, so the chore keeps
                // its previous value while a half-typed one is on screen.
                const time = parseCivilTime(next);
                if (time !== null) onChange(time);
              }}
              placeholder="6:45 pm"
              autoCapitalize="none"
              {...(showError ? { error: 'Try something like 6:45pm or 18:45.' } : {})}
            />
            {parsed === null ? null : (
              <Txt variant="small" tone="faint">
                {formatCivilTime(parsed)}
              </Txt>
            )}
          </View>
        ) : null}
      </View>
    </FieldGroup>
  );
}
