/**
 * Happy path for Today.
 *
 * Mocked at the hook boundary, but the *data* is real: the fixtures are chores,
 * and the view comes from the actual projector and `buildTodayView`. So this
 * tests the screen against the shapes the engine genuinely produces rather than
 * against a hand-written object that could drift away from them.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { civilDate } from '@/core/civil/date';
import type { CalendarConfig, CivilDate } from '@/core/civil/types';
import { buildTodayView, collapseSupersededMisses } from '@/core/occurrence/agenda';
import { projectOccurrences } from '@/core/occurrence/project';
import type { ChoreInput, CompletionInput } from '@/core/occurrence/types';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ThemeProvider } from '@/design/theme';
import { DEFAULT_VIEW, useViewStore } from '@/stores/viewStore';
import { TOAST_MS } from '@/design/Toast';
import { TodayScreen } from './TodayScreen';

const ME = 'user-me';
const THEM = 'user-them';
const mockToday = civilDate('2026-07-30'); // a Thursday
const CAL: CalendarConfig = { weekStartsOn: 0 };

const d = (s: string): CivilDate => civilDate(s);

/*
 * Typed as engine input, but the screen is handed the fuller `Chore` — which
 * carries `notes`. One fixture has one, so the row that renders it is covered.
 */
type Fixture = ChoreInput & { notes?: string | null; priority?: string };

