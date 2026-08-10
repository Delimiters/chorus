/**
 * Property tests for the expander.
 *
 * The invariant catalogue lives in docs/TESTING.md; the P-numbers below refer
 * to it. Several of these correspond directly to bugs that shipped in the
 * previous implementation — see docs/POSTMORTEM-SWIFT.md.
 */

import fc from 'fast-check';

import { arbCalendarConfig, arbWindow } from '../__testing__/arbitraries';
import {
  arbMonthlyByDay,
  arbMonthlyFloating,
  arbSchedule,
  arbScheduleAndWindow,
  arbScheduleWindowAndSplit,
  arbSchedulableRule,
  arbWeekly,
  arbWeeklyFloating,
} from '../__testing__/rules';
import {
  addDays,
  civilDate,
  compareCivil,
  isSameOrAfter,
  isSameOrBefore,
  isWithin,
  startOfWeek,
} from '../civil/date';
import type { CalendarConfig, CivilDate, DateWindow } from '../civil/types';
import { MAX_WINDOW_DAYS, WindowTooWideError, expandOccurrences } from './expand';
import type { Occurrence, Schedule } from './types';

const CHORE = 'chore-1';
const expand = (s: Schedule, cal: CalendarConfig, w: DateWindow): readonly Occurrence[] =>
  expandOccurrences(CHORE, s, cal, w);

// A window narrow enough that composability splits stay under MAX_WINDOW_DAYS.
const arbSafeWindow = () => arbWindow(180);

describe('P1 — determinism', () => {
  it('produces identical output for identical input', () => {
    fc.assert(
      fc.property(arbScheduleAndWindow(), arbCalendarConfig(), ({ schedule, window }, cal) => {
        expect(expand(schedule, cal, window)).toEqual(expand(schedule, cal, window));
      }),
    );
  });
});

describe('the generators actually generate occurrences', () => {
  // A meta-test, because the original generators drew startsOn and the window
  // independently across a 70-year range: measured, 93.8% of runs produced zero
  // occurrences, so every property below was asserting almost nothing. That is
  // why two real expansion bugs survived a property suite. If this regresses,
  // the rest of this file quietly stops testing anything.
  it('produces a non-empty expansion in most runs', () => {
    let empty = 0;
    let total = 0;
    fc.assert(
      fc.property(arbScheduleAndWindow(), arbCalendarConfig(), ({ schedule, window }, cal) => {
        total += 1;
        if (expand(schedule, cal, window).length === 0) empty += 1;
      }),
      // Seeded: this measures the generators, so it must not itself be flaky.
      { numRuns: 500, seed: 20260730 },
    );
    // `unscheduled` is one of eight rule kinds and always yields nothing, and
    // `once` yields at most one occurrence, so a perfect score is impossible.
    // The bar is "nothing like the 94% that let two real bugs through".
    expect(empty / total).toBeLessThan(0.5);
    console.log(`generator coverage: ${(100 - (empty / total) * 100).toFixed(1)}% non-empty`);
  });
});

