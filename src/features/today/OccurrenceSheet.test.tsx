/**
 * The occurrence sheet.
 *
 * Two things are worth testing here and one of them is the copy. Skip and
 * reschedule are the pair users confuse, and the difference is invisible from
 * the buttons alone — so the sheet states what each does to the *next*
 * occurrence, and these tests hold that wording in place. Wording that drifts
 * out of step with behaviour is worse than none, because it is believed.
 *
 * The other is that the sheet offers *undo* for both, and offers it only when
 * there is something to undo.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { civilDate } from '@/core/civil/date';
import type { CivilDate } from '@/core/civil/types';
import type { AgendaItem } from '@/core/occurrence/agenda';
import { ThemeProvider } from '@/design/theme';
import { OccurrenceSheet } from './OccurrenceSheet';

const TODAY = civilDate('2026-07-30');

const item = (over: Partial<AgendaItem> = {}): AgendaItem =>
  ({
    choreId: 'dishes',
    choreTitle: 'Dishes',
    occurrenceKey: 'v1:dishes:2026-07-30:0:-',
    dueOn: TODAY,
    flexibleFrom: TODAY,
    flexibleUntil: TODAY,
    periodKey: '2026-07-30',
    slot: 0,
    subject: null,
    occurrenceIndex: 0,
    status: 'due',
    assignee: { kind: 'anyone' },
    completedOn: null,
    completedBy: null,
    daysLate: 0,
    rescheduled: false,
    originalDueOn: null,
    displaced: false,
    missedBefore: 0,
    daysOverdue: 0,
    ...over,
  }) as AgendaItem;

function renderSheet(target: AgendaItem | null = item()) {
  const handlers = {
    onClose: jest.fn(),
    onToggleComplete: jest.fn(),
    onSkip: jest.fn(),
    onReschedule: jest.fn(),
    onClearException: jest.fn(),
    onEditChore: jest.fn(),
  };
  return {
    ...handlers,
    rendered: render(
      <ThemeProvider>
        <OccurrenceSheet item={target} today={TODAY} weekStartsOn={0} {...handlers} />
      </ThemeProvider>,
    ),
  };
}

describe('what the sheet offers', () => {
  it('names the chore and when it is due', async () => {
    const h = renderSheet();
    await h.rendered;
    expect(screen.getByRole('header', { name: 'Dishes' })).toBeOnTheScreen();
    expect(screen.getByText('Due Thu 30 Jul')).toBeOnTheScreen();
  });

  it('completes and closes', async () => {
    const h = renderSheet();
    await h.rendered;
    await fireEvent.press(screen.getByRole('button', { name: /Mark as done/ }));
    expect(h.onToggleComplete).toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalled();
  });

  it('offers to un-complete something already done', async () => {
    const h = renderSheet(item({ status: 'completed', completedOn: TODAY, completedBy: 'me' }));
    await h.rendered;
    expect(screen.getByRole('button', { name: /Mark as not done/ })).toBeOnTheScreen();
  });

  it('opens the chore editor, and says that edits are not just for this one', async () => {
    const h = renderSheet();
    await h.rendered;
    // The distinction the sheet exists to make: this occurrence versus the rule.
    expect(screen.getByText(/Changes every time it comes round/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /Edit the chore/ }));
    expect(h.onEditChore).toHaveBeenCalledWith('dishes');
  });
});

describe('skip and reschedule are different, and the sheet says how', () => {
  it('says a skip leaves the next one alone', async () => {
    const h = renderSheet();
    await h.rendered;
    expect(screen.getByText(/doesn't count. The next one comes as scheduled/)).toBeOnTheScreen();
  });

  it('skips this occurrence only', async () => {
    const h = renderSheet();
    await h.rendered;
    await fireEvent.press(screen.getByRole('button', { name: /Skip it/ }));
    expect(h.onSkip).toHaveBeenCalledWith(expect.objectContaining({ choreId: 'dishes' }));
    expect(h.onReschedule).not.toHaveBeenCalled();
  });

  it('says a move does not hand the chore to somebody else', async () => {
    // The reason this sentence exists: a reschedule keeps the occurrence's
    // identity, so the rotation turn travels with it. Users assume the opposite.
    const h = renderSheet();
    await h.rendered;
    await fireEvent.press(screen.getByRole('button', { name: /Move it\./ }));
    expect(screen.getByText(/Whose turn it is does not change/)).toBeOnTheScreen();
  });

  it('moves it to the chosen date', async () => {
    const h = renderSheet();
    await h.rendered;
    await fireEvent.press(screen.getByRole('button', { name: /Move it\./ }));
    await fireEvent.press(screen.getByRole('button', { name: 'New date: Next week' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Move to/ }));

    expect(h.onReschedule).toHaveBeenCalledWith(
      expect.objectContaining({ choreId: 'dishes' }),
      '2026-08-02' as CivilDate,
    );
    expect(h.onSkip).not.toHaveBeenCalled();
  });

  it('can be backed out of without moving anything', async () => {
    const h = renderSheet();
    await h.rendered;
    await fireEvent.press(screen.getByRole('button', { name: /Move it\./ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(h.onReschedule).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Skip it/ })).toBeOnTheScreen();
  });
});

describe('undoing a deviation', () => {
  it('offers to un-skip a skipped occurrence, and not to skip it again', async () => {
    const h = renderSheet(item({ status: 'skipped' }));
    await h.rendered;
    expect(screen.getByRole('button', { name: /Un-skip it/ })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Skip it/ })).toBeNull();
  });

  it('offers to put a moved occurrence back, naming where it came from', async () => {
    const h = renderSheet(
      item({
        dueOn: civilDate('2026-08-05'),
        rescheduled: true,
        originalDueOn: TODAY,
        status: 'upcoming',
      }),
    );
    await h.rendered;
    expect(screen.getByText('Moved to Wed 5 Aug, from Thu 30 Jul')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /Put it back/ }));
    expect(h.onClearException).toHaveBeenCalled();
  });

  it('does not offer undo when there is nothing to undo', async () => {
    const h = renderSheet();
    await h.rendered;
    expect(screen.queryByRole('button', { name: /Un-skip|Put it back/ })).toBeNull();
  });
});

describe('the quiet marker', () => {
  it('mentions a single missed occurrence without scolding', async () => {
    const h = renderSheet(item({ missedBefore: 1 }));
    await h.rendered;
    expect(screen.getByText('The last one was missed.')).toBeOnTheScreen();
  });

  it('counts several', async () => {
    const h = renderSheet(item({ missedBefore: 3 }));
    await h.rendered;
    expect(screen.getByText('The last 3 were missed.')).toBeOnTheScreen();
  });

  it('says nothing when nothing was missed', async () => {
    const h = renderSheet();
    await h.rendered;
    expect(screen.queryByText(/were missed|was missed/)).toBeNull();
  });
});

describe('when nothing is open', () => {
  it('renders no sheet content at all', async () => {
    const h = renderSheet(null);
    await h.rendered;
    expect(screen.queryByRole('button', { name: /Skip it/ })).toBeNull();
  });
});
