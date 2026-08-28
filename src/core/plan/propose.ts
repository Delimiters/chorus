/**
 * "Here's a day."
 *
 * An empty plan asks the person to do the work; a pre-filled one recreates the
 * wall of twenty with extra steps. The way out is a third option: the app
 * *proposes* five or six things and they accept it in one tap, or edit it, or
 * throw it away.
 *
 * That is also the only shape that satisfies both halves of what Emily asked
 * for — *"it says it's your turn on this day at this time, not an enormous
 * amount of options"* (directive) and *"an area where i can like select chores
 * and add them to TODAY's schedule"* (chosen). Directive by default, editable
 * always.
 *
 * ── The riskiest part of the whole redesign ───────────────────────────────
 *
 * If the proposal is bad — if it keeps offering "pull out beanie babies" while
 * the labs sit in the backlog — then "Start the day" becomes a button nobody
 * trusts, and she is back to picking fifty things by hand with an extra screen
 * in the way. The ranking matters more than any of the screens, which is why
 * it is deliberately simple, explainable, and entirely tested: every score
 * here is a sentence somebody could argue with.
 */

import type { CivilDate } from '../civil/types';
import { compareCivil } from '../civil/date';

/** Everything the ranking looks at. The screen's rows carry much more. */
export interface Candidate {
  readonly occurrenceKey: string;
  readonly choreId: string;
  readonly choreTitle: string;
  readonly dueOn: CivilDate;
  readonly status: string;
  readonly daysOverdue: number;
  /** How many consecutive times this has already been missed. */
  readonly missedBefore: number;
  /** True when it repeats — a chore rather than a one-off task. */
  readonly recurring: boolean;
}

export interface Proposal {
  readonly items: readonly Candidate[];
  /** Why this is the day being offered, in one line. */
  readonly reason: string;
}

/**
 * How many things a day holds.
 *
 * Five, and the number is the entire product. An app that says "here is a day"
 * is doing the job; one that says "here are fifty true facts" is not — and
 * fifty true facts is precisely what made her close it. Deliberately a constant
 * rather than a setting: a slider labelled "how much can you do today" is
 * another decision at the moment the app is supposed to be removing them.
 */
export const DAY_SIZE = 5;

/**
 * Scored high to low. Every term is a claim about what matters, in order.
 *
 * The weights are spread far enough apart that the ordering between reasons is
 * fixed rather than emergent: a flagged chore always outranks a merely late
 * one, whatever the arithmetic underneath. Emergent orderings are the kind
 * nobody can explain three months later.
 */
function score(
  candidate: Candidate,
  flagged: ReadonlySet<string>,
  leftOver: ReadonlySet<string>,
): number {
  let points = 0;

  // You already decided this mattered and did not get to it. A stronger signal
  // than anything the app can compute about it.
  if (leftOver.has(candidate.occurrenceKey)) points += 1000;

  // You said so, this week, in as many words.
  if (flagged.has(candidate.choreId)) points += 500;

  /*
   * Lateness, capped.
   *
   * Uncapped, a chore three months overdue would outrank everything for the
   * rest of its life — and something ignored for three months is usually
   * something that needs deleting rather than doing. Thirty days of credit is
   * enough to float it near the top without letting it own the screen.
   */
  points += Math.min(candidate.daysOverdue, 30) * 10;

  /*
   * Repeatedly missed, which is different from very late.
   *
   * A weekly chore missed four times running is a small persistent failure the
   * list is not surfacing, and it will keep happening until something changes.
   */
  points += Math.min(candidate.missedBefore, 5) * 25;

  /*
   * One-off work outranks recurring work at the same lateness.
   *
   * "plant garden bed is not the same priority as car registration". Missing
   * the litter box is recoverable and it comes back tomorrow; missing the car
   * inspection *is* the failure. Recurring volume is exactly what buries
   * one-off stakes on the backlog, and the proposal is where that stops.
   */
  if (!candidate.recurring) points += 60;

  return points;
}

/**
 * The day to offer.
 *
 * `leftOver` is yesterday's unfinished plan; `flagged` is what either of you
 * marked this week. Anything already planned or already finished must be
 * filtered out by the caller — this ranks what it is given.
 */
export function proposeDay(
  candidates: readonly Candidate[],
  options: {
    readonly flagged: ReadonlySet<string>;
    readonly leftOver: ReadonlySet<string>;
    readonly size?: number;
  },
): Proposal {
  const size = options.size ?? DAY_SIZE;

  const ranked = [...candidates].sort((a, b) => {
    const byScore =
      score(b, options.flagged, options.leftOver) - score(a, options.flagged, options.leftOver);
    if (byScore !== 0) return byScore;
    // Then the older due date, then the title — so the same list always
    // produces the same day, and a tie is never resolved by array order.
    const byDue = compareCivil(a.dueOn, b.dueOn);
    return byDue !== 0 ? byDue : a.choreTitle.localeCompare(b.choreTitle);
  });

  const items = ranked.slice(0, size);
  return { items, reason: describe(items, options) };
}

/**
 * One line saying why this is the day.
 *
 * Counted from what was actually chosen rather than asserted: a proposal that
 * says "2 late" while showing none is worse than saying nothing, and it is the
 * first thing that would rot as the weights change.
 */
function describe(
  items: readonly Candidate[],
  options: { readonly flagged: ReadonlySet<string>; readonly leftOver: ReadonlySet<string> },
): string {
  if (items.length === 0) return 'Nothing needs doing today.';

  const parts: string[] = [];
  const left = items.filter((i) => options.leftOver.has(i.occurrenceKey)).length;
  const flagged = items.filter(
    (i) => options.flagged.has(i.choreId) && !options.leftOver.has(i.occurrenceKey),
  ).length;
  const late = items.filter(
    (i) =>
      i.daysOverdue > 0 &&
      !options.leftOver.has(i.occurrenceKey) &&
      !options.flagged.has(i.choreId),
  ).length;
  const rest = items.length - left - flagged - late;

  if (left > 0) parts.push(`${left} from yesterday`);
  if (flagged > 0) parts.push(`${flagged} you flagged`);
  if (late > 0) parts.push(`${late} late`);
  if (rest > 0) parts.push(`${rest} due`);

  return parts.join(', ');
}
