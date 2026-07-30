# ADR-0002 — A purpose-built rule union, not RFC 5545

**Status:** accepted · **Date:** 2026-07-29

## Context

Recurrence is a solved problem with a standard: RFC 5545's `RRULE`, and a mature
JavaScript implementation in the `rrule` package. Using it would be the default
choice.

## Decision

A purpose-built discriminated union of eight variants
(`src/core/recurrence/types.ts`), validated by Zod and stored as jsonb.

## Reasoning

Three things decided it, in order of weight:

1. **RRULE cannot express "3× per week, any days" at all.** There is no
   representation for "N times within a period, unscheduled within it". That is a
   headline feature here — a household chore is often "water the plants three
   times this week" with no fixed day. We would need a parallel representation for
   floating rules anyway, and then maintain two systems.

2. **`BYMONTHDAY=31` skips short months, with no way to opt out.** February has no
   31st, so the standard omits February. A household setting "clean the gutters
   monthly on the 31st" means twelve times a year, not seven. We need a
   first-class `overflow: 'clamp' | 'skip'` choice, which RRULE cannot carry — so
   we would be wrapping and correcting the library rather than using it.

3. **`rrule` is instant-oriented.** `DTSTART` and `UNTIL` are `Date` objects, and
   the library's own documentation discusses the resulting floating-versus-UTC
   confusion at length. Our entire correctness strategy is that the engine never
   touches `Date` (see [ADR-0003](ADR-0003-civil-dates.md)). Adopting `rrule`
   would reintroduce precisely the class of bug we removed.

Secondary: an eight-variant union with a hand-written expander is a few hundred
lines that can be property-tested exhaustively and reasoned about completely.

## Consequences

- We own the correctness of expansion. Mitigated by property tests and ~35 golden
  fixtures verified against an independent implementation.
- No free calendar interop. `RRULE` remains available as a **lossy export**
  format for anchored rules if a calendar feed is ever wanted; floating rules have
  no representation and would export as nothing.
- Adding a variant is mechanical: add a union member, then a case in `expand`,
  `describe`, and the Zod schema. `assertNever` makes the compiler enumerate it.
