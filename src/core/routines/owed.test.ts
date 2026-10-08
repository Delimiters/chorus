import type { CivilDate, CivilTime } from '../civil/types';

import { owedBadge, owedByNow, type OwedCandidate } from './owed';

const ME = 'me';
const THEM = 'them';
const TODAY = '2026-10-01' as CivilDate;
const YESTERDAY = '2026-09-30' as CivilDate;
const TOMORROW = '2026-10-02' as CivilDate;
const t = (s: string) => s as CivilTime;

function item(over: Partial<OwedCandidate> = {}): OwedCandidate {
  return {
    ownerId: ME,
    dueOn: TODAY,
    bucket: 'morning',
    timeOfDay: null,
    status: 'due',
    ...over,
  };
}

/*
 * `dayStartsAtHour: 5` throughout the existing tests, deliberately.
 *
 * Five is the routine day's own origin, which is what every assertion here was
 * written against — so holding it there makes this file the "did measuring from
 * the household break change the count" check. The break's own effect is tested
 * on its own terms at the bottom.
 */
const ROUTINE_DAY = 5;

describe('what has come due by now', () => {
  it('counts an untimed item once its bucket’s reminder time has arrived', () => {
    const items = [item({ bucket: 'afternoon' })];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('12:29'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(0);
    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('12:30'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  /*
   * The distinction worth having. Rounding a timed item down to its bucket
   * would claim the 21:00 medication was owed at five in the afternoon, which
   * is a badge that lies for four hours every day.
   */
  it('counts a timed item from its own time, not its bucket’s', () => {
    const items = [item({ bucket: 'night', timeOfDay: t('21:00') })];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('20:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(0);
    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('21:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  it('keeps counting what you skipped earlier in the day', () => {
    const items = [item({ bucket: 'morning' }), item({ bucket: 'afternoon' })];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('17:30'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(2);
  });

  it('does not count what has not come due yet', () => {
    const items = [item({ bucket: 'evening' }), item({ bucket: 'night' })];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('09:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(0);
  });

  it('stops counting an item once it is done', () => {
    const items = [item({ status: 'completed' }), item({ status: 'due' })];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('09:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  /*
   * On the day being viewed, a missed item is still work that came due and did
   * not happen — the badge should not go quiet just because the projector has
   * given up on it. It stops counting tomorrow, because a missed routine never
   * rolls forward.
   */
  /*
   * ── The defect a day-less shape could not express ─────────────────────
   *
   * The caller hands over a whole quantised week, because that is what
   * `useRoutineDay` fetches for the screen that pages through days. Every
   * incomplete occurrence earlier in the week is `missed`, and with no day to
   * compare against they all counted: one daily item read `5` on a Thursday
   * and `7` by Saturday — the wallpaper this was built not to be.
   *
   * `OwedCandidate` had no `dueOn` at all, so no fixture could state this, and
   * `RoutineOccurrence` satisfied the narrower shape structurally so it type
   * checked. Hence the day is a required option now.
   */
  it('counts only today, out of the whole week it is handed', () => {
    const items = [
      item({ dueOn: YESTERDAY, status: 'missed' }),
      item({ dueOn: '2026-09-29' as CivilDate, status: 'missed' }),
      item({ dueOn: TODAY }),
      item({ dueOn: TOMORROW, status: 'upcoming' }),
    ];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('14:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  /*
   * Spelled out because it is the clause that let the week in. For today's
   * date `statusOf` produces `due` or `completed` and nothing else, so
   * admitting `missed` bought nothing and cost the whole feature.
   */
  it('does not count a missed item, which by definition belongs to another day', () => {
    expect(
      owedByNow([item({ dueOn: YESTERDAY, status: 'missed' })], {
        userId: ME,
        today: TODAY,
        now: t('14:00'),
        dayStartsAtHour: ROUTINE_DAY,
      }),
    ).toBe(0);
  });

  /*
   * The day filter on its own, with the status filter unable to help.
   *
   * Today's projection cannot produce a `due` item dated to another day — so
   * without this fixture, deleting `dueOn === today` changes nothing and the
   * check is dead code that reads as a guarantee. Here the two filters are
   * separated: a `due` item on the wrong day must still not count, because the
   * day is the thing being asserted, not a side effect of how `statusOf`
   * happens to work today.
   */
  it('counts only today even for an item that calls itself due', () => {
    const items = [item({ dueOn: YESTERDAY }), item({ dueOn: TOMORROW }), item({ dueOn: TODAY })];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('14:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  it('ignores an upcoming item even if its bucket has somehow started', () => {
    expect(
      owedByNow([item({ status: 'upcoming' })], {
        userId: ME,
        today: TODAY,
        now: t('14:00'),
        dayStartsAtHour: ROUTINE_DAY,
      }),
    ).toBe(0);
  });

  it('never counts your housemate’s shared routine — you cannot do their stretches', () => {
    const items = [item({ ownerId: THEM }), item({ ownerId: ME })];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('09:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  it('counts nothing when nobody is signed in', () => {
    expect(
      owedByNow([item()], {
        userId: null,
        today: TODAY,
        now: t('09:00'),
        dayStartsAtHour: ROUTINE_DAY,
      }),
    ).toBe(0);
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

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('00:30'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(4);
    // And the same list at eight in the morning owes only the morning one.
    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('08:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  /*
   * Morning included, which the first version of this fixture quietly left out
   * — and morning is the only bucket where the structural start and the
   * reminder time differ. Measuring from `bucketStart` made every untimed
   * morning item owed at 05:00, so the count opened the day at full rather
   * than at zero. This is the single input that shows it.
   */
  it('owes nothing at the very start of the day', () => {
    const items = [
      item({ bucket: 'morning' }),
      item({ bucket: 'afternoon' }),
      item({ bucket: 'evening' }),
      item({ bucket: 'night' }),
    ];

    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('05:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(0);
    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('06:59'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(0);
    // And owed once the morning reminder time arrives, not before.
    expect(
      owedByNow(items, { userId: ME, today: TODAY, now: t('07:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(1);
  });

  it('is zero for an empty routine', () => {
    expect(
      owedByNow([], { userId: ME, today: TODAY, now: t('09:00'), dayStartsAtHour: ROUTINE_DAY }),
    ).toBe(0);
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

describe('counting against the household day break', () => {
  /*
   * Both sides of "has this come due yet" have to be measured from the same
   * origin as `today`, or the count is simply wrong — and wrong in a direction
   * nobody would question, because a badge reading 2 instead of 5 looks like a
   * badge.
   *
   * The old code measured elapsed time from the routine day's fixed 05:00 while
   * `today` came from the household break. A review found the consequence at the
   * far end of the allowed range.
   */
  const evening = item({ dueOn: TODAY, status: 'due', bucket: 'evening', timeOfDay: null });
  const morning = item({ dueOn: TODAY, status: 'due', bucket: 'morning', timeOfDay: null });

  it('counts a whole day of items once that day has passed', () => {
    /*
     * The case that was broken: with the break at noon, 09:00 on Tuesday is
     * still *Monday*, twenty-one hours into it — so Monday's morning and evening
     * items have both long since come due. Measured from 05:00 instead, "now"
     * looked like four hours into the day and the evening item vanished from
     * the count.
     */
    const count = owedByNow([morning, evening], {
      userId: ME,
      today: TODAY,
      now: t('09:00'),
      dayStartsAtHour: 12,
    });

    expect(count).toBe(2);
  });

  it('still waits for an item to come due', () => {
    // The guard that stops this from being "count everything": at 13:00 with a
    // noon break we are one hour in, and neither has arrived.
    const count = owedByNow([morning, evening], {
      userId: ME,
      today: TODAY,
      now: t('13:00'),
      dayStartsAtHour: 12,
    });

    expect(count).toBe(0);
  });

  it('counts the small hours as part of the night before', () => {
    /*
     * With a 3 AM break, 01:00 on Tuesday is twenty-two hours into Monday — so
     * Monday's evening item is owed, which is the whole point of the break.
     */
    const count = owedByNow([evening], {
      userId: ME,
      today: TODAY,
      now: t('01:00'),
      dayStartsAtHour: 3,
    });

    expect(count).toBe(1);
  });

  it('agrees with the old behaviour at the routine day’s own origin', () => {
    // At 5 the new measure is the old one, which is what pins the rest of this
    // file as a no-change check.
    expect(
      owedByNow([morning, evening], {
        userId: ME,
        today: TODAY,
        now: t('20:00'),
        dayStartsAtHour: ROUTINE_DAY,
      }),
    ).toBe(2);
  });
});
