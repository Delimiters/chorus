/**
 * How much a chore matters.
 *
 * Three levels, not five. Five sounds more expressive and is not: the middle
 * three blur together, people stop distinguishing them, and the field becomes
 * noise. Three survives contact with a household that is not thinking about
 * taxonomy while adding "take the bins out".
 *
 * Priority is independent of category. A chore can be a kitchen chore *and*
 * crucial, which is precisely why these are two axes and not one ordered list.
 *
 * Nothing here affects scheduling. Priority changes the order rows appear in,
 * never which occurrences exist or when they are due.
 */

/** Ordered most to least important. The array order *is* the sort order. */
export const PRIORITIES = ['crucial', 'normal', 'minor'] as const;

export type Priority = (typeof PRIORITIES)[number];

/**
 * What a chore gets when nobody chooses.
 *
 * `normal` rather than `crucial` so that adding a chore without thinking about
 * priority does not quietly inflate it, and so every chore that existed before
 * this feature is already valid without a backfill.
 */
export const DEFAULT_PRIORITY: Priority = 'normal';

/** Position in `PRIORITIES`. Lower sorts first. */
export function priorityRank(priority: Priority): number {
  return PRIORITIES.indexOf(priority);
}

/** Comparator: most important first. */
export function comparePriority(a: Priority, b: Priority): number {
  return priorityRank(a) - priorityRank(b);
}

/**
 * Narrows an unknown value, for data crossing the database boundary.
 *
 * The column has a CHECK constraint, so this should never reject in practice.
 * It exists so that a row written by some future version with a fourth level
 * degrades to `normal` instead of corrupting a sort.
 */
export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

/** Reads a priority off untrusted data, falling back to the default. */
export function toPriority(value: unknown): Priority {
  return isPriority(value) ? value : DEFAULT_PRIORITY;
}

/** Human label, for section headers and the picker. */
export function describePriority(priority: Priority): string {
  switch (priority) {
    case 'crucial':
      return 'Crucial';
    case 'normal':
      return 'Normal';
    case 'minor':
      return 'Minor';
  }
}
