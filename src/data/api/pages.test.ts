/**
 * The pager, and the silent truncation it exists to prevent.
 *
 * This is written against a fake `page` rather than Supabase, because the
 * thing being tested is the loop: how many requests it makes, when it stops,
 * and that it does not quietly return a prefix. The live proof that a single
 * request *does* return a prefix is in `./pages.ts`.
 */

import { describe, expect, it } from '@jest/globals';

import { fetchAllPages, TooManyPagesError } from './pages';

/** A table of `total` rows, served in pages the way PostgREST serves them. */
const server = (total: number) => {
  const calls: { from: number; to: number }[] = [];
  const page = (from: number, to: number) => {
    calls.push({ from, to });
    const rows = [];
    for (let i = from; i <= Math.min(to, total - 1); i += 1) rows.push({ id: i });
    return Promise.resolve({ data: rows, error: null });
  };
  return { page, calls };
};

describe('reading a list that may be longer than one response', () => {
  it('returns everything, in order, across pages', async () => {
    /*
     * 1,317 rows is the live number: nine days of one household's plan, which
     * came back as 1,000 and lost the 317 most recently added. The row Jake
     * could not see was in that tail.
     */
    const { page, calls } = server(1317);
    const rows = await fetchAllPages('plan_entries', page);

    expect(rows).toHaveLength(1317);
    expect(rows.map((r) => r.id)).toEqual([...Array(1317).keys()]);
    expect(calls).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
  });

  it('costs exactly one request for a list that fits', async () => {
    /*
     * The reason paging everywhere is close to free: a short first page ends
     * the loop, so a 28-row table is one request, exactly as before.
     */
    const { page, calls } = server(28);
    const rows = await fetchAllPages('categories', page);

    expect(rows).toHaveLength(28);
    expect(calls).toHaveLength(1);
  });

  it('handles an empty table without a second request', async () => {
    const { page, calls } = server(0);
    expect(await fetchAllPages('plan_entries', page)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('asks once more when the total lands exactly on a page boundary', async () => {
    /*
     * A full page is indistinguishable from "there is more", because PostgREST
     * does not say how many rows exist unless asked for a separate count. So
     * exactly 1,000 rows costs one wasted request and — this is the point —
     * returns all 1,000 rather than guessing.
     */
    const { page, calls } = server(1000);
    const rows = await fetchAllPages('chore_completions', page);

    expect(rows).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it('translates the error rather than surfacing the raw one', async () => {
    /*
     * These errors reach `ErrorState`, which renders the message with no
     * fallback. The first version of this helper threw `error.message ??
     * String(error)`, which took seven queries out of `describeError`: a
     * permission failure became "permission denied for table
     * chore_completions", and an object-shaped error would have rendered the
     * literal `[object Object]` on the plan screen.
     */
    await expect(
      fetchAllPages('chore_completions', () =>
        Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } }),
      ),
    ).rejects.toThrow("You don't have permission to do that.");

    await expect(
      fetchAllPages('plan_entries', () => Promise.resolve({ data: null, error: {} })),
    ).rejects.toThrow('Something went wrong. Please try again.');
  });

  it('throws rather than returning a prefix when the error comes back', async () => {
    /*
     * Returning what arrived before the failure is the exact shape of the bug
     * this module is about: a short list that looks complete.
     */
    const page = (from: number) =>
      Promise.resolve(
        from === 0
          ? { data: [...Array(1000).keys()].map((id) => ({ id })), error: null }
          : { data: null, error: { message: 'network gone' } },
      );

    await expect(fetchAllPages('plan_entries', page)).rejects.toThrow('network gone');
  });

  it('refuses to page for ever', async () => {
    // A server that always returns a full page: without the cap this never ends.
    const page = (from: number) =>
      Promise.resolve({
        data: [...Array(1000).keys()].map((i) => ({ id: from + i })),
        error: null,
      });

    await expect(fetchAllPages('plan_entries', page)).rejects.toThrow(TooManyPagesError);
  });
});
