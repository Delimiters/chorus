import { addDays } from '../civil/date';
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
   * Both sides of "has this come due yet" have to be measured against the same
   * day as `today`, or the count is wrong in a direction nobody would question —
   * a badge reading 2 instead of 5 just looks like a badge.
   *
   * There are two boundaries in play and this is the one place that reconciles
   * them. An item's `dueOn` is a **routine** day (05:00 to 05:00), so an item
   * timed 04:00 happens on the *next* calendar morning; which **household** day
   * that instant falls in is then the break's question.
   */
  const TOMORROW = addDays(TODAY, 1);
  const YESTER = addDays(TODAY, -1);
  const evening = (dueOn: CivilDate) =>
    item({ dueOn, status: 'due', bucket: 'evening', timeOfDay: null });
  const smallHours = (dueOn: CivilDate) =>
    item({ dueOn, status: 'due', bucket: 'night', timeOfDay: t('04:00') });
  const count = (items: ReturnType<typeof item>[], today: CivilDate, now: string, hour = 3) =>
    owedByNow(items, { userId: ME, today, now: t(now), dayStartsAtHour: hour });

  it('counts the evening once the evening has passed', () => {
    expect(count([evening(TODAY)], TODAY, '23:00')).toBe(1);
  });

  it('does not count it before it arrives', () => {
    expect(count([evening(TODAY)], TODAY, '16:00')).toBe(0);
  });

  it('still counts last night at one in the morning', () => {
    // The whole point of the break: at 01:00 the day is still yesterday, and
    // yesterday's evening item is owed.
    expect(count([evening(YESTER)], YESTER, '01:00')).toBe(1);
  });

  it('does not count an item that has not happened yet, a day early', () => {
    /*
     * The regression a review caught in the first version of this fix. An item
     * timed 04:00 on Monday happens on *Tuesday* morning — the reminder for it
     * is scheduled that way — but measuring its due-from against Monday's break
     * made it look an hour into Monday, so the badge counted it from Monday
     * morning onwards: twenty-three hours early, and before the thing exists.
     */
    expect(count([smallHours(TODAY)], TODAY, '23:00')).toBe(0);
  });

  it('counts it when its morning actually comes', () => {
    // Non-vacuity for the pair above: at 04:30 the item is an hour and a half
    // into the household day it belongs to.
    expect(count([smallHours(TODAY)], TOMORROW, '04:30')).toBe(1);
  });

  it('files an item by the household day its instant falls in', () => {
    /*
     * With the break at noon, an item timed 07:00 on a routine Monday happens at
     * 07:00 — which is still *Sunday's* household day, because Monday's has not
     * begun. So it is not Monday's business, and `today = Monday` must not count
     * it.
     */
    const morning = item({ dueOn: TODAY, status: 'due', bucket: 'morning', timeOfDay: null });
    expect(count([morning], TODAY, '13:00', 12)).toBe(0);
    expect(count([morning], YESTER, '11:00', 12)).toBe(1);
  });

  it('agrees with the old behaviour at the routine day’s own origin', () => {
    // At 5 the measure is the old one, which is what pins the rest of this file
    // as a no-change check.
    expect(
      owedByNow(
        [evening(TODAY), item({ dueOn: TODAY, status: 'due', bucket: 'morning', timeOfDay: null })],
        {
          userId: ME,
          today: TODAY,
          now: t('20:00'),
          dayStartsAtHour: ROUTINE_DAY,
        },
      ),
    ).toBe(2);
  });
});
