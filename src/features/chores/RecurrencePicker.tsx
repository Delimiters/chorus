/**
 * Building a recurrence rule.
 *
 * The hardest screen in the app, and the shape of it is a deliberate trade: two
 * choices — a *frequency* and, within it, a *pattern* — rather than one list of
 * eight rule kinds. Nobody thinks "I want a weeklyFloating rule"; they think
 * "weekly, a few times, whenever". Frequency across the top, pattern beneath it,
 * details beneath that.
 *
 * Switching frequency deliberately keeps what it can (the interval, the chosen
 * weekdays) so that exploring the options does not punish you by discarding the
 * work of setting them. See docs/RECURRENCE.md for the rule union itself.
 */

import { useMemo } from 'react';
import { View } from 'react-native';

import { partsOf, weekdayOf } from '@/core/civil/date';
import type { CivilDate, NthWeek, Weekday } from '@/core/civil/types';
import { describeRule } from '@/core/recurrence/describe';
import type { MonthOverflow, RecurrenceRule } from '@/core/recurrence/types';
import { Txt } from '@/design/components';
import { FieldGroup, SegmentedControl, Stepper, ToggleChips } from '@/design/controls';
import { space } from '@/design/tokens';
import { DateField } from './DateField';

/** The top-level choice, in the words a person would use. */
export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'someday';

const FREQUENCIES: readonly { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'once', label: 'Once' },
  { value: 'someday', label: 'Someday' },
];

const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string; a11yLabel: string }[] = [
  { value: 0, label: 'S', a11yLabel: 'Sunday' },
  { value: 1, label: 'M', a11yLabel: 'Monday' },
  { value: 2, label: 'T', a11yLabel: 'Tuesday' },
  { value: 3, label: 'W', a11yLabel: 'Wednesday' },
  { value: 4, label: 'T', a11yLabel: 'Thursday' },
  { value: 5, label: 'F', a11yLabel: 'Friday' },
  { value: 6, label: 'S', a11yLabel: 'Saturday' },
];

const NTH_OPTIONS: readonly { value: NthWeek; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
];

/** Which frequency tab a rule belongs under. */
export function frequencyOf(rule: RecurrenceRule): Frequency {
  switch (rule.kind) {
    case 'unscheduled':
      return 'someday';
    case 'once':
      return 'once';
    case 'daily':
      return 'daily';
    case 'weekly':
    case 'weeklyFloating':
      return 'weekly';
    case 'monthlyByDay':
    case 'monthlyByWeekday':
    case 'monthlyFloating':
      return 'monthly';
  }
}

type WeeklyPattern = 'onDays' | 'anyDays';
type MonthlyPattern = 'onDate' | 'onWeekday' | 'anyDays';

function weeklyPatternOf(rule: RecurrenceRule): WeeklyPattern {
  return rule.kind === 'weeklyFloating' ? 'anyDays' : 'onDays';
}

function monthlyPatternOf(rule: RecurrenceRule): MonthlyPattern {
  if (rule.kind === 'monthlyByWeekday') return 'onWeekday';
  if (rule.kind === 'monthlyFloating') return 'anyDays';
  return 'onDate';
}

/**
 * What the user has chosen so far, kept whole across frequency changes.
 *
 * The rule union is a sum type, so switching from "every Tuesday" to "monthly"
 * and back would otherwise forget Tuesday. Carrying the parts separately means
 * the picker can rebuild any rule from them.
 */
export interface RecurrenceDraft {
  readonly rule: RecurrenceRule;
  /** Remembered across frequency switches, so exploring costs nothing. */
  readonly weekdays: readonly Weekday[];
  readonly interval: number;
  readonly timesPerPeriod: number;
  readonly dayOfMonth: number;
  readonly nth: NthWeek;
  readonly nthWeekday: Weekday;
  readonly dueOn: CivilDate;
  /** "due Tuesday" vs "due this week" — carried so editing does not rewrite it. */
  readonly granularity: 'day' | 'week' | 'month';
  /**
   * Carried for the same reason.
   *
   * The builder only ever *offers* `clamp`, but a stored rule may say `skip`,
   * and rebuilding the rule on open would have converted it silently — so
   * renaming a chore would change what it does in February.
   */
  readonly overflow: MonthOverflow;
}

