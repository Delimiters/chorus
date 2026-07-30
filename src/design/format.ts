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
