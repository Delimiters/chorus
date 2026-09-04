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
 * ── What it does not catch, stated plainly ────────────────────────────────
 *
 * It does not measure anything. jest-expo does no layout, so an *actual* height
 * is not available at any price — a row's real height comes from its content
 * and its padding on a device. What is checkable is the floor a file writes
 * down, and every case in the audit that prompted this was exactly that.
 *
 * So it is blind to, and a review found real examples of the first two:
 *
 *   - **A control sized by padding alone.** The mode switch was ~36pt this way
 *     and this file sailed past it. Anything relying on padding needs an
 *     explicit `minHeight` to be checkable at all, which is a good reason to
 *     write one.
 *   - **A fixed `height`.** The stepper was 34×34. Widening to `height` and
 *     `width` was tried and immediately failed on the sheet's 4pt grabber and
 *     every decorative rule in the app — sizes that are small because they are
 *     not controls — so the scope stays where it can be trusted.
 *   - A `minHeight` held in a named constant, or a style object in another
 *     module.
 *
 * The name of the `describe` says `minHeight` for that reason. A guard whose
 * name promises more than it checks is the false confidence this codebase has
 * been bitten by, in the file meant to stop exactly that.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

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

/**
 * A file that renders something tappable.
 *
 * Every React Native touchable, not the two that happened to come to mind —
 * `TouchableOpacity` has no occurrences in this app at all, so half the
 * original check was dead, and a file reaching for `TouchableHighlight` was
 * not scanned at all. A guard that goes quiet when somebody picks a different
 * primitive is the failure this file exists to prevent.
 */
const isTouchable = (source: string) =>
  /<(Pressable|Touchable(Opacity|Highlight|WithoutFeedback|NativeFeedback))\b/.test(source);

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

describe('explicit minHeight floors on files that render controls', () => {
  const files = sourceFiles(SRC);

  it('actually detects an undersized floor', () => {
    /*
     * The positive control, and the reason it is first.
     *
     * Every per-file case below now compares two empty arrays, because the
     * audit fixed all of them. That is what success looks like — and it is
     * indistinguishable from a matcher that stopped matching. One typo in the
     * regex would turn this whole file into twenty-odd green ticks asserting
     * nothing, which is precisely the shape of the defects it was written for.
     */
    expect(heightFloors('style={{ minHeight: 36 }}')).toEqual([36]);
    expect(heightFloors('style={{ minHeight: MIN_TARGET }}')).toEqual([]);
    expect(isTouchable('<Pressable onPress={x}>')).toBe(true);
    expect(isTouchable('<TouchableHighlight onPress={x}>')).toBe(true);
    expect(isTouchable('<View />')).toBe(false);
  });

  it('has files to check, so this cannot pass by finding nothing', () => {
    // The failure mode of a source-scanning test: a wrong root, an empty list,
    // and a green tick that means the scan never happened.
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => isTouchable(readFileSync(f, 'utf8'))).length).toBeGreaterThan(10);
  });

  it.each(
    files
      .filter((f) => isTouchable(readFileSync(f, 'utf8')))
      // Relative, so a failure in CI names a path that means something to
      // anybody other than the machine it ran on.
      .map((f) => [relative(SRC, f), f] as const),
  )('in %s, sets no minHeight below the minimum', (_name, file) => {
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
  });
});
