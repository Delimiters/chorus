/**
 * A reminder that keeps asking.
 *
 * Jake: *"Can we make some kind of feature for a super notification? Like where
 * it vibrates continuously or acts like an alarm or sends repeated
 * notifications until it's done?"*
 *
 * ── What iOS will and will not do ─────────────────────────────────────────
 *
 * **Continuous vibration is not available to any third-party app.** A local
 * notification plays one sound and one haptic; there is no "buzz until
 * dismissed" API. Anything claiming otherwise is a sequence of notifications.
 *
 * **A true alarm is available, but not here.** iOS 26 added AlarmKit, which
 * rings full-screen through Silent mode and Focus until somebody stops it —
 * both phones in this household are on 26.6. It needs a Swift module and a
 * Live Activity target, so it is its own piece of work; see
 * `docs/decisions/nagging-reminders.md`.
 *
 * **What is available now** is the third thing he asked for: repeated
 * notifications until the chore is done, each one Time Sensitive so it breaks
 * through a Focus mode. That is this file.
 *
 * ── Why a ladder and not a metronome ─────────────────────────────────────
 *
 * Equal gaps are the obvious shape and the wrong one. Every two minutes for
 * half an hour is fifteen identical buzzes, which trains you to swipe without
 * reading — the failure this whole notification layer is written against. The
 * gaps widen instead: close together while you have just been asked, further
 * apart once it is clear you are busy.
 *
 * Pure and `Date`-free like the rest of `core`: the interesting part is how
 * many notifications a nag costs and where they land, and that is arithmetic.
 */

import { addDays } from '../civil/date';
import type { CivilDate, CivilTime } from '../civil/types';

/**
 * Minutes after the reminder's own time.
 *
 * Six of them, widening. The first is the ordinary reminder, so a nagging chore
 * costs five extra notification slots rather than six.
 *
 * Ends at forty minutes because a nag that is still going an hour later has
 * stopped being a reminder and become the thing you turn the app off for. If
 * forty minutes of asking has not worked, another ten will not.
 */
export const NAG_OFFSETS = [0, 3, 8, 16, 27, 40] as const;

/**
 * How many chores may nag on one day.
 *
 * `MAX_PENDING` is sixty against the operating system's sixty-four, and the
 * planner keeps the *soonest* sixty — so three nagging chores in a morning is
 * eighteen slots of the earliest ones, and a fourth would start pushing real
 * reminders off the end of the queue. Three is enough for "the bins, the meds,
 * and the thing I keep forgetting"; past that the feature is eating the rest of
 * the day's reminders to tell you about the morning's.
 *
 * Chores past the limit still get their single ordinary reminder. The feature
 * degrades to the old behaviour rather than failing.
 */
export const MAX_NAGGING_PER_DAY = 3;

/** Where one nag's notifications land, given its reminder's date and time. */
export interface NagStep {
  readonly onDate: CivilDate;
  readonly atTime: CivilTime;
  /** 0 for the first, counting up — the id and the wording use it. */
  readonly index: number;
}

/**
 * The ladder for one reminder.
 *
 * Minutes are added to a wall-clock time, so a nag that starts at 23:50 runs
 * past midnight and the later steps land on the next date. That is the whole
 * reason this returns dates rather than offsets: a caller adding minutes itself
 * would have produced `24:30`, which the engine's own time parser rejects.
 */
export function nagSteps(onDate: CivilDate, atTime: CivilTime): readonly NagStep[] {
  const [hours, minutes] = atTime.split(':').map(Number) as [number, number];
  const start = hours * 60 + minutes;

  return NAG_OFFSETS.map((offset, index) => {
    const total = start + offset;
    const dayShift = Math.floor(total / (24 * 60));
    const within = total % (24 * 60);
    const hh = String(Math.floor(within / 60)).padStart(2, '0');
    const mm = String(within % 60).padStart(2, '0');

    return {
      onDate: dayShift === 0 ? onDate : addDays(onDate, dayShift),
      atTime: `${hh}:${mm}` as CivilTime,
      index,
    };
  });
}

/**
 * How a nag's later steps read.
 *
 * The first is the ordinary reminder and says what it always said. The rest say
 * they are a repeat, because a notification identical to one from three minutes
 * ago looks like a bug in the app rather than the app doing as it was told.
 */
export function nagBody(base: string, index: number): string {
  if (index === 0) return base;
  return `${base} — still not done`;
}
