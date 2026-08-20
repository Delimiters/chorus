/**
 * A routine row on its own, with the drag library **not** mocked.
 *
 * This file exists because of a crash that every other test was blind to by
 * construction. `RoutineRow` called `useReorderableDrag()` directly, which
 * throws outside a reorderable list — and the row renders in two places: the
 * reorderable list holding your own routine, and a plain list holding a
 * housemate's shared one. So the Routines screen died the moment somebody
 * switched sharing on, with "please consume ReorderableList context within its
 * provider".
 *
 * `RoutinesView.test.tsx` mocks the library wholesale, necessarily — dragging
 * is a Reanimated worklet on the UI thread — and its stub hook returns a
 * harmless function, so the throw could never happen there.
 *
 * The rule this pins: **RoutineRow must render with no reorderable list above
 * it.** Anything needing the drag hook belongs in `DraggableRoutineRow`.
 */

import { render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { RoutineOccurrence } from '@/core/routines/project';
import { ThemeProvider } from '@/design/theme';
import { RoutineRow } from './RoutineRow';

const TODAY = civilDate('2026-03-15');

const occurrence = (over: Partial<RoutineOccurrence> = {}): RoutineOccurrence =>
  ({
    choreId: 'stretch',
    itemId: 'stretch',
    occurrenceKey: 'stretch',
    dueOn: TODAY,
    flexibleFrom: TODAY,
    flexibleUntil: TODAY,
    periodKey: '2026-03-15',
    slot: 0,
    subject: null,
    occurrenceIndex: 0,
    title: 'Stretch',
    ownerId: 'them',
    bucket: 'morning',
    timeOfDay: null,
    linkedChoreId: null,
    icon: null,
    remind: false,
    status: 'due',
    completedOn: null,
    sortKey: 120,
    position: null,
    ...over,
  }) as RoutineOccurrence;

describe('a routine row outside any reorderable list', () => {
  it('renders, which is what a housemate’s shared routine needs', () => {
    // No provider anywhere above this. The row must not reach for one.
    expect(() =>
      render(
        <ThemeProvider>
          <RoutineRow item={occurrence()} ink="pink" canTick={false} onToggle={jest.fn()} />
        </ThemeProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByText('Stretch')).toBeOnTheScreen();
  });

  it('says it can be reordered only when it is given a way to', () => {
    render(
      <ThemeProvider>
        <RoutineRow
          item={occurrence()}
          ink="pink"
          canTick={false}
          onToggle={jest.fn()}
          onOpen={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('Stretch. Edit.')).toBeOnTheScreen();
  });

  it('offers the hold-to-reorder hint when it is', () => {
    render(
      <ThemeProvider>
        <RoutineRow
          item={occurrence()}
          ink="pink"
          canTick
          onDrag={jest.fn()}
          onToggle={jest.fn()}
          onOpen={jest.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('Stretch. Edit, or hold to reorder.')).toBeOnTheScreen();
  });
});
