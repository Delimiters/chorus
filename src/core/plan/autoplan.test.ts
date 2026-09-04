import { civilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import { autoPlannable, belongsTo } from './autoplan';

const TODAY = civilDate('2026-09-04');
const ME = 'user-me';
const THEM = 'user-them';

const item = (
  id: string,
  over: Partial<{ dueOn: CivilDate; status: string; assignee: unknown }> = {},
) =>
  ({
    occurrenceKey: `v1:${id}`,
    dueOn: TODAY,
    status: 'due',
    assignee: { kind: 'anyone' },
    ...over,
  }) as Parameters<typeof belongsTo>[0];

const keys = (items: readonly { occurrenceKey: string }[]) => items.map((i) => i.occurrenceKey);
const NONE: ReadonlySet<string> = new Set();
const always = () => true;

describe('whose work an occurrence is', () => {
  it('counts unassigned work for everybody', () => {
    // "Anyone" means it is on both lists until one of you does it.
    expect(belongsTo(item('a'), ME)).toBe(true);
    expect(belongsTo(item('a'), THEM)).toBe(true);
  });

  it('counts assigned work only for that person', () => {
    const mine = item('a', { assignee: { kind: 'member', memberId: ME } });
    expect(belongsTo(mine, ME)).toBe(true);
    expect(belongsTo(mine, THEM)).toBe(false);
  });
});

describe('what a day fills itself with', () => {
  it('takes what is due and what is late', () => {
    const day = [item('due'), item('late', { status: 'overdue', dueOn: civilDate('2026-08-30') })];
    expect(
      keys(autoPlannable(day, { userId: ME, on: TODAY, planned: NONE, recurring: always })),
    ).toEqual(['v1:due', 'v1:late']);
  });

  it('leaves out work that is not due yet', () => {
    /*
     * `showFrom` marks a chore `due` before its date arrives, so the status
     * test alone lets next week onto today — which is the wall of rows the
     * plan exists to avoid.
     */
    const day = [item('early', { dueOn: civilDate('2026-09-20') })];
    expect(autoPlannable(day, { userId: ME, on: TODAY, planned: NONE, recurring: always })).toEqual(
      [],
    );
  });

  it('leaves out finished and skipped work', () => {
    const day = [item('done', { status: 'completed' }), item('nope', { status: 'skipped' })];
    expect(autoPlannable(day, { userId: ME, on: TODAY, planned: NONE, recurring: always })).toEqual(
      [],
    );
  });

  it('leaves out what is already on the plan', () => {
    const day = [item('a'), item('b')];
    const planned = new Set(['v1:a']);
    expect(keys(autoPlannable(day, { userId: ME, on: TODAY, planned, recurring: always }))).toEqual(
      ['v1:b'],
    );
  });

  it('leaves out one-off work, which is chosen rather than assumed', () => {
    const day = [item('a'), item('b')];
    const recurring = (i: { occurrenceKey: string }) => i.occurrenceKey !== 'v1:b';
    expect(keys(autoPlannable(day, { userId: ME, on: TODAY, planned: NONE, recurring }))).toEqual([
      'v1:a',
    ]);
  });

  it('leaves out the other person&apos;s assigned work', () => {
    const day = [item('mine'), item('theirs', { assignee: { kind: 'member', memberId: THEM } })];
    expect(
      keys(autoPlannable(day, { userId: ME, on: TODAY, planned: NONE, recurring: always })),
    ).toEqual(['v1:mine']);
  });

  it('answers for a person who is not the one asking', () => {
    /*
     * The whole reason this is shared. The plan screen previews a housemate's
     * day with the same rule that will fill it when they open the app — two
     * copies of it would drift, and the drift would be invisible.
     */
    const day = [
      item('shared'),
      item('theirs', { assignee: { kind: 'member', memberId: THEM } }),
      item('mine', { assignee: { kind: 'member', memberId: ME } }),
    ];
    expect(
      keys(autoPlannable(day, { userId: THEM, on: TODAY, planned: NONE, recurring: always })),
    ).toEqual(['v1:shared', 'v1:theirs']);
  });
});