describe('P2 — window composability', () => {
  // The highest-value property in the suite: any off-by-one at a window edge,
  // in any rule, shows up here.
  it('expanding a window equals expanding its two halves', () => {
    fc.assert(
      fc.property(
        arbScheduleWindowAndSplit(),
        arbCalendarConfig(),
        ({ schedule, window, splitAfter }, cal) => {
          const whole = expand(schedule, cal, window);
          const left = expand(schedule, cal, { start: window.start, end: splitAfter });
          const right = expand(schedule, cal, { start: addDays(splitAfter, 1), end: window.end });
          expect([...left, ...right]).toEqual([...whole]);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('P3 — ordering and key uniqueness', () => {
  it('is sorted by (dueOn, slot)', () => {
    fc.assert(
      fc.property(arbScheduleAndWindow(), arbCalendarConfig(), ({ schedule, window }, cal) => {
        const result = expand(schedule, cal, window);
        for (let i = 1; i < result.length; i += 1) {
          const prev = result[i - 1] as Occurrence;
          const curr = result[i] as Occurrence;
          const byDate = compareCivil(prev.dueOn, curr.dueOn);
          expect(byDate <= 0).toBe(true);
          if (byDate === 0) expect(prev.slot).toBeLessThan(curr.slot);
        }
      }),
    );
  });

  // Directly kills the prototype's collapse-by-dedupe bug.
  it('never produces two occurrences with the same key', () => {
    fc.assert(
      fc.property(arbScheduleAndWindow(), arbCalendarConfig(), ({ schedule, window }, cal) => {
        const keys = expand(schedule, cal, window).map((o) => o.occurrenceKey);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it('gives every occurrence a distinct index', () => {
    fc.assert(
      fc.property(arbScheduleAndWindow(), arbCalendarConfig(), ({ schedule, window }, cal) => {
        const indices = expand(schedule, cal, window).map((o) => o.occurrenceIndex);
        expect(new Set(indices).size).toBe(indices.length);
      }),
    );
  });

  /**
   * The index has to *increase with the date*, and distinctness is not that.
   *
   * `occurrenceIndex` is what an `occurrence`-cadence rotation counts turns
   * with — the default cadence — so an index that jumps around hands out turns
   * in an order nobody asked for. A weekly Mon/Wed/Fri chore created on a
   * Friday produced alice, alice, bob, bob, bob, alice: three in a row, from a
   * rule that says "alternate".
   *
   * The old property passed throughout. Every index was distinct; they were
   * simply in the wrong order, and nothing looked at the order.
   */
  it('numbers occurrences in the order they fall', () => {
    fc.assert(
      fc.property(arbScheduleAndWindow(), arbCalendarConfig(), ({ schedule, window }, cal) => {
        const occurrences = expand(schedule, cal, window);
        for (let i = 1; i < occurrences.length; i += 1) {
          const prev = occurrences[i - 1] as {
            dueOn: string;
            occurrenceIndex: number;
            slot: number;
          };
          const next = occurrences[i] as { dueOn: string; occurrenceIndex: number; slot: number };
          // Same date means concurrent floating slots, which are ordered by
          // slot rather than by date; anything later must have a higher index.
          if (next.dueOn > prev.dueOn) {
            expect(next.occurrenceIndex).toBeGreaterThan(prev.occurrenceIndex);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('numbers a multi-day weekly rule in date order whatever weekday it starts on', () => {
    // The specific shape the property above generalises, pinned because it is
    // the one a person actually creates: "bins on Mon, Wed and Fri".
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), (startWeekday) => {
        // A week in 2026 beginning on a Sunday, offset to the chosen weekday.
        const anchor = addDays(civilDate('2026-07-26'), startWeekday);
        const occurrences = expand(
          {
            rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 3, 5] },
            startsOn: anchor,
            endsOn: null,
            timesOfDay: [],
          } as never,
          { weekStartsOn: 0 },
          { start: anchor, end: addDays(anchor, 40) },
        );
        const indices = occurrences.map((o) => o.occurrenceIndex);
        expect(indices).toEqual([...indices].sort((a, b) => a - b));
      }),
      { numRuns: 7 },
    );
  });
});

describe('P4 — floating cardinality', () => {
  // "3× per week" must yield exactly 3 occurrences per complete week. This is
  // the single most important regression guard in the codebase.
  it('weeklyFloating yields timesPerPeriod occurrences per complete period', () => {
    fc.assert(
      fc.property(
        arbWeeklyFloating(),
        arbCalendarConfig(),
        fc.integer({ min: 0, max: 20_000 }),
        (rule, cal, startDay) => {
          if (rule.kind !== 'weeklyFloating') return;
          const startsOn = addDays('2000-01-02' as CivilDate, startDay);
          const schedule: Schedule = { rule, startsOn, endsOn: null, timesOfDay: [] };
          // A window covering many whole cycles, aligned to the anchor week.
          const anchorWeek = startOfWeek(startsOn, cal.weekStartsOn);
          const window = { start: anchorWeek, end: addDays(anchorWeek, 20 * 7 - 1) };

          const byPeriod = new Map<string, number>();
          for (const occ of expandOccurrences(CHORE, schedule, cal, window)) {
            byPeriod.set(occ.periodKey, (byPeriod.get(occ.periodKey) ?? 0) + 1);
          }
          for (const count of byPeriod.values()) {
            expect(count).toBe(rule.timesPerPeriod);
          }
        },
      ),
    );
  });

  it('monthlyFloating yields timesPerPeriod occurrences per complete period', () => {
    fc.assert(
      fc.property(
        arbMonthlyFloating(),
        arbCalendarConfig(),
        fc.integer({ min: 0, max: 300 }),
        (rule, cal, monthOffset) => {
          if (rule.kind !== 'monthlyFloating') return;
          const startsOn = addDays('2000-01-01' as CivilDate, monthOffset);
          const schedule: Schedule = { rule, startsOn, endsOn: null, timesOfDay: [] };
          const window = { start: startsOn, end: addDays(startsOn, 360) };

          const byPeriod = new Map<string, number>();
          for (const occ of expandOccurrences(CHORE, schedule, cal, window)) {
            byPeriod.set(occ.periodKey, (byPeriod.get(occ.periodKey) ?? 0) + 1);
          }
          for (const count of byPeriod.values()) {
            expect(count).toBe(rule.timesPerPeriod);
          }
        },
      ),
    );
  });

  it('gives floating occurrences slots 0..n-1 within each period', () => {
    fc.assert(
      fc.property(
        arbWeeklyFloating(),
        arbCalendarConfig(),
        arbSafeWindow(),
        (rule, cal, window) => {
          const schedule: Schedule = {
            rule,
            startsOn: '2020-01-01' as CivilDate,
            endsOn: null,
            timesOfDay: [],
          };
          const byPeriod = new Map<string, number[]>();
          for (const occ of expandOccurrences(CHORE, schedule, cal, window)) {
            byPeriod.set(occ.periodKey, [...(byPeriod.get(occ.periodKey) ?? []), occ.slot]);
          }
          for (const slots of byPeriod.values()) {
            expect([...slots].sort((a, b) => a - b)).toEqual(slots.map((_, i) => i));
          }
        },
      ),
    );
  });
});

describe('P8 — once and unscheduled', () => {
  it('unscheduled never produces an occurrence', () => {
    fc.assert(
      fc.property(arbCalendarConfig(), arbSafeWindow(), (cal, window) => {
        const schedule: Schedule = {
          rule: { kind: 'unscheduled' },
          startsOn: '2020-01-01' as CivilDate,
          endsOn: null,
          timesOfDay: [],
        };
        expect(expand(schedule, cal, window)).toEqual([]);
      }),
    );
  });

  it('once produces at most one occurrence over any window', () => {
    fc.assert(
      fc.property(
        arbSchedule({ rule: fc.constant({ kind: 'unscheduled' }) }),
        arbCalendarConfig(),
        arbSafeWindow(),
        (base, cal, window) => {
          const schedule: Schedule = {
            ...base,
            rule: { kind: 'once', dueOn: base.startsOn, granularity: 'day' },
          };
          expect(expand(schedule, cal, window).length).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('P9 — bounds', () => {
  it('never produces an occurrence outside the window', () => {
    fc.assert(
      fc.property(arbScheduleAndWindow(), arbCalendarConfig(), ({ schedule, window }, cal) => {
        for (const occ of expand(schedule, cal, window)) {
          expect(isWithin(occ.dueOn, window.start, window.end)).toBe(true);
        }
      }),
    );
  });

  it('never produces an occurrence before startsOn or after endsOn', () => {
    fc.assert(
      fc.property(arbSchedule(), arbCalendarConfig(), arbSafeWindow(), (schedule, cal, window) => {
        for (const occ of expand(schedule, cal, window)) {
          expect(isSameOrAfter(occ.dueOn, schedule.startsOn)).toBe(true);
          if (schedule.endsOn) {
            expect(isSameOrBefore(occ.dueOn, schedule.endsOn)).toBe(true);
          }
        }
      }),
    );
  });

  it('returns nothing for an inverted window', () => {
    fc.assert(
      fc.property(arbSchedule(), arbCalendarConfig(), arbSafeWindow(), (schedule, cal, window) => {
        const inverted = { start: addDays(window.end, 1), end: window.start };
        if (compareCivil(inverted.start, inverted.end) <= 0) return;
        expect(expand(schedule, cal, inverted)).toEqual([]);
      }),
    );
  });

  it('rejects windows wider than the maximum', () => {
    const schedule: Schedule = {
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: '2020-01-01' as CivilDate,
      endsOn: null,
      timesOfDay: [],
    };
    const cal: CalendarConfig = { weekStartsOn: 0 };
    const start = '2020-01-01' as CivilDate;
    expect(() => expand(schedule, cal, { start, end: addDays(start, MAX_WINDOW_DAYS) })).toThrow(
      WindowTooWideError,
    );
    // Exactly at the limit is fine.
    expect(() =>
      expand(schedule, cal, { start, end: addDays(start, MAX_WINDOW_DAYS - 1) }),
    ).not.toThrow();
  });
});

describe('P15 — week-start independence', () => {
  // Anchored weekly rules name explicit weekdays, so the dates they produce
  // must not depend on where the household considers a week to begin.
  it('weekly produces the same dates under either week start', () => {
    fc.assert(
      fc.property(arbWeekly(), arbSafeWindow(), (rule, window) => {
        const schedule: Schedule = {
          rule,
          startsOn: '2020-01-01' as CivilDate,
          endsOn: null,
          timesOfDay: [],
        };
        const sunday = expand(schedule, { weekStartsOn: 0 }, window);
        const monday = expand(schedule, { weekStartsOn: 1 }, window);
        // everyNWeeks > 1 legitimately shifts which weeks are on-cycle, so
        // compare the weekday sets rather than exact dates in that case.
        if (rule.kind === 'weekly' && rule.everyNWeeks === 1) {
          expect(sunday.map((o) => o.dueOn)).toEqual(monday.map((o) => o.dueOn));
        }
      }),
    );
  });

  it('floating cardinality holds under either week start', () => {
    fc.assert(
      fc.property(arbWeeklyFloating(), arbSafeWindow(), (rule, window) => {
        const schedule: Schedule = {
          rule,
          startsOn: '2020-01-01' as CivilDate,
          endsOn: null,
          timesOfDay: [],
        };
        for (const weekStartsOn of [0, 1] as const) {
          const byPeriod = new Map<string, number>();
          for (const occ of expand(schedule, { weekStartsOn }, window)) {
            byPeriod.set(occ.periodKey, (byPeriod.get(occ.periodKey) ?? 0) + 1);
          }
          for (const count of byPeriod.values()) {
            if (rule.kind === 'weeklyFloating') expect(count).toBe(rule.timesPerPeriod);
          }
        }
      }),
    );
  });
});

describe('flexible ranges', () => {
  it('anchored rules have flexibleFrom === flexibleUntil === dueOn', () => {
    fc.assert(
      fc.property(
        arbSchedule({ rule: fc.oneof(arbWeekly(), arbMonthlyByDay()) }),
        arbCalendarConfig(),
        arbSafeWindow(),
        (schedule, cal, window) => {
          for (const occ of expand(schedule, cal, window)) {
            expect(occ.flexibleFrom).toBe(occ.dueOn);
            expect(occ.flexibleUntil).toBe(occ.dueOn);
          }
        },
      ),
    );
  });

  it('floating rules have a range containing dueOn', () => {
    fc.assert(
      fc.property(
        arbSchedule({ rule: fc.oneof(arbWeeklyFloating(), arbMonthlyFloating()) }),
        arbCalendarConfig(),
        arbSafeWindow(),
        (schedule, cal, window) => {
          for (const occ of expand(schedule, cal, window)) {
            expect(isWithin(occ.dueOn, occ.flexibleFrom, occ.flexibleUntil)).toBe(true);
            expect(isSameOrBefore(occ.flexibleFrom, occ.flexibleUntil)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('occurrence identity', () => {
  it('embeds the chore id and slot in every key', () => {
    fc.assert(
      fc.property(
        arbSchedulableRule(),
        arbCalendarConfig(),
        arbSafeWindow(),
        (rule, cal, window) => {
          const schedule: Schedule = {
            rule,
            startsOn: '2020-01-01' as CivilDate,
            endsOn: null,
            timesOfDay: [],
          };
          for (const occ of expandOccurrences('abc-123', schedule, cal, window)) {
            expect(occ.occurrenceKey).toContain('abc-123');
            expect(occ.occurrenceKey.endsWith(`:${occ.slot}:-`)).toBe(true);
            expect(occ.choreId).toBe('abc-123');
          }
        },
      ),
    );
  });

  it('tags every occurrence with the subject when fanning out', () => {
    fc.assert(
      fc.property(
        arbSchedulableRule(),
        arbCalendarConfig(),
        arbSafeWindow(),
        (rule, cal, window) => {
          const schedule: Schedule = {
            rule,
            startsOn: '2020-01-01' as CivilDate,
            endsOn: null,
            timesOfDay: [],
          };
          for (const occ of expandOccurrences(CHORE, schedule, cal, window, 'member-7')) {
            expect(occ.subject).toBe('member-7');
            expect(occ.occurrenceKey.endsWith(':member-7')).toBe(true);
          }
        },
      ),
    );
  });

  it('gives different subjects different keys for the same slot', () => {
    const schedule: Schedule = {
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: '2026-01-01' as CivilDate,
      endsOn: null,
      timesOfDay: [],
    };
    const cal: CalendarConfig = { weekStartsOn: 0 };
    const window = { start: '2026-01-01' as CivilDate, end: '2026-01-03' as CivilDate };
    const a = expandOccurrences(CHORE, schedule, cal, window, 'alice');
    const b = expandOccurrences(CHORE, schedule, cal, window, 'bob');
    expect(a.map((o) => o.occurrenceKey)).not.toEqual(b.map((o) => o.occurrenceKey));
    expect(a.map((o) => o.dueOn)).toEqual(b.map((o) => o.dueOn));
  });
});
