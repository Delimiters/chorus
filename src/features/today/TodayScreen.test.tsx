/**
 * Happy path for Today.
 *
 * Mocked at the hook boundary, but the *data* is real: the fixtures are chores,
 * and the view comes from the actual projector and `buildTodayView`. So this
 * tests the screen against the shapes the engine genuinely produces rather than
 * against a hand-written object that could drift away from them.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { CalendarConfig, CivilDate } from '@/core/civil/types';
import { buildTodayView, collapseSupersededMisses } from '@/core/occurrence/agenda';
import { projectOccurrences } from '@/core/occurrence/project';
import type { ChoreInput, CompletionInput } from '@/core/occurrence/types';
import { ThemeProvider } from '@/design/theme';
import { TodayScreen } from './TodayScreen';

const ME = 'user-me';
const THEM = 'user-them';
const mockToday = civilDate('2026-07-30'); // a Thursday
const CAL: CalendarConfig = { weekStartsOn: 0 };

const d = (s: string): CivilDate => civilDate(s);

const mockChores: ChoreInput[] = [
  {
    id: 'dishes',
    title: 'Dishes',
    schedule: {
      rule: { kind: 'daily', everyNDays: 1 },
      startsOn: d('2026-07-27'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'anyone' },
    archived: false,
  },
  {
    id: 'trash',
    title: 'Take out the trash',
    schedule: {
      rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [4] },
      startsOn: d('2026-07-02'),
      endsOn: null,
      timesOfDay: [],
    },
    // Rotating: whoever's turn it is on 30 July owns it.
    assignment: {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: d('2026-07-02'), memberIds: [ME, THEM], offset: 1 }],
    },
    archived: false,
  },
  {
    id: 'plants',
    title: 'Water the plants',
    schedule: {
      rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
      startsOn: d('2026-07-26'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'fixed', memberId: ME },
    archived: false,
  },
];

/** Real projection, so the screen sees exactly what the app would hand it. */
function buildView(completions: CompletionInput[] = []) {
  const projected = projectOccurrences(
    { chores: mockChores, completions, exceptions: [], memberIds: [ME, THEM], today: mockToday },
    CAL,
    { start: d('2026-07-19'), end: d('2026-08-01') },
  );
  return buildTodayView(collapseSupersededMisses(projected, mockToday), mockToday, ME);
}

const mockToggle = jest.fn();
const mockRefetch = jest.fn(async () => {});
const mockSkip = jest.fn();
const mockReschedule = jest.fn();
const mockClear = jest.fn();
const mockPush = jest.fn();
let mockView = buildView();
let mockError: Error | null = null;
let mockLoading = false;

