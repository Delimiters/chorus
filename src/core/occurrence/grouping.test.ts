import fc from 'fast-check';

import type { CivilDate } from '../civil/types';
import { PRIORITIES } from '../chore/priority';
import {
  ALL_KEY,
  groupItems,
  OTHER_KEY,
  OTHER_TITLE,
  type CategoryMeta,
  type ChoreMeta,
  type Groupable,
  type GroupBy,
  type SortBy,
} from './grouping';

interface Row extends Groupable {
  readonly choreId: string;
  readonly dueOn: CivilDate;
  readonly choreTitle: string;
}

const row = (choreId: string, dueOn: string, choreTitle = choreId): Row => ({
  choreId,
  dueOn: dueOn as CivilDate,
  choreTitle,
});

const cat = (
  id: string,
  name: string,
  position: number,
  ink: string | null = null,
): CategoryMeta => ({
  id,
  name,
  position,
  ink,
});

const metaOf = (entries: Record<string, ChoreMeta>): ReadonlyMap<string, ChoreMeta> =>
  new Map(Object.entries(entries));

const KITCHEN = cat('c-kitchen', 'Kitchen', 0, 'teal');
const LAUNDRY = cat('c-laundry', 'Laundry', 1);
const OUTDOORS = cat('c-outdoors', 'Outdoors', 2);
const CATEGORIES = [KITCHEN, LAUNDRY, OUTDOORS];

