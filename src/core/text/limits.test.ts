import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CATEGORY_NAME_MAX,
  CHORE_NOTES_MAX,
  CHORE_TITLE_MAX,
  HOUSEHOLD_NAME_MAX,
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
 * Comments removed without touching anything inside a string.
 *
 * A plain `replace(/\/\*[\s\S]*?\*\//g)` was wrong in two ways a review
 * demonstrated: a `/*` inside a string literal paired with the next real `*\/`
 * anywhere later in the file and swallowed every statement between, and
 * `--[^\n]*` erased DDL sitting after a `--` inside a string on the same line.
 * One migration really does carry `'https://exp.host/--/api/v2/push/send'`.
 *
 * So this walks the text: block comments nest, as they do in Postgres; single
 * quotes and dollar-quoted bodies are copied through verbatim.
 */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const pair = sql.slice(i, i + 2);

    if (pair === '--') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }

    if (pair === '/*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === '/*') {
          depth += 1;
          i += 2;
        } else if (sql.slice(i, i + 2) === '*/') {
          depth -= 1;
          i += 2;
        } else i += 1;
      }
      out += ' ';
      continue;
    }

    if (sql[i] === "'") {
      out += sql[i];
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          // `''` is an escaped quote, not the end of the string.
          if (sql[i + 1] === "'") {
            out += "''";
            i += 2;
            continue;
          }
          out += sql[i];
          i += 1;
          break;
        }
        out += sql[i];
        i += 1;
      }
      continue;
    }

    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar !== null) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, i + tag.length);
      const stop = close === -1 ? sql.length : close + tag.length;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
}

/**
 * Which table a statement is about, by its own DDL target.
 *
 * Tolerant on purpose — `only`, `if exists`, `if not exists` and quoted
 * identifiers are all spellings a future migration may legitimately use, and
 * every one of them slipped past the previous version, which then carried an
 * older bound forward and reported agreement. `null` means "this statement
 * defines something and I cannot tell what", which the caller treats as a
 * failure rather than a skip.
 */
function ddlTarget(statement: string): string | null {
  const match =
    /(?:alter|create)\s+table\s+(?:(?:only|if\s+not\s+exists|if\s+exists)\s+)*"?(?:public"?\s*\.\s*"?)?(\w+)"?/i.exec(
      statement,
    );
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * The last bound any migration puts on one table's column.
 *
 * **Fails loudly rather than closed.** The structural bug a review found was not
 * a missing alternation: when nothing matched, `found` simply kept the bound from
 * an older migration, and the only throw fired when *no* migration had ever
 * matched — which the base schema always does. So every spelling the regex could
 * not see was skipped in silence and the stale bound passed. Now a statement that
 * bounds this column and cannot be attributed to a table is an error.
 */
function boundOn(table: string, column: string): Bound {
  const len = `(?:char_)?length\\(\\s*(?:trim\\(\\s*)?${column}\\s*\\)?\\s*\\)`;
  const between = new RegExp(`${len}\\s+between\\s+(\\d+)\\s+and\\s+(\\d+)`, 'gi');
  const atMost = new RegExp(`${len}\\s*<=\\s*(\\d+)`, 'gi');
  const atLeast = new RegExp(`${len}\\s*>=\\s*(\\d+)`, 'i');
  const bounds = new RegExp(`${len}\\s*(?:between|<=|>=)`, 'i');

  let found: Bound | null = null;

  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;

    for (const statement of stripComments(readFileSync(join(MIGRATIONS, file), 'utf8')).split(
      ';',
    )) {
      const lowered = statement.toLowerCase();
      const defines =
        lowered.includes('add constraint') ||
        lowered.includes('add check') ||
        lowered.includes('create table');
      if (!defines) continue;
      if (!bounds.test(statement)) continue;

      const target = ddlTarget(statement);
      if (target === null) {
        throw new Error(
          `${file}: a CHECK bounds ${column} but the statement's table cannot be read — ` +
            `the parser would otherwise carry an older bound forward and pass`,
        );
      }
      if (target !== table) continue;

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

describe('every other capped name matches its CHECK', () => {
  it.each([
    ['chore_categories', 'name', CATEGORY_NAME_MAX],
    ['households', 'name', HOUSEHOLD_NAME_MAX],
  ])('%s.%s', (table, column, cap) => {
    expect(boundOn(table, column).high).toBe(cap);
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

  it.each([
    ['chore_categories', 'name'],
    ['households', 'name'],
  ])('%s.%s still needs at least one character', (table, column) => {
    // Only `.high` was asserted for these two, so a widening that dropped the
    // floor would have passed.
    expect(boundOn(table, column).low).toBe(1);
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
