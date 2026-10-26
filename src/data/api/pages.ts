/**
 * Reading a list that can be longer than PostgREST will hand over at once.
 *
 * **PostgREST caps every response at `db-max-rows`, 1000 by default, and says
 * nothing about it.** The response is a success with a short array — exactly
 * the shape of "there are only 900 of these" — so a query that outgrows the
 * cap starts quietly losing rows and every layer above it believes the answer.
 *
 * That is not hypothetical. `listPlanEntries` asks for nine days of a
 * household's plan; on the live household that reached 1,317 rows, came back
 * with 1,000, and the missing 317 were the ones with the highest `position` —
 * the most recently added. So a chore added to a day could not be seen on it,
 * no matter how many times it was added, which is precisely what Jake
 * reported:
 *
 * > "I added a 'Call grandma!' chore assigned to emily and tried to add it to
 * > her day but it is not showing up no matter how many times I add it"
 *
 * It had been written correctly every time, and read back never.
 *
 * ## Why paging rather than a bigger `.limit()`
 *
 * A limit above the server's cap is ignored; the cap wins. And any fixed
 * number is a guess that goes stale as the household grows — a limit of 2,000
 * would have made this household work and the next one fail the same way,
 * silently. Paging has no number in it to be wrong.
 */

/**
 * One page, matching PostgREST's `max_rows` in `supabase/config.toml`.
 *
 * The coupling is load-bearing in one direction only. If `max_rows` were
 * *raised*, this still works — pages would just be smaller than the server
 * would allow. If it were ever *lowered* below this, every first page would
 * come back short, the loop would stop, and the original silent truncation
 * would be back. The deleted `MAX_COMPLETIONS_PER_FETCH` carried this
 * cross-reference; it is restated here rather than lost.
 */
import { describeError } from '../supabase';

const PAGE = 1000;

/**
 * A guard against paging forever.
 *
 * Twenty pages is twenty thousand rows, far past anything a two-person
 * household can produce and still cheap to reason about. Throwing is right
 * here: a loop that cannot terminate is a worse outcome than a visible error,
 * and silently returning a prefix is the bug this module exists to prevent.
 */
const MAX_PAGES = 20;

/** Whatever PostgREST handed back, in the shape `describeError` expects. */
function asError(error: unknown): { code?: string | undefined; message: string } {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  return {
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    message: typeof e.message === 'string' ? e.message : String(error),
  };
}

export class TooManyPagesError extends Error {
  constructor(table: string) {
    super(
      `${table}: more than ${MAX_PAGES * PAGE} rows. Refusing to page further — ` +
        `narrow the query rather than raising this.`,
    );
    this.name = 'TooManyPagesError';
  }
}

/**
 * Runs `page(from, to)` until it stops returning full pages.
 *
 * The caller supplies a function that applies `.range(from, to)` to its own
 * query, because a Supabase query builder is single-use and the filters differ
 * per call site.
 *
 * `to` is inclusive. supabase-js implements `.range()` as `offset`/`limit`
 * query parameters rather than a `Range` header, so an offset past the end is
 * an empty 200 rather than a 416 — which is what makes the extra
 * boundary-case request harmless.
 */
export async function fetchAllPages<T>(
  table: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<readonly T[]> {
  const all: T[] = [];

  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    /*
     * Through `describeError`, like every hand-written query in this layer.
     *
     * The first version threw `new Error(error.message ?? String(error))`,
     * which quietly took seven queries *out* of that translation — their
     * errors reach `ErrorState`, which renders the message with no fallback.
     * So a permission failure went from "You don't have permission to do
     * that." to `permission denied for table chore_completions`, and an
     * object-shaped error would have rendered the literal string
     * `[object Object]` on the plan screen: the exact case `describeError`
     * exists to prevent, named in its own comment.
     */
    if (error) throw new Error(describeError(asError(error)));

    const rows = data ?? [];
    all.push(...rows);

    /*
     * A short page is the last page. A *full* page might be the last one too,
     * in which case the next request returns nothing and the loop ends one
     * round trip later — which is the price of PostgREST not saying how many
     * rows there are unless asked with a separate count.
     */
    if (rows.length < PAGE) return all;
  }

  throw new TooManyPagesError(table);
}
