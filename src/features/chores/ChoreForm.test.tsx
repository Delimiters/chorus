/**
 * The chore form, end to end within the component.
 *
 * The assertion this file exists for is the boring one: **opening an existing
 * chore and saving it unchanged must produce the chore you started with.** A
 * form that quietly rewrites a schedule, a start date, or a rotation roster on
 * open is worse than one that refuses to edit at all, because nothing tells you
 * it happened — and for a rotating chore, moving `startsOn` silently changes
 * whose turn every future occurrence is.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { CalendarConfig, CivilTime } from '@/core/civil/types';
import { safeParseSchedule } from '@/core/recurrence/schema';
import type { RecurrenceRule } from '@/core/recurrence/types';
import { safeParseAssignment } from '@/core/rotation/schema';
import type { Chore, ChoreDraft } from '@/data/api/chores';
import { ThemeProvider } from '@/design/theme';
import { ChoreForm } from './ChoreForm';

// Categories are fetched, and these suites render without a QueryClientProvider
// on purpose — they mock the data layer rather than standing one up. An empty
// list keeps the rows unbadged, which is what every assertion below expects.
const mockCategories = [
  { id: 'c-kitchen', name: 'Kitchen', ink: 'teal', icon: 'silverware-fork-knife', position: 0 },
  { id: 'c-bins', name: 'Bins', ink: null, icon: 'trash-can-outline', position: 1 },
  { id: 'c-plain', name: 'Plain', ink: null, icon: null, position: 2 },
];

jest.mock('@/data/hooks/useCategories', () => ({
  useCategoryList: () => mockCategories,
  useCategories: () => ({ data: [], isPending: false, isError: false }),
  useCreateCategory: () => ({ mutateAsync: jest.fn(), isPending: false, error: null }),
}));

const TODAY = civilDate('2026-07-30'); // a Thursday
const CAL: CalendarConfig = { weekStartsOn: 0 };
const ME = 'user-me';
const THEM = 'user-them';

const MEMBERS = [
  { userId: ME, displayName: 'Jake', accent: 'blue' },
  { userId: THEM, displayName: 'Sam', accent: 'ochre' },
];

const ROTATING_CHORE: Chore = {
  id: 'trash',
  title: 'Take out the bins',
  notes: 'Green bin on alternate weeks',
  schedule: {
    rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [1, 4] },
    startsOn: civilDate('2026-03-02'),
    endsOn: null,
    timesOfDay: [],
  },
  assignment: {
    kind: 'rotate',
    cadence: { unit: 'week', every: 1 },
    segments: [{ effectiveFrom: civilDate('2026-03-02'), memberIds: [ME, THEM], offset: 0 }],
  },
  archived: false,
  archivedAt: null,
  categoryId: null,
  priority: 'normal',
  icon: null,
  privateTo: null,
  createdAt: '2026-08-15T09:02:51.485803+00:00',
  createdBy: 'user-them',
};

/** `async` because RNTL v14's `render` is; see docs/TESTING.md. */
async function renderForm(over: Partial<React.ComponentProps<typeof ChoreForm>> = {}) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  const onArchive = jest.fn();

  const result = await render(
    <ThemeProvider>
      <ChoreForm
        members={MEMBERS}
        userId={ME}
        today={TODAY}
        calendar={CAL}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onArchive={onArchive}
        {...over}
      />
    </ThemeProvider>,
  );
  return { result, onSubmit, onCancel, onArchive };
}

const submitted = (fn: jest.Mock): ChoreDraft => fn.mock.calls[0]?.[0] as ChoreDraft;

