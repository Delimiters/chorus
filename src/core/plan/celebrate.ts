/**
 * What finishing a day is worth.
 *
 * A backlog has no end, so every session stops in the middle and feels like
 * failure. A plan can be finished, and being able to say "you're done" is most
 * of the argument for having built one. This decides how loudly to say it.
 *
 * ── Two tiers, because unconditional confetti is a toll ───────────────────
 *
 * A burst on every finished day is delightful in week one and an obstacle by
 * week four: anything that fires unconditionally stops being a reward and
 * becomes the price of finishing. So an ordinary day gets a quiet moment, and
 * the loud one is kept for days that actually differ from yesterday.
 *
 * Pure and `Date`-free. The screen decides how to render a `Celebration`; this
 * decides only which one is true.
 */

export type CelebrationTone = 'quiet' | 'loud';

export interface Celebration {
  readonly tone: CelebrationTone;
  /** The headline. Never generic — it names what actually happened. */
  readonly headline: string;
  /** A second line, or null when the headline says enough. */
  readonly detail: string | null;
}

export interface DayFinished {
  readonly planned: number;
  /** The largest `daysOverdue` among the things finished. */
  readonly worstLateness: number;
  /** The title carrying that lateness, when there is one. */
  readonly latestTitle: string | null;
  /** True only when the other person had a plan and has also cleared it. */
  readonly bothFinished: boolean;
  /** How many they finished, for the shared headline. */
  readonly theirCount: number;
}

/** Six or more is a day that was genuinely hard rather than merely done. */
const HEAVY_DAY = 6;

/** A week late is a different kind of relief from a chore done on time. */
const BADLY_LATE = 7;

/**
 * Which celebration this day has earned.
 *
 * Returns null when there is nothing to celebrate — including, deliberately,
 * an empty plan. "Everything is done" is vacuously true of a day nobody
 * planned, and congratulating somebody for choosing nothing would make the
 * moment worthless on the days it is earned.
 */
export function celebrationFor(day: DayFinished): Celebration | null {
  if (day.planned === 0) return null;

  /*
   * Both of you, first.
   *
   * The best trigger available and the only one a shared household app can
   * offer that a solo list cannot — which is most of why it is worth having
   * over a personal to-do app.
   */
  if (day.bothFinished) {
    return {
      tone: 'loud',
      headline: 'You both finished.',
      detail: `${day.planned + day.theirCount} things between you.`,
    };
  }

  if (day.worstLateness >= BADLY_LATE && day.latestTitle !== null) {
    return {
      tone: 'loud',
      headline: "That's today.",
      // Naming the hard one is the whole difference between being noticed and
      // being praised. The app already knows which it was.
      detail: `Including ${day.latestTitle} — ${day.worstLateness} days late.`,
    };
  }

  if (day.planned >= HEAVY_DAY) {
    return {
      tone: 'loud',
      headline: "That's today.",
      detail: `All ${day.planned} of them. That was a lot.`,
    };
  }

  return {
    tone: 'quiet',
    headline: "That's today.",
    detail:
      day.planned === 1 ? 'One thing, done.' : `All ${day.planned}, done. Nothing else is planned.`,
  };
}
