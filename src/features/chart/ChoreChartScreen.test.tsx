/**
 * The chart, tested where the backdated tick is wired.
 *
 * `weekChart` is unit-tested and would pass with nothing rendering it, and
 * `useToggleCompletion` accepts a `completedOn` it would happily never be sent.
 * The one assertion that proves the feature is the one below: tapping Tuesday's
 * box sends **Tuesday**. Send today's date instead and an `every N days` chore's
 * next occurrence moves — which is the thing Jake asked for this screen to
 * avoid.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { AgendaItem } from '@/core/occurrence/agenda';
import type { CivilDate } from '@/core/civil/types';
import { ThemeProvider } from '@/design/theme';

import { ChoreChartScreen } from './ChoreChartScreen';

const MONDAY = '2026-09-28' as CivilDate;
const TUESDAY = '2026-09-29' as CivilDate;
const WEDNESDAY = '2026-09-30' as CivilDate;
const THURSDAY = '2026-10-01' as CivilDate;

/** Wednesday, so Monday and Tuesday are past and Thursday is ahead. */
const TODAY = WEDNESDAY;

let mockItems: AgendaItem[] = [];
const mockMutate = jest.fn();

function occ(over: {
  dueOn: CivilDate;
  status?: AgendaItem['status'];
  choreTitle?: string;
  completedBy?: string | null;
  subject?: string | null;
}): AgendaItem {
  const completed = over.status === 'completed';
  return {
    choreId: 'c1',
    choreTitle: over.choreTitle ?? 'Dishes',
    occurrenceKey: `v1:c1:${over.dueOn}:0:${over.subject ?? '-'}`,
    dueOn: over.dueOn,
    status: over.status ?? 'due',
    subject: over.subject ?? null,
    timesOfDay: [],
    assignee: { kind: 'anyone' },
    completedOn: completed ? over.dueOn : null,
    completedBy: completed ? (over.completedBy ?? 'me') : null,
    daysLate: 0,
    rescheduled: false,
    originalDueOn: null,
    displaced: false,
    missedBefore: 0,
    daysOverdue: 0,
    occurrenceIndex: 0,
    periodKey: over.dueOn,
    slot: 0,
    showFrom: over.dueOn,
    flexibleFrom: over.dueOn,
    flexibleUntil: over.dueOn,
  };
}

jest.mock('@/data/hooks/useOccurrences', () => ({
  useOccurrences: () => ({
    items: mockItems,
    agenda: mockItems,
    chores: [],
    today: '2026-09-30',
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  }),
  useToggleCompletion: () => ({
    mutate: mockMutate,
    isPending: false,
    error: null,
    reset: jest.fn(),
  }),
}));
/**
 * Undefined until the household query lands, which is a render later than the
 * first one. That gap is where the stale-seed defect lived.
 */
let mockHouseholdLoaded = true;

