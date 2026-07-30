import { formatInviteCode, generateInviteCode, normalizeInviteCode } from './inviteCode';

/** Digits and letters minus vowels and the glyphs that get misread aloud. */
const ALLOWED = /^[0-9A-HJ-NP-Z]{8}$/;

describe('generateInviteCode', () => {
  it('matches the shape the database CHECK constraint enforces', () => {
    // If these ever diverge, every invite insert fails at runtime. Worth a loop
    // rather than a single sample.
    for (let i = 0; i < 500; i += 1) {
      expect(generateInviteCode()).toMatch(ALLOWED);
    }
  });

  it('omits the characters that are ambiguous when read aloud', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      for (const char of generateInviteCode()) seen.add(char);
    }
    // I/O/U are excluded so 0/O and 1/I cannot be confused across a kitchen.
    for (const excluded of ['I', 'O', 'U']) {
      expect(seen.has(excluded)).toBe(false);
    }
  });

  it('does not produce the same code twice in a row', () => {
    // A trivially weak generator would be guessable, and a guessable code lets a
    // stranger join the household.
    const codes = new Set(Array.from({ length: 200 }, generateInviteCode));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('formatInviteCode', () => {
  it('groups into two blocks of four', () => {
    expect(formatInviteCode('7K4M92XB')).toBe('7K4M-92XB');
  });
});

describe('normalizeInviteCode', () => {
  it.each([
    ['7k4m92xb', '7K4M92XB'],
    ['7K4M-92XB', '7K4M92XB'],
    ['7k4m 92xb', '7K4M92XB'],
    [' 7K4M-92XB ', '7K4M92XB'],
    ['7K4M–92XB', '7K4M92XB'], // en dash, as an autocorrect might produce
  ])('accepts %s', (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });

  it('round-trips a formatted code', () => {
    const code = generateInviteCode();
    expect(normalizeInviteCode(formatInviteCode(code))).toBe(code);
  });
});
