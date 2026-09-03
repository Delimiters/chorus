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
let mockTheirEntries: { occurrenceKey: string; position: number }[] = [];
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
  useRemoveFromPlan: () => ({ mutate: mockRemove }),
  useReorderPlan: () => ({ mutate: mockReorder }),
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
        today={TODAY}
        refetch={async () => {}}
        onAdd={onAdd}
        proposal={proposal}
        onAcceptProposal={onAcceptProposal}
      />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockEntries = [];
  mockTheirCount = 0;
  mockTheirTotal = 0;
  mockTheirEntries = [];
  mockTapped.mockClear();
  mockFinished.mockClear();
  mockCelebrated.mockClear();
  mockCelebratedOn = null;
  mockMarkCelebrated.mockClear();
  mockRemove.mockClear();
  mockReorder.mockClear();
  mockToggle.mockClear();
  onAdd.mockClear();
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

  it('says what the other person has taken on', () => {
    mockTheirCount = 3;
    mockTheirTotal = 3;
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByText('Sam has 3 of 3 left ›')).toBeOnTheScreen();
  });

  it('still says something once they have finished', () => {
    /*
     * The line used to be about what they had *left*, so it vanished the moment
     * they were done — which reads as them having planned nothing, not as them
     * having finished. Two very different things to learn about your housemate.
     */
    mockTheirCount = 0;
    mockTheirTotal = 4;
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    expect(screen.getByText('Sam has finished today ›')).toBeOnTheScreen();
  });

  it('shows their day when you tap it', () => {
    // The seeing half. The screen could say "Sam has 3 planned" and offer no
    // way at all to find out what they were.
    mockTheirCount = 1;
    mockTheirTotal = 2;
    mockTheirEntries = [
      { occurrenceKey: 'v1:bins', position: 1 },
      { occurrenceKey: 'v1:mopping', position: 2 },
    ];
    mockEntries = [entry('dishes', 1)];
    renderScreen([
      item('dishes', 'Dishes'),
      item('bins', 'Bins', 'completed'),
      item('mopping', 'Mopping'),
    ]);

    fireEvent.press(screen.getByRole('button', { name: "See Sam's day" }));

    expect(screen.getByText('Bins')).toBeOnTheScreen();
    expect(screen.getByText('Mopping')).toBeOnTheScreen();
    expect(screen.getByText(/1 of 2 done · only Sam can change this/)).toBeOnTheScreen();
  });

  it('offers no way to tick their rows', () => {
    /*
     * Read-only is enforced by the database — every write policy on
     * `plan_entries` requires the row to be yours, and `plan.test.sql` proves
     * Bob can neither reorder nor delete Alice's day. So the UI must not offer
     * a control whose only possible outcome is a refusal.
     */
    mockTheirCount = 1;
    mockTheirTotal = 1;
    mockTheirEntries = [{ occurrenceKey: 'v1:bins', position: 1 }];
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes'), item('bins', 'Bins')]);

    fireEvent.press(screen.getByRole('button', { name: "See Sam's day" }));

    // The positive control first: without it these two assertions pass just as
    // happily against a sheet that rendered nothing at all.
    expect(screen.getByText('Bins')).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox', { name: /Bins/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bins/ })).toBeNull();
  });

  it('counts a skipped chore as done, like everything else on this screen', () => {
    /*
     * `useTheirPlanCount` treats a skip as not-outstanding and `progressOf`
     * counts it as done for your own day; the sheet tested `completed` alone.
     * So a housemate who skipped both their chores got "Sam has finished today"
     * in the header and "0 of 2 done" in the sheet it opens — the same screen
     * disagreeing with itself about the same two rows.
     */
    mockTheirCount = 0;
    mockTheirTotal = 2;
    mockTheirEntries = [
      { occurrenceKey: 'v1:bins', position: 1 },
      { occurrenceKey: 'v1:mopping', position: 2 },
    ];
    mockEntries = [entry('dishes', 1)];
    renderScreen([
      item('dishes', 'Dishes'),
      item('bins', 'Bins', 'skipped'),
      item('mopping', 'Mopping', 'completed'),
    ]);

    fireEvent.press(screen.getByRole('button', { name: "See Sam's day" }));

    expect(screen.getByText(/2 of 2 done/)).toBeOnTheScreen();
  });

  it('says nothing when they planned nothing at all', () => {
    /*
     * Retitled, because the old name is now the opposite of the truth: a
     * finished housemate *does* get a line, twenty lines above this. What must
     * still stay silent is a housemate with no plan.
     *
     * As written this asserted against an empty subtree — `theirTotal = 0`
     * renders the whole branch as null — so it passed for any copy whatsoever.
     * The positive control below is what makes it about the condition.
    mockTheirCount = 0;
    mockTheirTotal = 0;
    mockEntries = [entry('dishes', 1)];
    renderScreen([item('dishes', 'Dishes')]);

    // The control: the screen did render, so the absence below means something.
    expect(screen.getByText('Dishes')).toBeOnTheScreen();
    expect(screen.queryByText(/Sam has/)).toBeNull();
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
    expect(mockReorder).toHaveBeenCalledWith('v1:trash', 9);
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
    expect(mockReorder).toHaveBeenCalledWith('v1:dishes', 25);
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
          today={TODAY}
          refetch={async () => {}}
          onAdd={onAdd}
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

  const titles = () =>
    screen.getAllByTestId(/^drag-row:/).map((row) => row.props.testID.replace('drag-row:v1:', ''));

  const rerenderWith = (rerender: (ui: React.ReactElement) => void, available: AgendaItem[]) => {
    act(() => {
      rerender(
        <ThemeProvider>
          <PlanScreen
            available={available}
            chores={available.map((i) => chore(i.choreId, i.choreTitle))}
            today={TODAY}
            refetch={async () => {}}
            onAdd={onAdd}
            proposal={null}
            onAcceptProposal={onAcceptProposal}
          />
        </ThemeProvider>,
      );
    });
  };

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
    // Nothing was ticked this session, so nothing is held and nothing moves —
    // but a day that arrives already finished must not shuffle on open either.
    mockEntries = [entry('dishes', 1), entry('trash', 2)];
    renderScreen([item('dishes', 'Dishes'), item('trash', 'Trash')]);

    act(() => {
      jest.advanceTimersByTime(3500);
    });

    expect(titles()).toEqual(['dishes', 'trash']);
  });
});
