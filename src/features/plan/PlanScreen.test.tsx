/**
 * The plan screen's three states, and the transitions between them.
 *
 * Mocked at the hook boundary like the Today suite, but the *view* is built by
 * the real engine — `planFor` and `progressOf` — so these test the screen
 * against shapes the engine genuinely produces.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';

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
let mockPlanUnknown = false;
/*
 * Everything recurs unless a test says otherwise, which keeps the existing
 * fixtures in one group and their assertions about ordering intact.
 */
let mockRecurring: ReadonlySet<string> = new Set();
let mockSubtasks = new Map<string, { id: string; title: string }[]>();
const mockToggleSubtask = jest.fn();
let mockTheirEntries: { occurrenceKey: string; position: number; plannedFor: string }[] = [];
const mockRemove = jest.fn();
const mockReorder = jest.fn();
const mockToggle = jest.fn();
const mockSetMode = jest.fn();
const mockPush = jest.fn();

jest.mock('@/data/hooks/usePlan', () => ({
  useMyPlanEntries: () => mockEntries,
  useTheirPlanCount: () => mockTheirCount,
  useTheirPlanTotal: () => mockTheirTotal,
  useTheirPlanEntries: () => mockTheirEntries,
  usePlanUnavailable: () => mockPlanUnknown,
  useRemoveFromPlan: () => ({ mutate: mockRemove }),
  useReorderPlan: () => ({ mutate: mockReorder }),
}));

jest.mock('@/data/hooks/useOccurrences', () => ({
  useToggleCompletion: () => ({ mutate: mockToggle }),
}));

/**
 * Two sets, not one derived from the other.
 *
 * A row *shows* the household's flags and the sheet *toggles* yours, and the
 * two genuinely differ whenever your housemate flags something you have not —
 * which is the case the feature is designed around. Deriving one from the
 * other made every test agree by construction, so the test named "shows a flag
 * somebody else set" would have passed against code reading the wrong set.
 */
let mockMyFlags: Set<string> = new Set();
/** Flagged by the housemate. The two overlap freely; that is the point. */
let mockTheirFlags: Set<string> = new Set();
const mockToggleFlag = jest.fn();

jest.mock('@/data/hooks/useFlags', () => ({
  /*
   * choreId -> the users who flagged it, derived from who flagged rather than
   * kept as a third set.
   *
   * The version before this had a separate `mockAnyFlags`, which let a test
   * say "flagged, by nobody" — an entry with an empty array. `liveFlagsByChore`
   * cannot produce that, and two tests were relying on it: filtering out empty
   * arrays in the screen, which is behaviourally identical in production,
   * turned them red. Building the map from the union makes the impossible
   * state unrepresentable.
   *
   * `ME` and `THEM` are referenced directly. A `jest.mock` factory may not
   * close over arbitrary variables, but babel-plugin-jest-hoist lifts `const`
   * declarators with pure initialisers alongside it — which this file already
   * depends on for `useUserId: () => ME`. Duplicating the ids as literals was
   * how they came to disagree with the screen's in the first place.
   */
  useFlagsByChore: () => {
    const map = new Map<string, string[]>();
    for (const id of mockMyFlags) map.set(id, [ME]);
    for (const id of mockTheirFlags) map.set(id, [...(map.get(id) ?? []), THEM]);
    return map;
  },
  useMyFlags: () => mockMyFlags,
  useToggleFlag: () => ({ mutate: mockToggleFlag }),
}));

jest.mock('@/data/hooks/useCategories', () => ({ useCategoryList: () => [] }));

let mockMyGroupOrder: 'chores' | 'oneOff' = 'chores';
/**
 * Which of the two comes back first from `useMembers`.
 *
 * With two members and an index-based mis-read, whichever person you put first
 * is the one you stop protecting: pinning the housemate at index 0 catches
 * `data[0]` standing in for *you*, and stops catching it standing in for
 * *them*. Under the previous fixture six tests caught the first and none the
 * second; flipping it simply reversed that. So the order is a variable, and
 * the ordering tests run both ways.
 */
let mockHousemateFirst = true;
const mockSetGroupOrder = jest.fn();
let mockGroupOrderError: Error | null = null;

jest.mock('@/data/hooks/useHousehold', () => ({
  useMembers: () => ({
    // The housemate is permanently set to the opposite preference, so reading
    // the wrong row orders the day backwards rather than passing by luck.
    data: mockHousemateFirst
      ? [
          { userId: THEM, displayName: 'Sam', accent: 'pink', planGroupOrder: 'oneOff' },
          { userId: ME, displayName: 'Jake', accent: 'blue', planGroupOrder: mockMyGroupOrder },
        ]
      : [
          { userId: ME, displayName: 'Jake', accent: 'blue', planGroupOrder: mockMyGroupOrder },
          { userId: THEM, displayName: 'Sam', accent: 'pink', planGroupOrder: 'oneOff' },
        ],
  }),
  useSetPlanGroupOrder: () => ({ mutate: mockSetGroupOrder, error: mockGroupOrderError }),
  useHousehold: () => ({ data: { weekStartsOn: 0, timeZone: 'UTC' } }),
}));

const mockTapped = jest.fn();
const mockFinished = jest.fn();
const mockCelebrated = jest.fn();
jest.mock('@/design/haptics', () => ({
  tapped: () => mockTapped(),
  finished: () => mockFinished(),
  celebrated: () => mockCelebrated(),
}));

jest.mock('@/stores/sessionStore', () => ({
  useUserId: () => ME,
  // The plan reads subtasks now, and those hooks want a household.
  useActiveHouseholdId: () => 'house-1',
}));

