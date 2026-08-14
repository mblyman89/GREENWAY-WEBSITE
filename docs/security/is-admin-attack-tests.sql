-- ===========================================================================
-- is_admin() AUDIT — ATTACK TESTS (throwaway PostgreSQL, harness roles)
-- Every claim in the audit report about runtime behavior is proven HERE.
-- Mirrors the F1–F4 suites: raise exception on failure, notice PASS on pass.
-- ===========================================================================
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Harness: auth schema + auth.uid() stub (plain PG lacks Supabase's auth).
-- auth.uid() reads a session config, exactly like Supabase's implementation
-- reads the JWT subject.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase roles (idempotent)
do $$ begin
  begin create role authenticated nologin; exception when duplicate_object then null; end;
  begin create role anon nologin; exception when duplicate_object then null; end;
  begin create role service_role nologin bypassrls; exception when duplicate_object then null; end;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Apply the REAL definitions from 0001 verbatim (staff_profiles + helpers +
-- RLS policies + the auto-provision trigger), so we attack the real thing.
-- ---------------------------------------------------------------------------
do $$ begin
  create type staff_role as enum ('owner','admin','manager','content_editor','staff','readonly');
exception when duplicate_object then null; end $$;

create table if not exists public.staff_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  role          staff_role not null default 'readonly',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create or replace function public.current_staff_role()
returns staff_role language sql stable security definer set search_path = public as $$
  select role from public.staff_profiles where id = auth.uid() and active = true;
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff_profiles where id = auth.uid() and active = true);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.staff_profiles
    where id = auth.uid() and active = true and role in ('owner','admin')
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.staff_profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.staff_profiles enable row level security;

drop policy if exists staff_self_read on public.staff_profiles;
create policy staff_self_read on public.staff_profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists staff_admin_write on public.staff_profiles;
create policy staff_admin_write on public.staff_profiles
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.staff_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: one owner, one budtender, one inactive ex-admin, one readonly default.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@x'),
  ('00000000-0000-0000-0000-00000000000b', 'bud@x'),
  ('00000000-0000-0000-0000-00000000000c', 'exadmin@x'),
  ('00000000-0000-0000-0000-00000000000d', 'newhire@x')
on conflict do nothing;

update public.staff_profiles set role = 'owner'  where id = '00000000-0000-0000-0000-00000000000a';
update public.staff_profiles set role = 'staff'  where id = '00000000-0000-0000-0000-00000000000b';
update public.staff_profiles set role = 'admin', active = false where id = '00000000-0000-0000-0000-00000000000c';
-- 'newhire' keeps the table default on purpose — that IS the test.

-- helper to run assertions
create or replace function public.audit_assert(label text, got boolean, want boolean)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  % (got %, want %)', label, got, want;
  end if;
  raise notice '  PASS  %', label;
end $$;

-- ===========================================================================
-- ATTACK 1 — baseline truth table. is_admin() must be true ONLY for the
-- active owner/admin. Everyone else false, including tricky states.
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 1 — the truth table'; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.audit_assert('active owner -> true', public.is_admin(), true);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.audit_assert('budtender -> false', public.is_admin(), false);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.audit_assert('INACTIVE admin -> false (the fired-admin test)', public.is_admin(), false);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select public.audit_assert('brand-new signup (default role) -> false', public.is_admin(), false);

-- ===========================================================================
-- ATTACK 2 — the anonymous/no-session cases. auth.uid() returns NULL for
-- anon. NULL = ... is NULL, exists() over it must be false, never null.
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 2 — no session / garbage session'; end $$;

select set_config('request.jwt.claim.sub', '', false);
select public.audit_assert('no session (uid null) -> false, not null',
  coalesce(public.is_admin(), true) = false, true);
select public.audit_assert('is_staff() with no session -> false too',
  coalesce(public.is_staff(), true) = false, true);

-- a syntactically valid uuid that matches NO user
select set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', false);
select public.audit_assert('valid-but-unknown uuid -> false', public.is_admin(), false);

-- ===========================================================================
-- ATTACK 3 — self-escalation through RLS. A budtender must not be able to
-- UPDATE their own role via the API path (RLS as authenticated).
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 3 — self-escalation via RLS'; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;