const ALL_CHORES: Fixture[] = [
  {
    id: 'dishes',
    title: 'Dishes',
    notes: 'Rinse the pans first',
    priority: 'normal',
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
    // The one crucial chore in the fixture, and Sam's — so priority grouping
    // has more than one section to make, and the top section holds work that
    // is not mine. A fixture where everything is `normal` would put every row
    // under one heading and prove nothing about the grouping.
    priority: 'crucial',
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
    priority: 'normal',
    schedule: {
      rule: { kind: 'weeklyFloating', everyNWeeks: 1, timesPerPeriod: 3 },
      startsOn: d('2026-07-26'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'fixed', memberId: ME },
    archived: false,
  },
  {
    // Genuinely overdue, and Sam's, so the Late section has something in it and
    // ordering can be asserted across both people. Without this the `late`
    // branch of the When arrangement was never rendered by any test.
    id: 'gutters',
    title: 'Clean the gutters',
    priority: 'normal',
    schedule: {
      rule: { kind: 'once', dueOn: d('2026-07-24'), granularity: 'day' },
      startsOn: d('2026-07-24'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'fixed', memberId: THEM },
    archived: false,
  },
  {
    // Sam's, and overdue by one day — less late than his gutters. Two overdue
    // rows with the *same* owner is what makes ordering assertable: with one
    // of each, the ownership split decides the order and any sort at all
    // passes.
    id: 'lightbulb',
    title: 'Replace the hall lightbulb',
    priority: 'normal',
    schedule: {
      rule: { kind: 'once', dueOn: d('2026-07-29'), granularity: 'day' },
      startsOn: d('2026-07-29'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'fixed', memberId: THEM },
    archived: false,
  },
  {
    // Not due for another week, but visible now because `showFrom` pulled it
    // forward. This is the shape that made Today unreadable and the reason
    // Coming up exists, and no fixture had one.
    id: 'filters',
    title: 'Change the filters',
    priority: 'normal',
    schedule: {
      // Two days out, kept inside the original window on purpose: widening it
      // starts a second floating period and gives "Water the plants" two rows,
      // which is a real behaviour and not this test's subject.
      rule: { kind: 'once', dueOn: d('2026-08-01'), granularity: 'day', showFrom: d('2026-07-28') },
      startsOn: d('2026-08-06'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'fixed', memberId: ME },
    archived: false,
  },
];

/**
 * What this render sees. Reset from `ALL_CHORES` before each test, so a test
 * that narrows the household to one chore — or retags them — cannot leak into
 * the next one.
 */
let mockChores: Fixture[] = ALL_CHORES.map((c) => ({ ...c }));

/** Real projection, so the screen sees exactly what the app would hand it. */
function buildView(completions: CompletionInput[] = []) {
  const projected = projectOccurrences(
    { chores: mockChores, completions, exceptions: [], memberIds: [ME, THEM], today: mockToday },
    CAL,
    { start: d('2026-07-19'), end: d('2026-08-01') },
  );
  return buildTodayView(collapseSupersededMisses(projected, mockToday), mockToday, ME);
}

/**
 * Actually completes things.
 *
 * A `jest.fn()` that swallows the call leaves the view unchanged, so the row
 * never becomes completed and every assertion about what happens *after* a tick
 * passes vacuously — which is exactly how the first version of the hold-in-place
 * test went green against a screen that did not hold anything in place.
 *
 * The re-render comes free: completing sets state on the screen, which calls
 * the mocked hook again and picks up the rebuilt view.
 */
let liveCompletions: CompletionInput[] = [];
const mockToggle = jest.fn(({ item, complete }: { item: AgendaItem; complete: boolean }) => {
  liveCompletions = complete
    ? [
        ...liveCompletions,
        {
          choreId: item.choreId,
          occurrenceKey: item.occurrenceKey,
          completedOn: mockToday,
          completedBy: ME,
        },
      ]
    : liveCompletions.filter((c) => c.occurrenceKey !== item.occurrenceKey);
  mockView = buildView(liveCompletions);
});
const mockRefetch = jest.fn(async () => {});
const mockSkip = jest.fn();
const mockReschedule = jest.fn();
const mockClear = jest.fn();
const mockPush = jest.fn();
let mockView = buildView();
let mockError: Error | null = null;
let mockLoading = false;

/*
 * The sheet reads a chore's steps. Mocked rather than standing up a
 * QueryClient: these tests are about the screen, and steps have their own
 * coverage in SubtaskList.
 */
let mockSteps: Map<string, { id: string; title: string }[]> = new Map();
let mockTicks: Map<string, Set<string>> = new Map();
const mockToggleSubtask = jest.fn();

jest.mock('@/data/hooks/useSubtasks', () => ({
  useSubtasksFor: () => [],
  useSubtaskTicks: () => new Set<string>(),
  useSubtasksByChore: () => mockSteps,
  useSubtaskTicksFor: () => mockTicks,
  useToggleSubtask: () => ({ mutate: mockToggleSubtask }),
}));

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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // Run the effect, ignore the cleanup. These tests render the screen once and
  // never navigate away, so focus never changes — but omitting it entirely
  // makes the screen throw on mount, which took a whole suite down.
  useFocusEffect: (effect: () => void | (() => void)) => {
    jest.requireActual('react').useEffect(effect, [effect]);
  },
}));

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

// Mutable, so a test can flag something. These suites mock the data layer
// rather than standing up a QueryClient.
let mockFlags: Set<string> = new Set();
const mockToggleFlag = jest.fn();
let mockFlagsByChore: Map<string, readonly string[]> = new Map();
jest.mock('@/data/hooks/useFlags', () => ({
  useMyFlags: () => mockFlags,
  useFlagsByChore: () => mockFlagsByChore,
  useToggleFlag: () => ({ mutate: mockToggleFlag }),
}));

jest.mock('@/data/hooks/useCategories', () => ({
  useCategoryList: () => mockCategories,
  useCategories: () => ({ data: mockCategories, isPending: false, isError: false }),
}));

/**
 * Opens a slim row's detail.
 *
 * Today's rows are one line by default now — name, category colour, lateness —
 * so chips, schedule text, notes and steps are behind the row's disclosure.
 * Tests that assert on any of those have to ask for it, exactly as a person
 * would.
 */
function expandRow(title: string) {
  fireEvent.press(screen.getByLabelText(`${title}. Show details.`));
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <TodayScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  /*
   * The arrangement is a real Zustand store, not a mock, and it lives at module
   * scope — so a test that presses "When" leaves every later test rendering in
   * When mode, where no priority heading exists at all. It went unnoticed
   * because nothing after it asked about one.
   */
  useViewStore.setState({ view: DEFAULT_VIEW });
  mockCategories = [];
  mockFlags = new Set();
  mockFlagsByChore = new Map();
  mockToggleFlag.mockClear();
  mockChores = ALL_CHORES.map((c) => ({ ...c }));
  mockToggle.mockClear();
  mockRefetch.mockClear();
  mockSkip.mockClear();
  mockReschedule.mockClear();
  mockClear.mockClear();
  mockPush.mockClear();
  liveCompletions = [];
  mockView = buildView();
  mockError = null;
  mockLoading = false;
});

