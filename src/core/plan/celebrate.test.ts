import { celebrationFor, type DayFinished } from './celebrate';

const day = (over: Partial<DayFinished> = {}): DayFinished => ({
  planned: 3,
  titles: ['Dishes', 'Trash', 'Litter'],
  worstLateness: 0,
  latestTitle: null,
  bothFinished: false,
  theirCount: 0,
  ...over,
});

describe('an ordinary finished day', () => {
  it('is quiet', () => {
    // Confetti on every finished day is delightful in week one and a toll by
    // week four. The common case must stay the cheap one.
    expect(celebrationFor(day())?.tone).toBe('quiet');
  });

  it('says how many', () => {
    expect(celebrationFor(day())?.detail).toBe('All 3, done. Nothing else is planned.');
  });

  it('does not say "All 1"', () => {
    expect(celebrationFor(day({ planned: 1, titles: ['Dishes'] }))?.detail).toBe(
      'One thing, done.',
    );
  });
});

describe('nothing to celebrate', () => {
  it('says nothing for a day nobody planned', () => {
    /*
     * The vacuous input: "everything is done" is trivially true of an empty
     * plan, and it is the state every morning starts in. Congratulating
     * somebody for choosing nothing devalues the moment on the days it is
     * earned.
     */
    expect(celebrationFor(day({ planned: 0, titles: [] }))).toBeNull();
  });
});

describe('days worth marking', () => {
  it('celebrates you both finishing, above everything else', () => {
    /*
     * Asserted against a day that *also* qualifies as heavy and badly late, so
     * this cannot pass by falling through to another loud branch. The shared
     * one has to win on its own merits — it is the only trigger a solo to-do
     * list structurally cannot offer.
     */
    const both = day({
      planned: 8,
      worstLateness: 20,
      latestTitle: 'Kill wasps',
      bothFinished: true,
      theirCount: 2,
    });
    const celebration = celebrationFor(both);

    expect(celebration?.tone).toBe('loud');
    expect(celebration?.headline).toBe('You both finished.');
    expect(celebration?.detail).toBe('10 things between you.');
  });

  it('names the badly late one rather than praising in general', () => {
    // "Great job" is hollow; naming the thing you had been avoiding for three
    // weeks is being noticed. The app already knows which it was.
    const celebration = celebrationFor(
      day({ worstLateness: 20, latestTitle: 'Get car inspected' }),
    );

    expect(celebration?.tone).toBe('loud');
    expect(celebration?.detail).toBe('Including Get car inspected — 20 days late.');
  });

  it('leaves a mildly late day quiet', () => {
    // Six days is not the same as three weeks. If merely-late qualified, most
    // days would be loud and the tier would mean nothing.
    expect(celebrationFor(day({ worstLateness: 6, latestTitle: 'Dishes' }))?.tone).toBe('quiet');
  });

  it('celebrates a heavy day', () => {
    expect(celebrationFor(day({ planned: 6 }))?.tone).toBe('loud');
  });

  it('leaves five things quiet', () => {
    // The boundary in the other direction, so "heavy" cannot quietly mean
    // "any day at all".
    expect(celebrationFor(day({ planned: 5 }))?.tone).toBe('quiet');
  });

  it('does not go loud for lateness it cannot name', () => {
    // `latestTitle` null means the detail line would read "Including undefined".
    expect(celebrationFor(day({ worstLateness: 30, latestTitle: null }))?.tone).toBe('quiet');
  });
});
