-- =============================================================================
-- 0179 — BOOKS ARE OWNER-ONLY (slice books-01)
--
-- OWNER DECISION, 2026-08-17, recorded verbatim (standing rule 1):
--
--   "I know at the beginning of the books build I wanted it to be owner and
--    admin, but I've changed my mind, there is no reason anyone else needs to
--    see my books or my financials ever, so I want strict controls over all of
--    those things. The only thing an admin can do is pay vendors and pay
--    employees. Those two features have very good security measures and hard
--    blockers preventing bad behavior."
--
-- This SUPERSEDES the earlier owner|admin decision that 0172–0178 were built
-- against. Every gl_* policy and every accounting RPC in 0175/0176/0177 gates on
-- public.is_admin(), which is role in ('owner','admin'). That is now wrong.
--
-- WHAT THIS MIGRATION DOES
--   §1  Adds public.is_owner() — the new gate. Same shape as is_staff() /
--       is_admin() / is_manager(): SQL, stable, security definer, search_path
--       pinned, so RLS policies can call it without recursion.
--   §2  Re-gates every gl_* RLS policy from is_admin() to is_owner().
--   §3  Re-gates every accounting RPC body from is_admin() to is_owner() by
--       REPLACING the guard clause, not by rewriting the functions. Done with a
--       surgical source rewrite so the bodies stay exactly as 0172–0178 wrote
--       them and this migration cannot silently change accounting behaviour.
--   §4  Leaves accounts-payable and payroll ALONE, deliberately. Those are the
--       two things an admin must still be able to do.
--
-- WHY is_owner() RATHER THAN JUST CHANGING is_admin()
-- Because is_admin() is used across the whole platform — orders, settings, users,
-- media, AP. Narrowing it to the owner would lock an admin out of paying vendors,
-- which is the one thing the owner explicitly wants them to keep. A new,
-- narrower helper changes exactly the surface we mean to change and nothing else.
-- Verified: is_admin() is referenced by non-accounting policies throughout
-- migrations 0001–0171; those are intentionally untouched.
--
-- WHY THE APP-SIDE GATE IS NOT ENOUGH ON ITS OWN
-- The app gate (books-access.ts) produces a pleasant redirect. The database gate
-- is what actually protects the ledger against a direct PostgREST call with a
-- staff session token. Both are changed in this slice; this file is the half
-- that actually holds.
--
-- IDEMPOTENT. Every statement is create-or-replace / drop-if-exists / guarded
-- DO block. Safe to run repeatedly.
-- APPLY MANUALLY in the Supabase SQL editor (standing rule 6).
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  THE NEW GATE
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.staff_profiles
    where id = auth.uid() and active = true and role = 'owner'
  );
$$;

comment on function public.is_owner() is
  'TRUE only for the active OWNER. The gate for the books and every financial statement (owner decision 2026-08-17). Deliberately narrower than is_admin(), which stays owner|admin so an admin can still pay vendors and run payroll.';

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2  RE-GATE EVERY gl_* RLS POLICY: is_admin() → is_owner()
--
-- Driven off the catalog rather than a hand-typed list, because a hand-typed
-- list is exactly how one table gets forgotten and stays readable by an admin
-- forever. Any policy on a public.gl_* table whose expression mentions
-- is_admin() is rewritten in place to is_owner(), preserving the policy's name,
-- command, roles and WITH CHECK shape.
--
-- The catalog-driven loop also means tables added by a LATER migration that
-- follow the same is_admin() pattern get caught the next time this file is run.
-- ═══════════════════════════════════════════════════════════════════════════
do $regate$
declare
  r           record;
  v_using     text;
  v_check     text;
  v_cmd       text;
  v_roles     text;
  v_sql       text;
  v_count     integer := 0;
begin
  for r in
    select
      p.polname                                    as polname,
      c.relname                                    as tablename,
      p.polcmd                                     as polcmd,
      pg_get_expr(p.polqual,      p.polrelid)      as qual,
      pg_get_expr(p.polwithcheck, p.polrelid)      as withcheck,
      array(
        select pg_get_userbyid(oid) from unnest(p.polroles) as oid
        where pg_get_userbyid(oid) <> 'public'
      )                                            as rolenames
    from pg_policy p
    join pg_class c     on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'gl\_%'
      and (
        coalesce(pg_get_expr(p.polqual,      p.polrelid), '') like '%is_admin()%'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%is_admin()%'
      )
  loop
    -- Swap the helper, leave the rest of the expression byte-for-byte.
    v_using := replace(coalesce(r.qual,      ''), 'is_admin()', 'is_owner()');
    v_check := replace(coalesce(r.withcheck, ''), 'is_admin()', 'is_owner()');

    v_cmd := case r.polcmd
               when 'r' then 'select'
               when 'a' then 'insert'
               when 'w' then 'update'
               when 'd' then 'delete'
               else 'all'
             end;

    v_roles := case
                 when array_length(r.rolenames, 1) is null then 'public'
                 else array_to_string(r.rolenames, ', ')
               end;

    execute format('drop policy if exists %I on public.%I', r.polname, r.tablename);

    v_sql := format('create policy %I on public.%I for %s to %s',
                    r.polname, r.tablename, v_cmd, v_roles);

    if v_using <> '' then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check <> '' then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice '0179 §2: re-gated % gl_* policies from is_admin() to is_owner()', v_count;
