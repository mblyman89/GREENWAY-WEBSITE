-- Minimal stand-in for the dependency chain 0192 needs, so the migration can be
-- executed for real without replaying 191 migrations. Every object here mirrors
-- the shape of the real one (verified by reading the real migrations).
create extension if not exists pgcrypto;

-- --- role stand-ins ----------------------------------------------------------
-- Supabase creates these roles for us; plain PostgreSQL does not. Without them
-- 0192's `grant execute ... to authenticated, service_role` fails outright with
-- 'role "authenticated" does not exist'.
--
-- This was NOT theoretical here. The first run of
-- verify-inventory-audit-post.sh failed on exactly that line, and it only
-- surfaced because the verify script captures psql's OWN exit status instead of
-- piping it through grep first. The gl-schema-harness carries the same comment
-- for the same reason: an access-control defect in 0175 stayed hidden for a
-- while because a verify script was swallowing this error.
--
-- NOLOGIN: nothing here can be connected to. They exist so that grants resolve,
-- and so `set role` can prove a budtender genuinely cannot post an audit.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to authenticated, anon, service_role;

create table staff_profiles (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  active boolean not null default true
);

-- Test doubles for auth. Replaced per-test to simulate who is signed in.
create schema if not exists auth;
create table auth_state (uid uuid);
create or replace function auth.uid() returns uuid language sql stable as $$
  select uid from auth_state limit 1;
$$;

create or replace function public.is_owner() returns boolean language sql stable as $$
  select exists(select 1 from staff_profiles where id = auth.uid() and active and role='owner');
$$;
create or replace function public.is_staff() returns boolean language sql stable as $$
  select exists(select 1 from staff_profiles where id = auth.uid() and active);
$$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table inventory_lots (
  id uuid primary key default gen_random_uuid(),
  lot_code text,
  pos_product_key text,
  on_hand_qty numeric not null default 0,
  unit_cost_minor_units integer,
  status text not null default 'active',
  updated_by uuid
);

create table inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references inventory_lots(id) on delete cascade,
  qty_delta numeric not null,
  reason text not null,
  note text,
  actor_id uuid references staff_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table cycle_counts (id uuid primary key default gen_random_uuid());
create table cycle_count_lines (id uuid primary key default gen_random_uuid());
