/**
 * Every touchable is at least {@link MIN_TARGET} points tall.
 *
 * This exists because "make the controls big enough" kept not happening. Jake,
 * after the fourth time: *"It has been a recurring issue that you've made
 * buttons and controls too small in this app."* He was right, and the specific
 * failure is worse than carelessness — `MIN_TARGET` has been in `tokens.ts` the
 * whole time, and the undersized controls were written by reaching past it for
 * a literal `40` or `36`. A reviewer flagged one of them and it shipped anyway,
 * with the flag reported as though noticing were the same as fixing.
 *
 * A guess about a size is not reviewable and a note in a summary is not a
 * guard. This is: it reads the source and fails on the number.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not measure anything. jest-expo does no layout, so an *actual* height
 * is not available at any price — a row's real height comes from its content
 * and its padding on a device. What is checkable is the floor a file sets, and
 * every case in the audit that prompted this was exactly that: an explicit
 * `minHeight` below the minimum, sitting next to a `Pressable`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { MIN_TARGET } from './tokens';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (extname(entry.name) === '.tsx' && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

/** A file that renders something tappable. */
const isTouchable = (source: string) =>
  source.includes('<Pressable') || source.includes('<TouchableOpacity');

/**
 * Explicit height floors, written as a bare number.
 *
 * `minHeight` only, deliberately. A first version also read `height` and
 * `width` and immediately failed on the sheet's 4pt grabber and every other
 * decorative dot and rule in the app — sizes that are small because they are
 * not controls. Every genuinely undersized target in the audit that prompted
 * this test was a `minHeight`, which is what you reach for when you mean "this
 * row is at least this tall".
 */
const heightFloors = (source: string): number[] =>
  [...source.matchAll(/\bminHeight:\s*(\d+)\b/g)].map((m) => Number(m[1]));

describe('touch targets', () => {
  const files = sourceFiles(SRC);

  it('has files to check, so this cannot pass by finding nothing', () => {
    // The failure mode of a source-scanning test: a wrong root, an empty list,
    // and a green tick that means the scan never happened.
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => isTouchable(readFileSync(f, 'utf8'))).length).toBeGreaterThan(10);
  });

  it.each(files.filter((f) => isTouchable(readFileSync(f, 'utf8'))))(
    'in %s, sets no size floor below the minimum',
    (file) => {
      const undersized = heightFloors(readFileSync(file, 'utf8')).filter(
        (value) => value > 0 && value < MIN_TARGET,
      );

      /*
       * If this fails on a genuinely non-interactive element — a bullet, a
       * rule, a swatch inside a larger row — give it a named constant rather
       * than widening this test. The number being unexplained is most of what
       * went wrong the first time.
       */
      expect(undersized).toEqual([]);
    },
  );
});