jest.mock('@/data/hooks/useHousehold', () => ({
  // Monday-start, so the columns run Mon–Sun and the dates above line up.
  useHousehold: () =>
    mockHouseholdLoaded ? { data: { timeZone: 'UTC', weekStartsOn: 1 } } : { data: undefined },
  useMembers: () => ({
    data: [
      { userId: 'me', displayName: 'Jake', accent: 'blue' },
      { userId: 'them', displayName: 'Emily', accent: 'pink' },
    ],
  }),
}));
jest.mock('@/data/today', () => ({ useToday: () => '2026-09-30' }));
jest.mock('@/stores/sessionStore', () => ({ useUserId: () => 'me' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

const renderChart = () =>
  render(
    <ThemeProvider>
      <ChoreChartScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  mockItems = [];
  mockHouseholdLoaded = true;
  mockMutate.mockClear();
});

describe('the chart', () => {
  it('shows a row per chore that was due, with its week tally', () => {
    mockItems = [
      occ({ dueOn: MONDAY, status: 'completed' }),
      occ({ dueOn: TUESDAY }),
      occ({ dueOn: WEDNESDAY }),
    ];

    renderChart();

    expect(screen.getByText('Dishes')).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getByText('1 OF 3 DONE')).toBeTruthy();
  });

  it('says so when nothing was due', () => {
    renderChart();
    expect(screen.getByText('Nothing is due this week.')).toBeTruthy();
  });

  /* ── The feature ─────────────────────────────────────────────────────── */

  it('ticks an earlier day as that day, not as today', () => {
    mockItems = [occ({ dueOn: TUESDAY })];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, Tue 29 Sep, not done'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      item: expect.objectContaining({ dueOn: TUESDAY }),
      complete: true,
      // Tuesday. Today is Wednesday, and sending Wednesday would restart an
      // interval chore's clock a day late — the whole reason this screen exists.
      completedOn: TUESDAY,
    });
  });

  it('ticks today as today', () => {
    mockItems = [occ({ dueOn: WEDNESDAY })];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, due today, not done'));

    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ complete: true, completedOn: TODAY });
  });

  it('undoes a day that was already done', () => {
    mockItems = [occ({ dueOn: MONDAY, status: 'completed' })];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, Mon 28 Sep, done'));

    // No assertion on `completedOn` here: the hook ignores it when `complete`
    // is false, so one would read as coverage it is not.
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ complete: false });
  });

  /* ── Shared days ─────────────────────────────────────────────────────── */

  /*
   * An `everyone` chore fans out to one occurrence per person, and the
   * projector's last sort key is the subject's **user id** — so `items[0]` is
   * the same person for every fan-out chore in the household, forever. The
   * first version tapped `items[0]`: for whichever housemate's id sorted
   * second, every shared box hit the other person's share, the write landed on
   * a duplicate `occurrence_key` and was swallowed as idempotent, and the box
   * never changed. A silent no-op, every time, invisible to the person whose id
   * sorted first.
   *
   * `me` sorts before `them`, so `items[0]` is deliberately not the viewer's.
   */
  it('ticks your own share of a shared day, not whoever sorts first', () => {
    mockItems = [
      occ({ dueOn: TUESDAY, subject: 'me', status: 'completed', completedBy: 'me' }),
      occ({ dueOn: TUESDAY, subject: 'them' }),
    ];

    renderChart();
    // The cell reads as outstanding, because one share still is.
    fireEvent.press(screen.getByLabelText('Dishes, Tue 29 Sep, not done'));

    // But the viewer is `me`, whose share is done — so the offer is the undo.
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      complete: false,
      item: expect.objectContaining({ subject: 'me' }),
    });
  });

  it('offers nothing on a shared day that holds no share of yours', () => {
    mockItems = [occ({ dueOn: TUESDAY, subject: 'them' })];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, Tue 29 Sep, not done'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  /* ── What must not be tappable ───────────────────────────────────────── */

  it('does not let you tick a day that has not happened', () => {
    mockItems = [occ({ dueOn: THURSDAY })];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, due Thu 1 Oct'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does not let you tick a day nothing was due on', () => {
    mockItems = [occ({ dueOn: TUESDAY })];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, not due Mon 28 Sep'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('leaves a skipped day alone — un-skipping is a different decision', () => {
    mockItems = [occ({ dueOn: TUESDAY, status: 'skipped' })];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, Tue 29 Sep, skipped'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  /*
   * The defect found by looking at the screen rather than at a test.
   *
   * `weekStartsOn` arrives with the household, a fetch after the first render.
   * Seeding `useState` with the week computed from the placeholder captured a
   * Sunday-start grid for a Monday-start household, and the heading stayed on a
   * date range because the seeded date no longer equalled the computed one —
   * "This week" was unreachable for the whole life of the screen.
   */
  it('follows the household’s week once it loads, rather than the placeholder', () => {
    mockItems = [occ({ dueOn: TUESDAY })];
    mockHouseholdLoaded = false;

    const view = renderChart();

    mockHouseholdLoaded = true;
    view.rerender(
      <ThemeProvider>
        <ChoreChartScreen />
      </ThemeProvider>,
    );

    expect(screen.getByText('This week')).toBeTruthy();
    // Monday first, not Sunday: the grid is the household's week, not the
    // default one it was rendered with a moment earlier.
    expect(screen.getByLabelText('Dishes, not due Sun 4 Oct')).toBeTruthy();
  });

  /* ── Paging ──────────────────────────────────────────────────────────── */

  /*
   * The cross-month branch, which nothing reached. It hangs on
   * `formatDayShort(...).slice(4)` — a positional slice on a formatted string,
   * exactly the sort of thing that changes shape without a compile error. Four
   * weeks back from 28 September is 31 August to 6 September, which is the
   * nearest week that both straddles a month and is not "This week".
   */
  it('names a week that straddles a month boundary', () => {
    mockItems = [occ({ dueOn: TUESDAY })];

    renderChart();
    for (let i = 0; i < 4; i += 1) fireEvent.press(screen.getByLabelText('Previous week'));

    expect(screen.getByText('31 Aug – 6 Sep')).toBeTruthy();
  });

  it('pages back a week, and cannot page past this one', () => {
    mockItems = [occ({ dueOn: TUESDAY })];

    renderChart();
    expect(screen.getByText('This week')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Previous week'));
    expect(screen.getByText('21–27 September')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Next week'));
    expect(screen.getByText('This week')).toBeTruthy();

    // Already on this week, so the arrow is disabled and nothing moves.
    fireEvent.press(screen.getByLabelText('Next week'));
    expect(screen.getByText('This week')).toBeTruthy();
  });
});
