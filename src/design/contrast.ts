/**
 * WCAG contrast maths.
 *
 * Extracted from inks.test.ts, which had the only copy. It was fine there
 * while contrast was something only tests asserted — but now the app picks a
 * foreground colour at render time, and two implementations of the same
 * formula would eventually disagree about whether something is legible.
 */

type RGB = readonly [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ] as const;
}

/** WCAG relative luminance, 0–1. */
export function luminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Whichever candidate is more readable on the given background.
 *
 * Measured rather than assumed. The inks are chosen to be legible *as
 * foreground* against paper, which says nothing about what reads well on top
 * of them: the light-mode blue is dark enough for white text, and the
 * dark-mode blue is light enough that white text on it would be close to
 * invisible. Picking by measurement means a new ink cannot quietly produce an
 * unreadable control.
 */
export function readableOn(background: string, candidates: readonly string[]): string {
  let best = candidates[0] as string;
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrast(background, candidate);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}
