import { describe, expect, it } from '@jest/globals';

import type { CivilDate } from '../civil/types';
import { dropReassignedAutoRows } from './reassigned';
import type { PlannedItem } from './plan';

const TODAY = '2026-11-02' as CivilDate;
const JAKE = 'jake';
const EMILY = 'emily';

interface Row {
  readonly occurrenceKey: string;
  readonly choreId: string;
  readonly status: string;
  readonly dueOn: CivilDate;
  readonly assignee: { readonly kind: string; readonly memberId?: string };
}

/**
 * A matched row, as `planFor` hands it over.
 *
 * `addedBy` rides on the row rather than being looked up from an entry list,
 * which is what the second review round changed: the same occurrence key
 * appears on several of the eight days fetched, and a map keyed on the
 * occurrence alone took whichever duplicate came last — entries arrive ordered
 * by position, not by date, so "last" was arbitrary. `planFor` is the only
 * place that knows which entry won.
 *
 * Defaults to the automatic fill, because that is the case with a decision in
 * it; a deliberate row is kept unconditionally.
 */
const row = (
  key: string,
  assignee: Row['assignee'],
  addedBy: string | null = null,
): PlannedItem<Row> => ({
  position: 1,
  addedBy,
  item: { occurrenceKey: key, choreId: key, status: 'due', dueOn: TODAY, assignee },
});

const member = (id: string) => ({ kind: 'member', memberId: id }) as const;
const keys = (rows: readonly PlannedItem<Row>[]) => rows.map((r) => r.item.occurrenceKey);

describe('a chore reassigned since the fill put it on a day', () => {
  it("drops an automatic row that is now somebody else's", () => {
    /*
     * The live case, measured the day it was reported: of 208 plan rows for
     * that day exactly one sat on the wrong person's day — "Water Indoor
     * Plants - Upstairs", on Jake's, assigned to Emily. The fill added it at
     * 13:25 while the chore was still his; she made it hers afterwards and
     * nothing revisited the row.
     *
     * Two rows and only one dropped, so this cannot pass by everything going.
     */
    const planned = [row('mine', member(JAKE)), row('hers', member(EMILY))];

    expect(keys(dropReassignedAutoRows(planned, JAKE))).toEqual(['mine']);
  });

  it('keeps a row a person added, whoever the chore belongs to', () => {
    /*
     * The constraint that rules out the obvious fix, in Jake's own words long
     * before any of this: *"I should be able to add it to my own plan even if
     * it's assigned to emily"*. Helping with your housemate's chore is a thing
     * people do.
     *
     * Same fixture as above with one field changed, so it cannot pass by being
     * a case where nothing would have been dropped anyway.
     */
    const planned = [row('mine', member(JAKE)), row('hers', member(EMILY), JAKE)];

    expect(keys(dropReassignedAutoRows(planned, JAKE))).toEqual(['mine', 'hers']);
  });

  it('keeps a row added by the housemate onto your day', () => {
    /*
     * `added_by` records the actor, so this is "Emily added it to Jake's day".
     * Either way it is non-null, which is the only thing this rule asks:
     * somebody decided.
     */
    const planned = [row('hers', member(EMILY), EMILY)];

    expect(keys(dropReassignedAutoRows(planned, JAKE))).toEqual(['hers']);
  });

  it('keeps shared work on both days', () => {
    // `anyone` belongs to everybody until one of them does it.
    const planned = [row('shared', { kind: 'anyone' })];

    expect(keys(dropReassignedAutoRows(planned, JAKE))).toEqual(['shared']);
    expect(keys(dropReassignedAutoRows(planned, EMILY))).toEqual(['shared']);
  });

  it('keeps an unassignable row rather than hiding it from everyone', () => {
    /*
     * A rotation with no segment covering the date resolves to `unassignable`,
     * which belongs to nobody — so a strict `belongsTo` reading is false for
     * *both* people and the row vanishes from the household. Work that exists
     * and neither person can see is worse than the bug being fixed. This test
     * is what caught that in the first implementation.
     */
    for (const reason of ['no-applicable-segment', 'empty-roster'] as const) {
      const planned = [row('orphan', { kind: 'unassignable', reason } as never)];
      expect(keys(dropReassignedAutoRows(planned, JAKE))).toEqual(['orphan']);
      expect(keys(dropReassignedAutoRows(planned, EMILY))).toEqual(['orphan']);
    }
  });

  it('keeps a kind it has never heard of', () => {
    /*
     * Default-keep rather than default-drop. A new assignment kind should make
     * rows linger visibly, not disappear silently, until somebody teaches this
     * function about it.
     */
    const planned = [row('future', { kind: 'by-coin-toss' } as never)];

    expect(keys(dropReassignedAutoRows(planned, JAKE))).toEqual(['future']);
  });

  it('leaves a day where nothing moved exactly as it was', () => {
    const planned = [
      row('a', { kind: 'anyone' }),
      row('b', member(JAKE)),
      row('c', { kind: 'anyone' }, JAKE),
    ];

    expect(keys(dropReassignedAutoRows(planned, JAKE))).toEqual(['a', 'b', 'c']);
  });
});
