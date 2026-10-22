/**
 * The row's layout must not depend on whether it is expanded.
 *
 * This is the defect Jake reported four separate times — "the daily plan cells
 * are still jumping when I expand and collapse" — and two of the three fixes
 * for it were necessary but not causal, so it is worth stating as an invariant
 * rather than as a list of the particular styles that were wrong.
 *
 * `TodayScreen.test.tsx` asserts the same thing through the screen, but only
 * ever with `compactRows: true`, which is the default and the only value any
 * test sets. `compact` is a user setting, and the last regression here came
 * from flattening it — so the full-height row needs its own guard or the next
 * flattening is green.
 *
 * Style props are the strongest thing available: jest-expo runs no layout.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { AgendaItem } from '@/core/occurrence/agenda';
import { ThemeProvider } from '@/design/theme';
import { MIN_TARGET } from '@/design/tokens';
import { ChoreRow, SectionHeader, SubHeader } from './ChoreRow';

const ITEM = {
  occurrenceKey: 'v1:sheets',
  choreId: 'sheets',
  // Long enough to wrap, which is what made the reflow visible on the phone.
  choreTitle: 'Wash and change the spare room sheets',
  dueOn: '2026-07-30',
  status: 'overdue',
  daysOverdue: 14,
  missedBefore: 0,
  completedBy: null,
  assignee: { kind: 'anyone' },
} as unknown as AgendaItem;

const renderRow = (compact: boolean) =>
  render(
    <ThemeProvider>
      <ChoreRow
        item={ITEM}
        ink={null}
        turnLabel={null}
        scheduleLabel="Every 14 days"
        category={{ name: 'Cleaning', ink: 'blue' }}
        subtasks={[{ id: 's1', title: 'Strip the bed' }]}
        compact={compact}
        onToggle={jest.fn()}
        onOpen={jest.fn()}
      />
    </ThemeProvider>,
  );

/** Every style that can move something sideways. */
const horizontalStyleOf = (testID: string) => {
  const flat = StyleSheet.flatten(screen.getAllByTestId(testID)[0]?.props.style) as Record<
    string,
    unknown
  >;
  const keys = [
    'flex',
    'flexGrow',
    'flexShrink',
    'flexBasis',
    'minWidth',
    'maxWidth',
    'width',
    'marginLeft',
    'marginRight',
    'paddingLeft',
    'paddingRight',
  ];
  return Object.fromEntries(keys.map((key) => [key, flat[key]]));
};

const snapshot = () => [horizontalStyleOf('title-column'), horizontalStyleOf('steps-toggle')];

describe.each([
  ['compact', true],
  ['full-height', false],
])('a %s row', (_name, compact) => {
  it('lays out identically collapsed, expanded, and collapsed again', () => {
    renderRow(compact);

    const before = snapshot();
    fireEvent.press(screen.getByTestId('steps-toggle'));
    const expanded = snapshot();
    fireEvent.press(screen.getByTestId('steps-toggle'));
    const after = snapshot();

    expect(expanded).toEqual(before);
    expect(after).toEqual(before);
  });

  it('keeps the same lateness marker in both states', () => {
    /*
     * Not a style, so the assertion above cannot see it. Dropping "14d" on
     * expansion handed its width back to the title, and a two-line name became
     * one line at the moment of expanding — found by diffing screenshots off
     * the simulator, not here.
     *
     * A full-height row shows the full "14 days late" chip instead, and shows
     * it in both states; what matters either way is that expanding does not
     * change what the header line holds.
     */
    renderRow(compact);

    const marker = () => screen.queryAllByText(compact ? '14d' : /14 days late/).length;

    const before = marker();
    expect(before).toBeGreaterThan(0);

    fireEvent.press(screen.getByTestId('steps-toggle'));
    expect(marker()).toBe(before);

    fireEvent.press(screen.getByTestId('steps-toggle'));
    expect(marker()).toBe(before);
  });
});