-- vacuity guard: if we are still superuser, RLS is bypassed and this test lies
do $$ begin
  if (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'TEST IS VACUOUS: still superuser';
  end if;
end $$;

-- the budtender tries to promote themselves
update public.staff_profiles set role = 'owner'
  where id = '00000000-0000-0000-0000-00000000000b';

reset role;
select public.audit_assert('budtender self-promotion silently updates ZERO rows (RLS write policy)',
  (select role = 'staff' from public.staff_profiles where id = '00000000-0000-0000-0000-00000000000b'),
  true);

-- the budtender tries to INSERT a fake admin profile for themselves
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare v_err text;
begin
  begin
    insert into public.staff_profiles (id, email, role)
    values ('00000000-0000-0000-0000-00000000000b', 'bud@x', 'owner');
    raise exception 'BREACH: insert of admin profile was ACCEPTED';
  exception
    when unique_violation then
      raise notice '  PASS  fake-profile insert blocked (pk conflict before policy mattered)';
    when insufficient_privilege or check_violation then
      raise notice '  PASS  fake-profile insert blocked by RLS/with check';
    when others then
      get stacked diagnostics v_err = returned_sqlstate;
      if v_err = '42501' then
        raise notice '  PASS  fake-profile insert blocked (42501)';
      else
        raise;
      end if;
  end;
end $$;
reset role;

-- can the budtender READ other people's profiles? Policy says self-or-admin.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.audit_assert('budtender sees ONLY their own profile row',
  (select count(*) from public.staff_profiles) = 1, true);
reset role;

-- ===========================================================================
-- ATTACK 4 — the deactivated-admin session. Deactivating must cut access
-- IMMEDIATELY on the next is_admin() call (no caching betrayal).
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 4 — deactivation takes effect immediately'; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.audit_assert('owner is admin before deactivation', public.is_admin(), true);
update public.staff_profiles set active = false where id = '00000000-0000-0000-0000-00000000000a';
select public.audit_assert('owner is NOT admin after active=false — same session, same statement stream',
  public.is_admin(), false);
update public.staff_profiles set active = true where id = '00000000-0000-0000-0000-00000000000a';
select public.audit_assert('restore: owner is admin again', public.is_admin(), true);

-- ===========================================================================
-- ATTACK 5 — role-demotion takes effect immediately (stable ≠ cached-forever;
-- stable only means "within a single statement").
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 5 — demotion is immediate'; end $$;

update public.staff_profiles set role = 'manager' where id = '00000000-0000-0000-0000-00000000000a';
select public.audit_assert('demoted to manager -> is_admin false', public.is_admin(), false);
update public.staff_profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
select public.audit_assert('restore to owner -> true', public.is_admin(), true);

-- ===========================================================================
-- ATTACK 6 — the auto-provision trigger. A brand-new auth user must arrive
-- as role=readonly / not as anything privileged, and a RE-signup (conflict)
-- must NOT reset an existing profile.
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 6 — auto-provision safety'; end $$;

-- reset state so the suite is re-runnable (cascade removes the profiles)
delete from auth.users where id in
  ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'fresh@x');
select public.audit_assert('trigger created profile with role=readonly',
  (select role = 'readonly' from public.staff_profiles where id = '00000000-0000-0000-0000-00000000000e'),
  true);
select public.audit_assert('trigger created profile with active=true (finding: see report)',
  (select active from public.staff_profiles where id = '00000000-0000-0000-0000-00000000000e'),
  true);

-- attacker-controlled metadata must not influence the role
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-00000000000f', 'evil@x', '{"role":"owner","full_name":"EVIL"}');
select public.audit_assert('metadata role=owner is IGNORED by the trigger (still readonly)',
  (select role = 'readonly' from public.staff_profiles where id = '00000000-0000-0000-0000-00000000000f'),
  true);

-- re-insert conflict does not clobber an existing role
delete from auth.users where id = '00000000-0000-0000-0000-00000000000e';
-- (cascade removed profile; recreate as admin then simulate re-signup)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'fresh@x');
update public.staff_profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000e';
-- direct trigger-path re-fire: on conflict do nothing must keep admin
insert into public.staff_profiles (id, email, full_name)
  values ('00000000-0000-0000-0000-00000000000e', 'fresh@x', 'X')
  on conflict (id) do nothing;
select public.audit_assert('re-provision does NOT downgrade an existing role',
  (select role = 'admin' from public.staff_profiles where id = '00000000-0000-0000-0000-00000000000e'),
  true);

-- ===========================================================================
-- ATTACK 7 — search_path hijack. is_admin() pins search_path=public. Prove
-- that a malicious schema earlier in the caller's search_path cannot swap
-- in a fake staff_profiles.
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 7 — search_path hijack'; end $$;

create schema if not exists evil;
create table if not exists evil.staff_profiles (
  id uuid primary key, email text, role staff_role default 'owner', active boolean default true
);
insert into evil.staff_profiles (id, email, role, active)
  values ('00000000-0000-0000-0000-00000000000b', 'bud@x', 'owner', true)
  on conflict do nothing;
grant usage on schema evil to authenticated;
grant select on evil.staff_profiles to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
set search_path = evil, public;
select public.audit_assert('budtender with evil schema FIRST in search_path: is_admin still false',
  public.is_admin(), false);
reset search_path;
reset role;

