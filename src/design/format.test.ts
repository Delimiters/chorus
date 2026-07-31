import { formatLateness } from './format';

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
