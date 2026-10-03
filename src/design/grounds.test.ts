/**
 * A press has to be *visible*, which is not the same as being different.
 *
 * Both earlier attempts at this were different-but-invisible: `rule`
 * composited to 1.009:1 against the resting ground in the light theme, and
 * `sunken` is 1.052:1 in the dark one. A test asserting the two colours differ
 * was green for both.
 */
import { contrastRatio, raisedGround } from './grounds';
import { palette } from './tokens';

/**
 * The floor, chosen rather than inherited.
 *
 * WCAG has no rule for this — it governs text and meaningful graphics, and a
 * press is transient feedback with nothing to compare against side by side.
 * 1.15 is above both of the failures above and below what either theme
 * actually ships, which makes it a regression guard rather than a target.
 */
const MIN_PRESS_CONTRAST = 1.15;

describe('a raised control’s press', () => {
  it.each([
    ['light', palette.light],
    ['dark', palette.dark],
  ])('is visible in the %s theme', (_name, colors) => {
    const ratio = contrastRatio(raisedGround(colors, false), raisedGround(colors, true));

    expect(ratio).toBeGreaterThan(MIN_PRESS_CONTRAST);
  });

  it.each([
    ['light', palette.light],
    ['dark', palette.dark],
  ])('rests on the raised ground in the %s theme', (_name, colors) => {
    expect(raisedGround(colors, false)).toBe(colors.raised);
  });

  /*
   * Opaque, both of them, in both themes. A translucent token has no contrast
   * of its own — it composites against whatever is behind it — and that is
   * precisely how the first attempt measured fine in isolation and vanished on
   * the sheet.
   */
  it.each([
    ['light', palette.light],
    ['dark', palette.dark],
  ])('uses opaque grounds in the %s theme', (_name, colors) => {
    for (const pressed of [true, false]) {
      expect(raisedGround(colors, pressed)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  /*
   * Same direction in both themes: deeper, never toward the surface. Pressing
   * toward `surface` made the pill read as fading out rather than going down,
   * and it flipped direction between themes.
   */
  it.each([
    ['light', palette.light],
    ['dark', palette.dark],
  ])('goes deeper rather than toward the surface, in the %s theme', (_name, colors) => {
    // Through the function, not the tokens: asserting on `colors.pressed`
    // directly left the function free to return something else entirely, and
    // swapping it for `surface` stayed green.
    const resting = contrastRatio(raisedGround(colors, false), colors.surface);
    const pressed = contrastRatio(raisedGround(colors, true), colors.surface);

    expect(pressed).toBeGreaterThan(resting);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour against itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#EAE8E2', '#EAE8E2')).toBeCloseTo(1, 5);
  });

  /*
   * The number from the original bug, kept as a fixture: `rule` over the
   * sheet's white surface composites to #E7E7E8, which is this far from the
   * resting ground. If the helper ever stopped agreeing with that, the floor
   * above would stop meaning anything.
   */
  it('puts the original invisible press at about 1.01', () => {
    expect(contrastRatio('#E7E7E8', '#EAE8E2')).toBeCloseTo(1.01, 2);
  });
});
