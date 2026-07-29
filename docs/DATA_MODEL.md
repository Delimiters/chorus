# Data model

Eight tables. The shape follows entirely from one rule:

> **Occurrences are never stored.** The database holds the recurrence *rule* and
> *events that deviate from it*. Everything else is computed.

## Tables

| Table | Holds | Notes |
|---|---|---|
| `profiles` | One row per auth user | Created by a trigger on signup, so the app never renders "signed in, no profile" |
| `households` | Name, timezone, week start, overdue horizon | The timezone is the single source of truth for what "today" means |
| `household_members` | Who belongs to which household, and their role | Display order only — rotation order lives on the chore |
| `household_invites` | Single-use codes | No non-member SELECT path; redemption goes through an RPC |
| `chores` | Title, `schedule` jsonb, `assignment` jsonb | Soft-deleted via `archived_at`, because history must outlive the chore |
| `chore_completions` | Append-only completion events | `unique (chore_id, occurrence_key)` — the idempotency guarantee |
| `chore_exceptions` | Skips and reschedules | The only other way reality deviates from the rule |
| `push_tokens` | Expo push tokens | Unused in v1; created now so enabling push isn't a migration |

There is deliberately **no `chore_instances` table**. That table is what the
previous implementation had, and it's what made "3× per week" silently collapse
into 1×. See [POSTMORTEM-SWIFT.md](POSTMORTEM-SWIFT.md).

## Why `schedule` and `assignment` are jsonb

Eight recurrence variants with disjoint fields would mean roughly twelve sparse
nullable columns and a `CHECK` constraint nobody could read — and it still
couldn't express "if `kind = 'weekly'` then `weekdays` is required".

Instead: jsonb, validated by a single Zod schema
(`src/core/recurrence/schema.ts`) applied on both read and write, plus a coarse
`CHECK` on the discriminator as a backstop. The engine performs no defensive
parsing; it trusts that anything reaching it came through Zod.

`test/integration/engine-over-db.test.ts` reads every seeded row and parses it,
so a drift between the stored shape and the engine's expectations fails CI.

### The generated columns are `text`, not `date`

```sql
starts_on text generated always as (schedule ->> 'startsOn') stored,
ends_on   text generated always as (nullif(schedule ->> 'endsOn', 'null')) stored,
```

A generated column's expression must be `IMMUTABLE`, and casting text to date is
only `STABLE` — it depends on the `DateStyle` setting. Postgres rejects the
`date` version outright.

Keeping them as text costs nothing, because civil dates are `'YYYY-MM-DD'` and
therefore compare lexicographically exactly as they compare chronologically.
`where ends_on >= '2026-07-29'` is both correct and indexed. That's the same
property the engine relies on.

## Row level security

Every table has RLS enabled and at least one policy. `supabase/tests/grants.test.sql`
asserts both, so a table added later can't quietly skip it.

### The recursion trap

The obvious policy on `household_members` is:

```sql
-- Do not do this.
using (household_id in (select household_id from household_members where user_id = auth.uid()))
```

The subquery re-triggers the policy it lives in, and Postgres aborts with
`42P17: infinite recursion detected in policy for relation "household_members"`.

The fix is a `SECURITY DEFINER` function, which runs as its owner and so isn't
subject to RLS inside its own body:

```sql
create function private.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.household_members hm
  where hm.household_id = hid and hm.user_id = (select auth.uid())
); $$;
```

Three details in there all matter:

- **`private` schema, not `public`.** A `SECURITY DEFINER` function in an
  API-exposed schema is callable by any client. Supabase warns about this
  explicitly. `private` is not in the exposed schema list, so PostgREST can't
  see it, while policies still can.
- **`set search_path = ''` with fully-qualified names.** Without it, a
  `SECURITY DEFINER` function is a privilege-escalation vector via a hijacked
  `search_path`.
- **`(select auth.uid())`, not `auth.uid()`.** The subselect form is hoisted into
  an InitPlan and evaluated once per query instead of once per row. Supabase
  benchmarks this at a ~95% improvement on RLS-heavy tables.