jest.mock('@/data/hooks/useSubtasks', () => ({
  useSubtasksByChore: () => mockSubtasks,
  useSubtaskTicksFor: () => new Map(),
  useToggleSubtask: () => ({ mutate: mockToggleSubtask }),
}));
let mockCelebratedOn: string | null = null;
const mockMarkCelebrated = jest.fn((day: string) => {
  mockCelebratedOn = day;
});
jest.mock('@/stores/routineStore', () => ({
  useRoutineStore: (selector: (s: unknown) => unknown) =>
    selector({
      setTodayMode: mockSetMode,
      celebratedOn: mockCelebratedOn,
      markCelebrated: mockMarkCelebrated,
    }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const item = (
  id: string,
  title: string,
  status = 'due',
  assignee: unknown = { kind: 'anyone' },
): AgendaItem =>
  ({
    occurrenceKey: `v1:${id}`,
    choreId: id,
    choreTitle: title,
    dueOn: TODAY,
    status,
    daysOverdue: 0,
    missedBefore: 0,
    completedBy: null,
    assignee,
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
const mockAddFor = jest.fn();

const onAcceptProposal = jest.fn();

function renderScreen(
  available: AgendaItem[],
  proposal: { items: readonly AgendaItem[]; reason: string } | null = null,
) {
  return render(
    <ThemeProvider>
      <PlanScreen
        available={available}
        chores={available.map((i) => chore(i.choreId, i.choreTitle))}
        recurringChoreIds={mockRecurring}
        today={TODAY}
        refetch={async () => {}}
        onAdd={onAdd}
        onAddFor={mockAddFor}
        proposal={proposal}
        onAcceptProposal={onAcceptProposal}
      />
    </ThemeProvider>,
  );
}

/** Re-render with a new agenda, which is how a tick arrives from the server. */
const rerenderWith = (rerender: (ui: React.ReactElement) => void, available: AgendaItem[]) => {
  act(() => {
    rerender(
      <ThemeProvider>
        <PlanScreen
          available={available}
          chores={available.map((i) => chore(i.choreId, i.choreTitle))}
          recurringChoreIds={mockRecurring}
          today={TODAY}
          refetch={async () => {}}
          onAdd={onAdd}
          onAddFor={mockAddFor}
          proposal={null}
          onAcceptProposal={onAcceptProposal}
        />
      </ThemeProvider>,
    );
  });
};

beforeEach(() => {
  mockEntries = [];
  mockTheirCount = 0;
  mockTheirTotal = 0;
  mockTheirEntries = [];
  mockSubtasks = new Map();
  mockRecurring = new Set(['dishes', 'trash', 'mail', 'bins', 'mopping', 'litter', 'gutters']);
  mockMyGroupOrder = 'chores';
  mockSetGroupOrder.mockClear();
  mockGroupOrderError = null;
  mockHousemateFirst = true;
  mockToggleSubtask.mockClear();
  mockPlanUnknown = false;
  mockTapped.mockClear();
  mockFinished.mockClear();
  mockCelebrated.mockClear();
  mockCelebratedOn = null;
  mockMarkCelebrated.mockClear();
  mockRemove.mockClear();
  mockReorder.mockClear();
  mockMyFlags = new Set();
  mockTheirFlags = new Set();
  mockToggleFlag.mockClear();
  mockToggle.mockClear();
  onAdd.mockClear();
  mockAddFor.mockClear();
  onAcceptProposal.mockClear();
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

  it('states where the other person is, without being a way in', () => {
    /*
     * Their day is a section on this screen now, not a sheet, so this line is a
     * status and not a button. It still appears when they have planned nothing,
     * because a line that vanishes on an empty subject cannot tell you whether
     * the subject is empty or the feature is missing.
     */
    mockTheirEntries = [
      { occurrenceKey: 'v1:bins', position: 1, plannedFor: TODAY },
      { occurrenceKey: 'v1:mopping', position: 2, plannedFor: TODAY },
    ];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins'), item('mopping', 'Mopping')]);

    expect(screen.getByText('Sam has 2 of 2 left')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "See Sam's day" })).toBeNull();
  });

  it('says so when they have planned nothing', () => {
    mockTheirEntries = [];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByText("Sam hasn't planned today")).toBeOnTheScreen();
  });

  it('says nothing about their day while the plan is still unknown', () => {
    /*
     * An empty list means "loading", "failed" and "genuinely empty" alike, and
     * only the third is worth stating. Saying "Sam hasn't planned today" out of
     * not having asked yet is a confident claim about another person.
     */
    mockPlanUnknown = true;
    mockTheirEntries = [];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    expect(screen.queryByText(/Sam/)).toBeNull();
  });

  it('shows their day as a section under yours', () => {
    // "Just show mine and then emily's below."
    mockTheirEntries = [{ occurrenceKey: 'v1:bins', position: 1, plannedFor: TODAY }];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    expect(screen.getByText("Sam's day")).toBeOnTheScreen();
    expect(screen.getByTestId('drag-row:v1:bins')).toBeOnTheScreen();
    expect(screen.getByTestId('drag-row:v1:dishes')).toBeOnTheScreen();
  });

  it('reorders their day against their rows, not yours', () => {
    /*
     * The reversal: their plan is editable. The owner has to be carried into
     * the write, or the reorder is computed from your positions and applied to
     * a row that is not on your day at all.
     */
    mockTheirEntries = [
      { occurrenceKey: 'v1:bins', position: 10, plannedFor: TODAY },
      { occurrenceKey: 'v1:mopping', position: 20, plannedFor: TODAY },
    ];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins'), item('mopping', 'Mopping')]);

    act(() => {
      screen
        .getByTestId('drag-row:v1:mopping')
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } });
    });

    expect(mockReorder).toHaveBeenCalledWith('v1:mopping', 9, THEM);
  });

  it('takes something off their day, from their day', () => {
    mockTheirEntries = [{ occurrenceKey: 'v1:bins', position: 1, plannedFor: TODAY }];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    fireEvent.press(screen.getByRole('button', { name: /^Bins, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Take off today/ }));

    expect(mockRemove).toHaveBeenCalledWith({ occurrenceKey: 'v1:bins', ownerId: THEM });
  });

  it('can be reordered without a drag gesture', () => {
    /*
     * A drag is unusable with VoiceOver, and "there is a handle" is not an
     * accessible reorder story — the rule the house list already follows.
     *
     * Moving the second row up writes a position between nothing and the first
     * row's, so one row moves and one row is written; renumbering the day would
     * be N writes and would make two people reordering at once a conflict.
     */
    mockEntries = [entry('dishes', 10), entry('trash', 20)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    const row = screen.getByTestId('drag-row:v1:trash');
    expect(row.props.accessibilityActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'moveUp' })]),
    );
    // Invoked directly: RNTL's synthetic event dispatch does not reach
    // `onAccessibilityAction`, and the action is what VoiceOver actually calls.
    act(() => {
      row.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } });
    });

    // The exact value, not merely "smaller": Dishes sits at 10 and Trash is
    // landing above it with nothing before, so the position is 9. Asserting
    // "less than 10" also passes for a hardcoded 1, which is no averaging at all.
    expect(mockReorder).toHaveBeenCalledWith('v1:trash', 9, ME);
  });

  it('writes the row that actually moved when it moves down', () => {
    /*
     * The direction that catches inferring the moved row from the two orders.
     * Moving Dishes down turns [dishes, trash, mail] into [trash, dishes, mail],
     * whose first differing index is 0 — Trash, which did not move. Writing
     * Trash's position instead leaves Dishes exactly where it was, so the drag
     * silently snaps back on the next refetch.
     */
    mockEntries = [entry('dishes', 10), entry('trash', 20), entry('mail', 30)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash'), item('mail', 'Mail')]);

    act(() => {
      screen
        .getByTestId('drag-row:v1:dishes')
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } });
    });

    // Between Trash (20) and Mail (30), not below Trash.
    expect(mockReorder).toHaveBeenCalledWith('v1:dishes', 25, ME);
  });

  it('takes something off the day without completing or skipping it', () => {
    // "Not today" is its own answer. Removing must not look like finishing.
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Take off today/ }));

    expect(mockRemove).toHaveBeenCalledWith({ occurrenceKey: 'v1:dishes', ownerId: ME });
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

