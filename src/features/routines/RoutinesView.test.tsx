import { fireEvent, render, screen } from '@testing-library/react-native';

import { addDays, civilDate } from '@/core/civil/date';
import type { CivilTime } from '@/core/civil/types';
import type { RoutineOccurrence } from '@/core/routines/project';
import { ThemeProvider } from '@/design/theme';
import { RoutinesView } from './RoutinesView';

const TODAY = civilDate('2026-03-15');
const ME = 'me';
const THEM = 'them';

const occurrence = (over: Partial<RoutineOccurrence> = {}): RoutineOccurrence =>
  ({
    choreId: 'stretch',
    itemId: 'stretch',
    occurrenceKey: `v1:stretch:${over.dueOn ?? TODAY}:0:-`,
    dueOn: TODAY,
    flexibleFrom: over.dueOn ?? TODAY,
    flexibleUntil: over.dueOn ?? TODAY,
    periodKey: '2026-03-15',
    slot: 0,
    subject: null,
    occurrenceIndex: 0,
    title: 'Stretch',
    ownerId: ME,
    bucket: 'morning',
    timeOfDay: '07:00' as CivilTime,
    linkedChoreId: null,
    icon: null,
    remind: false,
    status: 'due',
    completedOn: null,
    sortKey: 120,
    ...over,
  }) as RoutineOccurrence;

let mockOccurrences: RoutineOccurrence[] = [];
let mockDay = TODAY;
const mockToggle = jest.fn();

jest.mock('@/data/hooks/useRoutines', () => ({
  useRoutineDay: (on: string, options: { showOthers: boolean }) => {
    mockDay = on as typeof TODAY;
    // Deliberately the real one, so the day filtering and bucket splitting
    // under test is the code that ships rather than a stand-in.
    const { bucketSections } = jest.requireActual('@/core/routines/agenda');
    return {
      summary: bucketSections(mockOccurrences, 'me', { showOthers: options.showOthers, on }),
      occurrences: mockOccurrences,
      isLoading: false,
      error: null,
      unreadable: [],
    };
  },
  useToggleRoutine: () => ({ mutate: mockToggle, error: null }),
}));

// The linked-chore lookup reads today's chore occurrences. Mocked so the view
// tests stay about the routine screen; `mockChoreOccurrences` is what a linked
// item would find due today.
let mockChoreOccurrences: {
  choreId: string;
  occurrenceKey: string;
  dueOn: string;
  status?: string;
}[] = [];

/*
 * `agenda` is every occurrence in the window; `view.mine` is the outstanding
 * ones, which is why the filter below is here rather than being a convenience.
 *
 * The earlier version returned the same array for both, so it agreed with the
 * defect it was supposed to be able to catch — reading from `view.mine` still
 * found a completed chore, which the real hook never would.
 */
jest.mock('@/data/hooks/useOccurrences', () => ({
  useToday_View: () => ({
    agenda: mockChoreOccurrences,
    view: {
      mine: mockChoreOccurrences.filter((o) => o.status !== 'completed'),
      theirs: [],
    },
  }),
}));

jest.mock('@/data/hooks/useHousehold', () => ({
  useMembers: () => ({
    data: [
      { userId: 'me', displayName: 'Jake', accent: 'blue' },
      { userId: 'them', displayName: 'Sam', accent: 'pink' },
    ],
  }),
}));

jest.mock('@/stores/routineStore', () => ({
  useRoutinePreference: () => ({ showOthers: true, todayMode: 'routines' }),
  useRoutineStore: (selector: (s: unknown) => unknown) =>
    selector({ setTodayMode: jest.fn() } as unknown),
}));

function renderView() {
  return render(
    <ThemeProvider>
      <RoutinesView today={TODAY} myInk="blue" onAdd={jest.fn()} onOpen={jest.fn()} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockOccurrences = [];
  mockChoreOccurrences = [];
  mockDay = TODAY;
  mockToggle.mockClear();
});

