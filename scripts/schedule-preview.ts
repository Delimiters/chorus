/**
 * Prints what a recurrence rule actually does.
 *
 * A debugging tool and the Phase 1 demo: it lets you see the engine's answer
 * for any rule without launching the app.
 *
 *   npm run schedule:preview -- '{"kind":"monthlyByDay","everyNMonths":2,"dayOfMonth":31,"overflow":"clamp"}'
 *   npm run schedule:preview -- '{"kind":"weeklyFloating","everyNWeeks":1,"timesPerPeriod":3}' --from 2026-03-01
 *   npm run schedule:preview -- --examples
 */

import { addDays, civilDate, weekdayOf } from '../src/core/civil/date';
import type { CalendarConfig, CivilDate, Weekday } from '../src/core/civil/types';
import { describeSchedule } from '../src/core/recurrence/describe';
import { MAX_WINDOW_DAYS, expandOccurrences } from '../src/core/recurrence/expand';
import { recurrenceRuleSchema } from '../src/core/recurrence/schema';
import type { RecurrenceRule, Schedule } from '../src/core/recurrence/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const EXAMPLES: readonly { label: string; rule: RecurrenceRule }[] = [
  { label: 'Every day', rule: { kind: 'daily', everyNDays: 1 } },
  { label: 'Every 3 days', rule: { kind: 'daily', everyNDays: 3 } },
  { label: 'Mondays', rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1] } },
  { label: 'Mon/Wed/Fri', rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 3, 5] } },
  { label: 'Every other Monday', rule: { kind: 'weekly', everyNWeeks: 2, weekdays: [1] } },
  {
    label: '3x per week, any day',
    rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
  },
  {
    label: 'The 31st (clamped)',
    rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
  },
  {
    label: 'The 31st (skip short months)',
    rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'skip' },
  },
  {
    label: 'Every other month on the 31st',
    rule: { kind: 'monthlyByDay', everyNMonths: 2, dayOfMonth: 31, overflow: 'clamp' },
  },
  {
    label: '2nd Saturday',
    rule: { kind: 'monthlyByWeekday', everyNMonths: 1, nth: 2, weekday: 6 },
  },
  {
    label: 'Last Friday',
    rule: { kind: 'monthlyByWeekday', everyNMonths: 1, nth: -1, weekday: 5 },
  },
  {
    label: 'Twice a month, any day',
    rule: { kind: 'monthlyFloating', everyNMonths: 1, timesPerPeriod: 2 },
  },
];

function parseArgs(argv: readonly string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(name, next);
        i += 1;
      } else {
        flags.set(name, 'true');
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function render(
  rule: RecurrenceRule,
  from: CivilDate,
  days: number,
  cal: CalendarConfig,
  limit: number,
) {
  const schedule: Schedule = { rule, startsOn: from, endsOn: null, timesOfDay: [] };
  const occurrences = expandOccurrences('preview', schedule, cal, {
    start: from,
    end: addDays(from, days - 1),
  });

  console.log(`  ${describeSchedule(schedule)}`);
  if (occurrences.length === 0) {
    console.log('  (no occurrences in this window)');
    return;
  }

  const shown = occurrences.slice(0, limit);
  for (const occ of shown) {
    const day = DAY_NAMES[weekdayOf(occ.dueOn) as Weekday];
    const floating =
      occ.flexibleFrom === occ.flexibleUntil
        ? ''
        : `  (any day ${occ.flexibleFrom} … ${occ.flexibleUntil}, slot ${occ.slot})`;
    console.log(`    ${day} ${occ.dueOn}${floating}`);
  }
  if (occurrences.length > shown.length) {
    console.log(`    … and ${occurrences.length - shown.length} more`);
  }
}

function main(): void {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  const cal: CalendarConfig = {
    weekStartsOn: Number(flags.get('week-starts-on') ?? 0) as Weekday,
  };
  const from = civilDate(flags.get('from') ?? todayUtc());
  const days = Math.min(Number(flags.get('days') ?? 120), MAX_WINDOW_DAYS);
  const limit = Number(flags.get('limit') ?? 20);

  if (flags.has('examples') || positional.length === 0) {
    console.log(`\nSchedule preview — from ${from}, next ${days} days\n`);
    for (const { label, rule } of EXAMPLES) {
      console.log(`${label}`);
      render(rule, from, days, cal, 6);
      console.log('');
    }
    console.log('Pass a rule as JSON to preview your own:');
    console.log(`  npm run schedule:preview -- '{"kind":"daily","everyNDays":2}'\n`);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(positional[0] as string);
  } catch {
    console.error(`Could not parse that as JSON:\n  ${positional[0] as string}`);
    process.exit(1);
  }

  const result = recurrenceRuleSchema.safeParse(parsed);
  if (!result.success) {
    console.error('That is not a valid recurrence rule:\n');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(`\nFrom ${from}, next ${days} days:\n`);
  render(result.data as RecurrenceRule, from, days, cal, limit);
  console.log('');
}

/** The one place this tool touches a real clock — it is a CLI, not the engine. */
function todayUtc(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
}

main();
