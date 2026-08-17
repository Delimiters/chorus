/**
 * The recurrence builder, driven the way a person drives it.
 *
 * Table-driven over **every shape listed in docs/ROADMAP.md**, because that list
 * is the actual requirement and a builder that cannot express one of them is a
 * builder that failed. Each case taps real controls and asserts two things: the
 * `RecurrenceRule` that comes out, and the sentence `describeRule` makes of it.
 *
 * The sentence matters as much as the rule. It is the only thing on screen that
 * tells you whether the controls meant what you thought, so if it were wrong the
 * rule being right would not save anybody.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { civilDate } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import { describeRule } from '@/core/recurrence/describe';
import { safeParseSchedule } from '@/core/recurrence/schema';
import type { RecurrenceRule } from '@/core/recurrence/types';
import { ThemeProvider } from '@/design/theme';
import {
  RecurrencePicker,
  draftFromRule,
  type RecurrenceDraft,
} from '@/features/common/RecurrencePicker';

const TODAY = civilDate('2026-07-30'); // a Thursday

/**
 * Renders the picker as a controlled component and exposes the latest rule.
 *
 * `async`, because RNTL v14's `render` is — a synchronous call leaves `screen`
 * unpopulated and every query fails with "render function has not been called".
 */
async function renderPicker(initial: RecurrenceRule = { kind: 'daily', everyNDays: 1 }) {
  const seen: RecurrenceDraft[] = [];

  function Harness() {
    const [draft, setDraft] = useState(() => draftFromRule(initial, TODAY));
    seen.push(draft);
    return (
      <ThemeProvider>
        <RecurrencePicker
          draft={draft}
          onChange={(next) => {
            setDraft(next);
          }}
          today={TODAY}
        />
      </ThemeProvider>
    );
  }

  const rendered = await render(<Harness />);
  return {
    ...rendered,
    rule: () => seen[seen.length - 1]?.rule as RecurrenceRule,
  };
}

