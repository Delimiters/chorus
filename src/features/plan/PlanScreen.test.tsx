/**
 * The plan screen's three states, and the transitions between them.
 *
 * Mocked at the hook boundary like the Today suite, but the *view* is built by
 * the real engine — `planFor` and `progressOf` — so these test the screen
 * against shapes the engine genuinely produces.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { AgendaItem } from '@/core/occurrence/agenda';
import type { PlanEntry } from '@/core/plan/plan';
import { ThemeProvider } from '@/design/theme';
import { PlanScreen } from './PlanScreen';

const ME = 'user-me';
const THEM = 'user-them';
const TODAY = civilDate('2026-08-27');
const YESTERDAY = civilDate('2026-08-26');

let mockEntries: PlanEntry[] = [];
let mockTheirCount = 0;
let mockTheirTotal = 0;
const mockRemove = jest.fn();
const mockToggle = jest.fn();
const mockSetMode = jest.fn();
const mockPush = jest.fn();

jest.mock('@/data/hooks/usePlan', () => ({
  useMyPlanEntries: () => mockEntries,
  useTheirPlanCount: () => mockTheirCount,
  useTheirPlanTotal: () => mockTheirTotal,
  useRemoveFromPlan: () => ({ mutate: mockRemove }),
}));

jest.mock('@/data/hooks/useOccurrences', () => ({
  useToggleCompletion: () => ({ mutate: mockToggle }),
}));

jest.mock('@/data/hooks/useCategories', () => ({ useCategoryList: () => [] }));

jest.mock('@/data/hooks/useHousehold', () => ({
  useMembers: () => ({
    data: [
      { userId: ME, displayName: 'Jake', accent: 'blue' },
      { userId: THEM, displayName: 'Sam', accent: 'pink' },
    ],
  }),
}));

const mockTapped = jest.fn();
const mockFinished = jest.fn();
const mockCelebrated = jest.fn();
jest.mock('@/design/haptics', () => ({
  tapped: () => mockTapped(),
  finished: () => mockFinished(),
  celebrated: () => mockCelebrated(),
}));

jest.mock('@/stores/sessionStore', () => ({ useUserId: () => ME }));
jest.mock('@/stores/routineStore', () => ({
  useRoutineStore: (selector: (s: unknown) => unknown) => selector({ setTodayMode: mockSetMode }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const item = (id: string, title: string, status = 'due'): AgendaItem =>
  ({
    occurrenceKey: `v1:${id}`,
    choreId: id,
    choreTitle: title,
    dueOn: TODAY,
    status,
    daysOverdue: 0,
    missedBefore: 0,
    completedBy: null,
    assignee: { kind: 'anyone' },
  }) as unknown as AgendaItem;

const entry = (id: string, position: number): PlanEntry => ({
  occurrenceKey: `v1:${id}`,
  choreId: id,
  plannedFor: TODAY,
  position,
});

const chore = (id: string, title: string) => ({
  id,
  title,
  categoryId: null,
  priority: 'normal',
  notes: null,
  icon: null,
});

const onAdd = jest.fn();

function renderScreen(available: AgendaItem[]) {
  return render(
    <ThemeProvider>
      <PlanScreen
        available={available}
        chores={available.map((i) => chore(i.choreId, i.choreTitle))}
        today={TODAY}
        refetch={async () => {}}
        onAdd={onAdd}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockEntries = [];
  mockTheirCount = 0;
  mockTheirTotal = 0;
  mockTapped.mockClear();
  mockFinished.mockClear();
  mockCelebrated.mockClear();
  mockRemove.mockClear();
  mockToggle.mockClear();
  onAdd.mockClear();
  mockPush.mockClear();
});

describe('an empty plan', () => {
  it('asks rather than listing', () => {
    // The normal state every morning, not an error — so it must not look like
    // one, and must not pre-empt the choice with a wall of suggestions.
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByText('Nothing planned yet.')).toBeOnTheScreen();
    expect(screen.queryByText('Dishes')).toBeNull();
  });

  it('does not congratulate you for planning nothing', () => {
    /*
     * An empty plan is the input that makes "everything is done" vacuously
     * true. Saying "That's today" to somebody who has chosen nothing would
     * make the moment worthless on the days it is earned.
     */
    renderScreen([]);
    expect(screen.queryByText("That's today.")).toBeNull();
  });

  it('opens the picker', () => {
    renderScreen([item('dishes', 'Dishes')]);
    fireEvent.press(screen.getByRole('button', { name: 'Choose what to do today' }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('a plan in progress', () => {
  it('shows only what was planned, in its own order', () => {
    /*
     * Positions contradict both the order `available` arrives in *and* the
     * alphabet.
     *
     * The first version claimed to do that and did not: entries were
     * trash@20 / dishes@10 with `available` as [dishes, trash], so the expected
     * order matched the input order and the key order alike. Neutering the
     * position comparator left all eleven screen tests green. The exact trap the
     * engine's own test documents having fallen into, reintroduced two files
     * later in the same PR.
     *
     * Here Trash sorts first by position while arriving second and sorting
     * later alphabetically, so only position ordering produces this answer.
     */
    mockEntries = [entry('trash', 10), entry('dishes', 20)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash'), item('other', 'Not planned')]);

    const rows = screen
      .getAllByRole('button')
      .map((b) => String(b.props.accessibilityLabel))
      .filter((l) => /Open options\.$/.test(l));

    expect(rows[0]).toMatch(/^Trash/);
    expect(rows[1]).toMatch(/^Dishes/);
    expect(screen.queryByText('Not planned')).toBeNull();
  });

  it('counts how the day is going', () => {
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes', 'completed'), item('trash', 'Trash')]);

    expect(screen.getByText(/1 OF 2/)).toBeOnTheScreen();
  });

  it('says what the other person has taken on', () => {
    mockTheirCount = 3;
    mockTheirTotal = 3;
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByText('Sam has 3 planned')).toBeOnTheScreen();
  });

  it('says nothing when they have finished', () => {
    // The count used to tally raw rows, so it kept saying "Sam has 3 planned"
    // after Sam had done all three — a number meaning something different from
    // the identical-looking one directly above it.
    mockTheirCount = 0;
    mockTheirTotal = 0;
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.queryByText(/has \d+ planned/)).toBeNull();
  });

  it('takes something off the day without completing or skipping it', () => {
    // "Not today" is its own answer. Removing must not look like finishing.
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Take off today/ }));

    expect(mockRemove).toHaveBeenCalledWith('v1:dishes');
    expect(mockToggle).not.toHaveBeenCalled();
  });
});