/**
 * Seeds a draft from an existing rule, filling the parts it does not carry.
 *
 * The seeded rule is **rebuilt from those parts** rather than passed through.
 * For any valid rule that is the identity — the round-trip test in
 * ChoreForm.test.tsx proves it, and it has to be, or opening a chore to edit
 * its name would silently rewrite its schedule.
 *
 * It is not the identity for a degenerate one, which is the point: the form's
 * own default was a weekly rule with no weekdays, so creating a chore without
 * touching the schedule emitted something the schema rejects. Repairing here
 * fixes it for every caller instead of at each one.
 */
export function draftFromRule(rule: RecurrenceRule, today: CivilDate): RecurrenceDraft {
  const base: RecurrenceDraft = {
    rule,
    weekdays: [weekdayOf(today)],
    interval: 1,
    timesPerPeriod: 3,
    dayOfMonth: partsOf(today).day,
    nth: 1,
    nthWeekday: weekdayOf(today),
    dueOn: today,
    granularity: 'day',
    overflow: 'clamp',
  };

  const parts = ((): RecurrenceDraft => {
    switch (rule.kind) {
      case 'weekly':
        return {
          ...base,
          // An empty set is not expressible in the UI and not accepted by the
          // schema; fall back to today rather than carrying it forward.
          weekdays: rule.weekdays.length > 0 ? rule.weekdays : base.weekdays,
          interval: rule.everyNWeeks,
        };
      case 'weeklyFloating':
        return { ...base, interval: rule.everyNWeeks, timesPerPeriod: rule.timesPerPeriod };
      case 'daily':
        return { ...base, interval: rule.everyNDays };
      case 'monthlyByDay':
        return {
          ...base,
          interval: rule.everyNMonths,
          dayOfMonth: rule.dayOfMonth,
          overflow: rule.overflow,
        };
      case 'monthlyByWeekday':
        return { ...base, interval: rule.everyNMonths, nth: rule.nth, nthWeekday: rule.weekday };
      case 'monthlyFloating':
        return { ...base, interval: rule.everyNMonths, timesPerPeriod: rule.timesPerPeriod };
      case 'once':
        return { ...base, dueOn: rule.dueOn, granularity: rule.granularity };
      case 'unscheduled':
        return base;
    }
  })();

  return {
    ...parts,
    rule: ruleFrom(parts, frequencyOf(rule), weeklyPatternOf(rule), monthlyPatternOf(rule)),
  };
}

/** Rebuilds the rule from the draft's parts. Total over every combination. */
function ruleFrom(
  draft: RecurrenceDraft,
  frequency: Frequency,
  weeklyPattern: WeeklyPattern,
  monthlyPattern: MonthlyPattern,
): RecurrenceRule {
  switch (frequency) {
    case 'someday':
      return { kind: 'unscheduled' };

    case 'once':
      return { kind: 'once', dueOn: draft.dueOn, granularity: draft.granularity };

    case 'daily':
      return { kind: 'daily', everyNDays: draft.interval };

    case 'weekly':
      return weeklyPattern === 'anyDays'
        ? {
            kind: 'weeklyFloating',
            everyNWeeks: draft.interval,
            timesPerPeriod: draft.timesPerPeriod,
          }
        : {
            kind: 'weekly',
            everyNWeeks: draft.interval,
            // Sorted and non-empty, which the schema requires. An empty
            // selection falls back to today rather than producing a rule the
            // engine would reject.
            weekdays: draft.weekdays.length > 0 ? [...draft.weekdays].sort((a, b) => a - b) : [0],
          };

    case 'monthly':
      if (monthlyPattern === 'onWeekday') {
        return {
          kind: 'monthlyByWeekday',
          everyNMonths: draft.interval,
          nth: draft.nth,
          weekday: draft.nthWeekday,
        };
      }
      if (monthlyPattern === 'anyDays') {
        return {
          kind: 'monthlyFloating',
          everyNMonths: draft.interval,
          timesPerPeriod: draft.timesPerPeriod,
        };
      }
      return {
        kind: 'monthlyByDay',
        everyNMonths: draft.interval,
        dayOfMonth: draft.dayOfMonth,
        // New chores clamp: "the 31st" in February means the 28th, not "skip
        // February", because silently missing a month is nobody's intent when
        // they pick a day from a stepper. A stored `skip` is *preserved*
        // though — the builder not offering a choice is not a licence to
        // overwrite one somebody already made. See docs/RECURRENCE.md.
        overflow: draft.overflow,
      };
  }
}

