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
    // Mine, and overdue by one day — less late than Sam's gutters. Without a
    // second overdue row the Late section holds exactly one item and any
    // ordering at all puts it first, which is how the first version of the
    // ordering test passed against unsorted concatenation.
    id: 'lightbulb',
    title: 'Replace the hall lightbulb',
    priority: 'normal',
    schedule: {
      rule: { kind: 'once', dueOn: d('2026-07-29'), granularity: 'day' },
      startsOn: d('2026-07-29'),
      endsOn: null,
      timesOfDay: [],
    },
    assignment: { kind: 'fixed', memberId: ME },
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

const mockToggle = jest.fn();
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
  mockChores = ALL_CHORES.map((c) => ({ ...c }));
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

  it('arranges outstanding work by priority, both people in one list', async () => {
    // Ownership used to be the top-level split — Yours, then Everyone else —
    // which answered "whose is it" before "does it matter", and put a crucial
    // chore of Sam's below every minor one of mine. Whose turn it is is now on
    // the row, where it costs no heading.
    await renderScreen();
    expect(screen.getByRole('header', { name: /^Crucial/ })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Yours' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Everyone else' })).toBeNull();

    // Sam's crucial chore and my normal one are both on the screen, under the
    // heading each belongs to rather than under whose it is.
    expect(
      screen.getByRole('button', { name: /Take out the trash, Sam's turn/ }),
    ).toBeOnTheScreen();
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
    expect(screen.getByRole('header', { name: /^Due today/ })).toBeOnTheScreen();

    // And back, so the control is a switch rather than a one-way door.
    fireEvent.press(screen.getByRole('tab', { name: 'Priority' }));
    expect(screen.getByRole('header', { name: /^Crucial/ })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: /^Due today/ })).toBeNull();
  });

  it('orders by how late, not by whose it is', () => {
    // `view.mine` and `view.theirs` are separate lists, so concatenating them
    // leaves ownership as the primary sort — invisibly, under a heading that
    // says "Late". The gutters are Sam's and six days late; nothing of mine is
    // later than that, so mine-first ordering puts the wrong row on top.
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

  it('folds what is not yet due into one collapsed line', () => {
    // The section the redesign exists for, and the one nothing rendered: a
    // chore pulled forward by `showFrom` is `due`, so it used to sit among
    // work that is genuinely late.
    renderScreen();

    expect(screen.queryByText('Change the filters')).toBeNull();
    const disclosure = screen.getByRole('button', { name: /^Coming up, 1 chore\./ });
    expect(disclosure).toBeOnTheScreen();

    fireEvent.press(disclosure);
    expect(screen.getByText('Change the filters')).toBeOnTheScreen();
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
    expect(screen.getByText(/missed last \d+ times/)).toBeOnTheScreen();
  });

  it('never renders the ungrammatical "last 1 times"', async () => {
    // Guards the plural at the point it is read, not just in the helper.
    await renderScreen();
    expect(screen.queryByText(/missed last 1 times/)).toBeNull();
  });
});

describe('a chore with a note', () => {
  it('shows it on the row, not only in the editor', async () => {
    // The complaint: details written into a note were invisible everywhere a
    // chore is actually read.
    await renderScreen();
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

  it('draws them under the chore, expanded, without opening anything', async () => {
    withSteps();
    await renderScreen();

    expect(screen.getByText('Rinse')).toBeOnTheScreen();
    expect(screen.getByText('Load the machine')).toBeOnTheScreen();
  });

  it('counts the ones ticked for this occurrence', async () => {
    withSteps();
    const key = mockView.mine.find((i) => i.choreId === 'dishes')?.occurrenceKey as string;
    mockTicks = new Map([[key, new Set(['s1'])]]);
    await renderScreen();

    expect(screen.getByText(/1 of 2 steps/)).toBeOnTheScreen();
  });

  it('ticks one against the occurrence it belongs to', async () => {
    withSteps();
    const key = mockView.mine.find((i) => i.choreId === 'dishes')?.occurrenceKey as string;
    await renderScreen();
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
    withSteps();
    await renderScreen();

    const disclosure = screen.getByLabelText(/steps done\. Hide them\./);
    expect(disclosure.props.style).toEqual(expect.objectContaining({ width: 44, height: 44 }));
  });

  it('collapses and expands', async () => {
    withSteps();
    await renderScreen();

    await fireEvent.press(screen.getByLabelText(/steps done\. Hide them\./));
    expect(screen.queryByText('Rinse')).toBeNull();

    await fireEvent.press(screen.getByLabelText(/steps done\. Show them\./));
    expect(screen.getByText('Rinse')).toBeOnTheScreen();
  });

  it('says nothing at all for a chore without steps', async () => {
    // Most chores have none; the row must not grow a header for them.
    await renderScreen();
    expect(screen.queryByText(/steps/)).toBeNull();
  });
});