describe('groupItems', () => {
  describe('grouping by category', () => {
    const items = [
      row('dishes', '2026-08-05'),
      row('towels', '2026-08-07'),
      row('plants', '2026-08-09'),
      row('taxes', '2026-08-06'),
    ];
    const meta = metaOf({
      dishes: { categoryId: KITCHEN.id, priority: 'crucial' },
      towels: { categoryId: LAUNDRY.id, priority: 'minor' },
      plants: { categoryId: OUTDOORS.id, priority: 'normal' },
      taxes: { categoryId: null, priority: 'crucial' },
    });

    it('orders sections by position and pins Other last', () => {
      const sections = groupItems(items, meta, CATEGORIES, {
        groupBy: 'category',
        sortBy: 'priority',
      });
      expect(sections.map((s) => s.title)).toEqual(['Kitchen', 'Laundry', 'Outdoors', OTHER_TITLE]);
      expect(sections.at(-1)?.key).toBe(OTHER_KEY);
    });

    it('puts an uncategorised chore in Other even when it is the most important', () => {
      // Guards the obvious mistake: sorting by priority must not promote a
      // crucial chore out of its section.
      const sections = groupItems(items, meta, CATEGORIES, {
        groupBy: 'category',
        sortBy: 'priority',
      });
      const other = sections.find((s) => s.key === OTHER_KEY);
      expect(other?.items.map((i) => i.choreId)).toEqual(['taxes']);
    });

    it('carries the category ink onto the section', () => {
      const [kitchen] = groupItems(items, meta, CATEGORIES, {
        groupBy: 'category',
        sortBy: 'priority',
      });
      expect(kitchen?.ink).toBe('teal');
    });

    it('emits no section for a category nobody used', () => {
      const sections = groupItems([row('dishes', '2026-08-05')], meta, CATEGORIES, {
        groupBy: 'category',
        sortBy: 'priority',
      });
      expect(sections.map((s) => s.title)).toEqual(['Kitchen']);
    });

    it('treats a category id that no longer exists as Other', () => {
      const sections = groupItems(
        [row('ghost', '2026-08-05')],
        metaOf({ ghost: { categoryId: 'c-deleted', priority: 'normal' } }),
        CATEGORIES,
        { groupBy: 'category', sortBy: 'priority' },
      );
      expect(sections).toHaveLength(1);
      expect(sections[0]?.key).toBe(OTHER_KEY);
    });

    it('breaks a position tie by name, so the order is never input-dependent', () => {
      const tied = [cat('b', 'Bathroom', 0), cat('a', 'Attic', 0)];
      const sections = groupItems(
        [row('x', '2026-08-05'), row('y', '2026-08-05')],
        metaOf({
          x: { categoryId: 'a', priority: 'normal' },
          y: { categoryId: 'b', priority: 'normal' },
        }),
        tied,
        { groupBy: 'category', sortBy: 'due' },
      );
      expect(sections.map((s) => s.title)).toEqual(['Attic', 'Bathroom']);
    });
  });

  describe('grouping by priority', () => {
    it('orders sections crucial then normal then minor, skipping empty levels', () => {
      const sections = groupItems(
        [row('a', '2026-08-05'), row('b', '2026-08-06')],
        metaOf({
          a: { categoryId: null, priority: 'minor' },
          b: { categoryId: null, priority: 'crucial' },
        }),
        CATEGORIES,
        { groupBy: 'priority', sortBy: 'due' },
      );
      expect(sections.map((s) => s.title)).toEqual(['Crucial', 'Minor']);
    });

    it('uses the priority as the section key', () => {
      const sections = groupItems(
        [row('a', '2026-08-05')],
        metaOf({ a: { categoryId: null, priority: 'crucial' } }),
        CATEGORIES,
        { groupBy: 'priority', sortBy: 'due' },
      );
      expect(sections[0]?.key).toBe('crucial');
    });
  });

  describe('grouping off', () => {
    it('returns one unnamed section', () => {
      const sections = groupItems(
        [row('a', '2026-08-06'), row('b', '2026-08-05')],
        metaOf({}),
        CATEGORIES,
        { groupBy: 'none', sortBy: 'due' },
      );
      expect(sections).toHaveLength(1);
      expect(sections[0]?.key).toBe(ALL_KEY);
      expect(sections[0]?.items.map((i) => i.choreId)).toEqual(['b', 'a']);
    });

    it('returns nothing at all when there are no items', () => {
      expect(groupItems([], metaOf({}), CATEGORIES, { groupBy: 'none', sortBy: 'due' })).toEqual(
        [],
      );
    });
  });

  describe('sorting inside a section', () => {
    const items = [
      row('late-crucial', '2026-08-09'),
      row('early-minor', '2026-08-05'),
      row('mid-normal', '2026-08-07'),
    ];
    const meta = metaOf({
      'late-crucial': { categoryId: KITCHEN.id, priority: 'crucial' },
      'early-minor': { categoryId: KITCHEN.id, priority: 'minor' },
      'mid-normal': { categoryId: KITCHEN.id, priority: 'normal' },
    });

    it('by priority puts the crucial one first even though it is due last', () => {
      // The fixture matters: if every chore shared a due date, this assertion
      // would pass under a due-date sort too and prove nothing.
      const [section] = groupItems(items, meta, CATEGORIES, {
        groupBy: 'category',
        sortBy: 'priority',
      });
      expect(section?.items.map((i) => i.choreId)).toEqual([
        'late-crucial',
        'mid-normal',
        'early-minor',
      ]);
    });

    it('by due date puts the earliest first even though it is the least important', () => {
      const [section] = groupItems(items, meta, CATEGORIES, {
        groupBy: 'category',
        sortBy: 'due',
      });
      expect(section?.items.map((i) => i.choreId)).toEqual([
        'early-minor',
        'mid-normal',
        'late-crucial',
      ]);
    });

    it('falls through to the title when both axes tie', () => {
      const sections = groupItems(
        [row('z', '2026-08-05', 'Zucchini'), row('a', '2026-08-05', 'Artichoke')],
        metaOf({
          z: { categoryId: null, priority: 'normal' },
          a: { categoryId: null, priority: 'normal' },
        }),
        CATEGORIES,
        { groupBy: 'none', sortBy: 'priority' },
      );
      expect(sections[0]?.items.map((i) => i.choreTitle)).toEqual(['Artichoke', 'Zucchini']);
    });

    it('treats a chore missing from the lookup as uncategorised and normal', () => {
      const sections = groupItems([row('orphan', '2026-08-05')], metaOf({}), CATEGORIES, {
        groupBy: 'priority',
        sortBy: 'due',
      });
      expect(sections[0]?.title).toBe('Normal');
    });
  });

  describe('properties', () => {
    const arbRow = fc
      .tuple(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 28 }),
        fc.constantFrom(...PRIORITIES),
        fc.constantFrom<string | null>(KITCHEN.id, LAUNDRY.id, OUTDOORS.id, null),
      )
      .map(([n, day, priority, categoryId]) => ({
        item: row(`chore-${n}`, `2026-08-${String(day).padStart(2, '0')}`),
        priority,
        categoryId,
      }));

    const arbInput = fc.uniqueArray(arbRow, {
      selector: (r) => r.item.choreId,
      maxLength: 30,
    });

    const arbOptions = fc.record({
      groupBy: fc.constantFrom<GroupBy>('category', 'priority', 'none'),
      sortBy: fc.constantFrom<SortBy>('priority', 'due'),
    });

    it('partitions: every item lands in exactly one section, none invented', () => {
      fc.assert(
        fc.property(arbInput, arbOptions, (rows, options) => {
          const meta = new Map(
            rows.map((r) => [r.item.choreId, { categoryId: r.categoryId, priority: r.priority }]),
          );
          const sections = groupItems(
            rows.map((r) => r.item),
            meta,
            CATEGORIES,
            options,
          );
          const out = sections.flatMap((s) => s.items.map((i) => i.choreId));
          expect(out.slice().sort()).toEqual(rows.map((r) => r.item.choreId).sort());
          expect(new Set(out).size).toBe(out.length);
        }),
      );
    });

    it('never emits an empty section', () => {
      fc.assert(
        fc.property(arbInput, arbOptions, (rows, options) => {
          const meta = new Map(
            rows.map((r) => [r.item.choreId, { categoryId: r.categoryId, priority: r.priority }]),
          );
          const sections = groupItems(
            rows.map((r) => r.item),
            meta,
            CATEGORIES,
            options,
          );
          for (const section of sections) expect(section.items.length).toBeGreaterThan(0);
        }),
      );
    });

    it('is independent of input order', () => {
      fc.assert(
        fc.property(arbInput, arbOptions, (rows, options) => {
          const meta = new Map(
            rows.map((r) => [r.item.choreId, { categoryId: r.categoryId, priority: r.priority }]),
          );
          const items = rows.map((r) => r.item);
          const forward = groupItems(items, meta, CATEGORIES, options);
          const backward = groupItems([...items].reverse(), meta, CATEGORIES, options);
          expect(backward).toEqual(forward);
        }),
      );
    });

    it('the non-vacuity check: these inputs actually produce multiple sections', () => {
      // Guards the properties above from the failure mode this project keeps
      // finding — an assertion that holds because the fixture is degenerate.
      let sawMultiple = 0;
      let sawAny = 0;
      fc.assert(
        fc.property(arbInput, (rows) => {
          const meta = new Map(
            rows.map((r) => [r.item.choreId, { categoryId: r.categoryId, priority: r.priority }]),
          );
          const sections = groupItems(
            rows.map((r) => r.item),
            meta,
            CATEGORIES,
            { groupBy: 'category', sortBy: 'priority' },
          );
          sawAny += 1;
          if (sections.length > 1) sawMultiple += 1;
        }),
        { numRuns: 200 },
      );
      const ratio = sawMultiple / sawAny;
      console.log(`multi-section coverage: ${(ratio * 100).toFixed(1)}%`);
      expect(ratio).toBeGreaterThan(0.5);
    });
  });
});

