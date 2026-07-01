-- =============================================================================
-- 0053_integration_credentials.sql  (Slice 60)
--
-- Lets the owner enter external-service API keys / credentials from the back
-- office instead of editing environment variables. Grounded on the existing
-- integrations (Leafly Menu Integration API v2.0, WeedMaps Menu API 2025-07)
-- config surface in src/lib/leafly/config.ts and src/lib/weedmaps/config.ts.
--
-- Design:
--   * A single-row (singleton) settings table, same pattern as
--     public.accounting_settings (id boolean primary key default true).
--   * Stores exactly the fields the two config getters read. Environment
--     variables remain a fallback; a non-empty DB value OVERRIDES the env.
--   * These are SECRETS: SELECT is restricted to admins (owner/admin), not all
--     staff, and the application layer masks secret values on read. WRITE is
--     admin-only. RLS mirrors the accounting_settings admin-write pattern but
--     tightens read to admins.
--
-- No values are seeded (an empty row = "use env / not configured"). Nothing is
-- pushed to any third party as a result of this migration.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

create table if not exists public.integration_credentials (
  id                            boolean primary key default true,

  -- Leafly Menu Integration API v2.0 (src/lib/leafly/config.ts) ---------------
  -- 'sandbox' | 'production'
  leafly_environment            text not null default 'sandbox',
  leafly_menu_integration_key   text not null default '',
  leafly_client_id              text not null default '',
  leafly_client_secret          text not null default '',

  -- WeedMaps Menu API 2025-07 (src/lib/weedmaps/config.ts) --------------------
  -- 'sandbox' | 'production'
  weedmaps_environment          text not null default 'sandbox',
  weedmaps_menu_id              text not null default '',
  weedmaps_client_id            text not null default '',
  weedmaps_client_secret        text not null default '',
  -- Optional pre-provisioned bearer token (onboarding shortcut).
  weedmaps_access_token         text not null default '',
  -- Optional overrides (verified defaults live in code). Empty = use default.
  weedmaps_token_url            text not null default '',
  weedmaps_scope                text not null default '',

  updated_at                    timestamptz not null default now(),
  created_at                    timestamptz not null default now(),

  constraint integration_credentials_singleton check (id = true)
);

drop trigger if exists trg_integration_credentials_updated on public.integration_credentials;
create trigger trg_integration_credentials_updated
  before update on public.integration_credentials
  for each row execute function public.set_updated_at();

-- Seed the single empty row so the app can always upsert-by-id.
insert into public.integration_credentials (id) values (true)
on conflict (id) do nothing;

-- RLS -------------------------------------------------------------------------
alter table public.integration_credentials enable row level security;

-- Secrets: only admins (owner/admin) may read.
drop policy if exists "integration_credentials admin read" on public.integration_credentials;
create policy "integration_credentials admin read" on public.integration_credentials
  for select using (public.is_admin());

-- Only admins (owner/admin) may write.
drop policy if exists "integration_credentials admin write" on public.integration_credentials;
create policy "integration_credentials admin write" on public.integration_credentials
  for all using (public.is_admin()) with check (public.is_admin());
