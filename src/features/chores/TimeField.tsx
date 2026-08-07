/**
 * When a chore's reminder fires.
 *
 * The engine has honoured `schedule.timeOfDay` since Phase 7 and the reminder
 * planner falls back to the device default when it is null — but nothing ever
 * *set* it. The column existed, the planner read it, the tests covered it, and
 * no screen wrote it. Settings even advertised the gap, with "used when a chore
 * has no time of its own" under a control for the fallback.
 *
 * The same presets as the Settings default, plus "Default" for null, so the two
 * screens agree and neither needs a native time picker. Five fixed times is
 * coarse, and deliberately: a chore reminder is not an alarm, and the point is
 * "morning or evening", not 07:12.
 */

import type { CivilTime } from '@/core/civil/types';
import { FieldGroup, SegmentedControl } from '@/design/controls';
import { REMINDER_TIMES } from '@/design/times';

/** Null is "use whatever this phone's default is", not "never remind me". */
const DEFAULT_VALUE = 'default';

const CHOICES: readonly { value: string; label: string }[] = [
  { value: DEFAULT_VALUE, label: 'Default' },
  ...REMINDER_TIMES,
];

interface Props {
  value: CivilTime | null;
  onChange: (value: CivilTime | null) => void;
  /** The device default, so the hint can name it rather than say "the default". */
  defaultTime: CivilTime;
}

export function TimeField({ value, onChange, defaultTime }: Props) {
  const label = REMINDER_TIMES.find((t) => t.value === defaultTime)?.label ?? defaultTime;

  return (
    <FieldGroup
      label="Remind at"
      hint={
        value === null
          ? `Follows this phone's setting, currently ${label}. Change it in Settings.`
          : 'Only this chore. Everything else follows the phone default.'
      }
    >
      <SegmentedControl
        segments={CHOICES}
        value={value ?? DEFAULT_VALUE}
        onChange={(next) => onChange(next === DEFAULT_VALUE ? null : (next as CivilTime))}
        label="Reminder time"
        scrollable
      />
    </FieldGroup>
  );
}