describe('a finished plan', () => {
  it('says so, which a backlog never can', () => {
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes', 'completed'), item('trash', 'Trash', 'completed')]);

    expect(screen.getByText("That's today.")).toBeOnTheScreen();
    expect(screen.getByText(/All 2, done/)).toBeOnTheScreen();
  });

  it('counts a skip as dealt with', () => {
    // Skipping is a decision, not a failure; it should not hold the day open.
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes', 'completed'), item('trash', 'Trash', 'skipped')]);

    expect(screen.getByText("That's today.")).toBeOnTheScreen();
  });

  it('keeps the rows reachable so a mis-tap can be undone', () => {
    /*
     * The celebration used to replace the list, so ticking the last item by
     * accident left no checkbox, no row and no sheet — the only way back was
     * switching modes. The disappearing-row complaint again, at the exact
     * moment the screen is congratulating you.
     */
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes', 'completed')]);

    expect(screen.getByText("That's today.")).toBeOnTheScreen();
    expect(screen.getByLabelText('Mark Dishes not done')).toBeOnTheScreen();
  });

  it('counts what is done rather than what is left', () => {
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes', 'completed'), item('trash', 'Trash', 'completed')]);

    expect(screen.getByRole('header', { name: /Done today/ })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: /Doing today/ })).toBeNull();
  });

  it('still lets you add more', () => {
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes', 'completed')]);

    fireEvent.press(screen.getByRole('button', { name: 'Add something anyway' }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("yesterday's plan", () => {
  it('is not part of today, however it is stored', () => {
    /*
     * "It never inherits" is the rule the whole design rests on, and no
     * screen-level test asserted it — every fixture used today's date, so
     * removing the day filter left the app suite green.
     */
    mockEntries = [
      entry('dishes', 1),
      { occurrenceKey: 'v1:trash', choreId: 'trash', plannedFor: YESTERDAY, position: 2 },
    ];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    expect(screen.queryByText('Trash')).toBeNull();
    expect(screen.getByText(/0 OF 1/)).toBeOnTheScreen();
  });
});

describe('the finish moment', () => {
  it('buzzes quietly for an ordinary finished day', () => {
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes', 'completed')]);

    expect(mockFinished).toHaveBeenCalledTimes(1);
    expect(mockCelebrated).not.toHaveBeenCalled();
  });

  it('fires once, not on every render', () => {
    /*
     * The bug this is really for. Keyed on the boolean rather than the
     * transition, any re-render while the day is already done would buzz the
     * phone again — and a plan screen re-renders on every realtime message.
     */
    mockEntries = [entry('dishes', 1)];
    const view = renderScreen([item('dishes', 'Dishes', 'completed')]);
    view.rerender(
      <ThemeProvider>
        <PlanScreen
          available={[item('dishes', 'Dishes', 'completed')]}
          chores={[chore('dishes', 'Dishes')]}
          today={TODAY}
          refetch={async () => {}}
          onAdd={onAdd}
        />
      </ThemeProvider>,
    );

    expect(mockFinished).toHaveBeenCalledTimes(1);
  });

  it('says nothing at all for a day nobody planned', () => {
    renderScreen([]);
    expect(mockFinished).not.toHaveBeenCalled();
    expect(mockCelebrated).not.toHaveBeenCalled();
  });

  it('goes loud when you both finished, and says so', () => {
    // The one trigger a solo to-do list cannot offer.
    mockTheirTotal = 2;
    mockTheirCount = 0;
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes', 'completed')]);

    expect(mockCelebrated).toHaveBeenCalledTimes(1);
    expect(mockFinished).not.toHaveBeenCalled();
    expect(screen.getByText('You both finished.')).toBeOnTheScreen();
    expect(screen.getByText('3 things between you.')).toBeOnTheScreen();
  });

  it('names the badly late thing rather than praising in general', () => {
    mockEntries = [entry('car', 1)];
    renderScreen([
      { ...item('car', 'Get car inspected', 'completed'), daysOverdue: 20 } as AgendaItem,
    ]);

    expect(screen.getByText('Including Get car inspected — 20 days late.')).toBeOnTheScreen();
  });

  it('ticks lightly on an ordinary completion', () => {
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    fireEvent.press(screen.getByLabelText('Mark Dishes done'));
    expect(mockTapped).toHaveBeenCalledTimes(1);
  });
});

describe('a planned occurrence that no longer exists', () => {
  it('is dropped rather than rendered as a row that does nothing', () => {
    // The chore was archived, or its schedule changed and the key moved. A
    // planned row with nothing behind it cannot be ticked.
    mockEntries = [entry('dishes', 1), entry('ghost', 2)];
    renderScreen([item('dishes', 'Dishes')]);

    // One row planned, one row rendered — the ghost is not counted in the
    // denominator either, which is what would make the day unfinishable.
    expect(screen.getByText(/0 OF 1/)).toBeOnTheScreen();
    expect(screen.getByText('Dishes')).toBeOnTheScreen();
  });
});
