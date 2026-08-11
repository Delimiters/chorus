/**
 * The palette's accessibility claims, verified rather than asserted.
 *
 * `docs/DESIGN_SYSTEM.md` says the `cvdSafe` inks clear AA contrast on both
 * grounds and stay distinguishable under deuteranopia and protanopia. A claim
 * like that rots the moment someone tweaks a hex, so it is checked here — with
 * real contrast maths and a real dichromacy simulation — instead of being taken
 * on trust.
 */

import { contrast, luminance } from './contrast';
import {
  CVD_FRIENDLY_SET,
  INKS,
  availableInks,
  inkByName,
  inkColor,
  inkSoft,
  isCvdFriendly,
  nextAvailableInk,
} from './inks';
import { palette } from './tokens';

// ── Colour maths ────────────────────────────────────────────────────────────

type RGB = readonly [number, number, number];

/** The simulation works in RGB; the shared contrast maths speaks hex. */
function rgbToHex([r, g, b]: RGB): string {
  const part = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ] as const;
}

/**
 * Dichromacy simulation.
 *
 * The classic linear approximations. Not perceptually exact, but more than good
 * enough to catch two inks that collapse onto each other — which is the failure
 * this test exists to prevent.
 */
const MATRICES = {
  protanopia: [
    [0.567, 0.433, 0.0],
    [0.558, 0.442, 0.0],
    [0.0, 0.242, 0.758],
  ],
  deuteranopia: [
    [0.625, 0.375, 0.0],
    [0.7, 0.3, 0.0],
    [0.0, 0.3, 0.7],
  ],
} as const;

function simulate(hex: string, kind: keyof typeof MATRICES): RGB {
  const [r, g, b] = hexToRgb(hex);
  const m = MATRICES[kind];
  const apply = (row: readonly number[]): number =>
    Math.max(
      0,
      Math.min(255, (row[0] as number) * r + (row[1] as number) * g + (row[2] as number) * b),
    );
  return [apply(m[0]), apply(m[1]), apply(m[2])] as const;
}

/** CIE76 ΔE in Lab. Crude but adequate for "are these two clearly different". */
function deltaE(a: RGB, b: RGB): number {
  const toLab = ([r, g, bl]: RGB): readonly [number, number, number] => {
    const lin = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))] as const;
  };
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// ── The palette itself ──────────────────────────────────────────────────────