describe('the chevron', () => {
  it('is at least 44pt of target on a compact row, despite a 20pt box', () => {
    // The compact row cannot afford a laid-out 44 square — it set the height of
    // every row on Today and took 44pt of width from the title — so the target
    // is bought back with hitSlop. See MIN_TARGET and tapTargets.test.ts.
    renderRow(true);

    const toggle = screen.getByTestId('steps-toggle');
    const style = StyleSheet.flatten(toggle.props.style) as { width: number; height: number };
    const slop = toggle.props.hitSlop as {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };

    expect(style.width + slop.left + slop.right).toBeGreaterThanOrEqual(44);
    expect(style.height + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  });

  it('is a plain 44pt box on a full-height row, which has the room', () => {
    renderRow(false);

    const style = StyleSheet.flatten(screen.getByTestId('steps-toggle').props.style) as {
      width: number;
      height: number;
    };

    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });
});

describe('a section header carrying a control', () => {
  it('gives it a real 44pt box rather than a small one wearing hitSlop', () => {
    /*
     * The fourth under-sized control this project has shipped, and the first
     * where the sidestep was deliberate: the earlier version set `height: 20`
     * with `hitSlop` 12 and a comment claiming that bought the target back.
     * It does not — the rows drawn after the header win the overlap, so the
     * reachable band was about 34pt and a low tap opened a chore.
     *
     * `minHeight` rather than the hitSlop sum, because that is what
     * `tapTargets.test.ts` reads and what a reader checking this later will
     * look for.
     */
    render(
      <ThemeProvider>
        <SectionHeader
          title="Doing today"
          count={3}
          action={{
            label: '⇅ Tasks first',
            accessibilityLabel: 'Show one-time tasks first',
            onPress: jest.fn(),
          }}
        />
      </ThemeProvider>,
    );

    const button = screen.getByRole('button', { name: 'Show one-time tasks first' });
    const style = StyleSheet.flatten(
      typeof button.props.style === 'function'
        ? button.props.style({ pressed: false })
        : button.props.style,
    ) as { minHeight?: number };

    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  it('leaves a header without a control alone', () => {
    // Every other caller — Today, Routines, "Coming up", "Done" — passes no
    // action, and none of them should grow by 17pt because the plan needed one.
    render(
      <ThemeProvider>
        <SectionHeader title="Coming up" count={2} />
      </ThemeProvider>,
    );

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a sub-header dot', () => {
  /*
   * The plan's flagged group is drawn in `colors.danger`, the same red as the
   * "!!" on its rows. It was passed as the nearest *ink* instead, which gave
   * two similar-but-different reds an inch apart under a comment claiming they
   * matched — and `rust` is an assignable member accent, so a household where
   * somebody picked it got a Flagged dot in their personal colour.
   *
   * Nothing pinned this: ignoring the prop entirely left all 1393 tests green.
   */
  const dotStyle = (element: ReturnType<typeof screen.getByTestId>) =>
    StyleSheet.flatten(element.props.style) as { backgroundColor?: string; borderRadius?: number };

  it('takes a resolved colour over the ink', () => {
    render(
      <ThemeProvider>
        <SubHeader title="Flagged" count={1} ink="rust" dot="#B3261E" testID="sub" />
      </ThemeProvider>,
    );

    const dot = screen.getByTestId('sub-dot', { includeHiddenElements: true });
    expect(dotStyle(dot).backgroundColor).toBe('#B3261E');
  });

  it('still uses the ink when no colour is given', () => {
    render(
      <ThemeProvider>
        <SubHeader title="Kitchen" count={1} ink="rust" testID="sub" />
      </ThemeProvider>,
    );

    const dot = screen.getByTestId('sub-dot', { includeHiddenElements: true });
    expect(dotStyle(dot).backgroundColor).not.toBe('#B3261E');
  });
});

describe('steps on the plan', () => {
  const row = (over: Partial<Parameters<typeof ChoreRow>[0]> = {}) => (
    <ThemeProvider>
      <ChoreRow
        item={ITEM}
        ink={null}
        turnLabel={null}
        scheduleLabel="Every 14 days"
        category={{ name: 'Cleaning', ink: 'blue' }}
        subtasks={[]}
        compact
        stepsOpenByDefault
        onToggle={jest.fn()}
        onOpen={jest.fn()}
        {...over}
      />
    </ThemeProvider>
  );

  it('opens the steps when they arrive after the row', () => {
    /*
     * Jake, on build 61: *"I'm still noticing chores with steps not always
     * being expanded to show the steps on the plan page."*
     *
     * `useState(…)` runs its argument on the first render only, and the steps
     * come from a query — so a row that mounted before `useSubtasks` resolved
     * saw none, seeded itself closed, and stayed closed once they landed. With
     * a warm cache the query is already settled, which is what made it "not
     * always".
     */
    const view = render(row({ subtasks: [] }));
    expect(screen.queryByText('Strip the bed')).toBeNull();

    view.rerender(row({ subtasks: [{ id: 's1', title: 'Strip the bed' }] }));

    expect(screen.getByText('Strip the bed')).toBeOnTheScreen();
  });

  it('still lets you fold them away, and stays folded', () => {
    // The override: once somebody has an opinion it outlives any later change
    // to the default. The second half of that was unasserted — a review showed
    // the test passed against a component that discarded the fold whenever the
    // step count changed.
    const view = render(row({ subtasks: [{ id: 's1', title: 'Strip the bed' }] }));
    expect(screen.getByText('Strip the bed')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('steps-toggle'));
    expect(screen.queryByText('Strip the bed')).toBeNull();

    view.rerender(
      row({
        subtasks: [
          { id: 's1', title: 'Strip the bed' },
          { id: 's2', title: 'Flip the mattress' },
        ],
      }),
    );

    expect(screen.queryByText('Strip the bed')).toBeNull();
    expect(screen.queryByText('Flip the mattress')).toBeNull();
  });

  it('folds back by itself when the last thing worth showing goes', () => {
    /*
     * `override` outlives the chevron, and the chevron goes when there is no
     * detail — so a row tapped open whose note was then cleared stayed expanded
     * around nothing with no control to fold it. A review found it pinned at a
     * 44pt minimum height over one line of text.
     */
    // Blank schedule label, as the plan passes: otherwise the schedule line is
    // itself a reason to keep the chevron.
    const view = render(row({ subtasks: [], notes: 'bring the small bin', scheduleLabel: '' }));
    fireEvent.press(screen.getByTestId('steps-toggle'));
    expect(screen.getByText('bring the small bin')).toBeOnTheScreen();

    const padding = () =>
      (StyleSheet.flatten(screen.getByTestId('row-body').props.style) as Record<string, unknown>)
        .paddingVertical;
    const expanded = padding();

    view.rerender(row({ subtasks: [], notes: null, scheduleLabel: '' }));

    expect(screen.queryByTestId('steps-toggle')).toBeNull();
    /*
     * Collapsed, not merely uncontrollable. Asserting the chevron's absence
     * alone passed against a row left pinned open around nothing — the actual
     * defect — because the chevron is gone either way. The row's own padding is
     * what says slim.
     */
    // 7 when slim, 8 when expanded on a compact row.
    expect(padding()).not.toBe(expanded);
    expect(padding()).toBe(7);
  });
});

describe('the expander on a row with nothing to expand', () => {
  /*
   * Jake: *"chores that will not show any additional information once expanded
   * do not need to have a button to expand them on the plan page. If all it
   * does is change the size of the cell there is no reason to have it."*
   */
  const bare = (over: Partial<Parameters<typeof ChoreRow>[0]> = {}) => (
    <ThemeProvider>
      <ChoreRow
        item={ITEM}
        ink={null}
        turnLabel={null}
        scheduleLabel=""
        category={null}
        subtasks={[]}
        compact
        onToggle={jest.fn()}
        onOpen={jest.fn()}
        {...over}
      />
    </ThemeProvider>
  );

  it('is not drawn at all', () => {
    render(bare());

    expect(screen.queryByTestId('steps-toggle')).toBeNull();
  });

  it('is drawn when there are steps', () => {
    render(bare({ subtasks: [{ id: 's1', title: 'Strip the bed' }] }));

    expect(screen.getByTestId('steps-toggle')).toBeOnTheScreen();
  });

  it('is drawn when there is a note', () => {
    render(bare({ notes: 'bring the small bin' }));

    expect(screen.getByTestId('steps-toggle')).toBeOnTheScreen();
  });

  it('is drawn when there is a schedule to show', () => {
    render(bare({ scheduleLabel: 'Every 14 days' }));

    expect(screen.getByTestId('steps-toggle')).toBeOnTheScreen();
  });

  it('is drawn when it is somebody’s turn', () => {
    render(bare({ turnLabel: 'Emily' }));

    expect(screen.getByTestId('steps-toggle')).toBeOnTheScreen();
  });

  it('is drawn when the chore is crucial', () => {
    // A clause a review found untested: dropping it left a crucial row with no
    // chevron and its "Crucial" chip unreachable on the plan.
    render(bare({ priority: 'crucial' }));

    expect(screen.getByTestId('steps-toggle')).toBeOnTheScreen();
  });

  it('is absent on a finished row that already says who did it', () => {
    /*
     * The other untested clause. The expanded branch suppresses the schedule
     * line in exactly this case, so there would be a chevron revealing nothing.
     */
    render(
      bare({
        scheduleLabel: 'Every 14 days',
        item: { ...ITEM, status: 'completed', completedBy: 'u1' } as never,
      }),
    );

    expect(screen.queryByTestId('steps-toggle')).toBeNull();
  });

  it('leaves its footprint behind so the title does not move', () => {
    /*
     * The control goes; its 20pt box stays. Without that, a row with no detail
     * hands 32pt back to its title — so titles end at different widths down a
     * list, and a row that gains steps a beat after mounting re-wraps its title
     * under your thumb. jest-expo does no layout, so this asserts the declared
     * size — an empty `View` in its place would hand the 32pt straight back.
     */
    render(bare());

    expect(screen.queryByTestId('steps-toggle')).toBeNull();
    const spacer = StyleSheet.flatten(screen.getByTestId('steps-spacer').props.style) as Record<
      string,
      unknown
    >;
    expect(spacer.width).toBe(20);
    expect(spacer.height).toBe(20);
  });

  it('is still drawn on a full-height row with steps', () => {
    // Non-compact rows show their detail already; the control is for the steps.
    render(bare({ compact: false, subtasks: [{ id: 's1', title: 'Strip the bed' }] }));

    expect(screen.getByTestId('steps-toggle')).toBeOnTheScreen();
  });
});
