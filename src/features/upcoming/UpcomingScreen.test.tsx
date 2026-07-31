/**
 * Happy path for Upcoming.
 *
 * As with Today, the fixtures are chores and the occurrences come from the real
 * projector — the grid's dots and the dated agenda are both derived from them,
 * so a fabricated fixture would prove very little.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { CalendarConfig, CivilDate } from '@/core/civil/types';
import { toAgendaItems } from '@/core/occurrence/agenda';
import { projectOccurrences } from '@/core/occurrence/project';
import type { ChoreInput } from '@/core/occurrence/types';
import { ThemeProvider } from '@/design/theme';
import { UpcomingScreen } from './UpcomingScreen';

const ME = 'user-me';
const THEM = 'user-them';
const mockToday = civilDate('2026-07-30'); // a Thursday
const CAL: CalendarConfig = { weekStartsOn: 0 };

const d = (s: string): CivilDate => civilDate(s);

const mockChores: ChoreInput[] = [
  {
    id: 'trash',
    title: 'Take out the trash',
    schedule: {
      rule: { kind: 'weekly', everyNWeeks: 1, weekdays: [5] }, // Fridays
      startsOn: d('2026-07-03'),
      endsOn: null,
      timeOfDay: null,
    },
    // Alternating every occurrence, so the hand-over is visible week to week.
    assignment: {
      kind: 'rotate',
      cadence: { unit: 'occurrence', every: 1 },
      segments: [{ effectiveFrom: d('2026-07-03'), memberIds: [ME, THEM], offset: 0 }],
    },
    archived: false,
  },
  {
    id: 'fridge',
    title: 'Clean the fridge',
    schedule: {
      rule: { kind: 'monthlyByDay', everyNMonths: 1, dayOfMonth: 15, overflow: 'clamp' },
      startsOn: d('2026-07-15'),
      endsOn: null,
      timeOfDay: null,
    },
    assignment: { kind: 'fixed', memberId: THEM },
    archived: false,
  },
];

const mockItems = (() => {
  const projected = projectOccurrences(
    {
      chores: mockChores,
      completions: [],
      exceptions: [],
      memberIds: [ME, THEM],
      today: mockToday,
    },
    CAL,
    { start: d('2026-06-28'), end: d('2026-09-05') },
  );
  // Uncollapsed, which is what `useOccurrences` hands the calendar.
  return toAgendaItems(projected, mockToday);
})();

const mockToggle = jest.fn();
const mockRefetch = jest.fn(async () => {});
const mockSkip = jest.fn();
const mockReschedule = jest.fn();
const mockClear = jest.fn();
const mockPush = jest.fn();

jest.mock('@/data/hooks/useOccurrences', () => ({
  useOccurrences: () => ({
    items: mockItems,
    chores: mockChores,
    today: mockToday,
    isLoading: false,
    error: null,
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

jest.mock('@/stores/sessionStore', () => ({ useUserId: () => ME }));
jest.mock('@/data/today', () => ({ useToday: () => mockToday }));

function renderScreen() {
  return render(
    <ThemeProvider>
      <UpcomingScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockToggle.mockClear();
  mockRefetch.mockClear();
  mockSkip.mockClear();
  mockReschedule.mockClear();
  mockClear.mockClear();
  mockPush.mockClear();
});

describe('Upcoming', () => {
  it('opens on the current week', async () => {
    await renderScreen();
    // 30 July is a Thursday; a Sunday-start week runs 26 July to 1 August.
    expect(screen.getByLabelText(/^Sun 26,/)).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Sat 1,/)).toBeOnTheScreen();
    // Next week is not in the strip until it is expanded.
    expect(screen.queryByLabelText(/^Sun 2,/)).toBeNull();
  });

  it('says what is due on a day, and what is not', async () => {
    await renderScreen();
    // Trash falls on Fridays, and the label is singular for one.
    expect(screen.getByLabelText('Fri 31, 1 chore')).toBeOnTheScreen();
    expect(screen.getByLabelText('Sun 26, nothing due')).toBeOnTheScreen();
  });

  it('keeps a dot on a past day that a later occurrence superseded', async () => {
    // The regression this guards: the collapse rule ran in the shared data hook,
    // so every superseded past occurrence was gone before the grid saw it. Fri 3,
    // 10 and 17 July showed nothing — and the hand-over those dots make visible
    // is the only reason a calendar earns its place here.
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Expand to the whole month'));

    expect(screen.getByLabelText('Fri 3, 1 chore')).toBeOnTheScreen();
    expect(screen.getByLabelText('Fri 10, 1 chore')).toBeOnTheScreen();
    expect(screen.getByLabelText('Fri 17, 1 chore')).toBeOnTheScreen();
  });

  it('expands to the whole month and back', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Expand to the whole month'));

    expect(screen.getByText('July 2026')).toBeOnTheScreen();
    // The grid now runs whole weeks across the month, so early July is present.
    expect(screen.getByLabelText(/^Wed 1,/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Collapse to one week'));
    expect(screen.queryByText('July 2026')).toBeNull();
  });

  it('lists the days ahead with whose turn each one is', async () => {
    await renderScreen();
    // Trash alternates; the two upcoming Fridays belong to different people,
    // which is the thing the calendar exists to show.
    // The agenda runs well past the visible strip, so each turn recurs.
    expect(
      screen.getAllByRole('button', { name: /Take out the trash, Sam's turn/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', { name: /Take out the trash, Your turn/ }).length,
    ).toBeGreaterThan(0);
  });

  it('shows a future monthly chore on its day', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: /Clean the fridge, Sam's turn/ })).toBeOnTheScreen();
  });

  it('completes an occurrence from the agenda', async () => {
    await renderScreen();
    await fireEvent.press(screen.getAllByLabelText('Mark Take out the trash done')[0] as never);

    expect(mockToggle).toHaveBeenCalledTimes(1);
    expect(mockToggle.mock.calls[0]?.[0].complete).toBe(true);
  });
});
