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
import { ChoreRow, SectionHeader } from './ChoreRow';

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
