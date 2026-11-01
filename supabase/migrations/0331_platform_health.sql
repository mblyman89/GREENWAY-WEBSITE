-- 0331_platform_health.sql  (slice G-71a · owner messages 11 and 12 · platform early warning)
--
-- WHY. The owner, verbatim (message 11):
--   "should we be monitoring supabase and vercel for issues like this that could
--    cause real issues due to us not knowing about it until we run into the
--    problem in production."
-- and (message 12):
--   "Let's build 1-4 first ... Update the standing rules so we don't rely on the
--    database to do things for us and we are more deliberate about how we
--    communicate with the database."
--
-- On 2026-10-30 Supabase stopped granting new objects automatically, and the
-- first anyone knew was a refused customer return at the counter (R-RET, 0330).
-- This migration lets the app ASK the database every morning whether the
-- server role can still reach everything the code uses, and keeps the answer.
--
-- WHAT.
--   1. platform_health_runs: one row per check (daily cron or "Run check now").
--      Append-only: the server may read and add, never change or delete.
--      No browser role can touch it (no anon/authenticated grant, RLS on, no policy).
--   2. platform_db_contract_check(p_tables text[], p_functions text[]) -> jsonb.
--      READ-ONLY (stable, no writes). Given the app's contract
--      (src/lib/platform/db-contract.generated.ts) it reports, for service_role:
--        missing / unreachable tables+views, missing / unreachable functions,
--        anything else in `public` service_role cannot reach (same sweep as 0330),
--        and whether 0330's default privileges are still in place.
--      SECURITY INVOKER: it only reads catalogs, which any role may read.
--   3. Explicit grants (standing rule 15): service_role only. Nothing to anon,
--      authenticated or public.
--
-- Safe to re-run (if not exists, create or replace, idempotent grants).
-- Rollback: supabase/rollbacks/0331_platform_health.rollback.sql.


create table if not exists public.platform_health_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  status      text not null check (status in ('ok', 'warn', 'fail')),
  summary     text not null,
  report      jsonb not null default '{}'::jsonb,
  source      text not null check (source in ('cron', 'manual')),
  run_by      uuid null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_platform_health_runs_kind_created
  on public.platform_health_runs (kind, created_at desc);

alter table public.platform_health_runs enable row level security;

-- Deliberate, not default: 0330's default privileges hand service_role all four
-- verbs on every new table. This log is append-only, so take UPDATE/DELETE back.
revoke all on table public.platform_health_runs from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on table public.platform_health_runs from service_role;
grant select, insert on table public.platform_health_runs to service_role;

comment on table public.platform_health_runs is
  'G-71 platform early warning: one row per health check (daily cron or manual). Append-only; server role only.';

create or replace function public.platform_db_contract_check(p_tables text[], p_functions text[])
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  with
  want_t as (select distinct t from unnest(coalesce(p_tables, '{}'::text[])) as t where t ~ '^[a-z_][a-z0-9_]*$'),
  want_f as (select distinct f from unnest(coalesce(p_functions, '{}'::text[])) as f where f ~ '^[a-z_][a-z0-9_]*$'),
  rel as (
    select w.t, c.oid, c.relkind
      from want_t w
      left join pg_class c
        on c.relname = w.t
       and c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
  ),
  fn as (
    select w.f, p.oid
      from want_f w
      left join pg_proc p
        on p.proname = w.f
       and p.pronamespace = 'public'::regnamespace
  ),
  sweep_rel as (
    select 'table ' || c.relname as name
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
       and not has_table_privilege('service_role', c.oid, 'SELECT')
  ),
  sweep_seq as (
    select 'sequence ' || c.relname as name
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'S'
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
       and not (case when c.relkind = 'S' then has_sequence_privilege('service_role', c.oid, 'USAGE') else true end)
  ),
  sweep_fn as (
    select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind in ('f', 'p')
       and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  ),
  defaults as (
    select
      exists (
        select 1
          from pg_default_acl d, aclexplode(d.defaclacl) a
         where d.defaclnamespace = 'public'::regnamespace
           and d.defaclobjtype = 'r'
           and a.grantee = 'service_role'::regrole
           and a.privilege_type = 'SELECT'
      )
      and exists (
        select 1
          from pg_default_acl d, aclexplode(d.defaclacl) a
         where d.defaclnamespace = 'public'::regnamespace
           and d.defaclobjtype = 'f'
           and a.grantee = 'service_role'::regrole
           and a.privilege_type = 'EXECUTE'
      ) as ok
  )
  select jsonb_build_object(
    'missing_tables',
      coalesce((select jsonb_agg(t order by t) from rel where oid is null), '[]'::jsonb),
    'unreachable_tables',
      coalesce((select jsonb_agg(t order by t) from rel
                 where oid is not null and not has_table_privilege('service_role', oid, 'SELECT')), '[]'::jsonb),
    'missing_functions',
      coalesce((select jsonb_agg(distinct f) from fn where oid is null), '[]'::jsonb),
    'unreachable_functions',
      coalesce((select jsonb_agg(distinct f) from fn
                 where oid is not null and not has_function_privilege('service_role', oid, 'EXECUTE')), '[]'::jsonb),
    'public_unreachable',
      coalesce((select jsonb_agg(name order by name)
                  from (select name from sweep_rel union all select name from sweep_seq union all select name from sweep_fn) s), '[]'::jsonb),
    'default_privileges_ok', (select ok from defaults),
    'checked_tables', (select count(*) from want_t),
    'checked_functions', (select count(*) from want_f)
  );
$fn$;

comment on function public.platform_db_contract_check(text[], text[]) is
  'G-71a: read-only. Can service_role reach every table/function the app names, and anything else in public? Called daily by /api/cron/platform-health.';

revoke execute on function public.platform_db_contract_check(text[], text[]) from public, anon, authenticated;
grant execute on function public.platform_db_contract_check(text[], text[]) to service_role;


notify pgrst, 'reload schema';