interface Props {
  draft: RecurrenceDraft;
  onChange: (draft: RecurrenceDraft) => void;
  today: CivilDate;
  /** The household's setting, so the date grid matches every other calendar. */
  weekStartsOn?: Weekday;
}

export function RecurrencePicker({ draft, onChange, today, weekStartsOn = 0 }: Props) {
  const frequency = frequencyOf(draft.rule);
  const weeklyPattern = weeklyPatternOf(draft.rule);
  const monthlyPattern = monthlyPatternOf(draft.rule);

  /** Rebuilds the rule whenever any part changes. */
  const update = (
    patch: Partial<RecurrenceDraft>,
    over: {
      frequency?: Frequency;
      weeklyPattern?: WeeklyPattern;
      monthlyPattern?: MonthlyPattern;
    } = {},
  ) => {
    const next = { ...draft, ...patch };
    onChange({
      ...next,
      rule: ruleFrom(
        next,
        over.frequency ?? frequency,
        over.weeklyPattern ?? weeklyPattern,
        over.monthlyPattern ?? monthlyPattern,
      ),
    });
  };

  const summary = useMemo(() => describeRule(draft.rule), [draft.rule]);

  return (
    <View style={{ gap: space.lg }}>
      <FieldGroup label="How often">
        <SegmentedControl
          segments={FREQUENCIES}
          value={frequency}
          onChange={(value) => update({}, { frequency: value })}
          label="How often"
          scrollable
        />
      </FieldGroup>

      {frequency === 'someday' ? (
        <Txt variant="small" tone="faint">
          No date. It waits on the Someday list until you schedule it or tick it off.
        </Txt>
      ) : null}

      {frequency === 'once' ? (
        <>
          <FieldGroup label="On">
            <DateField
              value={draft.dueOn}
              onChange={(dueOn) => update({ dueOn })}
              today={today}
              label="Due date"
              weekStartsOn={weekStartsOn}
            />
          </FieldGroup>
          <FieldGroup
            label="How exact"
            hint="Only changes the wording and how long it waits before reading as late — the date itself does not move."
          >
            <SegmentedControl
              segments={[
                { value: 'day' as const, label: 'That day' },
                { value: 'week' as const, label: 'That week' },
                { value: 'month' as const, label: 'That month' },
              ]}
              value={draft.granularity}
              onChange={(granularity) => update({ granularity })}
              label="How exact"
            />
          </FieldGroup>
        </>
      ) : null}

      {frequency === 'daily' ? (
        <FieldGroup label="Every">
          <Stepper
            value={draft.interval}
            onChange={(interval) => update({ interval })}
            min={1}
            max={30}
            label="days between"
            unit={(n) => (n === 1 ? 'day' : `${n} days`)}
          />
        </FieldGroup>
      ) : null}

      {frequency === 'weekly' ? (
        <>
          <FieldGroup label="Pattern">
            <SegmentedControl
              segments={[
                { value: 'onDays' as const, label: 'On set days' },
                { value: 'anyDays' as const, label: 'Any days' },
              ]}
              value={weeklyPattern}
              onChange={(value) => update({}, { weeklyPattern: value })}
              label="Weekly pattern"
            />
          </FieldGroup>

          <FieldGroup label="Every">
            <Stepper
              value={draft.interval}
              onChange={(interval) => update({ interval })}
              min={1}
              max={12}
              label="weeks between"
              unit={(n) => (n === 1 ? 'week' : `${n} weeks`)}
            />
          </FieldGroup>

          {weeklyPattern === 'onDays' ? (
            <FieldGroup label="On" hint="Pick one or more.">
              <ToggleChips
                options={WEEKDAY_OPTIONS}
                selected={draft.weekdays}
                onToggle={(day) =>
                  update({
                    weekdays: draft.weekdays.includes(day)
                      ? draft.weekdays.filter((d) => d !== day)
                      : [...draft.weekdays, day],
                  })
                }
                label="Days of the week"
              />
            </FieldGroup>
          ) : (
            <FieldGroup label="How many times" hint="Do them whenever suits, within the week.">
              <Stepper
                value={draft.timesPerPeriod}
                onChange={(timesPerPeriod) => update({ timesPerPeriod })}
                min={1}
                max={7}
                label="times per week"
                unit={(n) => (n === 1 ? 'once' : `${n}×`)}
              />
            </FieldGroup>
          )}
        </>
      ) : null}

      {frequency === 'monthly' ? (
        <>
          <FieldGroup label="Pattern">
            <SegmentedControl
              segments={[
                { value: 'onDate' as const, label: 'On a date' },
                { value: 'onWeekday' as const, label: 'On a weekday' },
                { value: 'anyDays' as const, label: 'Any days' },
              ]}
              value={monthlyPattern}
              onChange={(value) => update({}, { monthlyPattern: value })}
              label="Monthly pattern"
            />
          </FieldGroup>

          <FieldGroup label="Every">
            <Stepper
              value={draft.interval}
              onChange={(interval) => update({ interval })}
              min={1}
              max={12}
              label="months between"
              unit={(n) => (n === 1 ? 'month' : `${n} months`)}
            />
          </FieldGroup>

          {monthlyPattern === 'onDate' ? (
            <FieldGroup
              label="Day of the month"
              hint={
                draft.dayOfMonth > 28
                  ? 'Short months use their last day — the 31st is the 28th in February.'
                  : undefined
              }
            >
              <Stepper
                value={draft.dayOfMonth}
                onChange={(dayOfMonth) => update({ dayOfMonth })}
                min={1}
                max={31}
                label="day of the month"
                unit={(n) => `the ${ordinal(n)}`}
              />
            </FieldGroup>
          ) : null}

          {monthlyPattern === 'onWeekday' ? (
            <>
              <FieldGroup label="Which one">
                <SegmentedControl
                  segments={NTH_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                  value={String(draft.nth)}
                  onChange={(value) => update({ nth: Number(value) as NthWeek })}
                  label="Which week"
                />
              </FieldGroup>
              <FieldGroup label="Day">
                <ToggleChips
                  options={WEEKDAY_OPTIONS}
                  selected={[draft.nthWeekday]}
                  onToggle={(day) => update({ nthWeekday: day })}
                  label="Day of the week"
                />
              </FieldGroup>
            </>
          ) : null}

          {monthlyPattern === 'anyDays' ? (
            <FieldGroup label="How many times" hint="Do them whenever suits, within the month.">
              <Stepper
                value={draft.timesPerPeriod}
                onChange={(timesPerPeriod) => update({ timesPerPeriod })}
                min={1}
                max={20}
                label="times per month"
                unit={(n) => (n === 1 ? 'once' : `${n}×`)}
              />
            </FieldGroup>
          ) : null}
        </>
      ) : null}

      {/* The rule in words, always visible. It is the one thing that tells you
          whether the controls above mean what you think they mean. */}
      {/* "Repeats no schedule." is not a sentence. The unscheduled case has
          nothing to summarise, and the field above it already explains itself. */}
      {frequency === 'someday' ? null : (
        <View accessibilityRole="summary" accessibilityLabel={`Repeats ${summary}`}>
          <Txt variant="small" tone="faint">
            Repeats {summary}.
          </Txt>
        </View>
      )}
    </View>
  );
}

/** Unexported twin of the one in describe.ts, which core cannot export to a screen. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
