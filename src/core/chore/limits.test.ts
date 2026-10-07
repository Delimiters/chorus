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
 * The bound is read from the migrations rather than written down twice here,
 * which is the only version of this test that cannot itself go stale: raise the
 * CHECK without the constant and this fails, and so does the reverse.
 */
const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

/** The bound from the last migration that constrains the column, in file order. */
function boundFromMigrations(constraint: string): { low: number; high: number } {
  const pattern = new RegExp(
    `${constraint}[\\s\\S]*?char_length\\(\\s*\\w+\\s*\\)\\s+between\\s+(\\d+)\\s+and\\s+(\\d+)`,
  );
  let found: { low: number; high: number } | null = null;

  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    // Only the `add constraint` half, so the `drop constraint` in the same file
    // cannot be read as a definition.
    for (const statement of sql.split(';')) {
      if (!statement.includes('add constraint') && !statement.includes('create table')) continue;
      const match = pattern.exec(statement);
      if (match === null) continue;
      found = { low: Number(match[1]), high: Number(match[2]) };
    }
  }

  if (found === null) throw new Error(`no CHECK found for ${constraint}`);
  return found;
}

describe('the chore title bound', () => {
  it('matches the database CHECK', () => {
    expect(boundFromMigrations('chores_title_check').high).toBe(CHORE_TITLE_MAX);
  });

  it('still requires at least one character', () => {
    // The lower bound is the one a widening can silently drop.
    expect(boundFromMigrations('chores_title_check').low).toBe(1);
  });
});

describe('the caps themselves', () => {
  it('leave a name shorter than its notes', () => {
    // A title is drawn on one line in the picker, in a notification body and in
    // the widget snapshot. Anything that wants a paragraph wants the notes.
    expect(CHORE_TITLE_MAX).toBeLessThan(CHORE_NOTES_MAX);
  });
});
