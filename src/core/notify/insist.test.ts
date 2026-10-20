import { civilDate } from '../civil/date';
import type { CivilDate, CivilTime } from '../civil/types';

import { MAX_NAGGING_PER_DAY, NAG_OFFSETS, nagBody, nagSteps } from './insist';

const d = (s: string): CivilDate => civilDate(s);
const t = (s: string): CivilTime => s as CivilTime;
const at = (date: string, time: string) =>
  nagSteps(d(date), t(time)).map((s) => `${s.onDate}T${s.atTime}`);

describe('the ladder', () => {
  it('starts at the reminder’s own time', () => {
    // The first step *is* the ordinary reminder, so a nag costs five extra
    // slots rather than six.
    expect(at('2026-10-20', '09:00')[0]).toBe('2026-10-20T09:00');
  });

  it('widens rather than repeating on a metronome', () => {
    /*
     * Equal gaps train you to swipe without reading, which is the failure the
     * whole notification layer is written against. The gaps have to grow.
     */
    const gaps = NAG_OFFSETS.slice(1).map((offset, i) => offset - NAG_OFFSETS[i]!);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    expect(new Set(gaps).size).toBe(gaps.length);
  });

  it('lands where the offsets say', () => {
    expect(at('2026-10-20', '09:00')).toEqual([
      '2026-10-20T09:00',
      '2026-10-20T09:03',
      '2026-10-20T09:08',
      '2026-10-20T09:16',
      '2026-10-20T09:27',
      '2026-10-20T09:40',
    ]);
  });

  it('rolls onto the next date rather than inventing an impossible time', () => {
    /*
     * A nag starting at 23:50 runs past midnight. A caller adding minutes to
     * the clock itself would produce "24:30", which the engine's own time
     * parser rejects — which is why this returns dates and not offsets.
     */
    expect(at('2026-10-20', '23:50')).toEqual([
      '2026-10-20T23:50',
      '2026-10-20T23:53',
      '2026-10-20T23:58',
      '2026-10-21T00:06',
      '2026-10-21T00:17',
      '2026-10-21T00:30',
    ]);
  });

  it('crosses a month boundary with it', () => {
    expect(at('2026-10-31', '23:55')[5]).toBe('2026-11-01T00:35');
  });

  it('never produces a time the engine would refuse', () => {
    for (const hour of [0, 9, 23]) {
      for (const minute of [0, 30, 59]) {
        const stamp = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        for (const step of nagSteps(d('2026-10-20'), t(stamp))) {
          expect(step.atTime).toMatch(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
        }
      }
    }
  });

  it('numbers its steps so each one gets its own identifier', () => {
    // Two notifications sharing an id are one notification: the transport
    // schedules by identifier and the second silently replaces the first.
    expect(nagSteps(d('2026-10-20'), t('09:00')).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('what the repeats say', () => {
  it('leaves the first one alone', () => {
    expect(nagBody('Dishes · due today', 0)).toBe('Dishes · due today');
  });

  it('says the later ones are repeats', () => {
    // A notification identical to one from three minutes ago reads as a bug in
    // the app rather than the app doing as it was told.
    expect(nagBody('Dishes · due today', 1)).toBe('Dishes · due today — still not done');
    expect(nagBody('Dishes · due today', 5)).toBe('Dishes · due today — still not done');
  });
});

describe('the budget', () => {
  it('leaves room for the rest of the day', () => {
    /*
     * `MAX_PENDING` is 60 and the planner keeps the soonest. Three nagging
     * chores is 18 of the earliest slots; a fourth starts pushing real
     * reminders off the end of the queue.
     */
    expect(MAX_NAGGING_PER_DAY * NAG_OFFSETS.length).toBeLessThanOrEqual(20);
  });
});
