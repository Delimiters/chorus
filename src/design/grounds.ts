/**
 * What a control sits on, resting and pressed.
 *
 * In `design/` rather than beside the one control that needed it first: a
 * ground pair is a design-system decision, and leaving it in `features/` made
 * it permanently unreachable from here — `design → features` is the wrong way
 * round for invariant 1, so `Sheet` and `ChoreRow` could never have shared it
 * and the next control would have picked its own pressed colour by eye. Which
 * is how this went wrong twice already.
 *
 * Exported as a function rather than inlined because `Pressable` resolves its
 * style function before any render can be inspected, so the pressed branch is
 * unreachable from a component test. Here both branches are checkable, in both
 * themes, which is the only way the dark theme's 1.05:1 press was ever going
 * to be caught.
 */

import type { Palette } from './tokens';

/** The ground for a raised control — a pill, a chip, a soft button. */
export function raisedGround(colors: Palette, pressed: boolean): string {
  return pressed ? colors.pressed : colors.raised;
}

/**
 * The WCAG contrast ratio between two opaque hex colours.
 *
 * Here rather than in a test because the thing worth asserting about a press
 * is that it is *visible*, and "the two strings differ" is not that — the
 * original 1.009:1 bug would have passed that assertion, since `rule` and
 * `raised` are different strings.
 *
 * Opaque input only: an alpha token has no ratio until it is composited
 * against whatever is behind it, which is exactly why one slipped through.
 */
export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return (
    0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number)
  );
}