const tapTab = async (name: string) => fireEvent.press(screen.getByRole('tab', { name }));
const tapButton = async (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const tapDay = async (name: string) => fireEvent.press(screen.getByRole('checkbox', { name }));

/** Presses a stepper until it reads the wanted value. */
async function setStepper(label: string, from: number, to: number) {
  const action = to > from ? 'Increase' : 'Decrease';
  for (let i = 0; i < Math.abs(to - from); i += 1) {
    await tapButton(`${action} ${label}`);
  }
}

describe('every recurrence shape the app promises', () => {
  it('daily', async () => {
    const p = await renderPicker();
    await tapTab('Daily');
    expect(p.rule()).toEqual({ kind: 'daily', everyNDays: 1 });
    expect(describeRule(p.rule())).toBe('every day');
  });

  it('every N days', async () => {
    const p = await renderPicker();
    await tapTab('Daily');
    await setStepper('days between', 1, 3);
    expect(p.rule()).toEqual({ kind: 'daily', everyNDays: 3 });
    expect(describeRule(p.rule())).toBe('every 3 days');
  });

  it('once a week on a specific day', async () => {
    const p = await renderPicker();
    await tapTab('Weekly');
    await tapTab('On set days');
    // Seeded with today (Thursday); switch it to Tuesday only.
    await tapDay('Thursday');
    await tapDay('Tuesday');
    expect(p.rule()).toEqual({ kind: 'weekly', everyNWeeks: 1, weekdays: [2] });
    expect(describeRule(p.rule())).toBe('every Tuesday');
  });

  it('several days a week', async () => {
    const p = await renderPicker();
    await tapTab('Weekly');
    await tapDay('Monday');
    await tapDay('Friday');
    // Sorted ascending, which the schema requires.
    expect(p.rule()).toEqual({ kind: 'weekly', everyNWeeks: 1, weekdays: [1, 4, 5] });
  });

  it('every N weeks on a day', async () => {
    const p = await renderPicker();
    await tapTab('Weekly');
    await setStepper('weeks between', 1, 2);
    expect(p.rule()).toEqual({ kind: 'weekly', everyNWeeks: 2, weekdays: [4] });
    expect(describeRule(p.rule())).toBe('every other Thursday');
  });

  it('N times a week, any days', async () => {
    const p = await renderPicker();
    await tapTab('Weekly');
    await tapTab('Any days');
    expect(p.rule()).toEqual({ kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 });
    expect(describeRule(p.rule())).toBe('3 times a week, any day');
  });

  it('once a month on a specific date', async () => {
    const p = await renderPicker();
    await tapTab('Monthly');
    // Today is the 30th, which is what the picker seeds.
    expect(p.rule()).toEqual({
      kind: 'monthlyByDay',
      everyNMonths: 1,
      dayOfMonth: 30,
      overflow: 'clamp',
    });
    expect(describeRule(p.rule())).toBe('monthly on the 30th (or the last day, in shorter months)');
  });

  it('every other month', async () => {
    const p = await renderPicker();
    await tapTab('Monthly');
    await setStepper('months between', 1, 2);
    expect(p.rule()).toMatchObject({ kind: 'monthlyByDay', everyNMonths: 2 });
  });

  it('the Nth weekday of the month', async () => {
    const p = await renderPicker();
    await tapTab('Monthly');
    await tapTab('On a weekday');
    await tapTab('2nd');
    await tapDay('Saturday');
    expect(p.rule()).toEqual({
      kind: 'monthlyByWeekday',
      everyNMonths: 1,
      nth: 2,
      weekday: 6,
    });
    expect(describeRule(p.rule())).toBe('monthly on the second Saturday');
  });

  it('the last weekday of the month', async () => {
    const p = await renderPicker();
    await tapTab('Monthly');
    await tapTab('On a weekday');
    await tapTab('Last');
    await tapDay('Friday');
    expect(p.rule()).toEqual({
      kind: 'monthlyByWeekday',
      everyNMonths: 1,
      nth: -1,
      weekday: 5,
    });
    expect(describeRule(p.rule())).toBe('monthly on the last Friday');
  });

  it('N times a month, any days', async () => {
    const p = await renderPicker();
    await tapTab('Monthly');
    await tapTab('Any days');
    expect(p.rule()).toEqual({ kind: 'monthlyFloating', everyNMonths: 1, timesPerPeriod: 3 });
    expect(describeRule(p.rule())).toBe('3 times a month, any day');
  });

  it('one-time, on a specific day', async () => {
    const p = await renderPicker();
    await tapTab('Once');
    await tapButton('Due date: Tomorrow');
    expect(p.rule()).toEqual({
      kind: 'once',
      dueOn: '2026-07-31',
      granularity: 'day',
    });
    expect(describeRule(p.rule())).toBe('once on July 31, 2026');
  });

  it('one-time, unscheduled', async () => {
    const p = await renderPicker();
    await tapTab('Someday');
    expect(p.rule()).toEqual({ kind: 'unscheduled' });
    expect(describeRule(p.rule())).toBe('no schedule');
  });
});

describe('the builder cannot produce a rule the engine rejects', () => {
  /**
   * Worth asserting separately from the shapes above. The schema is the single
   * validation point on both read and write, so a builder that can emit
   * something it rejects produces a chore that saves and then reads back as
   * "could not be understood".
   */
  const asSchedule = (rule: RecurrenceRule) => ({
    rule,
    startsOn: TODAY as CivilDate,
    endsOn: null,
    timesOfDay: [],
  });

  it('accepts every shape the tour above produces', async () => {
    const p = await renderPicker();
    const tour: (() => Promise<unknown>)[] = [
      () => tapTab('Daily'),
      () => tapTab('Weekly'),
      () => tapTab('Any days'),
      () => tapTab('On set days'),
      () => tapTab('Monthly'),
      () => tapTab('On a weekday'),
      () => tapTab('Any days'),
      () => tapTab('On a date'),
      () => tapTab('Once'),
      () => tapTab('Someday'),
    ];

    for (const step of tour) {
      await step();
      const parsed = safeParseSchedule(asSchedule(p.rule()));
      expect(parsed.success).toBe(true);
    }
  });

  it('never emits a weekly rule with no days, even if you deselect them all', async () => {
    // An empty weekday set is the one way to get the schema to reject a weekly
    // rule, and it is one tap away.
    const p = await renderPicker();
    await tapTab('Weekly');
    await tapDay('Thursday'); // the only one selected
    const rule = p.rule();
    expect(rule.kind).toBe('weekly');
    expect(safeParseSchedule(asSchedule(rule)).success).toBe(true);
  });

  it('always clamps a high day-of-month rather than skipping short months', async () => {
    // "The 31st" must mean February 28th, not "no February". Skipping is in the
    // union for hand-written rules; the builder does not offer it, because
    // silently missing a month is nobody's intent.
    const p = await renderPicker();
    await tapTab('Monthly');
    await setStepper('day of the month', 30, 31);
    expect(p.rule()).toMatchObject({ dayOfMonth: 31, overflow: 'clamp' });
  });
});

describe('switching frequency keeps your work', () => {
  it('remembers the weekdays you picked when you wander off and come back', async () => {
    const p = await renderPicker();
    await tapTab('Weekly');
    await tapDay('Thursday');
    await tapDay('Monday');
    await tapDay('Friday');
    expect(p.rule()).toMatchObject({ weekdays: [1, 5] });

    await tapTab('Monthly');
    await tapTab('Weekly');
    // Still Monday and Friday. Exploring the options should not punish you.
    expect(p.rule()).toMatchObject({ weekdays: [1, 5] });
  });

  it('remembers the interval across a frequency change', async () => {
    const p = await renderPicker();
    await tapTab('Weekly');
    await setStepper('weeks between', 1, 3);
    await tapTab('Monthly');
    expect(p.rule()).toMatchObject({ everyNMonths: 3 });
  });

  it('keeps the times-per-period when switching between floating rules', async () => {
    const p = await renderPicker();
    await tapTab('Weekly');
    await tapTab('Any days');
    await setStepper('times per week', 3, 5);
    await tapTab('Monthly');
    await tapTab('Any days');
    expect(p.rule()).toMatchObject({ kind: 'monthlyFloating', timesPerPeriod: 5 });
  });
});

describe('editing an existing chore', () => {
  it('opens on the rule the chore already has', async () => {
    const p = await renderPicker({ kind: 'weekly', everyNWeeks: 2, weekdays: [1, 3] });
    // No taps: the picker must already be showing this rule, or editing a chore
    // would quietly rewrite its schedule just by opening the form.
    expect(p.rule()).toEqual({ kind: 'weekly', everyNWeeks: 2, weekdays: [1, 3] });
    expect(screen.getByRole('tab', { name: 'Weekly', selected: true })).toBeOnTheScreen();
  });

  it('opens a floating rule on the Any days pattern', async () => {
    const p = await renderPicker({ kind: 'monthlyFloating', everyNMonths: 1, timesPerPeriod: 4 });
    expect(p.rule()).toMatchObject({ timesPerPeriod: 4 });
    expect(screen.getByRole('tab', { name: 'Any days', selected: true })).toBeOnTheScreen();
  });

  it('opens a one-time chore on its own date, not today', async () => {
    const p = await renderPicker({
      kind: 'once',
      dueOn: civilDate('2026-12-25'),
      granularity: 'day',
    });
    expect(p.rule()).toMatchObject({ dueOn: '2026-12-25' });
  });
});

describe('the sentence under the controls', () => {
  it('says what the rule does, in words', async () => {
    await renderPicker();
    await tapTab('Weekly');
    await tapTab('Any days');
    expect(screen.getByText('Repeats 3 times a week, any day.')).toBeOnTheScreen();
  });

  it('updates as the controls change', async () => {
    await renderPicker();
    await tapTab('Daily');
    expect(screen.getByText('Repeats every day.')).toBeOnTheScreen();
    await setStepper('days between', 1, 2);
    // "every other day", not "every 2 days" — the engine prefers the phrase a
    // person would use, and the summary is where that choice becomes visible.
    expect(screen.getByText('Repeats every other day.')).toBeOnTheScreen();
  });
});

describe('a one-time chore you can do any time that month', () => {
  /*
   * The concept survives the removal of the "How exact" picker — it moved
   * into the same control that decides when the chore shows up, because a
   * window and a deadline-with-warning are the same record. A chore due the
   * 31st and visible from the 1st *is* "sometime in August".
   */
  it('sets the span to the whole month and says so', async () => {
    const { rule } = await renderPicker({
      kind: 'once',
      dueOn: civilDate('2026-08-31'),
      granularity: 'day',
    });
    await fireEvent.press(screen.getByLabelText('All month'));

    expect(rule()).toEqual({
      kind: 'once',
      dueOn: civilDate('2026-08-31'),
      granularity: 'month',
      showFrom: civilDate('2026-08-01'),
    });
  });

  it('does not rewrite the wording of a chore it was not asked to change', async () => {
    // The silent-rewrite guard. Deriving granularity from the control alone
    // turned every stored "once in the week of…" into "once on…" the moment
    // anything else on the form was saved.
    const { rule } = await renderPicker({
      kind: 'once',
      dueOn: civilDate('2026-08-31'),
      granularity: 'week',
    });
    await fireEvent.press(screen.getByLabelText('A week early'));

    expect(rule()).toMatchObject({ granularity: 'week', showFrom: civilDate('2026-08-24') });
  });
});