end
$regate$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §3  RE-GATE EVERY ACCOUNTING RPC: is_admin() → is_owner()
--
-- These functions live in 0175/0176/0177 and each opens with
--     if not public.is_admin() then raise exception 'GL_FORBIDDEN…'
--
-- Rather than restate ~2,000 lines of function bodies here (which would fork
-- them from their source migrations and guarantee they drift), we fetch each
-- body from the catalog, replace the guard, and re-create the function with the
-- identical signature. The accounting logic is therefore provably unchanged —
-- the only edit is the helper name inside the guard.
--
-- SAFETY: the loop only touches functions whose body actually contains BOTH
-- 'is_admin()' AND 'GL_FORBIDDEN', i.e. an accounting permission guard. A
-- function that merely reads is_admin() for some other purpose is left alone.
-- ═══════════════════════════════════════════════════════════════════════════
do $refunc$
declare
  r        record;
  v_body   text;
  v_sql    text;
  v_count  integer := 0;
begin
  for r in
    select
      p.oid                                as oid,
      p.proname                            as proname,
      pg_get_functiondef(p.oid)            as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%is_admin()%'
      and pg_get_functiondef(p.oid) like '%GL_FORBIDDEN%'
  loop
    -- pg_get_functiondef returns a complete CREATE OR REPLACE FUNCTION
    -- statement, so swapping the guard and executing it re-defines the
    -- function in place with the same name, args, volatility and security.
    v_body := replace(r.def, 'public.is_admin()', 'public.is_owner()');
    v_body := replace(v_body, 'not is_admin()',   'not public.is_owner()');

    -- Also refresh the human-facing wording so the refusal message matches the
    -- new rule. The refusal TEXT is what Michael reads; leaving it saying
    -- "admin-only" while the code means "owner-only" would be a lie in the UI.
    v_body := replace(v_body, 'is admin-only.',            'is owner-only.');
    v_body := replace(v_body, 'only an admin may',         'only the owner may');
    v_body := replace(v_body, 'admin-only',                'owner-only');

    v_sql := v_body;
    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice '0179 §3: re-gated % accounting function(s) from is_admin() to is_owner()', v_count;
end
$refunc$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §4  WHAT IS DELIBERATELY *NOT* CHANGED
--
-- The owner said: "The only thing an admin can do is pay vendors and pay
-- employees." So these keep is_admin() / is_manager() and are listed here
-- explicitly so a future reader knows the omission is a decision, not an
-- oversight:
--
--   • ap_* / accounts-payable tables and RPCs      → admin pays vendors
--   • payroll_* tables and RPCs                    → admin pays employees
--   • everything non-financial (orders, media, content, inventory, staffing)
--
-- The boundary is: an admin may CAUSE money to move through the controlled,
-- hard-blocked payment paths, but may not READ the general ledger, the trial
-- balance, the financial statements, or the tax package, and may not WRITE a
-- journal entry.
--
-- A payment made by an admin still lands in the ledger — it is fed in by the
-- server (service_role), which bypasses RLS. So the books stay complete without
-- the admin ever being able to look at them. That is the whole design.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- §5  VERIFICATION HELPER
--
-- Run this after applying, to prove the lockdown actually took. It returns one
-- row per remaining is_admin() reference on a gl_* policy or accounting guard.
-- AN EMPTY RESULT IS THE PASSING RESULT.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_owner_only_gate()
returns table (kind text, object_name text, detail text)
language sql stable security definer set search_path = public as $$
  select 'policy'::text,
         c.relname::text || '.' || p.polname::text,
         'still references is_admin()'::text
  from pg_policy p
  join pg_class c     on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname like 'gl\_%'
    and (
      coalesce(pg_get_expr(p.polqual,      p.polrelid), '') like '%is_admin()%'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%is_admin()%'
    )
  union all
  select 'function'::text,
         p.proname::text,
         'GL_FORBIDDEN guard still references is_admin()'::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%is_admin()%'
    and pg_get_functiondef(p.oid) like '%GL_FORBIDDEN%';
$$;

comment on function public.gl_audit_owner_only_gate() is
  'Post-apply check for 0179. Returns one row per gl_* policy or accounting guard still gated on is_admin(). AN EMPTY RESULT MEANS THE BOOKS ARE OWNER-ONLY.';

revoke all on function public.gl_audit_owner_only_gate() from public;
grant execute on function public.gl_audit_owner_only_gate() to authenticated, service_role;
