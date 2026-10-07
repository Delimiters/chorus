import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHORE_NOTES_MAX,
  CHORE_TITLE_MAX,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  ROUTINE_TITLE_MAX,
  SUBTASK_TITLE_MAX,
} from './limits';

/**
 * Every cap here has to equal the CHECK that enforces it.
 *
 * Not a tautology. This exact pair has drifted twice: the chore title was raised
 * in the input, the constant and the migration while the screen's save gate and
 * the API layer stayed at 120, so a 150-character name typed fine and then could
 * not be saved — with the whole suite green. A number duplicated across
 * TypeScript and SQL has nothing keeping it honest.
 *
 * The bounds are read out of the migrations rather than written down twice here,
 * so raising a CHECK without its constant fails, and so does the reverse.
 *
 * **Table-aware on purpose.** The first version of this matched on the column
 * name alone and took the last match in file order. That was already luck —
 * four tables have a `title` CHECK — and it broke the moment a migration moved
 * more than one of them: the chore assertion would have read whichever table
 * came last in the file.
 */
const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

interface Bound {
  /** `null` where the column is nullable and the CHECK states no floor. */
  readonly low: number | null;
  readonly high: number;
}

/**
 * The last bound any migration puts on one table's column.
 *
 * Case-insensitive, and it accepts every spelling the schema actually uses:
 * `char_length(x) between 1 and 200`, `char_length(trim(x)) between …`, and
 * `length(x) <= 200` for the nullable one. A review caught the earlier version
 * silently passing on a stale bound when a hypothetical future migration used
 * uppercase SQL, renamed the constraint, or wrote `>= 1 and <= 200`.
 */
function boundOn(table: string, column: string): Bound {
  const len = `(?:char_)?length\\(\\s*(?:trim\\(\\s*)?${column}\\s*\\)?\\s*\\)`;
  const between = new RegExp(`${len}\\s+between\\s+(\\d+)\\s+and\\s+(\\d+)`, 'gi');
  const atMost = new RegExp(`${len}\\s*<=\\s*(\\d+)`, 'gi');
  const atLeast = new RegExp(`${len}\\s*>=\\s*(\\d+)`, 'i');

  let found: Bound | null = null;

  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;

    for (const statement of readFileSync(join(MIGRATIONS, file), 'utf8').split(';')) {
      const lowered = statement.toLowerCase();
      // Only the halves that *define* a constraint: a `drop constraint` in the
      // same file must never be read as one.
      const defines = lowered.includes('add constraint') || lowered.includes('create table');
      if (!defines) continue;
      // And only for this table, so four `title` CHECKs cannot be confused.
      if (!lowered.includes(`public.${table}`) && !lowered.includes(` ${table} `)) continue;

      for (const match of statement.matchAll(between)) {
        found = { low: Number(match[1]), high: Number(match[2]) };
      }
      for (const match of statement.matchAll(atMost)) {
        const floor = atLeast.exec(statement);
        found = { low: floor === null ? null : Number(floor[1]), high: Number(match[1]) };
      }
    }
  }

  if (found === null) throw new Error(`no CHECK found on ${table}.${column}`);
  return found;
}

describe('every title cap matches its CHECK', () => {
  it.each([
    ['chores', CHORE_TITLE_MAX],
    ['chore_subtasks', SUBTASK_TITLE_MAX],
    ['routine_items', ROUTINE_TITLE_MAX],
    ['household_notes', NOTE_TITLE_MAX],
  ])('%s.title', (table, cap) => {
    expect(boundOn(table, 'title').high).toBe(cap);
  });
});

describe('every body cap matches its CHECK', () => {
  it.each([
    ['chores', 'notes', CHORE_NOTES_MAX],
    ['routine_items', 'notes', CHORE_NOTES_MAX],
    ['household_notes', 'body', NOTE_BODY_MAX],
  ])('%s.%s', (table, column, cap) => {
    expect(boundOn(table, column).high).toBe(cap);
  });
});

describe('the floors, which a widening can silently drop', () => {
  it.each([
    ['chores', 1],
    ['chore_subtasks', 1],
    ['routine_items', 1],
  ])('%s still needs at least one character', (table, low) => {
    expect(boundOn(table, 'title').low).toBe(low);
  });

  it('leaves a note free to have no heading at all', () => {
    // The one nullable title: a note with a body and no heading is ordinary.
    expect(boundOn('household_notes', 'title').low).toBeNull();
  });
});

describe('a cap that is not there', () => {
  it('throws rather than passing quietly', () => {
    // The failure that matters is a *stale* match, but a missing one has to be
    // loud too — a silent `null` would make every assertion above vacuous.
    expect(() => boundOn('chores', 'nonexistent_column')).toThrow(/no CHECK found/);
  });
});

describe('the caps themselves', () => {
  it('leave every name shorter than the body it belongs with', () => {
    expect(CHORE_TITLE_MAX).toBeLessThan(CHORE_NOTES_MAX);
    expect(NOTE_TITLE_MAX).toBeLessThan(NOTE_BODY_MAX);
  });
});