jest.mock('@/data/hooks/useOccurrences', () => ({
  useToday_View: () => ({
    view: mockView,
    chores: mockChores,
    today: mockToday,
    isLoading: mockLoading,
    error: mockError,
    unreadable: [] as string[],
    refetch: mockRefetch,
  }),
  useToggleCompletion: () => ({ mutate: mockToggle }),
  useOccurrenceActions: () => ({
    skip: { mutate: mockSkip },
    reschedule: { mutate: mockReschedule },
    clear: { mutate: mockClear },
  }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/data/hooks/useHousehold', () => ({
  useHousehold: () => ({ data: { weekStartsOn: 0, timeZone: 'UTC' } }),
  useMembers: () => ({
    data: [
      { userId: ME, displayName: 'Jake', accent: 'blue' },
      { userId: THEM, displayName: 'Sam', accent: 'ochre' },
    ],
  }),
}));

jest.mock('@/stores/sessionStore', () => ({
  useUserId: () => ME,
  // The screen reads categories, which are household-scoped. Without this the
  // partial mock omits the hook and the whole suite fails to render.
  useActiveHouseholdId: () => 'house-1',
}));

// Categories are fetched, and these suites render without a QueryClientProvider
// on purpose — they mock the data layer rather than standing one up. An empty
// list keeps the rows unbadged, which is what every assertion below expects.
// Mutable so a test can give the household categories. Empty by default,
// which is what most assertions here expect: with no categories, Today falls
// back to Yours / Everyone else rather than putting everything under "Other".
let mockCategories: { id: string; name: string; ink: string | null; position: number }[] = [];

// The sheet can offer "add to my routine", which reads your routine items.
// This suite mocks the data layer rather than standing up a QueryClient.
jest.mock('@/data/hooks/useRoutines', () => ({
  useMyRoutineItems: () => [],
}));

jest.mock('@/data/hooks/useCategories', () => ({
  useCategoryList: () => mockCategories,
  useCategories: () => ({ data: mockCategories, isPending: false, isError: false }),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <TodayScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockCategories = [];
  mockToggle.mockClear();
  mockRefetch.mockClear();
  mockSkip.mockClear();
  mockReschedule.mockClear();
  mockClear.mockClear();
  mockPush.mockClear();
  mockView = buildView();
  mockError = null;
  mockLoading = false;
});

describe('Today', () => {
  it('heads the screen with the date', async () => {
    await renderScreen();
    expect(screen.getByText('THURSDAY 30 JULY')).toBeOnTheScreen();
  });

  it('separates what is yours from what is theirs', async () => {
    await renderScreen();
    expect(screen.getByRole('header', { name: 'Yours' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Everyone else' })).toBeOnTheScreen();
  });

  it('names whose turn it is, in words and not only in colour', async () => {
    await renderScreen();
    // Trash rotates; on this occurrence it is Sam's, and the row says so.
    expect(
      screen.getByRole('button', { name: /Take out the trash, Sam's turn/ }),
    ).toBeOnTheScreen();
  });

  it('shows a chore anyone can do without claiming it belongs to someone', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: /Dishes, anyone can do it/ })).toBeOnTheScreen();
  });

  it('collapses a floating chore into one row with its progress', async () => {
    await renderScreen();
    // "3× a week" is three occurrences; three identical rows would be noise.
    expect(screen.getByRole('header', { name: 'Sometime this week' })).toBeOnTheScreen();
    expect(
      screen.getByLabelText(/Mark one Water the plants done\. 0 of 3 done\./),
    ).toBeOnTheScreen();
  });

  it('completes an occurrence when its checkbox is pressed', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Mark Dishes done'));

    expect(mockToggle).toHaveBeenCalledTimes(1);
    const call = mockToggle.mock.calls[0]?.[0];
    expect(call.complete).toBe(true);
    expect(call.item.choreId).toBe('dishes');
    expect(call.item.dueOn).toBe(mockToday);
  });

  it('moves a completed chore into Done and offers to undo it', async () => {
    mockView = buildView([
      {
        choreId: 'dishes',
        occurrenceKey: buildView().mine.find((i) => i.choreId === 'dishes')?.occurrenceKey ?? '',
        completedOn: mockToday,
        completedBy: ME,
      },
    ]);
    await renderScreen();

    expect(screen.getByRole('header', { name: 'Done' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Mark Dishes not done')).toBeOnTheScreen();
    // And it is not still sitting in the outstanding list.
    expect(screen.queryByLabelText('Mark Dishes done')).toBeNull();
  });

  it('counts what has been done in the header', async () => {
    mockView = buildView([
      {
        choreId: 'dishes',
        occurrenceKey: buildView().mine.find((i) => i.choreId === 'dishes')?.occurrenceKey ?? '',
        completedOn: mockToday,
        completedBy: ME,
      },
    ]);
    await renderScreen();
    expect(screen.getByText('THURSDAY 30 JULY · 1 DONE')).toBeOnTheScreen();
  });

  it('surfaces a load failure rather than showing an empty list', async () => {
    mockError = new Error('Could not reach the server.');
    await renderScreen();
    expect(screen.getByText('Could not reach the server.')).toBeOnTheScreen();
  });
});

describe('grouping by category', () => {
  it('shows a heading per category, not just a tag on each row', () => {
    // The behaviour asked for directly: categories should be *headings*. An
    // earlier version put them only on the row as a chip, which reads as a
    // weaker signal than a section when the question is "what is left today".
    mockCategories = [
      { id: 'c-kitchen', name: 'Kitchen', ink: 'teal', position: 0 },
      { id: 'c-outdoors', name: 'Outdoors', ink: null, position: 1 },
    ];
    for (const chore of mockChores as unknown as { categoryId: string | null }[]) {
      chore.categoryId = 'c-kitchen';
    }

    renderScreen();

    // Both levels: ownership first, category nested beneath it.
    expect(screen.getByRole('header', { name: 'Yours' })).toBeTruthy();
    expect(screen.getAllByRole('header', { name: 'Kitchen' }).length).toBeGreaterThan(0);
    // Outdoors has nothing in it today, so it must not take up a line saying so.
    expect(screen.queryByRole('header', { name: 'Outdoors' })).toBeNull();
  });

  it('falls back to Yours when the household has no categories at all', () => {
    // Grouping by category before any exists would put every row under a
    // single "Other" heading, which says nothing.
    mockCategories = [];
    renderScreen();
    expect(screen.getByRole('header', { name: 'Yours' })).toBeTruthy();
  });
});

describe('adding a chore from Today', () => {
  it('offers a button that does not depend on where you have scrolled', async () => {
    // Floating rather than in the header or at the end of the list: adding a
    // chore is the one thing you might want from anywhere in a long list.
    renderScreen();
    expect(screen.getByRole('button', { name: 'Add a chore' })).toBeTruthy();
  });

  it('opens the new chore form', async () => {
    renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Add a chore' }));
    expect(mockPush).toHaveBeenCalledWith('/chore/new');
  });
});