describe('adding a chore from the plan', () => {
  it('does not float a + beside the button that adds what you already have', () => {
    /*
     * The + is the *create a new chore* button, and on this sub-tab it sat
     * directly beside "Add something", which picks from existing chores. The
     * most prominent control on the screen looked like the common action and
     * did the rare one — Jake read it exactly that way.
     *
     * Creating still happens from the plan, in the picker's first row, so this
     * asserts the removal rather than the loss of the ability. It stays on the
     * Chores and Routines sub-tabs, where nothing competes with it.
     */
    renderScreen([]);
    expect(screen.queryByRole('button', { name: 'Add a chore' })).toBeNull();
  });
});

describe('the morning proposal', () => {
  const proposal = (titles: string[]) => ({
    items: titles.map((t) => item(t.toLowerCase(), t)),
    reason: '2 late, 1 due',
  });

  it('offers a day rather than an empty screen', () => {
    /*
     * Neither empty nor pre-filled. Empty asks her to do the work; pre-filled
     * recreates the wall of twenty with extra steps. This is the third option,
     * and it is the only shape that answers "tell me what to do" and "let me
     * pick" at the same time.
     */
    renderScreen([], proposal(['Labs', 'Timesheet', 'Car']));

    expect(screen.getByText("Here's a day.")).toBeOnTheScreen();
    expect(screen.getByText('2 late, 1 due')).toBeOnTheScreen();
    expect(screen.getByText('Labs')).toBeOnTheScreen();
    expect(screen.queryByText('Nothing planned yet.')).toBeNull();
  });

  it('commits the whole day in one tap', () => {
    renderScreen([], proposal(['Labs', 'Timesheet']));
    fireEvent.press(screen.getByRole('button', { name: 'Start the day' }));

    expect(onAcceptProposal).toHaveBeenCalledTimes(1);
    expect(onAcceptProposal.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('still lets her pick her own instead', () => {
    // Directive by default, editable always. Without this the proposal is a
    // wall of somebody else's choices, which is what she already had.
    renderScreen([], proposal(['Labs']));
    fireEvent.press(screen.getByRole('button', { name: 'Pick my own' }));

    expect(onAdd).toHaveBeenCalled();
    expect(onAcceptProposal).not.toHaveBeenCalled();
  });

  it('falls back to the invitation when there is nothing to offer', () => {
    renderScreen([], { items: [], reason: 'Nothing needs doing today.' });
    expect(screen.getByText('Nothing planned yet.')).toBeOnTheScreen();
    expect(screen.queryByText("Here's a day.")).toBeNull();
  });

  it('does not offer a day over a plan that already exists', () => {
    // The proposal is for an empty morning. Showing it above a plan she has
    // already built would be the app arguing with her.
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')], proposal(['Labs']));

    expect(screen.queryByText("Here's a day.")).toBeNull();
    expect(screen.getByText('Dishes')).toBeOnTheScreen();
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
          recurringChoreIds={mockRecurring}
          today={TODAY}
          refetch={async () => {}}
          onAdd={onAdd}
          onAddFor={mockAddFor}
        />
      </ThemeProvider>,
    );

    expect(mockFinished).toHaveBeenCalledTimes(1);
  });

  it('does not congratulate you for skipping everything', () => {
    /*
     * A skip closes the day — it is a decision, not a failure — but it is not
     * an achievement. The loud tier read from a list that folded skips into
     * "done", so skipping a chore twenty days overdue produced confetti and
     * "Including Get car inspected — 20 days late": congratulations for the
     * exact thing you had just avoided.
     */
    mockEntries = [entry('car', 1)];
    renderScreen([
      { ...item('car', 'Get car inspected', 'skipped'), daysOverdue: 20 } as AgendaItem,
    ]);

    expect(mockCelebrated).not.toHaveBeenCalled();
    expect(screen.queryByText(/20 days late/)).toBeNull();
  });

  it('does not replay when the screen is remounted', () => {
    /*
     * Switching Today's mode unmounts this screen, so a `useState` guard let a
     * finished day buzz and throw confetti again on every return — the
     * opposite of "coming back should be quiet, you already had the moment".
     */
    mockEntries = [entry('dishes', 1)];
    const view = renderScreen([item('dishes', 'Dishes', 'completed')]);
    expect(mockFinished).toHaveBeenCalledTimes(1);

    view.unmount();
    renderScreen([item('dishes', 'Dishes', 'completed')]);

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

describe('finished work sinking to the bottom', () => {
  /*
   * Fake timers, because the delay is the design. The tick and the move are two
   * beats: a row that leaves at the instant you touch it takes its own feedback
   * with it, and if it was the wrong row, undo means hunting for it elsewhere.
   */
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /*
   * Both halves, in the order they are drawn. Finished rows leave the draggable
   * list entirely, so reading only `drag-row:` would make a sunk row look like
   * a deleted one — and would not notice one landing in the wrong half.
   */
  const titles = () =>
    screen
      .getAllByTestId(/^(drag|done)-row:/)
      .map((row) => row.props.testID.replace(/^(drag|done)-row:v1:/, ''));

  it('holds a just-ticked row in place, then sinks it', () => {
    mockEntries = [entry('dishes', 1), entry('trash', 2), entry('bins', 3)];
    const { rerender } = renderScreen([
      item('dishes', 'Dishes'),
      item('trash', 'Trash'),
      item('bins', 'Bins'),
    ]);

    // Ticked while you are looking at it, which is the only case that holds.
    rerenderWith(rerender, [
      item('dishes', 'Dishes', 'completed'),
      item('trash', 'Trash'),
      item('bins', 'Bins'),
    ]);

    expect(titles()).toEqual(['dishes', 'trash', 'bins']);

    /*
     * Still there half a second later. Without this step the test cannot tell a
     * three-second delay from no delay at all — under fake timers a zero-length
     * timeout is equally unfired until time is advanced, and the delay is the
     * entire design.
     */
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(titles()).toEqual(['dishes', 'trash', 'bins']);

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(titles()).toEqual(['trash', 'bins', 'dishes']);
  });

  it('does not hold work that was already done when the screen opened', () => {
    /*
     * Otherwise every row you finished earlier sits in its old place for three
     * seconds and then jumps, every single time you open the app. The hold is
     * for work you finish while looking at it.
     */
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes', 'completed'), item('trash', 'Trash')]);

    expect(titles()).toEqual(['trash', 'dishes']);
  });

  it('puts a row back where it was if you untick it', () => {
    /*
     * The reason this is a display rule rather than a stored position: unticking
     * something that had sunk must return it to its place in the day, not leave
     * it at the bottom having quietly destroyed the order you built.
     */
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    const { rerender } = renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    rerenderWith(rerender, [item('dishes', 'Dishes', 'completed'), item('trash', 'Trash')]);
    act(() => {
      jest.advanceTimersByTime(3500);
    });
    expect(titles()).toEqual(['trash', 'dishes']);

    rerenderWith(rerender, [item('dishes', 'Dishes'), item('trash', 'Trash')]);

    expect(titles()).toEqual(['dishes', 'trash']);
  });

  it('leaves an untouched day alone', () => {
    // Nothing finished, so nothing to sink and nothing to hold.
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    act(() => {
      jest.advanceTimersByTime(3500);
    });

    expect(titles()).toEqual(['dishes', 'trash']);
  });

  it('does not hold work that arrives already finished after the plan loads', () => {
    /*
     * The load race. The plan and the agenda are separate queries with no
     * ordering between them, so the first render routinely has an empty plan.
     *
     * A "have I looked once" flag is burned by that empty render, and every row
     * that then arrives already finished counts as freshly ticked — held
     * mid-list for three seconds and jumping. The same happens at midnight when
     * the date rolls over, and on switching household. Holding on the
     * transition rather than on a flag is what makes all three behave.
     */
    mockEntries = [];
    const { rerender } = renderScreen([
      item('dishes', 'Dishes', 'completed'),
      item('trash', 'Trash'),
      item('bins', 'Bins'),
    ]);

    // The plan entries land a moment after the agenda did.
    mockEntries = [entry('dishes', 1), entry('trash', 2), entry('bins', 3)];
    rerenderWith(rerender, [
      item('dishes', 'Dishes', 'completed'),
      item('trash', 'Trash'),
      item('bins', 'Bins'),
    ]);

    expect(titles()).toEqual(['trash', 'bins', 'dishes']);
  });
});

describe('reordering a day that has finished work in it', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /*
   * The shape a review caught, and the reason finished rows leave the draggable
   * list rather than moving within it.
   *
   * When the drag list was handed the *display* order, its positions were no
   * longer monotonic — a sunk row sat at the end carrying a low position. A
   * VoiceOver "move down" then averaged the wrong neighbours and wrote a
   * position that sent the row to the *top* of the day, in the database.
   */
  it('writes a position derived from the stored order, not the drawn one', () => {
    mockEntries = [entry('dishes', 1), entry('trash', 2), entry('bins', 3)];
    renderScreen([
      item('dishes', 'Dishes', 'completed'),
      item('trash', 'Trash'),
      item('bins', 'Bins'),
    ]);

    // Dishes is done, so it is not in the draggable list at all.
    expect(screen.queryByTestId('drag-row:v1:dishes')).toBeNull();

    act(() => {
      screen
        .getByTestId('drag-row:v1:bins')
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } });
    });

    /*
     * Above everything left, and clear of the whole stored day — not merely of
     * the draggable part of it. Dishes is finished and keeps position 1 while
     * sitting below the list, so landing *on* 1 would be a tie that only
     * surfaces when Dishes is unticked and the two swap inexplicably.
     */
    expect(mockReorder).toHaveBeenCalledWith('v1:bins', expect.any(Number), ME);
    const written = mockReorder.mock.calls[0]?.[1] as number;
    expect(written).toBeLessThan(1);
  });

  it('does not reshuffle the list when a row is picked up', () => {
    /*
     * Freezing the drag by reverting to the raw plan order made every sunk row
     * rise back into the middle of the list the moment a row lifted — before
     * the finger had moved a pixel — and drop back on release.
     */
    mockEntries = [entry('dishes', 1), entry('trash', 2), entry('bins', 3)];
    renderScreen([
      item('dishes', 'Dishes', 'completed'),
      item('trash', 'Trash'),
      item('bins', 'Bins'),
    ]);

    const before = screen
      .getAllByTestId(/^(drag|done)-row:/)
      .map((row) => row.props.testID as string);

    act(() => {
      screen.getByTestId('drag-row:v1:trash').props.onTouchStart({
        nativeEvent: { pageX: 100, pageY: 400 },
      });
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(
      screen.getAllByTestId(/^(drag|done)-row:/).map((row) => row.props.testID as string),
    ).toEqual(before);
  });
});

describe('two days on one screen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers a labelled way to add to each day', () => {
    /*
     * The add button used to sit unlabelled below both lists and write to yours
     * whatever it looked like it meant — the one mutation never threaded with
     * an owner. Under a housemate's section that reads as a dead button.
     */
    mockTheirEntries = [{ occurrenceKey: 'v1:bins', position: 1, plannedFor: TODAY }];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    fireEvent.press(screen.getByRole('button', { name: "Add to Sam's day" }));
    expect(mockAddFor).toHaveBeenCalledWith(THEM);

    fireEvent.press(screen.getByRole('button', { name: 'Add to my day' }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('holds a row ticked on their day, exactly as on yours', () => {
    /*
     * `held` was fed from your plan alone and applied to both sections, so a
     * row ticked on theirs sank the instant it was touched — the tick never
     * landed visibly and undoing meant hunting for it below the line.
     */
    mockTheirEntries = [
      { occurrenceKey: 'v1:bins', position: 1, plannedFor: TODAY },
      { occurrenceKey: 'v1:mopping', position: 2, plannedFor: TODAY },
    ];
    mockEntries = [entry('dishes', 1)];
    const { rerender } = renderScreen([
      item('dishes', 'Dishes'),
      item('bins', 'Bins'),
      item('mopping', 'Mopping'),
    ]);

    rerenderWith(rerender, [
      item('dishes', 'Dishes'),
      item('bins', 'Bins', 'completed'),
      item('mopping', 'Mopping'),
    ]);

    // Still in the draggable half, where it was.
    expect(screen.queryByTestId('drag-row:v1:bins')).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(3500);
    });

    expect(screen.queryByTestId('done-row:v1:bins')).not.toBeNull();
  });
});

describe('the steps inside a planned chore', () => {
  /*
   * Jake: *"the plan tab has no way to view and check off subtasks when they're
   * on a chore. That needs to be added, and in fact it should probably be
   * fairly prominent, maybe you don't even need to expand the chore to see
   * it."*
   *
   * The rows were compact, which folds detail away, and nothing passed the
   * steps in at all — so there was no way to reach them even by expanding. On a
   * day you have committed to, the steps are the work, so they start open.
   */
  beforeEach(() => {
    mockSubtasks = new Map([['dishes', [{ id: 's1', title: 'Rinse the pans' }]]]);
  });

  it('shows them without being expanded', () => {
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByText('Rinse the pans')).toBeOnTheScreen();
  });

  it('ticks one off against the occurrence it belongs to', () => {
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    fireEvent.press(screen.getByRole('checkbox', { name: /Rinse the pans/ }));

    expect(mockToggleSubtask).toHaveBeenCalledWith({
      subtaskId: 's1',
      ticked: true,
      occurrenceKey: 'v1:dishes',
    });
  });
});

describe('splitting the day by kind of work', () => {
  /*
   * Jake: *"we need to split the daily plan into sections. There should be a
   * Recurring Chores section and a One Time Tasks section, or else it just gets
   * too overwhelming."*
   *
   * One-off work started being auto-planned two days earlier, which put 38 rows
   * on this household's day — and a task you do once reads nothing like the
   * washing-up, so one undifferentiated list is where the overwhelm came from.
   */
  it('heads each group when there is both kinds', () => {
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('dishes', 1), entry('taxes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    expect(screen.getByRole('header', { name: /^Chores/ })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: /^One-time tasks/ })).toBeOnTheScreen();
  });

  it('draws no heading when the day is all one kind', () => {
    /*
     * A "One-time tasks" heading over nothing says there is work you cannot
     * see, and a "Chores" heading on a day of only chores is furniture.
     */
    mockRecurring = new Set(['dishes', 'trash']);
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    expect(screen.queryByRole('header', { name: /^Chores/ })).toBeNull();
    expect(screen.queryByRole('header', { name: /^One-time tasks/ })).toBeNull();
    // The rows are still there — the grouping is what is absent, not the work.
    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    expect(screen.getByText('Trash')).toBeOnTheScreen();
  });

  it('keeps a one-off out of the chores group', () => {
    /*
     * The split has to be on what the chore *is*, not on where it happens to
     * sort — otherwise the headings are decoration.
     *
     * The one-off is therefore given the *earlier* position. With
     * `dishes` first this assertion held whether or not the grouping ran at
     * all, because `planFor` sorts by position and would have produced the
     * same order on its own: the exact shape AGENTS.md warns about, where the
     * simplest fixture is the one input the right and wrong implementations
     * agree on.
     */
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('taxes', 1), entry('dishes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    const rows = screen
      .getAllByTestId(/^(drag|done)-row:/)
      .map((row) => (row.props.testID as string).replace(/^(drag|done)-row:v1:/, ''));

    // Chores first, then one-time tasks.
    expect(rows).toEqual(['dishes', 'taxes']);
  });
});

describe('which kind of work leads the day', () => {
  /*
   * Jake and Emily want opposite answers — *"Emily wants one time tasks first
   * and I want chores first so I think we just need to make it something you
   * can flip if you want."* — so this is a preference on the profile rather
   * than a decision made once in the layout.
   *
   * Every fixture here puts the *one-off* at the earlier plan position, so
   * position-order and group-order disagree. With them agreeing, a screen that
   * had lost the grouping entirely would still produce the expected sequence.
   */
  const rowOrder = () =>
    screen
      .getAllByTestId(/^(drag|done)-row:/)
      .map((row) => (row.props.testID as string).replace(/^(drag|done)-row:v1:/, ''));

  const renderMixedDay = () => {
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('taxes', 1), entry('dishes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);
  };

  it('leads with chores when that is what you chose', () => {
    mockMyGroupOrder = 'chores';
    renderMixedDay();

    expect(rowOrder()).toEqual(['dishes', 'taxes']);
  });

  it('leads with one-time tasks when that is what you chose', () => {
    mockMyGroupOrder = 'oneOff';
    renderMixedDay();

    expect(rowOrder()).toEqual(['taxes', 'dishes']);
  });

  it.each([
    ['housemate first', true],
    ['you first', false],
  ])('reads your own preference whichever row comes back first (%s)', (_name, housemateFirst) => {
    /*
     * The member list has no guaranteed order, and the housemate is always set
     * to the opposite preference — so any index-based read orders the day
     * backwards in one of these two runs. One fixture only ever protects
     * against the mis-read that picks the *other* person.
     */
    mockHousemateFirst = housemateFirst;
    mockMyGroupOrder = 'chores';
    renderMixedDay();

    expect(rowOrder()).toEqual(['dishes', 'taxes']);
  });

  it("offers the flip on the day's own heading, labelled with what it will do", () => {
    /*
     * On the section header rather than a group heading. It started on the
     * second group's `SubHeader`, which moved it by the height of whichever
     * group changed places — four rows down a day of one chore and five tasks
     * — and left it too short to hit, because a heading row cannot afford a
     * 44pt box and `hitSlop` loses the overlap to the rows drawn after it.
     */
    mockMyGroupOrder = 'chores';
    renderMixedDay();

    expect(screen.getByRole('button', { name: 'Show one-time tasks first' })).toBeOnTheScreen();
    // The label names the action, never the current state.
    expect(screen.queryByRole('button', { name: 'Show chores first' })).toBeNull();
  });

  it('names the other group once the order is flipped', () => {
    mockMyGroupOrder = 'oneOff';
    renderMixedDay();

    expect(screen.getByRole('button', { name: 'Show chores first' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Show one-time tasks first' })).toBeNull();
  });

  it('saves the flip against your profile', () => {
    mockMyGroupOrder = 'chores';
    renderMixedDay();

    fireEvent.press(screen.getByRole('button', { name: 'Show one-time tasks first' }));

    expect(mockSetGroupOrder).toHaveBeenCalledWith('oneOff');
  });

  it('says so when the flip does not stick', () => {
    /*
     * The write rolls back optimistically, so the control springs back to where
     * it was. Unexplained, that is a toggle that looks broken — and it is the
     * exact silent no-op the zero-row guard in `setPlanGroupOrderWith` exists
     * to turn into an error. Catching it there and rendering nothing would
     * leave the user precisely where they started.
     */
    mockGroupOrderError = new Error('Your profile could not be found.');
    mockMyGroupOrder = 'chores';
    renderMixedDay();

    expect(screen.getByText('Your profile could not be found.')).toBeOnTheScreen();
  });

  it('offers nothing to flip on a day of only one kind', () => {
    // No headings, so no heading to hang the control on — and nothing to
    // reorder either.
    mockRecurring = new Set(['dishes', 'trash']);
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    expect(screen.queryByRole('button', { name: /^Show .* first$/ })).toBeNull();
  });

  it('offers nothing to flip when the flagged group leaves only one kind', () => {
    /*
     * A day of one flagged chore and two plain ones has two *groups* and one
     * *kind*. Gating on group count rather than kind count put the control
     * here, and tapping it swapped two entries of which one was empty: nothing
     * moved, and the label flipped. The flagged group manufactures this case
     * by emptying a kind, so it is not a corner.
     */
    mockMyFlags = new Set(['dishes']);
    mockRecurring = new Set(['dishes', 'trash', 'mail']);
    mockEntries = [entry('dishes', 1), entry('trash', 2), entry('mail', 3)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash'), item('mail', 'Post')]);

    // The grouping is visible — so this is not "no groups, no control".
    expect(screen.getByRole('header', { name: /^Flagged/ })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Show .* first$/ })).toBeNull();
  });

  it('does not fall through into the housemate’s section', () => {
    /*
     * The fixture that was missing, and the reason it mattered: the version
     * before this one put the control on *their* day when your own held one
     * kind of work — a button that changes **your** preference, under a heading
     * reading "Sam's day", at the one moment the copy elsewhere is careful to
     * say the two are separate.
     *
     * The test above cannot see it: its housemate has an empty day, so "no
     * control anywhere" and "control moved next door" look identical. This one
     * gives them a day of both kinds, which is the only shape where the
     * fall-through has somewhere to land.
     */
    mockRecurring = new Set(['dishes', 'trash', 'mail']);
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    mockTheirCount = 2;
    mockTheirTotal = 2;
    mockTheirEntries = [entry('mail', 1), entry('gutters', 2)];
    renderScreen([
      item('dishes', 'Dishes'),
      item('trash', 'Trash'),
      item('mail', 'Post', 'due', { kind: 'fixed', userId: THEM }),
      item('gutters', 'Gutters', 'due', { kind: 'fixed', userId: THEM }),
    ]);

    // Their day genuinely splits, so there is a heading to fall through onto.
    expect(screen.getByRole('header', { name: /^One-time tasks/ })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Show .* first$/ })).toBeNull();
  });

  it('shows exactly one flip, not one per day', () => {
    // The preference is about how you read the screen, so it applies to both
    // days and is stated once.
    mockMyGroupOrder = 'chores';
    mockTheirCount = 2;
    mockTheirTotal = 2;
    mockTheirEntries = [entry('mail', 1), entry('gutters', 2)];
    mockRecurring = new Set(['dishes', 'mail']);
    mockEntries = [entry('taxes', 1), entry('dishes', 2)];
    renderScreen([
      item('dishes', 'Dishes'),
      item('taxes', 'File the taxes'),
      item('mail', 'Post', 'due', { kind: 'fixed', userId: THEM }),
      item('gutters', 'Gutters', 'due', { kind: 'fixed', userId: THEM }),
    ]);

    expect(screen.getAllByRole('button', { name: /^Show .* first$/ })).toHaveLength(1);
  });
});

describe('flagging from the plan', () => {
  /*
   * The "!!" existed on Today and was absent here entirely — a row could carry
   * a flag the plan never drew, and there was no way to set one from the
   * screen you actually work off. Jake: *"I don't see a button to add the !!
   * on daily plan."*
   */
  it('shows a flag somebody else set, because a flag is the household’s', () => {
    /*
     * Flagged by *them* and not by you — the case the whole feature is built
     * around, and the one the old fixture could not express because it derived
     * both sets from one. A row reading `myFlags` instead of the household's
     * draws nothing here.
     */
    mockMyFlags = new Set();
    mockTheirFlags = new Set(['dishes']);
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByRole('button', { name: /Dishes.*Flagged for this week/ })).toBeOnTheScreen();
  });

  it('lifts a row your housemate flagged, not only your own', () => {
    mockMyFlags = new Set();
    mockTheirFlags = new Set(['taxes']);
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('dishes', 1), entry('taxes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    const rows = screen
      .getAllByTestId(/^(drag|done)-row:/)
      .map((row) => (row.props.testID as string).replace(/^(drag|done)-row:v1:/, ''));
    expect(rows).toEqual(['taxes', 'dishes']);
  });

  it('draws no flag on work that has none', () => {
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.queryByRole('button', { name: /Flagged for this week/ })).toBeNull();
  });

  it('keeps "Take off today" as the first action in the sheet', () => {
    /*
     * On the plan the question is almost always *not today*, which is this
     * sheet's own stated reason for existing — so that is the reflex tap.
     * "Flag it" was briefly first, which turns the muscle memory that clears a
     * row into one that flags it. Nothing pinned the order, and it has now
     * flipped twice.
     */
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));

    const actions = screen
      .getAllByRole('button')
      .map((b) => String(b.props.accessibilityLabel ?? ''))
      .filter((label) => /Take off today|Flag it for this week|Edit the chore/.test(label));

    expect(actions[0]).toMatch(/Take off today/);
  });

  it('offers to flag, and moves it to the top of the day', () => {
    /*
     * A written position, not a sort rule. Jake asked for the flag to be the
     * row's *default* position — "allow you to move it afterwards if needed" —
     * and a sort that put flagged work first would win over every later drag.
     *
     * Above the smallest stored position on the day, which is 1 here, so -1
     * beats a tie with anything already sitting there.
     */
    mockEntries = [entry('dishes', 3), entry('bins', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Flag it for this week/ }));

    expect(mockToggleFlag).toHaveBeenCalledWith('dishes');
    expect(mockReorder).toHaveBeenCalledWith('v1:dishes', 0, ME);
  });

  it('writes no position when the row is already the top of the day', () => {
    /*
     * `stored` includes the row's own position, so a second write just makes
     * it the minimum again: the number falls and nothing moves. Comparing
     * against the minimum stops the write rather than letting it drift.
     */
    mockMyFlags = new Set();
    mockTheirFlags = new Set(['dishes']);
    mockEntries = [entry('dishes', 1), entry('bins', 3)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Flag it for this week/ }));

    expect(mockToggleFlag).toHaveBeenCalledWith('dishes');
    expect(mockReorder).not.toHaveBeenCalled();
  });

  it('still writes a position for a row lifted by a flag set on Today', () => {
    /*
     * The case a `theirsToo` gate got wrong. Flagging from Today writes no
     * position, so a row your housemate flagged there is lifted while its
     * stored position is still mid-day. Skipping the write because "it is
     * already at the top" means that once both flags lapse it drops back into
     * the middle — losing the one thing the position is for.
     */
    mockMyFlags = new Set();
    mockTheirFlags = new Set(['dishes']);
    mockEntries = [entry('dishes', 3), entry('bins', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Flag it for this week/ }));

    expect(mockReorder).toHaveBeenCalledWith('v1:dishes', 0, ME);
  });

  it('promises the drop only when yours is the last flag on it', () => {
    mockMyFlags = new Set(['dishes']);
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));

    expect(screen.getByText(/drops back in with the rest of the day/)).toBeOnTheScreen();
  });

  it('says the row stays up when the housemate has flagged it too', () => {
    /*
     * The lift belongs to the household: either flag is enough to raise the
     * row, and it comes down only when the last one does. Promising it "drops
     * back in with the rest of the day" here is simply false — you tap, and
     * nothing moves.
     */
    mockMyFlags = new Set(['dishes']);
    mockTheirFlags = new Set(['dishes']);
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));

    expect(screen.getByText(/stays at the top/)).toBeOnTheScreen();
    expect(screen.queryByText(/drops back in with the rest of the day/)).toBeNull();
  });

  it('leaves the position alone when the flag comes off', () => {
    // Where it sits is a decision you have since made; lifting the flag is not
    // a request to undo it.
    mockMyFlags = new Set(['dishes']);
    mockEntries = [entry('dishes', 3), entry('bins', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    fireEvent.press(screen.getByRole('button', { name: /^Dishes, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Unflag it/ }));

    expect(mockToggleFlag).toHaveBeenCalledWith('dishes');
    expect(mockReorder).not.toHaveBeenCalled();
  });

  it('moves it to the top of the day it was flagged on, not always yours', () => {
    mockTheirEntries = [
      { occurrenceKey: 'v1:bins', position: 9, plannedFor: TODAY },
      { occurrenceKey: 'v1:mail', position: 4, plannedFor: TODAY },
    ];
    mockEntries = [entry('dishes', 1)];
    renderScreen([
      item('dishes', 'Dishes'),
      item('bins', 'Bins', 'due', { kind: 'fixed', userId: THEM }),
      item('mail', 'Post', 'due', { kind: 'fixed', userId: THEM }),
    ]);

    fireEvent.press(screen.getByRole('button', { name: /^Bins, .*Open options\.$/ }));
    fireEvent.press(screen.getByRole('button', { name: /Flag it for this week/ }));

    // Their day's smallest is 4, so 3 — not something derived from your day,
    // whose smallest is 1.
    expect(mockReorder).toHaveBeenCalledWith('v1:bins', 3, THEM);
  });
});

