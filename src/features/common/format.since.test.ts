import { formatSince } from './format';

const NOW = new Date('2026-09-23T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('how long ago a note was touched', () => {
  it('says "just now" for the case that matters most', () => {
    // You are both looking at it right now, which is exactly when
    // last-write-wins is about to bite.
    expect(formatSince(ago(5_000), NOW)).toBe('just now');
  });

  it.each([
    [2 * MINUTE, '2 minutes ago'],
    [1 * HOUR, '1 hour ago'],
    [5 * HOUR, '5 hours ago'],
    [2 * DAY, '2 days ago'],
  ])('reads %p as %p', (delta, expected) => {
    expect(formatSince(ago(delta), NOW)).toBe(expected);
  });

  it('gets the singular right, which is the tell for a generated string', () => {
    expect(formatSince(ago(1 * MINUTE), NOW)).toBe('1 minute ago');
    expect(formatSince(ago(1 * DAY), NOW)).toBe('1 day ago');
  });

  it('falls back to a date once "days ago" stops being useful', () => {
    expect(formatSince(ago(30 * DAY), NOW)).toMatch(/^on \d/);
  });

  it('does not say "in 3 seconds" when a phone clock runs fast', () => {
    // Two phones disagreeing by a few seconds is ordinary; a note claiming to
    // have been edited in the future is not.
    expect(formatSince(new Date(NOW.getTime() + 3_000).toISOString(), NOW)).toBe('just now');
  });

  it('returns null for something that is not a timestamp', () => {
    expect(formatSince('not a date', NOW)).toBeNull();
  });
});
