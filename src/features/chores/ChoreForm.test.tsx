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
import type { CalendarConfig } from '@/core/civil/types';
import { safeParseSchedule } from '@/core/recurrence/schema';
import { safeParseAssignment } from '@/core/rotation/schema';
import type { Chore, ChoreDraft } from '@/data/api/chores';
import { ThemeProvider } from '@/design/theme';
import { ChoreForm } from './ChoreForm';

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
    timeOfDay: null,
  },
  assignment: {
    kind: 'rotate',
    cadence: { unit: 'week', every: 1 },
    segments: [{ effectiveFrom: civilDate('2026-03-02'), memberIds: [ME, THEM], offset: 0 }],
  },
  archived: false,
  archivedAt: null,
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

  it('saves an untouched chore back exactly as it was', async () => {
    // The one that matters. Anything this form normalises on open is a silent
    // edit, and for a rotating chore a moved `startsOn` changes whose turn every
    // future occurrence is.
    const { onSubmit } = await renderForm({ chore: ROTATING_CHORE });
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    const draft = submitted(onSubmit);
    expect(draft.title).toBe(ROTATING_CHORE.title);
    expect(draft.notes).toBe(ROTATING_CHORE.notes);
    expect(draft.schedule).toEqual(ROTATING_CHORE.schedule);
    expect(draft.assignment).toEqual(ROTATING_CHORE.assignment);
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

  it('says there is nothing to preview for a someday chore', async () => {
    await renderForm();
    await fireEvent.press(screen.getByRole('tab', { name: 'Someday' }));
    expect(screen.getByText(/no dates until you schedule it/)).toBeOnTheScreen();
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
          timeOfDay: null,
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