describe('undated items', () => {
  // The Chores tab groups chore *definitions*, which have no due date. They
  // must still group and order sensibly rather than needing a fabricated date.
  const undated = (id: string, title: string): Groupable => ({
    choreId: id,
    dueOn: null,
    choreTitle: title,
  });

  it('orders undated items by title under either sort', () => {
    for (const sortBy of ['priority', 'due'] as const) {
      const sections = groupItems(
        [undated('z', 'Zucchini'), undated('a', 'Artichoke')],
        new Map([
          ['z', { categoryId: null, priority: 'normal' as const }],
          ['a', { categoryId: null, priority: 'normal' as const }],
        ]),
        [],
        { groupBy: 'none', sortBy },
      );
      expect(sections[0]?.items.map((i) => i.choreTitle)).toEqual(['Artichoke', 'Zucchini']);
    }
  });

  it('still honours priority over title for undated items', () => {
    const sections = groupItems(
      [undated('z', 'Artichoke'), undated('a', 'Zucchini')],
      new Map([
        ['z', { categoryId: null, priority: 'minor' as const }],
        ['a', { categoryId: null, priority: 'crucial' as const }],
      ]),
      [],
      { groupBy: 'none', sortBy: 'priority' },
    );
    expect(sections[0]?.items.map((i) => i.choreTitle)).toEqual(['Zucchini', 'Artichoke']);
  });

  it('sorts undated after dated when mixed', () => {
    const sections = groupItems(
      [
        undated('u', 'Undated'),
        { choreId: 'd', dueOn: '2026-08-05' as CivilDate, choreTitle: 'Dated' },
      ],
      new Map([
        ['u', { categoryId: null, priority: 'normal' as const }],
        ['d', { categoryId: null, priority: 'normal' as const }],
      ]),
      [],
      { groupBy: 'none', sortBy: 'due' },
    );
    expect(sections[0]?.items.map((i) => i.choreTitle)).toEqual(['Dated', 'Undated']);
  });
});
