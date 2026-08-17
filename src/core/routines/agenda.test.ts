/**
 * How a routine day is arranged.
 *
 * This file did not exist until manual ordering was added, which is worth
 * noting: `bucketSections` decides what every routine screen shows, and it was
 * covered only indirectly, through a component test that hand-wrote its output
 * as a fixture.
 */

import { civilDate } from '../civil/date';
import type { CivilDate } from '../civil/types';
import { bucketSections } from './agenda';
import type { RoutineOccurrence } from './project';

const TODAY = civilDate('2026-03-15');
const ME = 'me';

const occurrence = (over: Partial<RoutineOccurrence> = {}): RoutineOccurrence =>
  ({
    choreId: 'stretch',
    itemId: 'stretch',
    occurrenceKey: 'stretch',
    dueOn: TODAY,
    flexibleFrom: TODAY,
    flexibleUntil: TODAY,
    periodKey: '2026-03-15',
    slot: 0,
    subject: null,
    occurrenceIndex: 0,
    title: 'Stretch',
    ownerId: ME,
    bucket: 'morning',
    timeOfDay: null,
    linkedChoreId: null,
    icon: null,
    remind: false,
    status: 'due',
    completedOn: null,
    sortKey: 120,
    position: null,
    ...over,
  }) as RoutineOccurrence;

const morningTitles = (occs: RoutineOccurrence[], on: CivilDate = TODAY) =>
  bucketSections(occs, ME, { showOthers: false, on })
    .sections.find((s) => s.bucket === 'morning')
    ?.mine.map((o) => o.title) ?? [];

describe('an order you dragged into place', () => {
  /*
   * Time of day is a poor proxy for sequence. Most routine items are untimed,
   * so they fell back to a title sort — alphabetical order pretending to be a
   * plan. Forcing a sequence by inventing times is worse, because those times
   * then drive reminders.
   */
  it('beats the clock', () => {
    // The two orders must disagree, or the assertion holds whether or not
    // position is consulted. Stretch is earlier on the clock and second by
    // hand; the hand wins.
    expect(
      morningTitles([
        occurrence({ itemId: 'a', occurrenceKey: 'a', title: 'Stretch', sortKey: 30, position: 1 }),
        occurrence({ itemId: 'b', occurrenceKey: 'b', title: 'Meds', sortKey: 600, position: 0 }),
      ]),
    ).toEqual(['Meds', 'Stretch']);
  });

  it('leaves an untouched list in clock order', () => {
    // Non-vacuity: without this, a comparator that ignored time entirely would
    // pass the test above.
    expect(
      morningTitles([
        occurrence({ itemId: 'a', occurrenceKey: 'a', title: 'Stretch', sortKey: 60 }),
        occurrence({ itemId: 'b', occurrenceKey: 'b', title: 'Meds', sortKey: 30 }),
      ]),
    ).toEqual(['Meds', 'Stretch']);
  });

  it('puts anything never dragged after everything that was', () => {
    // So a newly added item joins the bottom of its bucket rather than landing
    // in the middle of a sequence somebody set.
    expect(
      morningTitles([
        occurrence({
          itemId: 'new',
          occurrenceKey: 'new',
          title: 'Added today',
          sortKey: 0,
        }),
        occurrence({
          itemId: 'a',
          occurrenceKey: 'a',
          title: 'Stretch',
          sortKey: 600,
          position: 0,
        }),
      ]),
    ).toEqual(['Stretch', 'Added today']);
  });

  it('is total, so two unplaced items never swap between renders', () => {
    const apple = occurrence({ itemId: 'a', occurrenceKey: 'a', title: 'Apple', sortKey: 120 });
    const banana = occurrence({ itemId: 'b', occurrenceKey: 'b', title: 'Banana', sortKey: 120 });

    expect(morningTitles([apple, banana])).toEqual(morningTitles([banana, apple]));
  });

  it('orders a housemate’s shared routine the same way', () => {
    // Their list is theirs to arrange; showing it in a different order than
    // they see would make "did you do these in order" unanswerable.
    const them = 'them';
    const sections = bucketSections(
      [
        occurrence({
          itemId: 'x',
          occurrenceKey: 'x',
          title: 'Late',
          sortKey: 10,
          position: 1,
          ownerId: them,
        }),
        occurrence({
          itemId: 'y',
          occurrenceKey: 'y',
          title: 'First',
          sortKey: 900,
          position: 0,
          ownerId: them,
        }),
      ],
      ME,
      { showOthers: true, on: TODAY },
    );
    const theirs = sections.sections.find((s) => s.bucket === 'morning')?.theirs[0];
    expect(theirs?.items.map((i) => i.title)).toEqual(['First', 'Late']);
  });
});
