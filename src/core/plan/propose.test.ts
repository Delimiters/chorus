import { civilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import { DAY_SIZE, proposeDay, type Candidate } from './propose';

const d = (s: string): CivilDate => civilDate(s);
const TODAY = d('2026-09-10');

const candidate = (over: Partial<Candidate> & { occurrenceKey: string }): Candidate => ({
  choreId: over.occurrenceKey,
  choreTitle: over.occurrenceKey,
  dueOn: TODAY,
  daysOverdue: 0,
  missedBefore: 0,
  recurring: true,
  ...over,
});

const none = new Set<string>();
const keys = (items: readonly Candidate[]) => items.map((i) => i.occurrenceKey);

describe('how big a day is', () => {
  it('offers five things, not fifty', () => {
    // The number is the entire product: an app that says "here is a day" is
    // doing the job, and one that says "here are fifty true facts" is what she
    // closed.
    const many = Array.from({ length: 30 }, (_, i) => candidate({ occurrenceKey: `k${i}` }));
    expect(proposeDay(many, { flagged: none, leftOver: none }).items).toHaveLength(DAY_SIZE);
  });

  it('offers fewer when there is less', () => {
    const two = [candidate({ occurrenceKey: 'a' }), candidate({ occurrenceKey: 'b' })];
    expect(proposeDay(two, { flagged: none, leftOver: none }).items).toHaveLength(2);
  });
});

describe('what gets offered first', () => {
  it('puts yesterday’s unfinished work above everything', () => {
    /*
     * You already decided it mattered and did not get to it — a stronger
     * signal than anything the app computes. Asserted against a rival that
     * wins on *every other* term (flagged, very late, repeatedly missed,
     * one-off), so this cannot pass by the leftover happening to score well.
     */
    const items = proposeDay(
      [
        candidate({
          occurrenceKey: 'rival',
          daysOverdue: 30,
          missedBefore: 5,
          recurring: false,
        }),
        candidate({ occurrenceKey: 'left' }),
      ],
      { flagged: new Set(['rival']), leftOver: new Set(['left']) },
    ).items;

    expect(keys(items)[0]).toBe('left');
  });

  it('puts a flagged chore above a merely late one', () => {
    // She said so, this week, in as many words. The rival is 30 days late,
    // which is the most lateness can ever contribute.
    const items = proposeDay(
      [
        candidate({ occurrenceKey: 'late', daysOverdue: 30 }),
        candidate({ occurrenceKey: 'flagged' }),
      ],
      { flagged: new Set(['flagged']), leftOver: none },
    ).items;

    expect(keys(items)[0]).toBe('flagged');
  });

  it('prefers a one-off task to a recurring chore that is equally late', () => {
    /*
     * "plant garden bed is not the same priority as car registration."
     * Missing the litter box is recoverable and comes back tomorrow; missing
     * the car inspection *is* the failure. Recurring volume burying one-off
     * stakes is the thing the proposal exists to stop.
     */
    const items = proposeDay(
      [
        candidate({ occurrenceKey: 'litter', daysOverdue: 3, recurring: true }),
        candidate({ occurrenceKey: 'registration', daysOverdue: 3, recurring: false }),
      ],
      { flagged: none, leftOver: none },
    ).items;

    expect(keys(items)[0]).toBe('registration');
  });

  it('prefers the later of two equally-classified things by due date', () => {
    const items = proposeDay(
      [
        candidate({ occurrenceKey: 'newer', dueOn: d('2026-09-09') }),
        candidate({ occurrenceKey: 'older', dueOn: d('2026-09-01') }),
      ],
      { flagged: none, leftOver: none },
    ).items;

    expect(keys(items)).toEqual(['older', 'newer']);
  });

  it('is deterministic when everything ties', () => {
    // A tie resolved by array order means the proposal changes when the
    // database feels like returning rows differently, and "Start the day"
    // stops being the same day twice.
    const tied = [
      candidate({ occurrenceKey: 'c', choreTitle: 'C' }),
      candidate({ occurrenceKey: 'a', choreTitle: 'A' }),
      candidate({ occurrenceKey: 'b', choreTitle: 'B' }),
    ];
    expect(keys(proposeDay(tied, { flagged: none, leftOver: none }).items)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('lateness is capped', () => {
  it('does not let an ancient chore own the screen forever', () => {
    /*
     * Uncapped, something ninety days overdue outranks everything for the rest
     * of its life — and a chore ignored for three months usually needs
     * deleting rather than doing. Two flagged items must both outrank it.
     */
    const items = proposeDay(
      [
        candidate({ occurrenceKey: 'ancient', daysOverdue: 90 }),
        candidate({ occurrenceKey: 'f1' }),
        candidate({ occurrenceKey: 'f2' }),
      ],
      { flagged: new Set(['f1', 'f2']), leftOver: none },
    ).items;

    expect(keys(items).slice(0, 2).sort()).toEqual(['f1', 'f2']);
  });

  it('still ranks more-late above less-late below the cap', () => {
    // The cap must not flatten ordinary lateness into a single bucket.
    const items = proposeDay(
      [
        candidate({ occurrenceKey: 'a-bit', daysOverdue: 2 }),
        candidate({ occurrenceKey: 'quite', daysOverdue: 20 }),
      ],
      { flagged: none, leftOver: none },
    ).items;

    expect(keys(items)[0]).toBe('quite');
  });
});

describe('repeatedly missed is not the same as very late', () => {
  it('surfaces a chore that keeps being skipped', () => {
    // A weekly chore missed four times running is a small persistent failure
    // the backlog is not surfacing, and it will keep happening.
    /*
     * Titles chosen to *contradict* the expected answer.
     *
     * The first version used 'always-missed' and 'once-late', which sort in
     * exactly the order the weight is supposed to produce — so zeroing the
     * weight left the alphabetical tiebreak giving the same result and the
     * test passed against a deleted feature. Confirmed by deleting it.
     */
    const items = proposeDay(
      [
        candidate({ occurrenceKey: 'a-rarely', choreTitle: 'A rarely missed', daysOverdue: 5 }),
        candidate({
          occurrenceKey: 'z-always',
          choreTitle: 'Z always missed',
          daysOverdue: 5,
          missedBefore: 4,
        }),
      ],
      { flagged: none, leftOver: none },
    ).items;

    expect(keys(items)[0]).toBe('z-always');
  });
});

describe('the line explaining the day', () => {
  it('counts what it actually chose, not what it was offered', () => {
    /*
     * A proposal that says "2 late" while showing none is worse than saying
     * nothing — and it is the first thing that rots when the weights change.
     * Here twenty late chores are offered and only five fit.
     */
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate({ occurrenceKey: `k${i}`, daysOverdue: 3 }),
    );
    expect(proposeDay(many, { flagged: none, leftOver: none }).reason).toBe('5 late');
  });

  it('names each reason once, in order', () => {
    const items = [
      candidate({ occurrenceKey: 'left' }),
      candidate({ occurrenceKey: 'flag' }),
      candidate({ occurrenceKey: 'late', daysOverdue: 4 }),
      candidate({ occurrenceKey: 'due' }),
    ];
    const proposal = proposeDay(items, {
      flagged: new Set(['flag']),
      leftOver: new Set(['left']),
    });

    expect(proposal.reason).toBe('1 from yesterday, 1 you flagged, 1 late, 1 due');
  });

  it('counts a leftover once, even when it is also flagged and late', () => {
    // Otherwise the line reads "1 from yesterday, 1 you flagged, 1 late" for a
    // single chore, and the numbers sum to more than the day.
    const proposal = proposeDay([candidate({ occurrenceKey: 'x', daysOverdue: 9 })], {
      flagged: new Set(['x']),
      leftOver: new Set(['x']),
    });

    expect(proposal.reason).toBe('1 from yesterday');
  });

  it('says so plainly when there is nothing', () => {
    expect(proposeDay([], { flagged: none, leftOver: none }).reason).toBe(
      'Nothing needs doing today.',
    );
  });
});