describe('getting out of the form', () => {
  it('offers a Cancel at the top, not only at the bottom of a long form', async () => {
    // Every (app) screen is headerShown: false, so the only other way out is an
    // edge swipe — an invisible affordance. The existing Cancel sat below the
    // recurrence and assignment pickers, off-screen on arrival.
    const onCancel = jest.fn();
    await renderForm({ onCancel });
    // Two now: the bar at the top and the button at the bottom. The first in
    // tree order is the top one, which is the whole point of this test.
    const exits = screen.getAllByLabelText('Cancel');
    expect(exits.length).toBeGreaterThan(1);
    fireEvent.press(exits[0]!);
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('a category with a default icon', () => {
  it('gives its icon to a chore that has none', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Dishes');
    await fireEvent.press(screen.getByLabelText('Category: Kitchen'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBe('silverware-fork-knife');
  });

  it('updates the icon when the category changes, if it was chosen for you', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Dishes');
    await fireEvent.press(screen.getByLabelText('Category: Kitchen'));
    await fireEvent.press(screen.getByLabelText('Category: Bins'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBe('trash-can-outline');
  });

  it('never overwrites an icon you picked deliberately', async () => {
    // The decision worth getting right. Silently undoing a choice is worse
    // than not helping at all.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Dishes');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'dog' }));
    await fireEvent.press(screen.getByLabelText('Category: Kitchen'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBe('dog');
  });

  it('clears an adopted icon when the new category has none', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Dishes');
    await fireEvent.press(screen.getByLabelText('Category: Kitchen'));
    await fireEvent.press(screen.getByLabelText('Category: Plain'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBeNull();
  });

  it('leaves the icon alone when moving to Other', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Dishes');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'dog' }));
    await fireEvent.press(screen.getByLabelText('Category: Other'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBe('dog');
  });
});

describe('the icon', () => {
  it('starts with none, because most chores do not want one', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBeNull();
  });

  it('saves the one you pick', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'trash can outline' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBe('trash-can-outline');
  });

  it('can be taken off again', async () => {
    // Null and "some icon" are different states, and without a way back a
    // mistaken pick would be permanent.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose an icon' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'trash can outline' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove the icon' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).icon).toBeNull();
  });

  it('ignores a name the app no longer offers', async () => {
    // Icons are stored as plain text with no CHECK, so a row can name a glyph
    // that has since been dropped from the picker. That must degrade to no
    // icon rather than rendering a blank square or crashing the list.
    const { onSubmit } = await renderForm({
      chore: { ...ROTATING_CHORE, icon: 'nonsense-that-was-never-offered' },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(submitted(onSubmit).icon).toBeNull();
  });
});

describe('the reminder times', () => {
  // This UI did not exist until it was asked for. The engine had honoured the
  // schedule's reminder time since reminders were built, the planner fell back
  // to the device default, tests covered both — and no screen ever set it.
  it('defaults to following the phone, not to a fixed hour', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual([]);
  });

  it('adds a shortcut time', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByLabelText('Add a reminder at 7pm'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual(['19:00']);
  });

  it('keeps more than one, in order', async () => {
    // The whole point of the change: a chore can deserve a morning reminder
    // and an evening one, and the alternative — a duplicate chore — would
    // split the completion history the stats are built from.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByLabelText('Add a reminder at 7pm'));
    await fireEvent.press(screen.getByLabelText('Add a reminder at 9am'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual(['09:00', '19:00']);
  });

  it('removes one by tapping it', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByLabelText('Add a reminder at 7pm'));
    await fireEvent.press(screen.getByLabelText('Add a reminder at 9am'));
    await fireEvent.press(screen.getByLabelText('Remove the reminder at 7 pm'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual(['09:00']);
  });

  it('goes back to following the phone when the last one is removed', async () => {
    // Empty and "some times" are different states, and there has to be a way
    // back or a mistaken choice is permanent.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByLabelText('Add a reminder at 9am'));
    await fireEvent.press(screen.getByLabelText('Remove the reminder at 9 am'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual([]);
  });

  it('takes any time from the wheel, not just the shortcuts', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByLabelText('Pick a reminder time'));
    await fireEvent(screen.getByLabelText('Pick a reminder time'), 'change', {
      type: 'set',
      nativeEvent: { timestamp: new Date(2026, 0, 1, 18, 45).getTime() },
    });
    await fireEvent.press(screen.getByLabelText('Add a reminder at 6:45 pm'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual(['18:45']);
  });

  it('only reads hours and minutes off the wheel, never its date', async () => {
    // The picker deals in Date because the OS does. If that leaked, a reminder
    // would become an instant and the civil-time guarantee would be gone.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByLabelText('Pick a reminder time'));
    await fireEvent(screen.getByLabelText('Pick a reminder time'), 'change', {
      type: 'set',
      nativeEvent: { timestamp: new Date(1999, 11, 31, 6, 5).getTime() },
    });
    await fireEvent.press(screen.getByLabelText('Add a reminder at 6:05 am'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual(['06:05']);
  });

  it('warns that a default chore will never remind you', async () => {
    // A new chore is assigned to "Anyone", the default policy excludes
    // unassigned chores, and so nothing is scheduled. Setting a time did
    // nothing and said nothing.
    await renderForm();
    expect(screen.getByText(/Nobody is assigned/)).toBeTruthy();
  });

  it('stops warning once the chore is assigned to you', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('radio', { name: /One person/ }));
    await fireEvent.press(screen.getByRole('radio', { name: /Jake/ }));
    expect(screen.queryByText(/Nobody is assigned/)).toBeNull();
  });

  it('keeps the times a chore already had when it is edited', async () => {
    const { onSubmit } = await renderForm({
      chore: {
        ...ROTATING_CHORE,
        schedule: {
          ...ROTATING_CHORE.schedule,
          timesOfDay: ['09:00' as CivilTime, '19:00' as CivilTime],
        },
      },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(submitted(onSubmit).schedule.timesOfDay).toEqual(['09:00', '19:00']);
  });
});

describe('creating a chore', () => {
  it('will not save without a name', async () => {
    const { onSubmit } = await renderForm();
    const button = screen.getByRole('button', { name: 'Add chore' });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves a name, a schedule and an assignment', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Dishes  ');
    await fireEvent.press(screen.getByRole('tab', { name: 'Daily' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));

    const draft = submitted(onSubmit);
    expect(draft.title).toBe('Dishes'); // trimmed
    expect(draft.notes).toBeNull(); // empty notes are null, not ''
    expect(draft.schedule.rule).toEqual({ kind: 'daily', everyNDays: 1 });
    expect(draft.assignment).toEqual({ kind: 'anyone' });
  });

  it('starts a new chore today', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Dishes');
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.startsOn).toBe(TODAY);
  });

  it('emits a schedule and assignment the engine accepts', async () => {
    // The form is the only writer, so anything it can emit will be read back by
    // the parser. A shape it rejects becomes a chore that says "could not be
    // understood" and cannot be fixed from inside the app.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('radio', { name: /Take turns/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));

    const draft = submitted(onSubmit);
    expect(safeParseSchedule(draft.schedule).success).toBe(true);
    expect(safeParseAssignment(draft.assignment).success).toBe(true);
  });
});

describe('editing an existing chore', () => {
  it('opens with everything the chore already has', async () => {
    await renderForm({ chore: ROTATING_CHORE });
    expect(screen.getByLabelText('Name').props.value).toBe('Take out the bins');
    expect(screen.getByLabelText('Notes').props.value).toBe('Green bin on alternate weeks');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeOnTheScreen();
  });

  /**
   * The assertion this file exists for, run over **one chore per rule kind**.
   *
   * It used to run over a single weekly chore, which is a rule family
   * `ruleFrom` happens to reproduce exactly — so it passed while the form
   * silently rewrote two other kinds on open. `granularity: 'week'` became
   * `'day'`, and `overflow: 'skip'` became `'clamp'`, meaning renaming a chore
   * changed what it did in February. The vacuity-making input was the only
   * input the test used.
   */
  const ROUND_TRIP: readonly { name: string; rule: RecurrenceRule }[] = [
    { name: 'daily', rule: { kind: 'daily', everyNDays: 3 } },
    { name: 'weekly', rule: { kind: 'weekly', everyNWeeks: 2, weekdays: [1, 4] } },
    {
      name: 'weekly floating',
      rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
    },
    {
      name: 'monthly, clamping',
      rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
    },
    {
      name: 'monthly, skipping short months',
      rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'skip' },
    },
    {
      name: 'monthly by weekday',
      rule: { kind: 'monthlyByWeekday', everyNMonths: 3, nth: -1, weekday: 5 },
    },
    {
      name: 'monthly floating',
      rule: { kind: 'monthlyFloating', everyNMonths: 2, timesPerPeriod: 4 },
    },
    {
      name: 'once, on a day',
      rule: { kind: 'once', dueOn: civilDate('2026-12-25'), granularity: 'day' },
    },
    {
      name: 'once, in a week',
      rule: { kind: 'once', dueOn: civilDate('2026-12-25'), granularity: 'week' },
    },
    {
      name: 'once, in a month',
      rule: { kind: 'once', dueOn: civilDate('2026-12-25'), granularity: 'month' },
    },
    { name: 'someday', rule: { kind: 'unscheduled' } },
  ];

  it.each(ROUND_TRIP)('saves an untouched $name chore back exactly as it was', async ({ rule }) => {
    const chore: Chore = {
      ...ROTATING_CHORE,
      schedule: {
        ...ROTATING_CHORE.schedule,
        rule,
        // `once` normalises `startsOn` to its own date; anything else keeps the
        // chore's.
        startsOn: rule.kind === 'once' ? rule.dueOn : ROTATING_CHORE.schedule.startsOn,
      },
    };

    const { onSubmit } = await renderForm({ chore });
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    const draft = submitted(onSubmit);
    expect(draft.title).toBe(chore.title);
    expect(draft.notes).toBe(chore.notes);
    expect(draft.schedule).toEqual(chore.schedule);
    // A rotating chore's roster travels untouched: rewriting a segment would
    // retroactively change who was responsible last month.
    expect(draft.assignment).toEqual(chore.assignment);
  });

  it('keeps the original start date when the schedule is changed', async () => {
    // Changing "every Monday and Thursday" to "every day" must not also move the
    // chore's start to today — that would re-phase the whole sequence.
    const { onSubmit } = await renderForm({ chore: ROTATING_CHORE });
    await fireEvent.press(screen.getByRole('tab', { name: 'Daily' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    const draft = submitted(onSubmit);
    expect(draft.schedule.rule).toEqual({ kind: 'daily', everyNDays: 1 });
    expect(draft.schedule.startsOn).toBe('2026-03-02');
  });

  it('keeps the rotation roster and its effective date', async () => {
    const { onSubmit } = await renderForm({ chore: ROTATING_CHORE });
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    // Appending a segment is how a roster change is recorded; editing this one
    // would rewrite who was responsible in the past.
    expect(submitted(onSubmit).assignment).toEqual(ROTATING_CHORE.assignment);
  });

  it('says "bring back" on an archived chore, because that is what the button does', async () => {
    // It used to say "Archive this chore" on a chore that was already archived,
    // and un-archive it. Archived rows are pressable, so that was reachable.
    const { onArchive } = await renderForm({
      chore: { ...ROTATING_CHORE, archived: true, archivedAt: '2026-05-01T00:00:00Z' },
    });
    expect(screen.queryByRole('button', { name: 'Archive this chore' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Bring this chore back' }));
    expect(onArchive).toHaveBeenCalled();
  });

  it('offers archiving, and says what it does to the history', async () => {
    const { onArchive } = await renderForm({ chore: ROTATING_CHORE });
    await fireEvent.press(screen.getByRole('button', { name: 'Archive this chore' }));
    expect(onArchive).toHaveBeenCalled();
    expect(screen.getByText(/stays counted/)).toBeOnTheScreen();
  });

  it('does not offer archiving on a chore that does not exist yet', async () => {
    await renderForm();
    expect(screen.queryByRole('button', { name: 'Archive this chore' })).toBeNull();
  });
});

describe('when it starts', () => {
  it('defaults to today for a new chore', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).schedule.startsOn).toBe(TODAY);
  });

  it('can begin later, for something that has not started yet', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Water the plants');
    await fireEvent.press(screen.getByRole('button', { name: 'Start date: Next week' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    // 30 July 2026 is a Thursday; a Sunday-start week puts "next week" on 2 Aug.
    expect(submitted(onSubmit).schedule.startsOn).toBe('2026-08-02');
  });

  it('re-phases a fortnightly chore, which is the point of the field', async () => {
    // "Every other Monday" starting this week and starting next week are
    // different chores. Until this field existed, which one you got was decided
    // by the day you happened to be adding it.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('tab', { name: 'Weekly' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Increase weeks between' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Start date: Next week' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));

    const schedule = submitted(onSubmit).schedule;
    expect(schedule.rule).toMatchObject({ kind: 'weekly', everyNWeeks: 2 });
    expect(schedule.startsOn).toBe('2026-08-02');
  });

  it('is not offered for a one-time chore, which carries its own date', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('tab', { name: 'Once' }));
    expect(screen.queryByText('Starts on')).toBeNull();
    // Its own date field is still there.
    expect(screen.getByRole('button', { name: 'Due date: Tomorrow' })).toBeOnTheScreen();
  });

  it('is not offered for a Someday chore, which has no dates at all', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('tab', { name: 'Someday' }));
    expect(screen.queryByText('Starts on')).toBeNull();
  });

  it('opens on the chore’s own start date, not today', async () => {
    // Editing a name must not silently re-phase the schedule.
    await renderForm({ chore: ROTATING_CHORE });
    expect(screen.getByLabelText('Start date is Mon 2 Mar')).toBeOnTheScreen();
  });
});

describe('the schedule preview', () => {
  it('shows the next few dates for a weekly rule', async () => {
    await renderForm({ chore: ROTATING_CHORE });
    // Mondays and Thursdays from 30 July 2026: Thu 30, Mon 3, Thu 6...
    expect(screen.getByLabelText('Next: Thu 30 Jul')).toBeOnTheScreen();
    expect(screen.getByLabelText('Then: Mon 3 Aug')).toBeOnTheScreen();
  });

  it('follows the picker as the rule changes', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('tab', { name: 'Daily' }));
    expect(screen.getByLabelText('Next: Thu 30 Jul')).toBeOnTheScreen();
    expect(screen.getByLabelText('Then: Fri 31 Jul')).toBeOnTheScreen();
  });

  it('is not shown at all for a someday chore', async () => {
    // A "next few times" heading over "nothing to preview" is a field asking to
    // be ignored. The frequency picker already says what Someday means.
    await renderForm();
    await fireEvent.press(screen.getByRole('tab', { name: 'Someday' }));
    expect(screen.queryByText('Next few times')).toBeNull();
    expect(screen.getByText(/waits on the Someday list/)).toBeOnTheScreen();
  });

  it('hides the rotation cadence for a chore that only happens once', async () => {
    // There is no second turn to hand over.
    await renderForm();
    await fireEvent.press(screen.getByRole('tab', { name: 'Once' }));
    await fireEvent.press(screen.getByRole('radio', { name: /Take turns/ }));
    expect(screen.queryByText('Turns change')).toBeNull();
    expect(screen.getByText('In this order')).toBeOnTheScreen();
  });

  it('shows the cadence again for a recurring one', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('tab', { name: 'Weekly' }));
    await fireEvent.press(screen.getByRole('radio', { name: /Take turns/ }));
    expect(screen.getByText('Turns change')).toBeOnTheScreen();
  });

  it('clamps a 31st rule into short months rather than skipping them', async () => {
    // The preview is where this becomes checkable before saving, which is most
    // of why it earns its place.
    await renderForm({
      chore: {
        ...ROTATING_CHORE,
        schedule: {
          rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 31, overflow: 'clamp' },
          startsOn: civilDate('2026-01-31'),
          endsOn: null,
          timesOfDay: [],
        },
      },
    });
    // August has 31 days; September has 30 and must still appear.
    expect(screen.getByLabelText('Next: Fri 31 Jul')).toBeOnTheScreen();
    expect(screen.getByLabelText('Then: Mon 31 Aug')).toBeOnTheScreen();
    expect(screen.getByLabelText('Then: Wed 30 Sep')).toBeOnTheScreen();
  });
});

describe('assignment', () => {
  /**
   * The regression that mattered most in Phase 6's retrospective: the picker
   * rebuilt segment 0 from current membership whenever the mode was set, so
   * toggling away from "take turns" and back rewrote who was responsible in the
   * past. Three taps, silent, permanent.
   */
  /**
   * The fixture matters as much as the assertion here.
   *
   * The first version of this test used a rotation whose roster was identical
   * to the household — so a segment *rebuilt from current membership* came out
   * byte-for-byte the same as one that was preserved, and the test passed
   * either way. It also asserted only `segments[0]`, so it could not see the
   * cadence being reset on the very path it exercised.
   *
   * So: a third housemate who is NOT in the rotation, a second segment, and an
   * assertion on the whole assignment.
   */
  const THIRD = 'user-third';
  const HISTORIED: Chore = {
    ...ROTATING_CHORE,
    assignment: {
      kind: 'rotate',
      cadence: { unit: 'week', every: 1 },
      segments: [
        { effectiveFrom: civilDate('2026-03-02'), memberIds: [ME, THEM], offset: 0 },
        { effectiveFrom: civilDate('2026-06-01'), memberIds: [THEM, ME], offset: 1 },
      ],
    },
  };

  it('never rewrites a rotation that has already taken effect', async () => {
    const { onSubmit } = await renderForm({
      chore: HISTORIED,
      members: [...MEMBERS, { userId: THIRD, displayName: 'Robin', accent: 'moss' }],
    });

    // Away and back: the exact path that used to overwrite it.
    await fireEvent.press(screen.getByRole('radio', { name: /Anyone/ }));
    await fireEvent.press(screen.getByRole('radio', { name: /Take turns/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    // Every segment, and the cadence — which a rebuild silently reset to
    // per-occurrence.
    expect(submitted(onSubmit).assignment).toEqual(HISTORIED.assignment);
  });

  it('does not touch the roster when you tap the mode it is already in', async () => {
    // OptionRow fires on every press, including the selected one.
    const { onSubmit } = await renderForm({
      chore: HISTORIED,
      members: [...MEMBERS, { userId: THIRD, displayName: 'Robin', accent: 'moss' }],
    });
    await fireEvent.press(screen.getByRole('radio', { name: /Take turns/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(submitted(onSubmit).assignment).toEqual(HISTORIED.assignment);
  });

  it('distinguishes one shared job from one job each', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Laundry');
    await fireEvent.press(screen.getByRole('radio', { name: /Everyone, separately/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).assignment).toEqual({ kind: 'everyone' });
  });

  it('assigns to one named person', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('radio', { name: /One person/ }));
    await fireEvent.press(screen.getByRole('radio', { name: /Sam/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));
    expect(submitted(onSubmit).assignment).toEqual({ kind: 'fixed', memberId: THEM });
  });

  it('rotates with a cadence separate from the chore’s own', async () => {
    // Three times a week, but whose job it is changes weekly. Conflating the two
    // is what stops most chore apps expressing this at all.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('tab', { name: 'Weekly' }));
    // Thursday is pre-selected because today is one; clear it first.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Thursday' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Monday' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Wednesday' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Friday' }));
    await fireEvent.press(screen.getByRole('radio', { name: /Take turns/ }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Weekly', selected: false }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));

    const draft = submitted(onSubmit);
    expect(draft.schedule.rule).toMatchObject({ kind: 'weekly', weekdays: [1, 3, 5] });
    expect(draft.assignment).toMatchObject({
      kind: 'rotate',
      cadence: { unit: 'week', every: 1 },
    });
  });

  it('seeds a new rotation with everyone in the household', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Bins');
    await fireEvent.press(screen.getByRole('radio', { name: /Take turns/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));

    const assignment = submitted(onSubmit).assignment;
    expect(assignment).toMatchObject({
      kind: 'rotate',
      segments: [{ effectiveFrom: TODAY, memberIds: [ME, THEM], offset: 0 }],
    });
  });
});

describe('where a chore came from', () => {
  it('says who added it and when, when editing', async () => {
    // The question that prompted this: a chore appeared already assigned, and
    // there was no way inside the app to see who had put it there.
    await renderForm({ chore: ROTATING_CHORE });
    expect(screen.getByText('Added by Sam on 15 August 2026')).toBeTruthy();
  });

  it('says nothing at all when creating one', async () => {
    await renderForm({});
    expect(screen.queryByText(/^Added /)).toBeNull();
  });

  it('still gives the date when the creator is unknown', async () => {
    // `created_by` is nullable, and a member can leave the household.
    await renderForm({ chore: { ...ROTATING_CHORE, createdBy: null } });
    expect(screen.getByText('Added on 15 August 2026')).toBeTruthy();
  });
});

describe('keeping a chore to yourself', () => {
  it('is shared unless you say otherwise', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Get anniversary flowers');
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ privateTo: null }));
  });

  it('records it against you, not as a bare flag', async () => {
    // The column holds an id because `created_by` is nullable and not
    // trustworthy; the switch is a boolean because "private to somebody else"
    // is not a thing any screen offers.
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Get anniversary flowers');
    await fireEvent.press(screen.getByLabelText('Only me'));
    await fireEvent.press(screen.getByRole('button', { name: 'Add chore' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ privateTo: ME }));
  });

  it('opens an existing private chore already switched on', async () => {
    await renderForm({ chore: { ...ROTATING_CHORE, privateTo: ME } });
    expect(screen.getByText(/Only you can see this chore/)).toBeTruthy();
  });

  it('can be shared again', async () => {
    const { onSubmit } = await renderForm({ chore: { ...ROTATING_CHORE, privateTo: ME } });
    await fireEvent.press(screen.getByLabelText('Shared'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ privateTo: null }));
  });
});
