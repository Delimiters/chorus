import type { TextStyle } from 'react-native';

/**
 * Design tokens.
 *
 * The identity: two inks that overprint. Blue is you, pink is your housemate,
 * and where they overlap is shared. Borrowed from risograph printing, where two
 * inks overprint into a third — which is a fairly literal description of a shared
 * household, and means "whose turn is it" reads before any label does.
 *
 * Both themes are designed, not inverted. The blue that works on paper goes muddy
 * on a near-black ground, so the dark theme lifts both inks to a brighter
 * register while keeping them recognisably the same two people.
 *
 * See docs/DESIGN_SYSTEM.md.
 */

/**
 * The colour roles. Declared as an interface so both themes are checked against
 * the same shape and neither can drift by forgetting a token.
 */
export interface Palette {
  readonly paper: string;
  readonly surface: string;
  readonly sunken: string;
  readonly raised: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly rule: string;
  readonly inkA: string;
  readonly inkASoft: string;
  readonly inkB: string;
  readonly inkBSoft: string;
  readonly overprint: string;
  readonly overprintSoft: string;
  readonly overdue: string;
  readonly onOverdue: string;
  readonly danger: string;
}

/** The two person inks, plus their overprint. Semantic, not decorative. */
const light: Palette = {
  // Grounds
  paper: '#F3F2EE',
  surface: '#FFFFFF',
  sunken: '#F4F4F1',
  raised: '#EAE8E2',

  // Ink
  text: '#17171F',
  textMuted: '#4A4A55',
  textFaint: '#7C7C86',
  rule: '#17171F1A',

  // The two people
  inkA: '#2B4ACB',
  inkASoft: '#2B4ACB1F',
  inkB: '#D42B85',
  inkBSoft: '#D42B851F',
  /** Where both apply: flexible chores, schedule previews, shared state. */
  overprint: '#5B2E9E',
  overprintSoft: '#5B2E9E1A',

  /**
   * Overdue.
   *
   * Deliberately the text colour rather than a red. A red wash over a chore list
   * makes an ordinary Tuesday feel like an incident; an outlined row with a solid
   * ink chip is unmissable without being a scold.
   */
  overdue: '#17171F',
  onOverdue: '#FFFFFF',

  danger: '#B3261E',
} as const;

const dark: Palette = {
  paper: '#121219',
  surface: '#1A1A23',
  sunken: '#22222D',
  raised: '#262631',

  text: '#ECEBE6',
  textMuted: '#A9A8B2',
  textFaint: '#76757F',
  rule: '#ECEBE61F',

  inkA: '#7C93FF',
  inkASoft: '#7C93FF24',
  inkB: '#FF6FB4',
  inkBSoft: '#FF6FB424',
  overprint: '#B08CFF',
  overprintSoft: '#B08CFF20',

  overdue: '#ECEBE6',
  onOverdue: '#121219',

  danger: '#FF6B60',
} as const;

export const palette = { light, dark } as const;
export type ThemeName = keyof typeof palette;

/** A 4-point spacing scale. Layout uses `gap`, not per-element margins. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * Type scale.
 *
 * `mono` carries anything countable — dates, counts, status — which gives
 * tabular figures so the agenda's date column aligns, and echoes the chore chart
 * on a fridge that this app replaces.
 */
export const type = {
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.9 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 13, fontWeight: '500' },
  /** Uppercase, letterspaced. Section labels and status chips. */
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  mono: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

/** Minimum touch target. Below this, taps get missed. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TARGET = 44;

/** Which ink a member is drawn in. Stored on the profile. */
export type Accent = 'blue' | 'pink';

export function accentColor(accent: Accent, colors: Palette): string {
  return accent === 'blue' ? colors.inkA : colors.inkB;
}

export function accentSoftColor(accent: Accent, colors: Palette): string {
  return accent === 'blue' ? colors.inkASoft : colors.inkBSoft;
}
