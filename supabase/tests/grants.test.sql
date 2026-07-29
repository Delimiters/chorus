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
select plan(6);

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
-- Except the two RPCs that are deliberately client-callable.
select is_empty(
  $$ select p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.proname not in ('redeem_invite', 'create_household') $$,
  'no incidental SECURITY DEFINER functions in the API-exposed schema'
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