describe('palette shape', () => {
  it('has eight inks with unique names', () => {
    expect(INKS).toHaveLength(8);
    expect(new Set(INKS.map((i) => i.name)).size).toBe(8);
  });

  it('gives every ink a light and a dark hex', () => {
    for (const ink of INKS) {
      expect(ink.light).toMatch(/^#[0-9A-F]{6}$/i);
      expect(ink.dark).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('never uses the same hex twice on a given ground', () => {
    expect(new Set(INKS.map((i) => i.light)).size).toBe(8);
    expect(new Set(INKS.map((i) => i.dark)).size).toBe(8);
  });

  it('starts with blue then pink, so defaults match the original design', () => {
    expect(INKS[0]?.name).toBe('blue');
    expect(INKS[1]?.name).toBe('pink');
  });
});

describe('contrast against both grounds', () => {
  // 3:1 is the WCAG AA floor for non-text UI components, which is what these are
  // — checkbox borders, dots and chips, not body copy.
  const NON_TEXT_AA = 3;

  it.each(INKS.map((i) => [i.name, i] as const))(
    '%s is visible on the light ground',
    (_name, ink) => {
      expect(contrast(ink.light, palette.light.paper)).toBeGreaterThanOrEqual(NON_TEXT_AA);
      expect(contrast(ink.light, palette.light.sunken)).toBeGreaterThanOrEqual(NON_TEXT_AA);
    },
  );

  it.each(INKS.map((i) => [i.name, i] as const))(
    '%s is visible on the night ground',
    (_name, ink) => {
      expect(contrast(ink.dark, palette.dark.paper)).toBeGreaterThanOrEqual(NON_TEXT_AA);
      expect(contrast(ink.dark, palette.dark.sunken)).toBeGreaterThanOrEqual(NON_TEXT_AA);
    },
  );

  it('the colour-blind-friendly set clears the stricter text threshold too', () => {
    // 4.5:1 — so they work for a coloured label, not only a coloured dot.
    for (const name of CVD_FRIENDLY_SET) {
      const ink = inkByName(name);
      expect(contrast(ink.light, palette.light.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink.dark, palette.dark.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('colour vision deficiency', () => {
  // Distinguishability is a property of a COMBINATION, not of a colour: an ink
  // is only "safe" relative to what sits beside it. So what is verified here is
  // the recommended combination, not individual swatches.
  const safe = CVD_FRIENDLY_SET.map(inkByName);

  it('offers a combination big enough for a typical household', () => {
    // Three is close to the ceiling — red-green deficiency flattens the palette
    // onto a blue-yellow axis, so a fourth clearly-separable hue is not really
    // available. Beyond three people, the always-present text carries it.
    expect(safe.length).toBeGreaterThanOrEqual(3);
  });

  it.each(['protanopia', 'deuteranopia'] as const)(
    'every pair in the friendly set stays distinguishable under %s',
    (kind) => {
      const failures: string[] = [];
      for (const ground of ['light', 'dark'] as const) {
        for (let i = 0; i < safe.length; i += 1) {
          for (let j = i + 1; j < safe.length; j += 1) {
            const a = safe[i] as (typeof safe)[number];
            const b = safe[j] as (typeof safe)[number];
            const difference = deltaE(
              simulate(ground === 'light' ? a.light : a.dark, kind),
              simulate(ground === 'light' ? b.light : b.dark, kind),
            );
            // ΔE 20 is comfortably beyond "just noticeable" — these are small
            // marks glanced at, not swatches compared side by side.
            if (difference < 20) {
              failures.push(`${a.name}/${b.name} on ${ground}: ΔE ${difference.toFixed(1)}`);
            }
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it('separates on more than hue alone', () => {
    // Hue is exactly what colour vision deficiency removes, so a set separated
    // only by hue would be useless however many colours it had.
    //
    // Note this cannot be checked as raw luminance spread: every ink has to be
    // dark enough to contrast against the paper ground, so they necessarily
    // share a dark register and the spread is small by construction. What
    // matters is that they stay apart AFTER the deficiency is applied — which
    // is what the ΔE tests above measure, and this asserts directly.
    for (const kind of ['protanopia', 'deuteranopia'] as const) {
      const simulated = safe.map((ink) => luminance(rgbToHex(simulate(ink.light, kind))));
      const spread = Math.max(...simulated) - Math.min(...simulated);
      // Surviving lightness difference, on the same scale as the inks themselves.
      expect(spread).toBeGreaterThan(0.02);
    }
  });
});

describe('helpers', () => {
  it('resolves an ink by name', () => {
    expect(inkByName('teal').label).toBe('Teal');
  });

  it('reports membership of the friendly combination', () => {
    expect(isCvdFriendly('blue')).toBe(true);
    expect(isCvdFriendly('ochre')).toBe(true);
    expect(isCvdFriendly('pink')).toBe(false);
  });

  it('every ink in the friendly set actually exists in the palette', () => {
    for (const name of CVD_FRIENDLY_SET) {
      expect(INKS.map((i) => i.name)).toContain(name);
    }
  });

  it('falls back to blue for an unknown name rather than throwing', () => {
    // A bad value from the database must not blank a screen.
    expect(inkByName('chartreuse').name).toBe('blue');
    expect(inkByName('').name).toBe('blue');
  });

  it('picks the right variant per theme', () => {
    expect(inkColor('blue', false)).toBe('#1E3A9E');
    expect(inkColor('blue', true)).toBe('#7C93FF');
  });

  it('produces a translucent wash', () => {
    expect(inkSoft('blue', false)).toBe('#1E3A9E1F');
    expect(inkSoft('blue', true)).toBe('#7C93FF24');
  });

  describe('nextAvailableInk', () => {
    it('gives blue to the first member and pink to the second', () => {
      expect(nextAvailableInk([])).toBe('blue');
      expect(nextAvailableInk(['blue'])).toBe('pink');
      expect(nextAvailableInk(['blue', 'pink'])).toBe('teal');
    });

    it('returns null when all eight are taken', () => {
      // Caps a household at eight; the UI should say so rather than reuse one.
      expect(nextAvailableInk(INKS.map((i) => i.name))).toBeNull();
    });
  });

  describe('availableInks', () => {
    it('excludes what housemates already hold', () => {
      const available = availableInks(['blue', 'teal']);
      expect(available.map((i) => i.name)).not.toContain('blue');
      expect(available.map((i) => i.name)).not.toContain('teal');
      expect(available).toHaveLength(6);
    });
  });
});
