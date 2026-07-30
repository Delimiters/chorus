# ADR-0003 — Due dates are civil dates; only completions are instants

**Status:** accepted · **Date:** 2026-07-29

## Context

"Due on the 3rd" is not a moment in time. It is a date on a calendar, and it
means the same thing regardless of where the phone is. "Sam completed this" *is* a
moment in time.

The previous implementation used `Date` and `Calendar` for both, and produced two
distinct timezone bugs: monthly recurrence terminated at the first February, and
week boundaries were hardcoded to Sunday.

## Decision

- **Due dates, skip dates, reschedule targets** are `CivilDate` — the branded
  string `'YYYY-MM-DD'`, stored as Postgres `date`. No timezone, ever.
- **`completed_at`, `created_at`** are `timestamptz`.
- `src/core` contains **no `Date` at all**, enforced by lint
  (`no-restricted-globals`, plus AST selectors for `new Date`, `Date.*`, and
  `Math.random`).
- "Today" is computed in exactly one place — `src/data/today.ts` — and passed
  into the engine as a parameter.

## Consequences

- The engine is deterministic. CI runs the whole suite under four timezones
  including UTC+14 and UTC−11 and requires byte-identical results, which retires
  a bug class for about ten lines of YAML.
- Time travel in tests is free: pass a different string.
- `'YYYY-MM-DD'` sorts lexicographically exactly as it sorts chronologically,
  which is why `starts_on`/`ends_on` can be `text` generated columns and still
  index and compare correctly. (They have to be `text`: a generated column's
  expression must be `IMMUTABLE`, and `text::date` is only `STABLE` because it
  depends on `DateStyle`.)
- Civil arithmetic is hand-written (Hinnant's era algorithms) rather than
  delegated. About 150 lines, 100% covered.
- If two housemates are in different timezones, the **household's** timezone
  decides what "today" means. That is right for a shared list, but it is a choice.
