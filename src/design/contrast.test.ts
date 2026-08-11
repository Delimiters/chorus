import { contrast, luminance, readableOn } from './contrast';
import { INKS, inkColor } from './inks';
import { palette } from './tokens';

describe('contrast', () => {
  it('is 21 for black on white, and 1 for a colour on itself', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#1E3A9E', '#1E3A9E')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the pair is given', () => {
    expect(contrast('#1E3A9E', '#ffffff')).toBeCloseTo(contrast('#ffffff', '#1E3A9E'), 10);
  });

  it('puts white at the top of the luminance range and black at the bottom', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });
});

describe('readableOn', () => {
  /**
   * The concern that prompted this: a bright ink with a white glyph on it.
   *
   * Rather than assuming which inks are "too bright", every ink is checked in
   * both themes — so adding one cannot quietly produce an unreadable control.
   */
  const CANDIDATES = [palette.light.surface, palette.light.text];

  it('reaches AA for every ink, in both themes', () => {
    for (const ink of INKS) {
      for (const isDark of [false, true]) {
        const background = inkColor(ink.name, isDark);
        const chosen = readableOn(background, CANDIDATES);
        // Named in the message so a failure says *which* ink and which theme,
        // rather than only that one of sixteen combinations is unreadable.
        expect([ink.name, isDark, contrast(background, chosen) >= 4.5]).toEqual([
          ink.name,
          isDark,
          true,
        ]);
      }
    }
  });

  it('picks the dark glyph on a light ink and the light glyph on a dark one', () => {
    // The actual behaviour worth having: the same ink flips the glyph between
    // themes, because the ink itself flips.
    const lightModeBlue = inkColor('blue', false); // dark navy
    const darkModeBlue = inkColor('blue', true); // pale periwinkle
    expect(readableOn(lightModeBlue, CANDIDATES)).toBe(palette.light.surface);
    expect(readableOn(darkModeBlue, CANDIDATES)).toBe(palette.light.text);
  });

  it('returns the first candidate when there is only one', () => {
    expect(readableOn('#123456', ['#ffffff'])).toBe('#ffffff');
  });
});
