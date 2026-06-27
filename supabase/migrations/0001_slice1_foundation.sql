-- =============================================================================
-- Greenway Back Office — Slice 1: Foundation
-- Tables: staff profiles + roles, audit_logs, media_assets, media_usages,
--         site_settings. Plus RLS, helper functions, and triggers.
-- Money is stored as integer minor units (cents). Timestamps are UTC.
-- =============================================================================

-- ---------- Extensions -------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------- Enums ------------------------------------------------------------
do $$ begin
  create type staff_role as enum ('owner','admin','manager','content_editor','staff','readonly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asset_status as enum ('draft','published','archived');
exception when duplicate_object then null; end $$;

-- ---------- staff_profiles ---------------------------------------------------
-- One row per back-office user, linked 1:1 to auth.users (Supabase Auth).
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
create index if not exists idx_staff_profiles_role on public.staff_profiles(role);

-- ---------- audit_logs -------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.staff_profiles(id) on delete set null,
  actor_email text,
  action      text not null,
  entity_type text,
  entity_id   text,
  before_json jsonb,
  after_json  jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_actor on public.audit_logs(actor_id);
create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);

-- ---------- media_assets -----------------------------------------------------
create table if not exists public.media_assets (
  id             uuid primary key default gen_random_uuid(),
  storage_key    text not null,
  public_url     text,
  filename       text not null,
  mime_type      text,
  size_bytes     bigint,
  width          integer,
  height         integer,
  alt_text       text,
  title          text,
  description    text,
  source         text,
  license_status text,
  usage_type     text,
  tags           text[] not null default '{}',
  focal_x        numeric default 0.5,
  focal_y        numeric default 0.5,
  status         asset_status not null default 'draft',
  uploaded_by    uuid references public.staff_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_media_usage_type on public.media_assets(usage_type);
create index if not exists idx_media_status on public.media_assets(status);
create index if not exists idx_media_tags on public.media_assets using gin(tags);

-- ---------- media_usages -----------------------------------------------------
create table if not exists public.media_usages (
  id              bigint generated always as identity primary key,
  media_asset_id  uuid not null references public.media_assets(id) on delete cascade,
  entity_type     text not null,
  entity_id       text not null,
  field_key       text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_media_usages_asset on public.media_usages(media_asset_id);
create index if not exists idx_media_usages_entity on public.media_usages(entity_type, entity_id);

-- ---------- site_settings ----------------------------------------------------
create table if not exists public.site_settings (
  key              text primary key,
  value_json       jsonb,
  draft_value_json jsonb,
  label            text,
  published_at     timestamptz,
  updated_by       uuid references public.staff_profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- =============================================================================
-- Helper functions
-- =============================================================================

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_staff_updated on public.staff_profiles;
create trigger trg_staff_updated before update on public.staff_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_media_updated on public.media_assets;
create trigger trg_media_updated before update on public.media_assets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_settings_updated on public.site_settings;
create trigger trg_settings_updated before update on public.site_settings
  for each row execute function public.set_updated_at();

-- current user's role (security definer so RLS can call it without recursion)
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

-- Auto-create a staff_profile when a new auth user signs up.
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

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.staff_profiles enable row level security;
alter table public.audit_logs     enable row level security;
alter table public.media_assets   enable row level security;
alter table public.media_usages   enable row level security;
alter table public.site_settings  enable row level security;

-- staff_profiles: a user can read their own row; admins read all; admins write all.
drop policy if exists staff_self_read on public.staff_profiles;
create policy staff_self_read on public.staff_profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists staff_admin_write on public.staff_profiles;
create policy staff_admin_write on public.staff_profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- audit_logs: any active staff can read; inserts happen via service role only.
drop policy if exists audit_staff_read on public.audit_logs;
create policy audit_staff_read on public.audit_logs
  for select using (public.is_staff());

-- media_assets: active staff read/write (granular role checks enforced in app layer).
drop policy if exists media_staff_read on public.media_assets;
create policy media_staff_read on public.media_assets
  for select using (public.is_staff());
drop policy if exists media_staff_write on public.media_assets;
create policy media_staff_write on public.media_assets
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists media_usage_staff on public.media_usages;
create policy media_usage_staff on public.media_usages
  for all using (public.is_staff()) with check (public.is_staff());

-- site_settings: staff read; admin/manager write (enforced in app; RLS allows staff write, app gates).
drop policy if exists settings_staff_read on public.site_settings;
create policy settings_staff_read on public.site_settings
  for select using (public.is_staff());
drop policy if exists settings_staff_write on public.site_settings;
create policy settings_staff_write on public.site_settings
  for all using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- Storage bucket for the media library (private; served via signed URLs)
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists media_bucket_staff_read on storage.objects;
create policy media_bucket_staff_read on storage.objects
  for select using (bucket_id = 'media' and public.is_staff());

drop policy if exists media_bucket_staff_write on storage.objects;
create policy media_bucket_staff_write on storage.objects
  for all using (bucket_id = 'media' and public.is_staff())
  with check (bucket_id = 'media' and public.is_staff());