-- ===========================================================================
-- ATTACK 8 — who can WRITE the deciding table outside RLS? Enumerate table
-- privileges on staff_profiles for the API-visible roles. anon must have
-- NOTHING; authenticated goes through RLS (proven in attack 3).
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 8 — privilege enumeration on the deciding table'; end $$;

select public.audit_assert('anon has NO select on staff_profiles',
  has_table_privilege('anon', 'public.staff_profiles', 'select'), false);
select public.audit_assert('anon has NO update on staff_profiles',
  has_table_privilege('anon', 'public.staff_profiles', 'update'), false);
select public.audit_assert('authenticated CAN reach the table (RLS then filters rows)',
  has_table_privilege('authenticated', 'public.staff_profiles', 'select'), true);

-- ===========================================================================
-- ATTACK 9 — execute-permission on is_admin itself. If anon can call it it
-- returns false anyway (uid null), but enumerate to document the surface.
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 9 — who may call is_admin()'; end $$;

select public.audit_assert('is_admin is callable by authenticated (needed by RLS)',
  has_function_privilege('authenticated', 'public.is_admin()', 'execute'), true);
-- default PUBLIC execute on functions — document it; harmless here but note it
select public.audit_assert('is_admin callable by anon (DEFAULT PUBLIC EXECUTE — finding, low sev)',
  has_function_privilege('anon', 'public.is_admin()', 'execute'), true);

-- ===========================================================================
-- ATTACK 10 — NULL role / weird row states cannot sneak past.
-- role is NOT NULL by DDL; prove the constraint holds.
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 10 — the deciding row cannot be malformed'; end $$;

do $$
begin
  begin
    update public.staff_profiles set role = null where id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'BREACH: null role was ACCEPTED';
  exception when not_null_violation then
    raise notice '  PASS  role NOT NULL is enforced by DDL';
  end;
end $$;

do $$
begin
  begin
    update public.staff_profiles set role = 'superadmin' where id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'BREACH: unknown role accepted';
  exception when invalid_text_representation then
    raise notice '  PASS  unknown role rejected by the enum';
  end;
end $$;

-- ===========================================================================
-- ATTACK 11 — the blast radius of is_staff vs is_admin. The financial
-- foundations (0156 atm, 0157 plaid, 0160 crypto, 0168/0170/0171) gate with
-- is_staff() FOR ALL. Replicate one such table with the verbatim policy shape
-- and prove a BUDTENDER can read AND write it, while an is_admin-gated table
-- (the 0143/0172 shape) refuses the same budtender. This grounds the
-- report's top finding by execution.
-- ===========================================================================
do $$ begin raise notice ''; raise notice 'ATTACK 11 — is_staff blast radius on financial tables'; end $$;

create table if not exists public.sim_plaid_transactions (
  id bigint generated always as identity primary key,
  account text, amount_cents bigint, memo text
);
alter table public.sim_plaid_transactions enable row level security;
drop policy if exists sim_plaid_staff_all on public.sim_plaid_transactions;
create policy sim_plaid_staff_all on public.sim_plaid_transactions
  for all using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.sim_plaid_transactions to authenticated;

create table if not exists public.sim_payee_banking (
  id bigint generated always as identity primary key,
  payee text, routing text, account text
);
alter table public.sim_payee_banking enable row level security;
drop policy if exists sim_payee_admin_all on public.sim_payee_banking;
create policy sim_payee_admin_all on public.sim_payee_banking
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.sim_payee_banking to authenticated;

delete from public.sim_plaid_transactions;
delete from public.sim_payee_banking;
insert into public.sim_plaid_transactions (account, amount_cents, memo)
  values ('owner-personal-checking', -250000, 'mortgage payment');
insert into public.sim_payee_banking (payee, routing, account)
  values ('vendor-x', '325081403', '999999');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;

do $$ begin
  if (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'TEST IS VACUOUS: still superuser';
  end if;
end $$;

select public.audit_assert('FINDING PROVEN: budtender READS the plaid-shaped table (is_staff gate)',
  (select count(*) from public.sim_plaid_transactions) = 1, true);

insert into public.sim_plaid_transactions (account, amount_cents, memo)
  values ('injected-by-budtender', 1, 'tamper');
select public.audit_assert('FINDING PROVEN: budtender WRITES the plaid-shaped table (for all + is_staff)',
  (select count(*) from public.sim_plaid_transactions) = 2, true);

select public.audit_assert('CONTRAST: the is_admin-gated table shows the budtender ZERO rows',
  (select count(*) from public.sim_payee_banking) = 0, true);

reset role;
drop table public.sim_plaid_transactions;
drop table public.sim_payee_banking;

do $$ begin raise notice ''; raise notice 'ALL is_admin ATTACKS COMPLETE'; end $$;
