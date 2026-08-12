import { fireEvent, render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { CalendarConfig, CivilTime } from '@/core/civil/types';
import type { RoutineDraft, RoutineItem } from '@/data/api/routines';
import { ThemeProvider } from '@/design/theme';
import { RoutineForm } from './RoutineForm';

const TODAY = civilDate('2026-03-15');
const CAL: CalendarConfig = { weekStartsOn: 0 };

const EXISTING: RoutineItem = {
  id: 'stretch',
  title: 'Stretch',
  ownerId: 'me',
  notes: null,
  icon: null,
  schedule: {
    rule: { kind: 'daily', everyNDays: 1 },
    startsOn: civilDate('2026-01-01'),
    endsOn: null,
    timesOfDay: [],
  },
  timeOfDay: '07:00' as CivilTime,
  bucket: 'morning',
  linkedChoreId: null,
  remind: false,
  archived: false,
  archivedAt: null,
  shared: false,
};

async function renderForm(over: Partial<React.ComponentProps<typeof RoutineForm>> = {}) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  await render(
    <ThemeProvider>
      <RoutineForm today={TODAY} calendar={CAL} onSubmit={onSubmit} onCancel={onCancel} {...over} />
    </ThemeProvider>,
  );
  return { onSubmit, onCancel };
}

const submitted = (onSubmit: jest.Mock): RoutineDraft =>
  onSubmit.mock.calls[0]?.[0] as RoutineDraft;

describe('RoutineForm', () => {
  it('will not save without a name', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.press(screen.getByRole('button', { name: 'Add to my routine' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('defaults to daily, because most routines are', async () => {
    const { onSubmit } = await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Stretch');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to my routine' }));
    expect(submitted(onSubmit).schedule.rule).toEqual({ kind: 'daily', everyNDays: 1 });
  });

  describe('a time or a part of the day, never both', () => {
    // Mirrors the database's routine_bucket_source check. Emitting both would
    // be a 23514 from Postgres rather than anything a person could act on.
    it('sends a bucket and no time when no time is set', async () => {
      const { onSubmit } = await renderForm();
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Tidy');
      await fireEvent.press(screen.getByRole('button', { name: 'Add to my routine' }));

      const draft = submitted(onSubmit);
      expect(draft.timeOfDay).toBeNull();
      expect(draft.bucketChoice).toBe('morning');
    });

    it('sends a time and no bucket once a time is chosen', async () => {
      const { onSubmit } = await renderForm();
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Stretch');
      await fireEvent.press(screen.getByText('7am'));
      await fireEvent.press(screen.getByRole('button', { name: 'Add to my routine' }));

      const draft = submitted(onSubmit);
      expect(draft.timeOfDay).toBe('07:00');
      expect(draft.bucketChoice).toBeNull();
    });

    it('hides the bucket picker once a time is set', async () => {
      // Two controls for one answer is how somebody ends up believing they
      // disagree.
      await renderForm();
      expect(screen.getByLabelText('Part of the day')).toBeTruthy();
      await fireEvent.press(screen.getByText('7am'));
      expect(screen.queryByLabelText('Part of the day')).toBeNull();
    });

    it('goes back to a bucket when the time is cleared', async () => {
      const { onSubmit } = await renderForm();
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Tidy');
      await fireEvent.press(screen.getByText('7am'));
      await fireEvent.press(screen.getByText('No set time'));
      await fireEvent.press(screen.getByRole('button', { name: 'Add to my routine' }));

      const draft = submitted(onSubmit);
      expect(draft.timeOfDay).toBeNull();
      expect(draft.bucketChoice).toBe('morning');
    });
  });

  describe('the reminder', () => {
    it('is off by default', async () => {
      const { onSubmit } = await renderForm();
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Stretch');
      await fireEvent.press(screen.getByRole('button', { name: 'Add to my routine' }));
      expect(submitted(onSubmit).remind).toBe(false);
    });

    it('names the time it would arrive, rather than leaving it a guess', async () => {
      await renderForm();
      await fireEvent.press(screen.getByText('7am'));
      await fireEvent(
        screen.getByLabelText('Remind me about this routine item'),
        'valueChange',
        true,
      );
      expect(screen.getByText('At 7 am.')).toBeTruthy();
    });

    it('says the bucket start when there is no specific time', async () => {
      // "Sometime this morning" has to resolve to a moment, and the form should
      // say which one rather than surprising somebody at 05:00.
      await renderForm();
      await fireEvent(
        screen.getByLabelText('Remind me about this routine item'),
        'valueChange',
        true,
      );
      expect(screen.getByText('At 5 am, the start of Morning.')).toBeTruthy();
    });
  });

  describe('editing', () => {
    it('opens with what the item already had', async () => {
      await renderForm({ item: EXISTING });
      expect(screen.getByDisplayValue('Stretch')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('keeps the link a linked item already had', async () => {
      // The form does not offer linking yet; it must not silently drop one.
      const { onSubmit } = await renderForm({
        item: { ...EXISTING, linkedChoreId: 'chore-1' },
      });
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      expect(submitted(onSubmit).linkedChoreId).toBe('chore-1');
    });

    it('offers delete only for something that exists', async () => {
      await renderForm();
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

      await renderForm({ item: EXISTING, onDelete: jest.fn() });
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });
  });

  it('can be left from the top, not only from the bottom of a long form', async () => {
    const { onCancel } = await renderForm();
    const exits = screen.getAllByLabelText('Cancel');
    expect(exits.length).toBeGreaterThan(1);
    fireEvent.press(exits[0]!);
    expect(onCancel).toHaveBeenCalled();
  });
});
