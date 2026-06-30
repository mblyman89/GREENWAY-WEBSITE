-- =============================================================================
-- Slice 40 — Menu syndication logs (Leafly / WeedMaps)
-- =============================================================================
-- One row per syndication attempt (preview/dry-run OR live push) so staff have
-- an auditable history of what menu payload was sent to a third-party channel,
-- when, by whom, and what the channel returned. The actual payload + response
-- are stored as jsonb for transparency during certification.
--
-- STANDING RULE: nothing is pushed automatically. A "preview" row records the
-- exact JSON we WOULD send (dry-run); a "live" row is only written when the
-- owner explicitly confirms a push and credentials are present.
--
-- Reuses: public.is_staff(), public.set_updated_at() (earlier slices).
-- Idempotent: create-if-not-exists + drop-if-exists guards.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'syndication_channel') then
    create type public.syndication_channel as enum ('leafly', 'weedmaps');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'syndication_mode') then
    create type public.syndication_mode as enum ('preview', 'live');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'syndication_status') then
    create type public.syndication_status as enum ('ok', 'error', 'skipped');
  end if;
end$$;

create table if not exists public.syndication_logs (
  id           uuid primary key default gen_random_uuid(),
  channel      public.syndication_channel not null,
  mode         public.syndication_mode not null,
  status       public.syndication_status not null default 'ok',
  item_count   integer not null default 0,
  -- The exact payload we built (preview) or sent (live).
  payload      jsonb not null default '{}'::jsonb,
  -- The channel's response (live only); null for preview.
  response     jsonb,
  message      text,
  created_by   uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists syndication_logs_channel_idx
  on public.syndication_logs (channel, created_at desc);

alter table public.syndication_logs enable row level security;

drop policy if exists syndication_logs_staff_all on public.syndication_logs;
create policy syndication_logs_staff_all on public.syndication_logs
  for all using (public.is_staff()) with check (public.is_staff());
