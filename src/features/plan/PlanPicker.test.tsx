/**
 * The picker, which had no tests and a findability bug.
 *
 * Jake could not find "Water upstairs plants" to add it. It was there — inside
 * a forty-row "Late" group, in a 420px scroll box, among fifty-five offered
 * rows. Grouping by why-you-might-pick-something is right for browsing and
 * useless for looking one thing up, and at this household's size looking one
 * thing up is the common case.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, ScrollView } from 'react-native';

import { civilDate } from '@/core/civil/date';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ThemeProvider } from '@/design/theme';
import { PlanPicker, type PickerGroup } from './PlanPicker';

const TODAY = civilDate('2026-09-01');

const item = (title: string): AgendaItem =>
  ({
    occurrenceKey: `v1:${title}`,
    choreId: title,
    choreTitle: title,
    dueOn: TODAY,
    status: 'due',
    daysOverdue: 0,
    missedBefore: 0,
    completedBy: null,
    assignee: { kind: 'anyone' },
  }) as unknown as AgendaItem;

const onAdd = jest.fn();
const onClose = jest.fn();

function renderPicker(groups: PickerGroup[]) {
  return render(
    <ThemeProvider>
      <PlanPicker open groups={groups} categoryFor={() => null} onClose={onClose} onAdd={onAdd} />
    </ThemeProvider>,
  );
}

const late = (...titles: string[]): PickerGroup => ({
  key: 'late',
  title: 'Late',
  items: titles.map(item),
});
const later = (...titles: string[]): PickerGroup => ({
  key: 'later',
  title: 'Later',
  items: titles.map(item),
});

beforeEach(() => {
  onAdd.mockClear();
  onClose.mockClear();
});

describe('finding something in a long list', () => {
  it('filters across every group at once', () => {
    // The reported bug: the chore was offered and unfindable.
    renderPicker([
      late('Water upstairs plants', 'Kill wasps', 'Get car inspected'),
      later('Water hallway pothos'),
    ]);

    fireEvent.changeText(screen.getByLabelText('Search chores to add'), 'water');

    expect(screen.getByText('Water upstairs plants')).toBeOnTheScreen();
    expect(screen.getByText('Water hallway pothos')).toBeOnTheScreen();
    expect(screen.queryByText('Kill wasps')).toBeNull();
  });

  it('matches anywhere in the name, not just the start', () => {
    // People search for the word they remember, which is rarely the first one.
    renderPicker([late('Take out the trash', 'Kill wasps')]);
    fireEvent.changeText(screen.getByLabelText('Search chores to add'), 'trash');

    expect(screen.getByText('Take out the trash')).toBeOnTheScreen();
    expect(screen.queryByText('Kill wasps')).toBeNull();
  });

  it('ignores case', () => {
    renderPicker([late('Kill Wasps')]);
    fireEvent.changeText(screen.getByLabelText('Search chores to add'), 'WASPS');
    expect(screen.getByText('Kill Wasps')).toBeOnTheScreen();
  });

  it('says so when nothing matches', () => {
    renderPicker([late('Kill wasps')]);
    fireEvent.changeText(screen.getByLabelText('Search chores to add'), 'zzz');

    expect(screen.getByText('Nothing matching "zzz".')).toBeOnTheScreen();
    expect(screen.queryByText('Kill wasps')).toBeNull();
  });

  it('drops a group whose every row is filtered out', () => {
    renderPicker([late('Kill wasps'), later('Water pothos')]);
    fireEvent.changeText(screen.getByLabelText('Search chores to add'), 'water');

    expect(screen.queryByText('LATE · 1')).toBeNull();
    expect(screen.getByText('LATER · 1')).toBeOnTheScreen();
  });
});

describe('choosing', () => {
  it('keeps a selection that the search then hides', () => {
    /*
     * Tick something, search for something else, add — the first must still be
     * in the batch. Filtering the *selection* rather than only the view would
     * drop it silently, which is the worst possible way to lose a choice.
     */
    renderPicker([late('Kill wasps', 'Water pothos')]);

    fireEvent.press(screen.getByRole('checkbox', { name: 'Kill wasps' }));
    fireEvent.changeText(screen.getByLabelText('Search chores to add'), 'water');
    fireEvent.press(screen.getByRole('checkbox', { name: 'Water pothos' }));
    fireEvent.press(screen.getByRole('button', { name: 'Add 2 to today' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0].map((i: AgendaItem) => i.choreTitle).sort()).toEqual([
      'Kill wasps',
      'Water pothos',
    ]);
  });

  it('counts the selection on the button', () => {
    renderPicker([late('Kill wasps', 'Water pothos')]);
    expect(screen.getByRole('button', { name: 'Nothing selected' })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('checkbox', { name: 'Kill wasps' }));
    expect(screen.getByRole('button', { name: 'Add 1 to today' })).toBeOnTheScreen();
  });

  it('clears the search on the way out, so the next open starts fresh', () => {
    /*
     * A query left behind would make the next open look empty, and the fastest
     * way to conclude a feature is broken is to open it and see nothing.
     *
     * The first version of this test searched for something that hid the very
     * row it then tried to tick — an assertion about a screen that could not
     * exist.
     */
    renderPicker([late('Kill wasps')]);

    fireEvent.press(screen.getByRole('checkbox', { name: 'Kill wasps' }));
    fireEvent.changeText(screen.getByLabelText('Search chores to add'), 'wasps');
    fireEvent.press(screen.getByRole('button', { name: 'Add 1 to today' }));

    expect(onClose).toHaveBeenCalled();
    expect(screen.getByLabelText('Search chores to add').props.value).toBe('');
  });
});

describe('the keyboard', () => {
  /*
   * Props, not pixels: jest-expo does no layout, so this cannot prove the list
   * is actually clear of the keyboard — that was checked on the phone. What it
   * can pin is the two decisions, both of which are one prop each and both of
   * which were silently absent.
   */
  const listOf = () => screen.UNSAFE_getByType(ScrollView);

  it('lets a tap through instead of only dismissing itself', () => {
    // Without this the first tap on a row is eaten dismissing the keyboard and
    // the row does not toggle: you tap a chore, nothing happens, you tap again.
    renderPicker([late('Water upstairs plants')]);

    expect(listOf().props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('shortens the list when the keyboard is up', () => {
    // `Keyboard.emit` does not exist under jest-expo, so the listener the hook
    // registers is captured and called directly — which is what the platform
    // does to it anyway.
    const listeners = new Map<string, (event: unknown) => void>();
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((
      event: string,
      handler: (payload: unknown) => void,
    ) => {
      listeners.set(event, handler);
      return { remove: () => listeners.delete(event) };
    }) as never);

    renderPicker([late('Water upstairs plants')]);
    const before = listOf().props.style.maxHeight;

    act(() => {
      /*
       * Deliberately taller than a real keyboard. The test environment's window
       * is far taller than any phone, so a realistic 336 never forces the
       * clamp — and jest-expo does no layout, so the arithmetic against a real
       * screen cannot be checked here regardless. What this pins is the
       * coupling: the list's height is a function of the keyboard's. The
       * clearance itself was checked on the phone.
       */
      listeners.get('keyboardWillShow')?.({ endCoordinates: { height: 5000 } });
    });

    // The whole bug: at a fixed height the bottom of the list sits exactly
    // where the keyboard appears, so the row you just searched for is
    // unreachable.
    expect(listOf().props.style.maxHeight).toBeLessThan(before);
  });
});
