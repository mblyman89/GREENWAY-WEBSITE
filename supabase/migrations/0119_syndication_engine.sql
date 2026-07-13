-- =============================================================================
-- Task X — Syndication sync engine (Leafly / Weedmaps)
-- =============================================================================
-- Two small tables that turn the one-shot menu pushes into a professional,
-- owner-tunable sync engine:
--
--   1. syndication_sync_settings — ONE row per channel holding the owner's
--      transmission parameters (pacing, retries, field toggles, Leafly sync
--      mode, Weedmaps unpublish behavior, force-resend). The row stores a
--      jsonb blob; the app resolves + CLAMPS it through the pure
--      sync-settings-core resolvers, so unknown/garbage values can never
--      break a push (defaults win).
--
--   2. syndication_sync_state — ONE row per channel remembering the
--      id -> payload-hash map from the LAST SUCCESSFUL sync. This powers
--      delta plans (creates / updates / unchanged / deletes) and payload-hash
--      idempotency ("skipped — no changes"), and lets Weedmaps (which has NO
--      bulk endpoint) send only the per-item PUTs that actually changed.
--
-- Reuses: public.syndication_channel enum (0049), public.is_staff(),
--         public.set_updated_at() (earlier slices).
-- Idempotent: create-if-not-exists + drop-if-exists guards.
-- APPLY MANUALLY (owner) — after 0118.
-- =============================================================================

create table if not exists public.syndication_sync_settings (
  channel      public.syndication_channel primary key,
  -- Raw owner-entered settings; resolved + clamped in code (sync-settings-core).
  settings     jsonb not null default '{}'::jsonb,
  updated_by   uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_syndication_sync_settings_updated on public.syndication_sync_settings;
create trigger trg_syndication_sync_settings_updated
  before update on public.syndication_sync_settings
  for each row execute function public.set_updated_at();

alter table public.syndication_sync_settings enable row level security;

drop policy if exists syndication_sync_settings_staff_all on public.syndication_sync_settings;
create policy syndication_sync_settings_staff_all on public.syndication_sync_settings
  for all using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------

create table if not exists public.syndication_sync_state (
  channel          public.syndication_channel primary key,
  -- { "<stable item id>": "<8-hex payload hash>", ... } from the last SUCCESSFUL sync.
  item_hashes      jsonb not null default '{}'::jsonb,
  -- Published menu version the hashes were computed from (provenance).
  last_version_id  text,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_syndication_sync_state_updated on public.syndication_sync_state;
create trigger trg_syndication_sync_state_updated
  before update on public.syndication_sync_state
  for each row execute function public.set_updated_at();

alter table public.syndication_sync_state enable row level security;

drop policy if exists syndication_sync_state_staff_all on public.syndication_sync_state;
create policy syndication_sync_state_staff_all on public.syndication_sync_state
  for all using (public.is_staff()) with check (public.is_staff());
