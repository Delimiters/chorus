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
import { daysBetween } from '@/core/civil/date';
import { RESCHEDULE_PAD_DAYS } from '@/core/occurrence/project';
import { MAX_WINDOW_DAYS } from '@/core/recurrence/expand';
import type { CivilDate } from '@/core/civil/types';
import { ThemeProvider } from '@/design/theme';

import {
  ChoreChartScreen,
  MAX_WEEKS_BACK,
  WEEKS_PER_STEP,
  spanFor,
  windowFor,
} from './ChoreChartScreen';

const MONDAY = '2026-09-28' as CivilDate;
const TUESDAY = '2026-09-29' as CivilDate;
const WEDNESDAY = '2026-09-30' as CivilDate;
const THURSDAY = '2026-10-01' as CivilDate;

/** Wednesday, so Monday and Tuesday are past and Thursday is ahead. */
const TODAY = WEDNESDAY;

let mockItems: AgendaItem[] = [];
let mockError: Error | null = null;
const mockMutate = jest.fn();
const mockRefetch = jest.fn();

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
    error: mockError,
    refetch: mockRefetch,
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
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
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
  mockError = null;
  mockCanGoBack = true;
  mockMutate.mockClear();
  mockRefetch.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
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
    // The cell reads as outstanding, because one share still is — but the box
    // says whose half is done, and the tap acts on that half.
    fireEvent.press(screen.getByLabelText('Dishes, Tue 29 Sep, not done, you have done yours'));

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
    // Announced as theirs, not as "not done" — and it does nothing when pressed.
    fireEvent.press(screen.getByLabelText("Dishes, Tue 29 Sep, not done, your housemate's"));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  /*
   * The regression the previous round introduced: returning early on your own
   * share collapsed every state into one string for anything that was not
   * yours, so a housemate's chore read the same whether it was done, missed,
   * due today or still to come. Whether it got done is the one thing this
   * screen exists to say.
   */
  it('still says whether a housemate’s chore got done', () => {
    mockItems = [
      occ({ dueOn: MONDAY, subject: 'them', status: 'completed', completedBy: 'them' }),
      occ({ dueOn: TUESDAY, subject: 'them' }),
    ];

    renderChart();

    expect(screen.getByLabelText("Dishes, Mon 28 Sep, done, your housemate's")).toBeTruthy();
    expect(screen.getByLabelText("Dishes, Tue 29 Sep, not done, your housemate's")).toBeTruthy();
  });

  /*
   * A floating "3x a week" chore puts every slot in one box, so without a
   * count the first two of three taps changed nothing on screen.
   */
  it('shows how far through a day with several slots you are', () => {
    mockItems = [
      { ...occ({ dueOn: TUESDAY, status: 'completed', completedBy: 'me' }), occurrenceKey: 'k0' },
      { ...occ({ dueOn: TUESDAY }), occurrenceKey: 'k1' },
      { ...occ({ dueOn: TUESDAY }), occurrenceKey: 'k2' },
    ];

    renderChart();

    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getByLabelText('Dishes, Tue 29 Sep, not done, 1 of 3 done')).toBeTruthy();
  });

  /*
   * The box that destroyed data. Your share done, your housemate's not: the
   * cell reads outstanding and the only action is to undo *your* completion.
   * It must not claim to be unchecked and must not call itself "not done".
   */
  it('says your share is done on a day that is not finished', () => {
    mockItems = [
      occ({ dueOn: TUESDAY, subject: 'me', status: 'completed', completedBy: 'me' }),
      occ({ dueOn: TUESDAY, subject: 'them' }),
    ];

    renderChart();

    const box = screen.getByLabelText('Dishes, Tue 29 Sep, not done, you have done yours');
    expect(box.props.accessibilityState).toMatchObject({ checked: true });
    // The day's own state survives in the label rather than being replaced by
    // yours — whether it got done is what the chart is for.
    expect(screen.queryByLabelText('Dishes, Tue 29 Sep, not done')).toBeNull();
  });

  it('says you skipped yours, rather than that the day was skipped', () => {
    mockItems = [
      occ({ dueOn: TUESDAY, subject: 'me', status: 'skipped' }),
      occ({ dueOn: TUESDAY, subject: 'them' }),
    ];

    renderChart();
    fireEvent.press(screen.getByLabelText('Dishes, Tue 29 Sep, not done, you skipped yours'));

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

  /*
   * The error state, which shipped with no coverage at all — the mock
   * hard-coded `error: null`, so the back bar, the cold-start fallback and the
   * retry were unreachable from the suite and deleting the whole branch would
   * have gone unnoticed. This screen is pushed from House under a Stack with
   * no header, so a bare `ErrorState` is the same dead end as `/chores`.
   */
  describe('when the week cannot be loaded', () => {
    it('still offers a way back', () => {
      mockError = new Error('offline');

      renderChart();
      fireEvent.press(screen.getByRole('button', { name: 'Back' }));

      expect(mockBack).toHaveBeenCalled();
    });

    it('offers a retry that actually refetches', () => {
      mockError = new Error('offline');

      renderChart();
      fireEvent.press(screen.getByText('Try again'));

      expect(mockRefetch).toHaveBeenCalled();
    });

    it('says what went wrong', () => {
      mockError = new Error('offline');

      renderChart();

      expect(screen.getByText('offline')).toBeTruthy();
    });
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

/*
 * The clamp, pinned against the engine's own limit rather than against a number
 * somebody typed.
 *
 * `projectOccurrences` throws inside a `useMemo` during render, so going over
 * takes the whole app down through the root error boundary, not this screen's
 * error state — and no test of this screen can see it, because they all mock
 * `useOccurrences`. Change `WEEKS_PER_STEP` to 16 and the old arrangement went
 * back over the limit silently with every test green.
 */
describe('how far back the window may reach', () => {
  /*
   * Measured off `windowFor`, which is what the component actually asks for.
   *
   * Hand-computing `7 * span + 7` here matched today and was a second
   * implementation: widen the window's end to prefetch, or change the factor,
   * and this stays green while the real window grows past the limit.
   */
  const paddedDays = (weeksBack: number) => {
    const window = windowFor('2026-09-28' as CivilDate, weeksBack);
    // The same sum `projectOccurrences` guards on.
    return daysBetween(window.start, window.end) + 1 + RESCHEDULE_PAD_DAYS * 2;
  };

  it('stays inside the projection limit at its widest', () => {
    expect(paddedDays(MAX_WEEKS_BACK)).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
  });

  /*
   * Non-vacuity: the clamp has to be the thing holding it, not the arithmetic
   * happening to be small. One step further has to breach the limit, or this
   * is a test that would pass with the clamp set to anything.
   *
   * Which also means this fails if `MAX_WEEKS_BACK` is *lowered* — 32 is the
   * largest safe value, not merely a safe one, and a more conservative clamp
   * turns this red with a message that reads like the opposite of the problem.
   * Say so here rather than leaving the next person to work it out.
   */
  it('is the largest safe clamp: one step further breaches the limit', () => {
    expect(paddedDays(MAX_WEEKS_BACK + WEEKS_PER_STEP)).toBeGreaterThan(MAX_WINDOW_DAYS);
  });

  it('grows in steps rather than on every tap, so paging does not refetch', () => {
    expect(spanFor(0)).toBe(WEEKS_PER_STEP);
    expect(spanFor(WEEKS_PER_STEP - 1)).toBe(WEEKS_PER_STEP);
    expect(spanFor(WEEKS_PER_STEP)).toBe(WEEKS_PER_STEP * 2);
  });

  it('stops the back arrow at the clamp', () => {
    mockItems = [occ({ dueOn: TUESDAY })];
    renderChart();

    for (let i = 0; i < MAX_WEEKS_BACK + 5; i += 1) {
      fireEvent.press(screen.getByLabelText('Previous week'));
    }

    // 32 weeks back from the week of 28 Sep 2026 is the week of 16 Feb 2026.
    expect(screen.getByText('16–22 February')).toBeTruthy();
  });
});
