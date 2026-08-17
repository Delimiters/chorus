import { formatLateness, formatMissedBefore } from './format';

describe('lateness', () => {
  it('pluralises', () => {
    expect(formatLateness(1)).toBe('1 day late');
    expect(formatLateness(2)).toBe('2 days late');
  });

  it('does not say "0 days late" — a row that is not late has no chip', () => {
    // Guarded by the caller, but stated so the intent survives a refactor.
    expect(formatLateness(0)).toBe('0 days late');
  });
});

describe('formatMissedBefore', () => {
  it('says "last time" for one, because a count of one is not a pattern', () => {
    expect(formatMissedBefore(1)).toBe('missed last time');
  });

  it('counts anything more, which is the whole point', () => {
    // The row said "missed last time" whether one had been missed or nine.
    expect(formatMissedBefore(2)).toBe('missed last 2 times');
    expect(formatMissedBefore(9)).toBe('missed last 9 times');
  });
});
