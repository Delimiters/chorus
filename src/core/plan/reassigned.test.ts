import { describe, expect, it } from '@jest/globals';

import type { CivilDate } from '../civil/types';
import { dropReassignedAutoRows } from './reassigned';
import type { PlanEntry, PlannedItem } from './plan';

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

const item = (key: string, assignee: Row['assignee']): PlannedItem<Row> => ({
  position: 1,
  item: { occurrenceKey: key, choreId: key, status: 'due', dueOn: TODAY, assignee },
});

const entry = (key: string, addedBy: string | null): PlanEntry => ({
  occurrenceKey: key,
  choreId: key,
  plannedFor: TODAY,
  position: 1,
  addedBy,
});

const keys = (rows: readonly PlannedItem<Row>[]) => rows.map((r) => r.item.occurrenceKey);

describe('a chore that has been reassigned since the fill added it', () => {
  it("drops an automatic row that is now somebody else's", () => {
    /*
     * The live case, measured the day it was reported: of 208 plan rows for
     * that day exactly one sat on the wrong person's day — "Water Indoor
     * Plants - Upstairs", on Jake's, assigned to Emily. The fill added it at
     * 13:25 while the chore was still his to do; she made it hers alone
     * afterwards, and nothing revisited the row.
     */
    const planned = [
      item('mine', { kind: 'member', memberId: JAKE }),
      item('hers', { kind: 'member', memberId: EMILY }),
    ];
    const entries = [entry('mine', null), entry('hers', null)];

    expect(keys(dropReassignedAutoRows(planned, entries, JAKE))).toEqual(['mine']);
  });

  it('keeps a row a person deliberately added, whoever the chore belongs to', () => {
    /*
     * The constraint that rules out the obvious fix, in Jake's own words
     * before any of this was built: *"I should be able to add it to my own
     * plan even if it's assigned to emily"*. Helping with your housemate's
     * chore is a thing people do, and a deliberate decision is not the app's
     * to overrule.
     *
     * Same fixture as above with one field changed, so this cannot pass by
     * being a case where nothing would have been dropped anyway.
     */
    const planned = [
      item('mine', { kind: 'member', memberId: JAKE }),
      item('hers', { kind: 'member', memberId: EMILY }),
    ];
    const entries = [entry('mine', null), entry('hers', JAKE)];

    expect(keys(dropReassignedAutoRows(planned, entries, JAKE))).toEqual(['mine', 'hers']);
  });

  it('keeps shared work on both days', () => {
    // `anyone` belongs to everybody until one of them does it — the rule the
    // rest of the plan already follows.
    const planned = [item('shared', { kind: 'anyone' })];
    const entries = [entry('shared', null)];

    expect(keys(dropReassignedAutoRows(planned, entries, JAKE))).toEqual(['shared']);
    expect(keys(dropReassignedAutoRows(planned, entries, EMILY))).toEqual(['shared']);
  });

  it('keeps a row whose entry says nothing about who chose it', () => {
    /*
     * `undefined` rather than `null` — a caller that has not threaded
     * `addedBy` through. Treated as deliberate on purpose: showing one extra
     * row is recoverable by the person looking at it, and work silently
     * disappearing is not.
     */
    const planned = [item('hers', { kind: 'member', memberId: EMILY })];
    const entries = [{ occurrenceKey: 'hers', choreId: 'hers', plannedFor: TODAY, position: 1 }];

    expect(keys(dropReassignedAutoRows(planned, entries, JAKE))).toEqual(['hers']);
  });

  it('keeps an unassignable row rather than quietly binning it', () => {
    /*
     * A rotation with no segment covering the date resolves to
     * `unassignable`, which belongs to nobody — so `belongsTo` is false for
     * both people and a strict reading would hide it from everyone. That is
     * the worst outcome: work that exists and that neither person can see.
     * Left visible, and the warning in the chore's own editor is what says
     * something is wrong.
     */
    const planned = [item('orphan', { kind: 'unassignable' })];
    const entries = [entry('orphan', null)];

    expect(keys(dropReassignedAutoRows(planned, entries, JAKE))).toEqual(['orphan']);
  });

  it('leaves an untouched day exactly as it was', () => {
    const planned = [
      item('a', { kind: 'anyone' }),
      item('b', { kind: 'member', memberId: JAKE }),
      item('c', { kind: 'anyone' }),
    ];
    const entries = [entry('a', null), entry('b', null), entry('c', JAKE)];

    expect(keys(dropReassignedAutoRows(planned, entries, JAKE))).toEqual(['a', 'b', 'c']);
  });
});
