import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHORE_NOTES_MAX, CHORE_TITLE_MAX } from './limits';

/**
 * The client cap and the database CHECK have to be the same number.
 *
 * Not a tautology, and not here for coverage: this exact pair has drifted twice.
 * The title cap was raised from 120 to 200 in the input, the constant and the
 * migration while `canSave` and the API layer stayed at 120 — so a 150-character
 * name typed fine and then could not be saved, with the whole suite green. A
 * number duplicated across TypeScript and SQL has no compiler keeping it honest,
 * so a test has to.
 *
 * The bound is read from the migrations rather than written down twice here, so
 * raising the CHECK without the constant fails, and so does the reverse.
 */
const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

/**
 * The last bound any migration puts on a column, in file order.
 *
 * Matched on `char_length(<column>)` rather than on a constraint name, and
 * case-insensitively, because a review showed the first version of this passing
 * on a stale bound in three realistic spellings: uppercase SQL, a renamed
 * constraint, and the `>= 1 and <= 200` form instead of `between`. In each case
 * the new migration was skipped, the *old* bound still matched, and the test
 * reported agreement while the database had moved.
 *
 * Every match is collected and the last wins, so a later migration always
 * overrides an earlier one. Finding nothing throws rather than passing.
 */
function boundOn(column: string): { low: number; high: number } {
  const between = new RegExp(
    `char_length\\(\\s*(?:trim\\(\\s*)?${column}\\s*\\)?\\s*\\)\\s+between\\s+(\\d+)\\s+and\\s+(\\d+)`,
    'gi',
  );
  const comparison = new RegExp(
    `char_length\\(\\s*(?:trim\\(\\s*)?${column}\\s*\\)?\\s*\\)\\s*<=\\s*(\\d+)`,
    'gi',
  );

  let found: { low: number; high: number } | null = null;

  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');

    for (const statement of sql.split(';')) {
      const lowered = statement.toLowerCase();
      // The definition halves only: a `drop constraint` in the same file must
      // not be read as one.
      if (!lowered.includes('add constraint') && !lowered.includes('create table')) continue;

      for (const match of statement.matchAll(between)) {
        found = { low: Number(match[1]), high: Number(match[2]) };
      }
      for (const match of statement.matchAll(comparison)) {
        // `>= 1` is the usual partner; a bare `<=` leaves the floor at zero.
        const low = /char_length\(\s*(?:trim\(\s*)?title\s*\)?\s*\)\s*>=\s*(\d+)/i.exec(statement);
        found = { low: low === null ? 0 : Number(low[1]), high: Number(match[1]) };
      }
    }
  }

  if (found === null) throw new Error(`no CHECK found on ${column}`);
  return found;
}

describe('the chore title bound', () => {
  it('matches the database CHECK', () => {
    expect(boundOn('title').high).toBe(CHORE_TITLE_MAX);
  });

  it('still requires at least one character', () => {
    // The lower bound is the one a widening can silently drop.
    expect(boundOn('title').low).toBe(1);
  });
});

describe('the caps themselves', () => {
  it('leave a name shorter than its notes', () => {
    // A title is drawn on one line in the picker, in a notification body and in
    // the widget snapshot. Anything that wants a paragraph wants the notes.
    expect(CHORE_TITLE_MAX).toBeLessThan(CHORE_NOTES_MAX);
  });
});
