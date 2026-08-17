/**
 * Copy that belongs to a component rather than to a screen.
 *
 * Lives here so `design/` never reaches up into `features/` — dependencies point
 * inward. See AGENTS.md.
 */

/** `2 days late` / `1 day late` */
export function formatLateness(days: number): string {
  return days === 1 ? '1 day late' : `${days} days late`;
}

/**
 * `missed last time` / `missed last 3 times`
 *
 * The count was already carried on every row and thrown away: the text said
 * "last time" whether one occurrence had been missed or nine, which reads as
 * a one-off when it is a pattern.
 *
 * Still quiet, and still not a reproach — see the overdue rule in
 * DESIGN_SYSTEM.md. A number is the honest amount of information; an
 * exclamation mark would be a judgement.
 */
export function formatMissedBefore(count: number): string {
  return count === 1 ? 'missed last time' : `missed last ${count} times`;
}
