# ADR-0006 — CI is the source of truth for database tests

**Status:** accepted · **Date:** 2026-07-29

## Context

Testing row level security properly needs a real Postgres. `supabase start` needs
a container runtime. The development machine is a 2018 Intel MacBook Pro, where
running ten containers is not free.

Development is also largely autonomous, so a local environment problem must not
be able to block progress.

## Decision

**GitHub Actions is authoritative for database tests.** `ubuntu-latest` has Docker
natively, so the Supabase stack starts quickly and at no cost there.

Locally, Colima provides the same stack as a **convenience** for fast iteration,
started with an exclusion list so only what the policy tests need comes up:

```
supabase start -x imgproxy,studio,logflare,vector,supavisor,mailpit
```

## Consequences

- A Colima hiccup is an inconvenience, not a blocker: push the branch, let CI
  prove the policies, read the result.
- The database workflow must trigger on everything that could affect it. It is
  path-filtered, and an early version omitted `src/core/**` and `src/data/**` —
  which meant `engine-over-db.test.ts`, the one test that exists to catch drift
  between the engine and the database, never ran on the changes most likely to
  cause that drift. Both paths are now included.
- Local and CI must run the same commands in the same order. They didn't once:
  pgTAP fixtures were verified before `seed.sql` existed, and locally the tests
  were never re-run in the reset-then-test order CI uses. CI caught the
  collision. The order is now the same in both places.
- A cloud "test project" was considered and rejected: shared mutable state
  prevents parallel runs, and free projects pause after about a week idle, which
  is a confusing failure for an intermittently-active side project.
