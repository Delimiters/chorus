/**
 * That `listPlanEntries` actually pages — and the right columns to page by.
 *
 * `pages.test.ts` tests the loop in isolation, which review showed was not
 * enough: reverting `listPlanEntries` to its exact pre-fix single-request form
 * left **422 tests across 21 suites green**. A full revert of the production
 * fix was invisible to the suite, which is the gap this file closes.
 *
 * It also pins the ordering. supabase-js does not type `.order()`'s column, so
 * `.order('definitely_not_a_column')` typechecks cleanly and fails only at
 * runtime — and paging without a total order lets PostgREST hand back a row
 * twice or skip one. `position` is not unique, so `id` has to be there.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

/** Every `.range()` the query made, and the ordering it carried. */
const mockRanges: { from: number; to: number }[] = [];
const mockOrders: string[] = [];
let mockTotal = 0;

jest.mock('../supabase', () => {
  const builder = () => {
    const self: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'or']) {
      self[method] = () => self;
    }
    self.order = (column: string) => {
      mockOrders.push(column);
      return self;
    };
    self.range = (from: number, to: number) => {
      mockRanges.push({ from, to });
      const rows = [];
      for (let i = from; i <= Math.min(to, mockTotal - 1); i += 1) {
        rows.push({
          id: `row-${i}`,
          user_id: 'u',
          chore_id: 'c',
          occurrence_key: `v1:k${i}`,
          planned_for: '2026-10-25',
          position: i + 1,
        });
      }
      return Promise.resolve({ data: rows, error: null });
    };
    return self;
  };
  return {
    supabase: { from: () => builder() },
    describeError: (e: { message: string }) => e.message,
    isDuplicate: () => false,
  };
});

// Imported after the mock, so the module under test picks it up.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { listPlanEntries } = require('./plan') as typeof import('./plan');

beforeEach(() => {
  mockRanges.length = 0;
  mockOrders.length = 0;
});

describe('reading a household plan bigger than one response', () => {
  it('pages until it has them all', async () => {
    /*
     * 1,317 is the live number that exposed this: nine days of one household's
     * plan came back as 1,000 rows, and the 317 lost were the highest
     * positions — where a newly added chore lands.
     */
    mockTotal = 1317;
    const rows = await listPlanEntries(
      'house' as never,
      '2026-10-17' as never,
      '2026-10-25' as never,
    );

    expect(rows).toHaveLength(1317);
    expect(mockRanges).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
    // The row that could not be seen: past the cut, and present now.
    expect(rows.some((r) => r.occurrenceKey === 'v1:k1000')).toBe(true);
  });

  it('orders by a total order, so paging cannot skip or repeat a row', async () => {
    /*
     * `position` is not unique — the live household has duplicate positions on
     * both plans — so without `id` the sort is ambiguous between pages and the
     * row at the boundary can arrive twice or not at all.
     *
     * Asserted in order and exactly, because supabase-js does not type
     * `.order()`'s column: `.order('definitely_not_a_column')` typechecks
     * cleanly and fails only against a real server.
     */
    mockTotal = 40;
    await listPlanEntries('house' as never, '2026-10-17' as never, '2026-10-25' as never);

    expect(mockOrders).toEqual(['position', 'id']);
  });

  it('costs one request when the plan fits', async () => {
    mockTotal = 40;
    const rows = await listPlanEntries(
      'house' as never,
      '2026-10-17' as never,
      '2026-10-25' as never,
    );

    expect(rows).toHaveLength(40);
    expect(mockRanges).toHaveLength(1);
  });
});