Every policy also names its role with `TO authenticated`, which stops Postgres
evaluating it for roles that could never match.

### Policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | self + housemates | *(trigger only)* | self | — |
| `households` | members | creator = you | admins | owner |
| `household_members` | members | self, into a household you created | admins | self or admins |
| `household_invites` | members | admins | — | admins |
| `chores` | members | members, author = you | members | members |
| `chore_completions` | members | members, `completed_by` = you | *(none)* | members |
| `chore_exceptions` | members | members, author = you | *(none)* | members |
| `push_tokens` | self | self | self | self |

Two of these are load-bearing rather than incidental:

- **`completed_by = auth.uid()` on insert.** Without it, a member could forge a
  completion attributed to their partner. Tested.
- **No UPDATE on completions or exceptions.** They're append-only events;
  correcting one means deleting and re-inserting. Rewriting history in place is
  how the stats view would start lying.

Either housemate may **delete** a completion. A two-person household is a trust
relationship, not an access-control problem, and "I ticked the wrong one" needs
to be fixable by whoever notices.

## Grants

The project has **automatically expose new tables disabled**, so nothing is
reachable through the Data API without an explicit `GRANT`. Access is stated out
loud rather than inherited.

This has two non-obvious consequences, both discovered by tests failing:

1. **`anon` still receives `TRUNCATE`, `REFERENCES` and `TRIGGER`** from
   Supabase's default privileges. None are reachable through PostgREST, so it
   isn't a live hole — but an unauthenticated role holding `TRUNCATE` on the
   completions log isn't something to leave lying around. The migration revokes
   them, and `grants.test.sql` asserts `anon` holds nothing at all.
2. **`service_role` needs explicit grants too.** With auto-expose off it gets the
   same `TRUNCATE/REFERENCES/TRIGGER` and nothing more, so admin tooling and test
   setup fail with `permission denied` until granted. It bypasses RLS by design
   and must never appear in a client bundle.

## RPCs

Two operations can't be expressed as table policies:

**`redeem_invite(code)`** — a non-member must be able to redeem a code without
being able to read it first, or they could enumerate invites. `SECURITY DEFINER`,
with `SELECT ... FOR UPDATE` so two people racing the same code can't both win.
Raises `invalid_invite_code`, `invite_already_used`, or `invite_expired`.

**`create_household(name, tz, week_start)`** — creating the household and joining
it must be atomic. Done as two client round trips, a failure between them leaves
a household with no members, which nothing can then read *or* delete.

## Realtime

`chores`, `chore_completions`, `chore_exceptions`, `household_members` and
`households` are in the `supabase_realtime` publication.

`chore_completions` and `chore_exceptions` are set to `replica identity full`,
because DELETE events otherwise carry only the primary key — and the client needs
`occurrence_key` to know which occurrence just became incomplete.

## Indexes

`household_members (user_id)` is the most load-bearing index in the schema: the
membership helper hits it on every RLS check on every table.

Beyond that, one index per read path the app actually has — live chores per
household, completions by due date, completions by person, exceptions by date —
plus a partial index on `moved_to` for rescheduled occurrences.

## Migrations

Files in `supabase/migrations/`, never edited after merge. Corrections are new
migrations.

`db.yml` runs on every PR touching `supabase/**` and does four things:

1. `supabase db reset` — proves the migrations apply to an empty database from
   scratch, which is the only real guarantee that a new environment can be built.
2. `supabase test db` — the pgTAP policy suite.
3. The TypeScript integration suite, through PostgREST and `supabase-js`.
4. **A drift guard** — `supabase db diff --schema public` must be empty, and the
   committed `database.types.ts` must match a fresh generation. Together those
   catch anyone changing the database out of band or forgetting to regenerate
   types.

Because the Supabase GitHub integration auto-deploys migrations on push to
`main`, schema changes go through a pull request so these checks run *before*
anything reaches the live database.
