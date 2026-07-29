/**
 * The `default: assertNever(...)` arms are unreachable through the type system —
 * that is their purpose. These tests reach them by casting, so that adding a
 * union member without updating every switch fails loudly at runtime as well as
 * at compile time.
 */

import { civilDate } from '../civil/date';
import type { CalendarConfig } from '../civil/types';
import { describeRule } from './describe';
import { expandOccurrences } from './expand';
import type { RecurrenceRule, Schedule } from './types';

const CAL: CalendarConfig = { weekStartsOn: 0, timeZone: 'UTC' };
const unknownRule = { kind: 'yearly', everyNYears: 1 } as unknown as RecurrenceRule;

const scheduleWith = (rule: RecurrenceRule): Schedule => ({
  rule,
  startsOn: civilDate('2026-01-01'),
  endsOn: null,
  timeOfDay: null,
});

describe('exhaustiveness guards', () => {
  it('expandOccurrences rejects an unknown rule kind', () => {
    expect(() =>
      expandOccurrences('chore', scheduleWith(unknownRule), CAL, {
        start: civilDate('2026-01-01'),
        end: civilDate('2026-01-31'),
      }),
    ).toThrow(/Unhandled recurrence rule/);
  });

  it('describeRule rejects an unknown rule kind', () => {
    expect(() => describeRule(unknownRule)).toThrow(/Unhandled recurrence rule/);
  });

  it('describeRule rejects an unknown "once" granularity', () => {
    const rule = {
      kind: 'once',
      dueOn: civilDate('2026-03-14'),
      granularity: 'decade',
    } as unknown as RecurrenceRule;
    expect(() => describeRule(rule)).toThrow(/Unhandled once granularity/);
  });
});
