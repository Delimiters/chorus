import { civilDate } from '../civil/date';
import { somedayKeyOf } from '../recurrence/period';
import { somedayAgenda, type SomedayChore, type SomedayCompletion } from './someday';

const TODAY = civilDate('2026-09-22');

const chore = (id: string, over: Partial<SomedayChore> = {}): SomedayChore => ({
  id,
  title: id,
  scheduleKind: 'unscheduled',
  ...over,
});

const done = (choreId: string, on: string): SomedayCompletion => ({
  choreId,
  completedOn: civilDate(on),
  completedBy: 'user-me',
});

describe('which chores get a row', () => {
  it('takes the undated ones', () => {
    const rows = somedayAgenda([chore('loft')], [], TODAY);

    expect(rows.map((r) => r.choreId)).toEqual(['loft']);
  });

  it('leaves scheduled work alone, which is the whole boundary', () => {
    /*
     * A dated chore already has real occurrences from `expand`. Synthesising a
     * second, undated row for it would put the same chore on the screen twice
     * — once as work with a deadline and once as work without one.
     */
    const rows = somedayAgenda(
      [
        chore('loft'),
        chore('dishes', { scheduleKind: 'daily' }),
        chore('tax', { scheduleKind: 'once' }),
      ],
      [],
      TODAY,
    );

    expect(rows.map((r) => r.choreId)).toEqual(['loft']);
  });
});

describe('the key it uses', () => {
  it('is the one the Chores tab writes, so a tick means the same thing on both', () => {
    /*
     * The point of the whole module. `useToggleSomeday` completes against
     * `somedayKeyOf`, so a row built with any other key would tick off into a
     * different database row and the two screens would disagree about whether
     * the loft had been cleared.
     */
    const [row] = somedayAgenda([chore('loft')], [], TODAY);

    expect(row?.occurrenceKey).toBe(somedayKeyOf('loft'));
  });
});

describe('what a completion does to the row', () => {
  it('marks it done and says when', () => {
    const [row] = somedayAgenda([chore('loft')], [done('loft', '2026-03-03')], TODAY);

    expect(row?.status).toBe('completed');
    expect(row?.completedOn).toBe(civilDate('2026-03-03'));
    expect(row?.completedBy).toBe('user-me');
  });

  it('leaves an untouched chore due, not overdue', () => {
    /*
     * "Overdue" would be a reproach for missing a deadline nobody set — the
     * defining property of an undated chore is that there was never a date to
     * be late for.
     */
    const [row] = somedayAgenda([chore('loft')], [], TODAY);

    expect(row?.status).toBe('due');
    expect(row?.daysOverdue).toBe(0);
  });

  it('does not attribute a completion to the wrong chore', () => {
    // One of each, because a fixture with a single chore passes against an
    // implementation that ignores `choreId` entirely.
    const rows = somedayAgenda([chore('loft'), chore('shed')], [done('shed', '2026-03-03')], TODAY);

    expect(rows.find((r) => r.choreId === 'loft')?.status).toBe('due');
    expect(rows.find((r) => r.choreId === 'shed')?.status).toBe('completed');
  });

  it('takes the latest of two completions rather than whichever arrived first', () => {
    // There should only ever be one — a Someday chore has a single key — but
    // arrival order must not be what decides the date on screen.
    const [row] = somedayAgenda(
      [chore('loft')],
      [done('loft', '2026-03-03'), done('loft', '2026-05-01')],
      TODAY,
    );

    expect(row?.completedOn).toBe(civilDate('2026-05-01'));
  });
});

describe('the dates it carries', () => {
  it('uses the day being viewed for work still outstanding', () => {
    // The column is not nullable and "due whenever you get to it" is the
    // honest reading. It is not a claim that the chore is due today.
    const [row] = somedayAgenda([chore('loft')], [], TODAY);

    expect(row?.dueOn).toBe(TODAY);
  });

  it('uses the completion date once it is done, so history reads correctly', () => {
    // Otherwise "we finally cleared the loft" would be filed under whatever
    // day you happened to be looking at the list.
    const [row] = somedayAgenda([chore('loft')], [done('loft', '2026-03-03')], TODAY);

    expect(row?.dueOn).toBe(civilDate('2026-03-03'));
  });

  it('is not flexible work, which has a window and a different heading', () => {
    const [row] = somedayAgenda([chore('loft')], [], TODAY);

    expect(row?.flexibleFrom).toBe(row?.flexibleUntil);
  });
});

describe('who it belongs to', () => {
  it('is nobody’s turn', () => {
    /*
     * A chore with no date has no rotation to be part of, so there is no turn
     * to resolve. Claiming one would put a name on work nobody was assigned —
     * and on the plan, a named turn is how work gets silently reassigned.
     */
    const [row] = somedayAgenda([chore('loft')], [], TODAY);

    expect(row?.assignee).toEqual({ kind: 'anyone' });
  });
});
