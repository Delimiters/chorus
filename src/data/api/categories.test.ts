import { CATEGORY_NAME_MAX } from '@/core/text/limits';

import { cleanName } from './categories';

describe('cleaning a category name', () => {
  it('trims, and refuses a name that is only spaces', () => {
    expect(cleanName('  Kitchen  ')).toBe('Kitchen');
    expect(() => cleanName('   ')).toThrow(/needs a name/);
  });

  it('rejects a name past the cap, and nothing short of it', () => {
    /*
     * Written against the constant, which is the point of the test rather than a
     * detail of it. This guard held a literal `40` — the same shape that outranked
     * the chore title's cap in three places while the change was called shipped —
     * and a literal is invisible to the migration drift test, which can only see
     * numbers that reach SQL. Raise `CATEGORY_NAME_MAX` without this file and
     * this goes red.
     */
    expect(() => cleanName('x'.repeat(CATEGORY_NAME_MAX + 1))).toThrow(/too long/);
    expect(() => cleanName('x'.repeat(CATEGORY_NAME_MAX))).not.toThrow();
  });

  it('counts the trimmed length, not what you typed', () => {
    // Leading spaces are not characters you spent; the CHECK trims too.
    expect(() => cleanName(`   ${'x'.repeat(CATEGORY_NAME_MAX)}   `)).not.toThrow();
  });
});
