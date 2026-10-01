import type { CivilTime } from '../civil/types';

import { owedBadge, owedByNow, type OwedCandidate } from './owed';

const ME = 'me';
const THEM = 'them';
const t = (s: string) => s as CivilTime;

function item(over: Partial<OwedCandidate> = {}): OwedCandidate {
  return {
    ownerId: ME,
    bucket: 'morning',
    timeOfDay: null,
    status: 'due',
    ...over,
  };
}

describe('what has come due by now', () => {
  it('counts an untimed item once its bucket has started', () => {
    const items = [item({ bucket: 'afternoon' })];

    expect(owedByNow(items, { userId: ME, now: t('11:59') })).toBe(0);
    expect(owedByNow(items, { userId: ME, now: t('12:00') })).toBe(1);
  });

  /*
   * The distinction worth having. Rounding a timed item down to its bucket
   * would claim the 21:00 medication was owed at five in the afternoon, which
   * is a badge that lies for four hours every day.
   */
  it('counts a timed item from its own time, not its bucket’s', () => {
    const items = [item({ bucket: 'night', timeOfDay: t('21:00') })];

    expect(owedByNow(items, { userId: ME, now: t('20:00') })).toBe(0);
    expect(owedByNow(items, { userId: ME, now: t('21:00') })).toBe(1);
  });

  it('keeps counting what you skipped earlier in the day', () => {
    const items = [item({ bucket: 'morning' }), item({ bucket: 'afternoon' })];

    expect(owedByNow(items, { userId: ME, now: t('17:30') })).toBe(2);
  });

  it('does not count what has not come due yet', () => {
    const items = [item({ bucket: 'evening' }), item({ bucket: 'night' })];

    expect(owedByNow(items, { userId: ME, now: t('09:00') })).toBe(0);
  });

  it('stops counting an item once it is done', () => {
    const items = [item({ status: 'completed' }), item({ status: 'due' })];

    expect(owedByNow(items, { userId: ME, now: t('09:00') })).toBe(1);
  });

  /*
   * On the day being viewed, a missed item is still work that came due and did
   * not happen — the badge should not go quiet just because the projector has
   * given up on it. It stops counting tomorrow, because a missed routine never
   * rolls forward.
   */
  it('counts a missed item, which is still owed today', () => {
    expect(owedByNow([item({ status: 'missed' })], { userId: ME, now: t('14:00') })).toBe(1);
  });

  it('ignores an upcoming item even if its bucket has somehow started', () => {
    expect(owedByNow([item({ status: 'upcoming' })], { userId: ME, now: t('14:00') })).toBe(0);
  });

  it('never counts your housemate’s shared routine — you cannot do their stretches', () => {
    const items = [item({ ownerId: THEM }), item({ ownerId: ME })];

    expect(owedByNow(items, { userId: ME, now: t('09:00') })).toBe(1);
  });

  it('counts nothing when nobody is signed in', () => {
    expect(owedByNow([item()], { userId: null, now: t('09:00') })).toBe(0);
  });

  /*
   * Night wraps midnight, which is the one real subtlety in this part of the
   * engine: the routine day runs 05:00 to 05:00, so half past midnight is
   * *late* in Tuesday's day, not early in it. Comparing raw 'HH:MM' would make
   * 00:30 the earliest moment of the day and count nothing at all.
   */
  it('treats half past midnight as the end of the day, not the start', () => {
    const items = [
      item({ bucket: 'morning' }),
      item({ bucket: 'afternoon' }),
      item({ bucket: 'evening' }),
      item({ bucket: 'night' }),
    ];

    expect(owedByNow(items, { userId: ME, now: t('00:30') })).toBe(4);
    // And the same list at six in the morning owes only the morning one.
    expect(owedByNow(items, { userId: ME, now: t('06:00') })).toBe(1);
  });

  it('owes nothing at the very start of the day', () => {
    const items = [
      item({ bucket: 'afternoon' }),
      item({ bucket: 'evening' }),
      item({ bucket: 'night' }),
    ];

    expect(owedByNow(items, { userId: ME, now: t('05:00') })).toBe(0);
  });

  it('is zero for an empty routine', () => {
    expect(owedByNow([], { userId: ME, now: t('09:00') })).toBe(0);
  });
});

describe('owedBadge', () => {
  it('shows nothing when nothing is owed', () => {
    expect(owedBadge(0)).toBeNull();
    expect(owedBadge(-1)).toBeNull();
  });

  it('shows the number up to nine', () => {
    expect(owedBadge(1)).toBe('1');
    expect(owedBadge(9)).toBe('9');
  });

  it('caps past nine, where the exact figure stops being the point', () => {
    expect(owedBadge(10)).toBe('9+');
  });
});
