import { civilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import {
  nextPosition,
  planFor,
  positionBetween,
  progressOf,
  unfinishedBefore,
  type PlanEntry,
  type Plannable,
} from './plan';

const d = (s: string): CivilDate => civilDate(s);
const TODAY = d('2026-08-27');
const YESTERDAY = d('2026-08-26');

const entry = (key: string, position: number, plannedFor: CivilDate = TODAY): PlanEntry => ({
  occurrenceKey: key,
  choreId: key.split(':')[0] ?? key,
  plannedFor,
  position,
});

const item = (key: string, status = 'due'): Plannable => ({
  occurrenceKey: key,
  choreId: key.split(':')[0] ?? key,
  status,
});

describe("today's plan", () => {
  it('orders by position, not by the order entries arrive', () => {
    /*
     * Positions deliberately contradict the alphabet.
     *
     * The first version used a=1, b=2, c=3, so the key tiebreak alone produced
     * the same answer and the test passed with the position comparator
     * neutered. Confirmed by neutering it. Here the expected order is b, c, a
     * — which only position ordering can produce.
     */
    const entries = [entry('a', 30), entry('c', 20), entry('b', 10)];
    const planned = planFor(entries, TODAY, [item('a'), item('b'), item('c')]);
    expect(planned.map((p) => p.item.occurrenceKey)).toEqual(['b', 'c', 'a']);
  });

  it('holds only the day asked for', () => {
    const entries = [entry('a', 1), entry('b', 1, YESTERDAY)];
    const planned = planFor(entries, TODAY, [item('a'), item('b')]);
    expect(planned.map((p) => p.item.occurrenceKey)).toEqual(['a']);
  });

  it('drops an entry whose occurrence no longer exists', () => {
    /*
     * Real cases: the chore was archived, its schedule was edited, or the
     * occurrence was rescheduled and its key changed. A planned row with
     * nothing behind it cannot be ticked, so rendering it would offer an
     * action that does nothing.
     */
    const entries = [entry('a', 1), entry('gone', 2)];
    const planned = planFor(entries, TODAY, [item('a')]);
    expect(planned.map((p) => p.item.occurrenceKey)).toEqual(['a']);
  });

  it('breaks a tie deterministically rather than arbitrarily', () => {
    // Two rows can share a position after enough averaging, or if two phones
    // wrote at once. Without the tiebreak the order would depend on `sort`
    // stability over an input whose order is the database's business.
    const entries = [entry('b', 1), entry('a', 1)];
    const planned = planFor(entries, TODAY, [item('a'), item('b')]);
    expect(planned.map((p) => p.item.occurrenceKey)).toEqual(['a', 'b']);
  });
});

describe('adding to the day', () => {
  it('puts a new one at the end', () => {
    // Something you just chose is not automatically more urgent than what you
    // chose a minute ago.
    expect(nextPosition([entry('a', 1), entry('b', 5)], TODAY)).toBe(6);
  });

  it('ignores other days when finding the end', () => {
    expect(nextPosition([entry('a', 1), entry('b', 99, YESTERDAY)], TODAY)).toBe(2);
  });

  it('starts at one on an empty day', () => {
    expect(nextPosition([], TODAY)).toBe(1);
  });
});

describe('dragging', () => {
  it('lands between its new neighbours', () => {
    expect(positionBetween(1, 2)).toBe(1.5);
  });

  it('goes above everything', () => {
    expect(positionBetween(null, 1)).toBe(0);
  });

  it('goes below everything', () => {
    expect(positionBetween(3, null)).toBe(4);
  });

  it('handles the only row in the list', () => {
    expect(positionBetween(null, null)).toBe(1);
  });

  it('keeps producing a value strictly between, repeatedly', () => {
    /*
     * The failure mode of averaging is running out of room. Ten successive
     * drags into the same gap must still yield a position that sorts between
     * its neighbours — asserting one drag proves nothing about the tenth, and
     * this is the property the whole scheme rests on.
     */
    let low = 1;
    const high = 2;
    for (let i = 0; i < 10; i += 1) {
      const mid = positionBetween(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      low = mid;
    }
  });
});

describe('how the day is going', () => {
  const planned = (statuses: string[]) =>
    planFor(
      statuses.map((_, i) => entry(`k${i}`, i + 1)),
      TODAY,
      statuses.map((status, i) => item(`k${i}`, status)),
    );

  it('counts what is done', () => {
    const progress = progressOf(planned(['completed', 'due', 'due']));
    expect(progress).toEqual({ total: 3, done: 1, finished: false });
  });

  it('counts a skip as dealt with', () => {
    // Skipping is a decision, not a failure — it should not hold the day open.
    expect(progressOf(planned(['completed', 'skipped'])).finished).toBe(true);
  });

  it('is not finished when nothing was planned', () => {
    /*
     * An empty plan is the input that makes "everything is done" true
     * vacuously, and it is also the commonest state — every morning before
     * anyone has chosen anything. Congratulating somebody for planning nothing
     * would make the moment worthless on the days it is earned.
     */
    expect(progressOf(planned([])).finished).toBe(false);
  });

  it('is not finished while anything is outstanding', () => {
    expect(progressOf(planned(['completed', 'overdue'])).finished).toBe(false);
  });
});

describe('what was left over', () => {
  it('returns unfinished work from before today', () => {
    const entries = [entry('a', 1, YESTERDAY), entry('b', 2, YESTERDAY)];
    const left = unfinishedBefore(entries, TODAY, [item('a'), item('b', 'completed')]);
    expect(left.map((i) => i.occurrenceKey)).toEqual(['a']);
  });

  it('ignores today, which is not left over yet', () => {
    const entries = [entry('a', 1), entry('b', 1, YESTERDAY)];
    const left = unfinishedBefore(entries, TODAY, [item('a'), item('b')]);
    expect(left.map((i) => i.occurrenceKey)).toEqual(['b']);
  });

  it('returns something planned on several past days only once', () => {
    // Planned Monday, not done, planned again Tuesday, still not done. It is
    // one piece of work and the proposal must not offer it twice.
    const entries = [entry('a', 1, d('2026-08-24')), entry('a', 1, d('2026-08-25'))];
    const left = unfinishedBefore(entries, TODAY, [item('a')]);
    expect(left.map((i) => i.occurrenceKey)).toEqual(['a']);
  });

  it('drops one whose occurrence has gone', () => {
    const left = unfinishedBefore([entry('gone', 1, YESTERDAY)], TODAY, [item('a')]);
    expect(left).toEqual([]);
  });
});