describe('flagged work leads the whole day', () => {
  /*
   * Jake, having seen the sections: *"Cells with !! should go to the top
   * automatically."* Top of the plan, not top of whichever section the row
   * happens to belong to — a flagged task buried under eleven chores because
   * it is a task is not "the top".
   *
   * The two order assertions below flag the row that the ordinary rules would
   * put *last*, so a screen that had lost the hoist produces the opposite
   * sequence rather than the same one. The rest are about headings and
   * draggability, where there is no order to invert.
   */
  const rowOrder = () =>
    screen
      .getAllByTestId(/^(drag|done)-row:/)
      .map((row) => (row.props.testID as string).replace(/^(drag|done)-row:v1:/, ''));

  it('lifts a flagged one-off above the chores', () => {
    mockMyFlags = new Set(['taxes']);
    mockMyGroupOrder = 'chores';
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('dishes', 1), entry('taxes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    // Without the hoist this is ['dishes', 'taxes'] — chores lead, and the
    // stored positions agree.
    expect(rowOrder()).toEqual(['taxes', 'dishes']);
  });

  it('lifts a flagged chore above the tasks when tasks lead', () => {
    mockMyFlags = new Set(['dishes']);
    mockMyGroupOrder = 'oneOff';
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('dishes', 2), entry('taxes', 1)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    expect(rowOrder()).toEqual(['dishes', 'taxes']);
  });

  it('heads the flagged group so the lift is explained', () => {
    mockMyFlags = new Set(['taxes']);
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('dishes', 1), entry('taxes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    expect(screen.getByRole('header', { name: /^Flagged/ })).toBeOnTheScreen();
  });

  it('draws no headings at all when everything is flagged', () => {
    // One group needs no label: there is nothing to tell it apart from, and a
    // lone "Flagged" heading over the whole day is furniture.
    mockMyFlags = new Set(['dishes', 'taxes']);
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('dishes', 1), entry('taxes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    expect(screen.queryByRole('header', { name: /^Flagged/ })).toBeNull();
    expect(screen.queryByRole('header', { name: /^Chores/ })).toBeNull();
  });

  it('keeps flagged rows draggable among themselves', () => {
    /*
     * "Maybe you should still be able to reorder them?" — they are their own
     * list, so they reorder like any other group. Asserted through the
     * accessibility path, since a drag gesture is not reachable here.
     */
    mockMyFlags = new Set(['dishes', 'taxes']);
    mockRecurring = new Set(['dishes']);
    mockEntries = [entry('dishes', 1), entry('taxes', 2)];
    renderScreen([item('dishes', 'Dishes'), item('taxes', 'File the taxes')]);

    const row = screen.getByTestId('drag-row:v1:taxes');
    expect(row.props.accessibilityActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'moveUp' })]),
    );

    act(() => {
      row.props.onAccessibilityAction({ nativeEvent: { actionName: 'moveUp' } });
    });

    // Dishes sits at 1 and the taxes are landing above it with nothing before,
    // so the position is 0 — a real write, within the flagged group.
    expect(mockReorder).toHaveBeenCalledWith('v1:taxes', 0, ME);
  });
});
