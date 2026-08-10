-- pgTAP is a test-only dependency, declared here rather than in a migration
-- that would ship it to production.
create extension if not exists pgtap with schema extensions;

-- Privilege-level guarantees, independent of RLS.
--
-- RLS decides which rows a role sees. Grants decide whether the table is
-- reachable at all. Both matter, and it is easy to get the second one wrong by
-- omission — Supabase's default privileges hand `anon` TRUNCATE on every new
-- table in public.

begin;
select plan(7);

-- ── anon must hold nothing ─────────────────────────────────────────────────
select is_empty(
  $$ select table_name, privilege_type
     from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public' $$,
  'anon holds no privilege on any table in public'
);

-- ── every table must have RLS on ───────────────────────────────────────────
select is_empty(
  $$ select tablename from pg_tables
     where schemaname = 'public' and rowsecurity = false $$,
  'every table in public has row level security enabled'
);

-- ── every table must have at least one policy ─────────────────────────────
-- RLS enabled with no policies denies everything, which is safe but means a
-- silently broken feature. Both failure modes are worth catching.
select is_empty(
  $$ select t.tablename
     from pg_tables t
     left join pg_policies p
       on p.schemaname = t.schemaname and p.tablename = t.tablename
     where t.schemaname = 'public'
     group by t.tablename
     having count(p.policyname) = 0 $$,
  'every table in public has at least one policy'
);

-- ── every policy must name its role ───────────────────────────────────────
-- A policy without TO is evaluated for every role, including anon.
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public' and roles = '{public}' $$,
  'no policy applies to the catch-all public role'
);

-- ── SECURITY DEFINER functions must be outside the exposed schema ─────────
-- Except the RPCs that are deliberately client-callable. Each earns its place
-- by doing something no table policy can express:
--
--   redeem_invite      — a non-member must redeem a code without being able to
--                        read the invites table.
--   create_household   — the creator's own membership row must exist before
--                        any membership policy would let them write it.
--   delete_my_account  — removing a row from auth.users is not a privilege
--                        `authenticated` has, or should ever be given.
--
-- The list is deliberately short and this test is deliberately annoying: a new
-- entry should be a decision somebody made on purpose, not a line that slipped
-- in with a feature.
select is_empty(
  $$ select p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname not in ('redeem_invite', 'create_household', 'delete_my_account') $$,
  'no incidental SECURITY DEFINER functions in the API-exposed schema'
);

-- ── A client-callable SECURITY DEFINER function must take no user id ───────
-- `delete_my_account()` deletes exactly auth.uid(). Giving it an argument
-- would turn "delete my account" into "delete an account", which is the whole
-- difference between a feature and a vulnerability.
select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delete_my_account'
     and p.pronargs = 0),
  1,
  'delete_my_account takes no arguments, so there is no id to tamper with'
);

-- ── SECURITY DEFINER functions must pin search_path ───────────────────────
-- Without it, they are a privilege-escalation vector.
select is_empty(
  $$ select n.nspname || '.' || p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prosecdef
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) c
         where c like 'search_path=%'
       ) $$,
  'every SECURITY DEFINER function pins its search_path'
);

select * from finish();
rollback;
