/**
 * The widget's grounds, as actually generated.
 *
 * `targets/plan/expo-target.config.js` declares four colours and
 * `@bacons/apple-targets` writes them into an asset catalogue that the
 * extension reads with `Color("$paper")`. Nothing between those two ends
 * checks that anything arrived.
 *
 * Nothing did. The plugin's own type documentation says
 * `{ color: "#FF0000", darkColor: "#0000FF" }`; its code reads `color.light`
 * and `color.dark`. Given the documented shape, both are `undefined` and it
 * writes `{ "colors": [] }` — a colorset with no colours in it. No warning from
 * the plugin, the prebuild or the build.
 *
 * `Color("$paper")` then resolves to nothing, so the widget rendered blank and
 * the Live Activity came up as a semi-transparent card showing the app's name
 * and nothing else: the background and every piece of text were invisible.
 * Shipped in builds 66 and 67.
 *
 * So this reads the generated file. Same habit as `contract.test.ts` and
 * `limits.test.ts`: decode the artifact, do not trust the dashboard.
 *
 * It lives beside the tokens rather than in `src/core/widget/`, because it has
 * to compare against `@/design/tokens` and `src/core` may not import outward —
 * the rule that keeps the engine pure, and which eslint enforces.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { palette } from '@/design/tokens';

const repo = join(__dirname, '..', '..');
const CATALOGUE = join(repo, 'targets', 'plan', 'Assets.xcassets');

/** The widget's colour name, and the app token it must equal. */
type Ground = 'paper' | 'text' | 'textFaint' | 'overprint';

const GROUNDS: readonly (readonly [string, Ground])[] = [
  ['$paper', 'paper'],
  ['$text', 'text'],
  ['$textFaint', 'textFaint'],
  ['$overprint', 'overprint'],
];

interface Entry {
  readonly idiom: string;
  readonly appearances?: readonly { appearance: string; value: string }[];
  readonly color: { readonly components: Record<string, number | string> };
}

const colorsetOf = (name: string): readonly Entry[] => {
  const raw = readFileSync(join(CATALOGUE, `${name}.colorset`, 'Contents.json'), 'utf8');
  return (JSON.parse(raw) as { colors: readonly Entry[] }).colors;
};

/** `#RRGGBB` for a generated entry, so it can be compared with a token. */
const hexOf = (entry: Entry): string => {
  const channel = (key: string): number => {
    const value = entry.color.components[key];
    const asNumber = typeof value === 'string' ? Number.parseFloat(value) : value;
    if (asNumber === undefined || Number.isNaN(asNumber)) {
      throw new Error(`component ${key} is not a number: ${String(value)}`);
    }
    // The plugin writes 0–1 fractions; a 0–255 form would also be legal JSON.
    const scaled = asNumber <= 1 ? asNumber * 255 : asNumber;
    return Math.round(scaled);
  };

  return (
    '#' +
    ['red', 'green', 'blue']
      .map((key) => channel(key).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
};

describe('the colour config', () => {
  /*
   * The generated files are committed, so a test that reads only those stays
   * green after someone reverts the config to the plugin's documented-but-wrong
   * `{ color, darkColor }` shape — right up until the next prebuild rewrites
   * them empty and ships an invisible widget. This reads the config itself.
   *
   * Comments are stripped first, because the config *quotes* the wrong form in
   * the paragraph explaining why it is wrong — and the first version of this
   * test found that quote instead of the code. Third time this exact trap has
   * cost something here: see `limits.test.ts` and `contract.test.ts`.
   */
  const config = readFileSync(join(repo, 'targets', 'plan', 'expo-target.config.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('uses the keys the plugin actually reads', () => {
    for (const [name] of GROUNDS) {
      const escaped = name.replace('$', '\\$');
      expect(config).toMatch(
        new RegExp(`${escaped}: \\{ light: '#[0-9A-Fa-f]{6}', dark: '#[0-9A-Fa-f]{6}' \\}`),
      );
    }

    /*
     * The plugin's own type documentation says to write it the other way. Its
     * code reads `color.light` and `color.dark`, so the documented form
     * produces `{ "colors": [] }` with no warning anywhere.
     */
    expect(config).not.toContain('darkColor');
  });
});

describe('the widget colour assets', () => {
  /*
   * A loop rather than `it.each`, which infers a union of tuples from a
   * correlated table and loses the pairing between a colour name and its
   * token.
   */
  for (const [name, token] of GROUNDS) {
    it(`${name} is actually generated, light and dark`, () => {
      const colors = colorsetOf(name);

      /*
       * The assertion that would have caught it. An empty array is a valid
       * asset catalogue, a successful prebuild and a clean build — and an
       * invisible widget.
       */
      expect(colors.length).toBe(2);

      const universal = colors.filter((c) => c.appearances === undefined);
      const night = colors.filter((c) =>
        c.appearances?.some((a) => a.appearance === 'luminosity' && a.value === 'dark'),
      );
      expect(universal).toHaveLength(1);
      expect(night).toHaveLength(1);
    });

    it(`${name} matches the app token on both grounds`, () => {
      const colors = colorsetOf(name);
      const universal = colors.find((c) => c.appearances === undefined) as Entry;
      const night = colors.find((c) => c.appearances !== undefined) as Entry;

      /*
       * Not just "has colours" — the *right* colours. A widget drawn on a
       * different paper from the app is the thing the asset catalogue exists
       * to prevent, and the config file duplicates these four values by hand.
       */
      expect(hexOf(universal)).toBe(palette.light[token].toUpperCase());
      expect(hexOf(night)).toBe(palette.dark[token].toUpperCase());
    });
  }
});
