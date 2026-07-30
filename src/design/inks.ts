/**
 * The eight person inks.
 *
 * Each person in a household is drawn in one, and the ink is what makes "whose
 * turn is it" readable before any label. It appears only on small marks — the
 * checkbox, the avatar, the turn chip, the agenda dot — never on grounds,
 * headings or buttons. See docs/DESIGN_SYSTEM.md.
 *
 * ## Why a curated set and not a colour picker
 *
 * Every ink needs a hand-tuned dark variant. The blue that reads confidently on
 * paper goes muddy against a near-black ground, so each has a lifted counterpart
 * rather than an algorithmic shift. A free hex cannot have that, and roughly half
 * the possible picks would be illegible on one theme or the other.
 *
 * ## Colour vision deficiency
 *
 * **Distinguishability is a property of a combination, not of a colour.** No
 * single ink is "colour-blind safe" on its own; it is only safe relative to what
 * it sits beside. So rather than flagging individual inks, this module exports a
 * verified *combination* — {@link CVD_FRIENDLY_SET} — and the picker offers it
 * as a preset.
 *
 * Colour is also never the only signal: a blue checkbox always sits beside the
 * words "Your turn". So nobody is blocked by an unfortunate pairing; the preset
 * exists so the *enhancement* works too.
 *
 * Under red-green deficiency the perceptual space collapses to roughly
 * blue-versus-yellow plus lightness, which is why the friendly set varies in
 * lightness as much as in hue, and why it has three members rather than eight.
 * That is a property of human vision, not a shortcoming of the palette.
 */

/** The stored value. Must match the CHECK constraint on household_members.accent. */
export type InkName = 'blue' | 'pink' | 'teal' | 'ochre' | 'plum' | 'green' | 'rust' | 'slate';

export interface Ink {
  readonly name: InkName;
  /** Shown in the picker. */
  readonly label: string;
  /** On the paper ground. */
  readonly light: string;
  /** On the night ground — lifted, not algorithmically shifted. */
  readonly dark: string;
}

/**
 * Ordered as the picker shows them, and as defaults are assigned: the first
 * member of a household gets blue, the second pink, matching the original
 * two-ink design out of the box.
 */
export const INKS: readonly Ink[] = [
  { name: 'blue', label: 'Blue', light: '#1E3A9E', dark: '#7C93FF' },
  { name: 'pink', label: 'Pink', light: '#C2185B', dark: '#FF8FC2' },
  { name: 'teal', label: 'Teal', light: '#0E7490', dark: '#4FD1E5' },
  { name: 'ochre', label: 'Ochre', light: '#8A5200', dark: '#F0B429' },
  { name: 'plum', label: 'Plum', light: '#5B21B6', dark: '#C4A6FF' },
  { name: 'green', label: 'Green', light: '#15803D', dark: '#4ADE80' },
  { name: 'rust', label: 'Rust', light: '#9F1239', dark: '#FB7185' },
  { name: 'slate', label: 'Slate', light: '#334155', dark: '#94A3B8' },
] as const;

/**
 * A combination that stays clearly distinguishable under both deuteranopia and
 * protanopia, on both grounds, and clears AA contrast.
 *
 * Verified in inks.test.ts by simulating both deficiencies and measuring ΔE —
 * so it is checkable rather than claimed, and a future tweak to any of these
 * hexes fails the build.
 *
 * Offered in the picker as "works well with colour blindness". Three is close to
 * the practical ceiling: red-green deficiency flattens the palette onto a
 * blue-yellow axis, so a fourth clearly-separable hue is not really available.
 */
export const CVD_FRIENDLY_SET: readonly InkName[] = ['blue', 'ochre', 'slate'];

const BY_NAME = new Map<InkName, Ink>(INKS.map((ink) => [ink.name, ink]));

/** Defaults in assignment order: first member blue, second pink, then the rest. */
export const DEFAULT_INK_ORDER: readonly InkName[] = INKS.map((ink) => ink.name);

/** Falls back to blue rather than throwing — a bad value must not blank a screen. */
export function inkByName(name: string): Ink {
  return BY_NAME.get(name as InkName) ?? (INKS[0] as Ink);
}

export function inkColor(name: string, isDark: boolean): string {
  const ink = inkByName(name);
  return isDark ? ink.dark : ink.light;
}

/**
 * A translucent wash of an ink, for chip backgrounds.
 *
 * Appends an alpha channel to the hex rather than blending, so it composites
 * correctly over either ground without needing to know which.
 */
export function inkSoft(name: string, isDark: boolean): string {
  return `${inkColor(name, isDark)}${isDark ? '24' : '1F'}`;
}

/**
 * The first unused ink in a household, for assigning a default.
 *
 * Returns null when all eight are taken — which caps a household at eight people
 * and is where the UI should say so rather than silently reusing one.
 */
export function nextAvailableInk(taken: readonly string[]): InkName | null {
  const used = new Set(taken);
  return DEFAULT_INK_ORDER.find((name) => !used.has(name)) ?? null;
}

/** Inks still selectable, given what everyone else in the household holds. */
export function availableInks(takenByOthers: readonly string[]): readonly Ink[] {
  const used = new Set(takenByOthers);
  return INKS.filter((ink) => !used.has(ink.name));
}

/** True when this ink is part of the colour-blind-friendly combination. */
export function isCvdFriendly(name: string): boolean {
  return CVD_FRIENDLY_SET.includes(name as InkName);
}