describe('Today', () => {
  it('heads the screen with the date', async () => {
    await renderScreen();
    expect(screen.getByText('THURSDAY 30 JULY')).toBeOnTheScreen();
  });

  it('keeps what is yours apart from what is theirs, and arranges inside each', async () => {
    // Both, and in that order. A version of this screen merged the two lists
    // and leaned on the turn chip to tell them apart; another person's work
    // threaded through your own is noise however well it is labelled.
    await renderScreen();

    const headers = screen.getAllByRole('header').map((h) => String(h.props.children));
    expect(headers).toContain('Yours');
    expect(headers).toContain('Everyone else');
    expect(headers.indexOf('Yours')).toBeLessThan(headers.indexOf('Everyone else'));

    // And the arrangement is the inner cut, not the outer one.
    expect(screen.getByRole('header', { name: /^Crucial/ })).toBeOnTheScreen();
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

  it('puts what is due today above what is merely due this week', async () => {
    // Order is the whole point of this screen and nothing asserted it, so the
    // floating section once sat above the dated ones — leading with the
    // loosest commitment and pushing "what should I do now" below the fold.
    await renderScreen();
    const headers = screen.getAllByRole('header').map((h) => String(h.props.children));
    const dated = headers.findIndex((t) => t.startsWith('Crucial') || t.startsWith('Normal'));
    const week = headers.findIndex((t) => t === 'Sometime this week');

    expect(dated).toBeGreaterThanOrEqual(0);
    expect(week).toBeGreaterThanOrEqual(0);
    expect(dated).toBeLessThan(week);
  });

  it('completes an occurrence when its checkbox is pressed', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Mark Dishes done'));

    expect(mockToggle).toHaveBeenCalledTimes(1);
    // Asserted as one object rather than three reads off a possibly-absent
    // call. `toHaveBeenCalledTimes` above does not narrow the index for the
    // compiler, and `!` would have hidden a genuinely empty calls array.
    expect(mockToggle).toHaveBeenCalledWith(
      expect.objectContaining({
        complete: true,
        item: expect.objectContaining({ choreId: 'dishes', dueOn: mockToday }),
      }),
    );
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

describe('arranging Today', () => {
  it('carries the category on the row rather than in a heading', () => {
    // Categories were headings, nested under ownership. With priority as the
    // top-level cut a second axis of headings would multiply them, so the
    // category is a colour rail and a faint name on the row instead.
    mockCategories = [
      { id: 'c-kitchen', name: 'Kitchen', ink: 'teal', position: 0 },
      { id: 'c-outdoors', name: 'Outdoors', ink: null, position: 1 },
    ];
    for (const chore of mockChores as unknown as { categoryId: string | null }[]) {
      chore.categoryId = 'c-kitchen';
    }

    renderScreen();

    expect(screen.queryByRole('header', { name: 'Kitchen' })).toBeNull();
    expect(screen.getAllByText('Kitchen').length).toBeGreaterThan(0);
  });

  it('switches to Late and Due today when asked for When', () => {
    // The two arrangements must actually differ. Asserting only that the
    // control renders would pass with the switch wired to nothing.
    renderScreen();
    expect(screen.queryByRole('header', { name: /^Late/ })).toBeNull();

    fireEvent.press(screen.getByRole('tab', { name: 'When' }));

    expect(screen.queryByRole('header', { name: /^Crucial/ })).toBeNull();
    expect(screen.queryByRole('header', { name: /^Normal/ })).toBeNull();
    expect(screen.getByRole('header', { name: /^Late/ })).toBeOnTheScreen();
    // One per person, since the arrangement is nested inside the ownership
    // split rather than replacing it.
    expect(screen.getAllByRole('header', { name: /^Due today/ }).length).toBe(2);

    // And back, so the control is a switch rather than a one-way door.
    fireEvent.press(screen.getByRole('tab', { name: 'Priority' }));
    expect(screen.getByRole('header', { name: /^Crucial/ })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: /^Due today/ })).toBeNull();
  });

  it('orders by how late inside a section', () => {
    // Ownership decides which section a row is in; nothing else about the
    // order. Both of these are Sam's and both are late, so only the sort
    // separates them — and unsorted, they arrive in fixture order, which puts
    // the one-day-late row above the six-day-late one.
    renderScreen();
    fireEvent.press(screen.getByRole('tab', { name: 'When' }));

    const rows = screen
      .getAllByRole('button')
      .map((b) => String(b.props.accessibilityLabel))
      .filter((label) => /Open options\.$/.test(label));

    const gutters = rows.findIndex((label) => label.startsWith('Clean the gutters'));
    const bulb = rows.findIndex((label) => label.startsWith('Replace the hall lightbulb'));

    // Both must be on the screen, or the comparison below is between -1 and -1.
    expect(gutters).toBeGreaterThanOrEqual(0);
    expect(bulb).toBeGreaterThanOrEqual(0);
    expect(gutters).toBeLessThan(bulb);
  });

  it('gathers what is not yet due under its own heading, and folds on demand', () => {
    // A chore pulled forward by `showFrom` is `due`, so it used to sit among
    // work that is genuinely late. It is separated but not hidden: the section
    // starts open, and collapsing it is the choice rather than the default.
    renderScreen();

    const disclosure = screen.getByRole('button', { name: /^Coming up, 1 chore\./ });
    expect(disclosure).toBeOnTheScreen();
    expect(screen.getByText('Change the filters')).toBeOnTheScreen();

    fireEvent.press(disclosure);
    expect(screen.queryByText('Change the filters')).toBeNull();
  });

  it('offers no arrangement control when there is nothing yet to arrange', () => {
    // `outstandingCount` counts the coming-up items too, so a household whose
    // dated work is entirely ahead of it is not "nothing to do" — but with
    // every row folded away the screen was a title, a control that changed
    // nothing in either position, and one collapsed line.
    mockChores = [ALL_CHORES.find((c) => c.id === 'filters')!];
    mockView = buildView();
    renderScreen();

    expect(screen.queryByRole('tab', { name: 'Priority' })).toBeNull();
    // And the pile is the screen, so it opens rather than hiding everything.
    expect(screen.getByText('Change the filters')).toBeOnTheScreen();
  });

  it('never renders the ungrammatical "1 chores"', () => {
    // Guarded here because this file already carries the same guard for
    // "missed last 1 times", and the disclosure got it wrong anyway.
    renderScreen();
    expect(screen.queryByLabelText(/Coming up, 1 chores/)).toBeNull();
  });

  it('shows one line per chore until the row is asked for more', () => {
    // The complaint that prompted this: "they don't seem meaningfully
    // smaller". A slim row is the name, the category colour and how late it
    // is; everything else is one tap away.
    renderScreen();

    // Present: the name, and the lateness shortened to a number.
    expect(screen.getByText('Clean the gutters')).toBeOnTheScreen();
    expect(screen.getByText('6d')).toBeOnTheScreen();

    // Folded: the schedule text, the turn chip and the full lateness chip.
    expect(screen.queryByText('6 days late')).toBeNull();
    expect(screen.queryByText("Sam's turn")).toBeNull();

    expandRow('Clean the gutters');
    expect(screen.getByText('6 days late')).toBeOnTheScreen();
    expect(screen.getByText("Sam's turn")).toBeOnTheScreen();
  });

  it('lets a long title shrink its own column instead of shoving the row apart', () => {
    /*
     * The bug this guards is invisible to this suite, so it is asserted at its
     * cause. "Find cardiologist and schedule" rendered as one long line and
     * pushed the category, the lateness and the chevron past the right edge of
     * the cell, where `overflow: hidden` hid them while they stayed tappable —
     * a chevron you could press but not see.
     *
     * Yoga will not shrink a box below its min-content width (for text, the
     * longest word) unless `minWidth: 0` says it may; `flex: 1` does not lift
     * that floor. Layout is not measured here, so the flag itself is the only
     * observable thing, and it is exactly what was missing.
     */
    renderScreen();

    const columns = screen.getAllByTestId('title-column');
    expect(columns.length).toBeGreaterThan(0);

    for (const column of columns) {
      const style = StyleSheet.flatten(column.props.style) as { minWidth?: number };
      expect(style.minWidth).toBe(0);
    }
  });

  it('never truncates a long category name', () => {
    // "Entertainment" was rendering as "Entertain…" against a 32% cap that
    // existed to protect the title. The title wraps now, so the cap bought
    // nothing and cost the one word that identifies the category.
    mockCategories = [{ id: 'c-long', name: 'Entertainment', ink: 'plum', position: 0 }];
    const chores = mockChores as unknown as { categoryId: string | null }[];
    for (const chore of chores) chore.categoryId = 'c-long';

    renderScreen();

    /*
     * Asserted on the style, not on the text.
     *
     * Truncation is a layout outcome and jest-expo does no layout: the text
     * node holds "Entertainment" whether or not it fits, so `getByText` finds
     * it either way and passes with the bug present. Checked that it does —
     * putting the cap back leaves a text assertion green. The width cap and
     * `numberOfLines` are the two things that can clip it, so those are what
     * this guards.
     */
    const label = screen.getAllByText('Entertainment')[0];
    const style = StyleSheet.flatten(label?.props.style) as { maxWidth?: unknown };

    expect(style.maxWidth).toBeUndefined();
    expect(label?.props.numberOfLines).toBeUndefined();
  });

  it('shows the category rail only where the category has an ink', () => {
    // Deleting the rail outright left every test green. The rail is the whole
    // of Emily's "option B", so something has to hold it in place.
    mockCategories = [
      { id: 'c-kitchen', name: 'Kitchen', ink: 'teal', position: 0 },
      { id: 'c-plain', name: 'Plain', ink: null, position: 1 },
    ];
    const chores = mockChores as unknown as { id: string; categoryId: string | null }[];
    for (const chore of chores) chore.categoryId = chore.id === 'dishes' ? 'c-plain' : 'c-kitchen';

    renderScreen();

    // One per inked row, and none for the row whose category has no ink — its
    // name still renders, which is the point of carrying both.
    // `includeHiddenElements` because the rail is deliberately hidden from
    // accessibility — it is decoration, and its meaning is in the name beside
    // it. That is also why the name is asserted here and not only the rail.
    const rails = screen.getAllByTestId('category-rail', { includeHiddenElements: true });
    expect(rails.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kitchen').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Plain').length).toBeGreaterThan(0);
  });
});

describe('ticking something off', () => {
  /*
   * The complaint this exists for, verbatim: "i accidentally checked something
   * off and it disappeared 😭". Completing moved the row out of its section and
   * down into Done, which on a fifty-row screen reads as the item being gone.
   */
  const tick = (title: string) => fireEvent.press(screen.getByLabelText(`Mark ${title} done`));

  it('leaves the row where it was instead of moving it to Done', () => {
    renderScreen();
    const before = screen
      .getAllByRole('header')
      .map((h) => String(h.props.children))
      .indexOf('Yours');

    tick('Dishes');

    // Still in Yours, not relocated to the bottom of the screen. The row is
    // found by its *completed* label, so this cannot pass by the tick simply
    // not registering.
    expect(screen.getByLabelText('Mark Dishes not done')).toBeOnTheScreen();
    const headers = screen.getAllByRole('header').map((h) => String(h.props.children));
    expect(headers.indexOf('Yours')).toBe(before);
  });

  it('keeps a ticked Coming-up row on the screen', () => {
    /*
     * The regression a review caught, and the sharpest possible version of the
     * bug this whole branch exists to fix.
     *
     * `held` pinned the row, but nothing rendered it: the arrangement only
     * builds blocks from late + due-today, `comingUp` was derived from the
     * lists the completion had just emptied, and Done excluded it because it
     * was pinned. So ticking something not-yet-due made it vanish outright —
     * worse than the behaviour on main, where it at least reappeared under
     * Done. On this household roughly two thirds of the list is showFrom rows.
     */
    renderScreen();
    // Coming up is open by default, so no disclosure press — pressing it here
    // collapsed the section and hid the very row under test.
    tick('Change the filters');

    expect(screen.getByLabelText('Mark Change the filters not done')).toBeOnTheScreen();
  });

  it('offers an undo, and undoing un-completes it', () => {
    renderScreen();
    tick('Dishes');

    expect(screen.getByText('Dishes — done')).toBeOnTheScreen();
    mockToggle.mockClear();

    fireEvent.press(screen.getByRole('button', { name: 'Undo' }));

    // The second call is the reversal, not a repeat of the first.
    expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ complete: false }));
  });

  it('does not offer an undo for un-completing', () => {
    // Un-ticking is already the undo. A toast offering to undo an undo is a
    // loop, and it would sit on screen over the row you just fixed.
    renderScreen();
    tick('Dishes');
    fireEvent.press(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('clears the toast on its own', () => {
    jest.useFakeTimers();
    try {
      renderScreen();
      tick('Dishes');
      expect(screen.getByText('Dishes — done')).toBeOnTheScreen();

      act(() => {
        jest.advanceTimersByTime(TOAST_MS + 100);
      });

      expect(screen.queryByText('Dishes — done')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('seeing what the other person did', () => {
  /*
   * "and ur not checking it off? or i cant see if you do?" — the app had
   * `completedBy` on every occurrence and rendered it nowhere. A done row
   * dropped its schedule label and put nothing in its place.
   */
  const samDid = (choreId: string, key: string): CompletionInput => ({
    choreId,
    occurrenceKey: key,
    completedOn: mockToday,
    completedBy: THEM,
  });

  it('says who did what, on the row', () => {
    const trash = buildView().theirs.find((i) => i.choreId === 'trash');
    mockView = buildView([samDid('trash', trash?.occurrenceKey ?? '')]);
    renderScreen();

    expect(screen.getByLabelText('Mark Take out the trash not done')).toBeOnTheScreen();
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0);
  });

  it('sums it up under the date', () => {
    const view = buildView();
    const two = [...view.theirs, ...view.mine].slice(0, 2);
    mockView = buildView(two.map((i) => samDid(i.choreId, i.occurrenceKey)));
    renderScreen();

    expect(screen.getByText('Sam did 2 today')).toBeOnTheScreen();
  });

  it('does not narrate your own work back to you', () => {
    // A tally of what you just did is the progress you watched happen, and
    // reads as the app talking about itself.
    const mine = buildView().mine[0];
    mockView = buildView([
      {
        choreId: mine?.choreId ?? '',
        occurrenceKey: mine?.occurrenceKey ?? '',
        completedOn: mockToday,
        completedBy: ME,
      },
    ]);
    renderScreen();

    expect(screen.queryByText(/did \d+ today/)).toBeNull();
  });
});

describe('flagging something for this week', () => {
  /*
   * Emily writes ‼️ in her notes, sometimes four of them. That is not a scale
   * being picked from — it is shouting louder, about this week. `priority` is
   * permanent, shared and three-valued, and 28 of 99 chores are `crucial`,
   * which is what happens when you use it to say something temporary.
   */
  const rowOrder = () =>
    screen
      .getAllByRole('button')
      .map((b) => String(b.props.accessibilityLabel))
      .filter((l) => /Open options\.$/.test(l));

  it('lifts a flagged chore above one that would otherwise outrank it', () => {
    /*
     * Asserted as a *reversal* of a known order, not as "index 0".
     *
     * The first version flagged Dishes and checked it came first — which it
     * already did, so the assertion held with the pinning deleted. Confirmed
     * by deleting it.
     *
     * "orders by how late inside a section" above pins the natural order:
     * the gutters are six days late and the lightbulb one, so the gutters come
     * first. Flagging the lightbulb has to overturn that or it does nothing.
     */
    mockFlags = new Set(['lightbulb']);
    mockFlagsByChore = new Map([['lightbulb', [ME]]]);
    renderScreen();

    const rows = rowOrder();
    const gutters = rows.findIndex((l) => l.startsWith('Clean the gutters'));
    const bulb = rows.findIndex((l) => l.startsWith('Replace the hall lightbulb'));

    expect(bulb).toBeGreaterThanOrEqual(0);
    expect(gutters).toBeGreaterThanOrEqual(0);
    expect(bulb).toBeLessThan(gutters);
  });

  it('keeps it in its own section rather than making a new one', () => {
    /*
     * A flag says "this one first", not "this one belongs elsewhere". Lifting
     * it out of Crucial would lose that it is crucial, which is usually why it
     * got flagged.
     *
     * A review pointed out this passes with `flaggedFirst` deleted, and it
     * does. That is inherent: deleting the feature also produces no new
     * section, so no fixture can make this fail for the right reason. It is a
     * negative control against a *future* change that decides flagged things
     * deserve their own pile — the discriminating half of the pair is
     * "lifts a flagged chore above one that would otherwise outrank it" above,
     * which does fail when the feature is removed.
     *
     * Saying so rather than dressing it up: an assertion that cannot fail is
     * worth keeping only if you know that about it.
     */
    mockFlags = new Set(['trash']);
    mockFlagsByChore = new Map([['trash', [ME]]]);
    renderScreen();

    const headers = screen.getAllByRole('header').map((h) => String(h.props.children));
    expect(headers.some((t) => t.startsWith('Crucial'))).toBe(true);
    expect(headers.some((t) => /[Ff]lagged/.test(t))).toBe(false);

    // The flagged row is still inside the ownership split rather than hoisted
    // above it: its Crucial heading comes after "Everyone else", not before.
    expect(headers.indexOf('Everyone else')).toBeLessThan(
      headers.findIndex((t) => t.startsWith('Crucial')),
    );
    expect(screen.getAllByRole('button', { name: /Take out the trash/ }).length).toBeGreaterThan(0);
  });

  it('marks the row in words, not only with a glyph', () => {
    // Set on the *shared* map: the row shows a flag raised by either person,
    // which is what the sheet's copy promises and what RLS was built for.
    mockFlagsByChore = new Map([['dishes', [THEM]]]);
    renderScreen();
    expect(screen.getByLabelText(/Dishes.*Flagged for this week/)).toBeOnTheScreen();
  });

  it('says nothing about a chore that is not flagged', () => {
    renderScreen();
    expect(screen.queryByLabelText(/Flagged for this week/)).toBeNull();
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

describe('a chore that keeps getting missed', () => {
  /*
   * The count has always been on the row and was thrown away in the render:
   * "missed last time" whether one occurrence had been missed or nine. Asserted
   * here rather than only on the helper, because the helper being right proves
   * nothing about what the row passes it — which is how a correct pure function
   * has twice shipped inert in this app.
   */
  it('says how many, not just that it happened', async () => {
    await renderScreen();
    expandRow('Dishes');
    expect(screen.getByText(/missed last \d+ times/)).toBeOnTheScreen();
  });

  it('never renders the ungrammatical "last 1 times"', async () => {
    // Guards the plural at the point it is read, not just in the helper.
    await renderScreen();
    expandRow('Dishes');
    expect(screen.queryByText(/missed last 1 times/)).toBeNull();
  });
});

describe('a chore with a note', () => {
  it('shows it on the row, not only in the editor', async () => {
    // The complaint: details written into a note were invisible everywhere a
    // chore is actually read. Still true, but one tap in rather than zero —
    // slim rows fold it away, and the editor is still two screens away.
    await renderScreen();
    expandRow('Dishes');
    expect(screen.getByText('Rinse the pans first')).toBeOnTheScreen();
  });
});

describe('the steps inside a chore', () => {
  /*
   * On the row, not behind a tap. Steps are ticked while the chore is being
   * done, so a list you had to open the occurrence sheet to reach was a list
   * nobody would use — the same objection that got notes onto the row.
   */
  beforeEach(() => {
    mockSteps = new Map();
    mockTicks = new Map();
    mockToggleSubtask.mockClear();
  });

  const withSteps = () => {
    mockSteps = new Map([
      [
        'dishes',
        [
          { id: 's1', title: 'Rinse' },
          { id: 's2', title: 'Load the machine' },
        ],
      ],
    ]);
  };

  it('draws them under the chore, without opening anything', async () => {
    withSteps();
    await renderScreen();
    expandRow('Dishes');

    expect(screen.getByText('Rinse')).toBeOnTheScreen();
    expect(screen.getByText('Load the machine')).toBeOnTheScreen();
  });

  it('counts the ones ticked for this occurrence', async () => {
    withSteps();
    const key = mockView.mine.find((i) => i.choreId === 'dishes')?.occurrenceKey as string;
    mockTicks = new Map([[key, new Set(['s1'])]]);
    await renderScreen();
    expandRow('Dishes');

    expect(screen.getByText(/1 of 2 steps/)).toBeOnTheScreen();
  });

  it('ticks one against the occurrence it belongs to', async () => {
    withSteps();
    const key = mockView.mine.find((i) => i.choreId === 'dishes')?.occurrenceKey as string;
    await renderScreen();
    expandRow('Dishes');
    await fireEvent.press(screen.getByLabelText('Mark Rinse done'));

    expect(mockToggleSubtask).toHaveBeenCalledWith({
      subtaskId: 's1',
      ticked: true,
      occurrenceKey: key,
    });
  });

  it('offers a disclosure big enough to hit', async () => {
    // The first version was a chevron inside the count line at sixteen points
    // in faint text; it read as decoration and was hard to press.
    //
    // Asserted on the *target* rather than the box. On a slim row the box is
    // 20pt — a laid-out 44 square was setting the height of every row and
    // taking that width from the title — so the 44 comes from `hitSlop`, and
    // measuring the box would now fail a row that is perfectly tappable.
    withSteps();
    await renderScreen();

    const disclosure = screen.getByLabelText('Dishes. Show details.');
    const { width, height } = disclosure.props.style as { width: number; height: number };
    const slop = disclosure.props.hitSlop as {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };

    expect(width + slop.left + slop.right).toBeGreaterThanOrEqual(44);
    expect(height + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  });

  it('collapses and expands', async () => {
    withSteps();
    await renderScreen();

    // Closed to begin with, which is the change: a slim row is one line until
    // asked otherwise.
    expect(screen.queryByText('Rinse')).toBeNull();
    expandRow('Dishes');
    expect(screen.getByText('Rinse')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Dishes. Hide details.'));
    expect(screen.queryByText('Rinse')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Dishes. Show details.'));
    expect(screen.getByText('Rinse')).toBeOnTheScreen();
  });

  it('says nothing at all for a chore without steps', async () => {
    // Most chores have none; the row must not grow a header for them.
    await renderScreen();
    expect(screen.queryByText(/steps/)).toBeNull();
  });
});
