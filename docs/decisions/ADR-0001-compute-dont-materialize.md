# ADR-0001 — Compute occurrences, don't materialize them

**Status:** accepted · **Date:** 2026-07-29

## Context

A chore recurs. Something has to answer "what is due today, and whose turn is it?"

The previous implementation of this app stored a row per occurrence — a
`chore_instances` table generated ahead of time. That decision produced four of
the seven failures in [POSTMORTEM-SWIFT.md](../POSTMORTEM-SWIFT.md), most
seriously: generation emitted N identical dates for "3× per week", storage
deduplicated by date, and three occurrences silently became one.

## Decision

Store the recurrence **rule** and **events that deviate from it** — completions,
skips, reschedules. Compute occurrences on demand for a bounded date window with
a pure function.

There is no `chore_instances` table and no `occurrences` query key.

## Consequences

Good:

- Editing a schedule is free. No rows to reconcile, delete, or regenerate, and no
  ambiguity about a partially-completed sequence.
- "3× per week" is structurally safe: each occurrence carries a slot index, so
  the three are distinct keys and there is no dedupe step to collapse them.
- Rotation follows a roster change automatically, because the assignee is
  recomputed rather than snapshotted at row-creation time.
- The horizon is infinite with no backfill job.
- Historical "expected vs actual" is honest: replay the expander over any past
  window and diff against completions. In a materialized design that number
  depends on whether a backfill happened to run.

Bad, and accepted:

- **Postgres cannot answer "what is due today".** The app fetches active chores
  and expands locally. For a two-person household with tens of chores that is a
  few kilobytes; at larger scale the same pure function can be deployed into an
  Edge Function, which the `src/core` purity boundary makes a zero-refactor move.
- Every screen needs a window, and windows need bounds. `MAX_WINDOW_DAYS` throws
  rather than silently building 3,650 objects.

## Alternatives

**Materialize with a nightly job.** Rejected: it is what failed before, and the
failure mode is silent wrongness rather than an error.

**Materialize lazily on read.** Rejected: it has the reconciliation problem of
materialization plus the computation of the pure approach, and adds a write to
every read path.