describe('RoutinesView', () => {
  it('groups the day into buckets, and omits the empty ones', () => {
    mockOccurrences = [
      occurrence({ itemId: 'a', title: 'Stretch', bucket: 'morning' }),
      occurrence({ itemId: 'b', title: 'Journal', bucket: 'night', sortKey: 900 }),
    ];
    renderView();

    expect(screen.getByRole('header', { name: /Morning/ })).toBeTruthy();
    expect(screen.getByRole('header', { name: /Night/ })).toBeTruthy();
    // Nothing in the afternoon, so no heading saying so.
    expect(screen.queryByRole('header', { name: /Afternoon/ })).toBeNull();
  });

  it('says how much of your own routine is done', () => {
    mockOccurrences = [
      occurrence({ itemId: 'a', status: 'completed', completedOn: TODAY }),
      occurrence({ itemId: 'b', title: 'Water', status: 'due' }),
    ];
    renderView();
    expect(screen.getByText('1 OF 2 DONE')).toBeTruthy();
  });

  describe('somebody else’s routine', () => {
    it('shows it under their name', () => {
      mockOccurrences = [
        occurrence({ itemId: 'mine' }),
        occurrence({ itemId: 'theirs', title: 'Run', ownerId: THEM }),
      ];
      renderView();
      expect(screen.getByRole('header', { name: /Sam/ })).toBeTruthy();
      expect(screen.getByText('Run')).toBeTruthy();
    });

    it('does not let you tick it', () => {
      // Read-only for others is enforced by the database; this stops the screen
      // offering something the server would refuse.
      mockOccurrences = [occurrence({ itemId: 'theirs', title: 'Run', ownerId: THEM })];
      renderView();
      const checkbox = screen.getByLabelText('Mark Run done');
      expect(checkbox.props.accessibilityState.disabled).toBe(true);
    });

    it('does not count it toward your total', () => {
      mockOccurrences = [
        occurrence({ itemId: 'mine' }),
        occurrence({ itemId: 'theirs', title: 'Run', ownerId: THEM }),
      ];
      renderView();
      expect(screen.getByText('0 OF 1 DONE')).toBeTruthy();
    });
  });

  describe('paging through days', () => {
    it('starts on today', () => {
      renderView();
      expect(screen.getByRole('header', { name: 'Today' })).toBeTruthy();
    });

    it('goes back a day', () => {
      renderView();
      fireEvent.press(screen.getByLabelText('Previous day'));
      expect(mockDay).toBe(addDays(TODAY, -1));
    });

    it('will not go past today, because tomorrow has not happened', () => {
      renderView();
      const forward = screen.getByLabelText('Next day');
      expect(forward.props.accessibilityState.disabled).toBe(true);
    });

    it('comes forward again once you have gone back', () => {
      renderView();
      fireEvent.press(screen.getByLabelText('Previous day'));
      fireEvent.press(screen.getByLabelText('Next day'));
      expect(mockDay).toBe(TODAY);
    });

    it('makes a past day read-only', () => {
      // A completion carries the date it was for, so back-filling would quietly
      // rewrite a day already lived.
      mockOccurrences = [occurrence({ dueOn: addDays(TODAY, -1), status: 'missed' })];
      renderView();
      fireEvent.press(screen.getByLabelText('Previous day'));
      expect(screen.getByLabelText('Mark Stretch done').props.accessibilityState.disabled).toBe(
        true,
      );
    });
  });

  it('ticks your own item off', () => {
    mockOccurrences = [occurrence()];
    renderView();
    fireEvent.press(screen.getByLabelText('Mark Stretch done'));
    expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ complete: true, on: TODAY }));
  });

  describe('a linked chore', () => {
    const LINKED = { choreId: 'dishes', occurrenceKey: 'v1:dishes:2026-03-15:0:-', dueOn: TODAY };

    it('is passed along when the routine item is ticked', () => {
      mockChoreOccurrences = [LINKED];
      mockOccurrences = [occurrence({ title: 'Wash up', linkedChoreId: 'dishes' })];
      renderView();

      fireEvent.press(screen.getByRole('checkbox', { name: /Wash up/ }));
      expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ chore: LINKED }));
    });

    it('is passed along when it is un-ticked, though the chore is done by then', () => {
      // The asymmetry that shipped. Ticking completed the chore, which took the
      // occurrence out of the outstanding lists this used to read, so the
      // un-tick found nothing, sent no chore to the RPC, and left the chore
      // completed with nothing on screen to say so.
      // Completed, because the tick that preceded this un-tick completed it.
      mockChoreOccurrences = [{ ...LINKED, status: 'completed' }];
      mockOccurrences = [
        occurrence({
          title: 'Wash up',
          linkedChoreId: 'dishes',
          status: 'completed',
          completedOn: TODAY,
        }),
      ];
      renderView();

      fireEvent.press(screen.getByRole('checkbox', { name: /Wash up/ }));
      expect(mockToggle).toHaveBeenCalledWith(
        expect.objectContaining({
          complete: false,
          chore: expect.objectContaining({
            choreId: 'dishes',
            occurrenceKey: LINKED.occurrenceKey,
          }),
        }),
      );
    });

    it('is left alone when nothing of that chore is due today', () => {
      mockChoreOccurrences = [];
      mockOccurrences = [occurrence({ title: 'Wash up', linkedChoreId: 'dishes' })];
      renderView();

      fireEvent.press(screen.getByRole('checkbox', { name: /Wash up/ }));
      expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ chore: null }));
    });
  });
});
