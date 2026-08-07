/**
 * The reminder times both the Settings default and the per-chore override
 * offer.
 *
 * Shared so the two cannot drift: a chore set to "7pm" and a default labelled
 * "7pm" must mean the same instant, and two hand-maintained lists is how that
 * stops being true.
 *
 * Five fixed times, and coarse on purpose. A chore reminder is not an alarm —
 * the useful distinction is morning or evening, not 07:12 — and a fixed set
 * needs no native time picker, which this app avoids for the reasons in
 * docs/RELEASE.md.
 */

export const REMINDER_TIMES: readonly { value: string; label: string }[] = [
  { value: '07:00', label: '7am' },
  { value: '09:00', label: '9am' },
  { value: '12:00', label: 'Noon' },
  { value: '17:00', label: '5pm' },
  { value: '19:00', label: '7pm' },
];
