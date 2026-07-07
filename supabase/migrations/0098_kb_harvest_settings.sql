-- ============================================================================
-- 0098_kb_harvest_settings.sql — Slice H7: Harvest Tuning control panel.
--
-- One singleton row (same pattern as discovery_settings, 0078) holding every
-- tunable knob of the KB harvest pipeline that was previously a hardcoded
-- constant in the web app:
--
--   • fast_lane_min_confidence / fast_lane_min_chars — the fast-lane bars
--     (review-lanes-core.ts). A draft must clear BOTH to be batch-acceptable.
--   • stale_after_days     — re-harvest cadence (harvest-freshness-core.ts).
--   • refresh_batch        — vendor sites per Tier-1 refresh click.
--   • trickle_batch        — lead sites per Tier-3 market-trickle click.
--   • batch_accept_cap     — max drafts one batch-accept click may apply.
--   • pending_limit        — pending drafts loaded per entity type in review.
--   • tier1/2/3_max_pages  — crawl depth presets per tier.
--   • tier3_delay_seconds  — politeness pause between Tier-3 sites.
--
-- FAIL-OPEN DESIGN: the app treats this table as OPTIONAL. If the row (or the
-- whole table) is missing, code falls back to the vetted defaults compiled
-- into src/lib/kb/harvest-settings-core.ts — which match the DB defaults
-- below. Nothing breaks if this migration hasn't been applied yet.
--
-- SAFETY: every column carries a CHECK constraint mirroring the app's
-- server-side clamps, so even a direct SQL write can't push a knob outside
-- its safe range. The crawler worker additionally enforces its own ceilings
-- (max_pages_per_site 1..50, delay 0..3600 — crawler/app/harvest.py).
--
-- Apply MANUALLY (owner runs migrations by hand, per standing rules).
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.kb_harvest_settings (
  id                        smallint primary key default 1,

  -- Fast-lane bars (review economics, H5)
  fast_lane_min_confidence  numeric(3,2) not null default 0.80
    constraint kb_hs_conf_range check (fast_lane_min_confidence >= 0.50 and fast_lane_min_confidence <= 0.99),
  fast_lane_min_chars       integer not null default 40
    constraint kb_hs_chars_range check (fast_lane_min_chars >= 10 and fast_lane_min_chars <= 500),

  -- Freshness cadence (H6)
  stale_after_days          integer not null default 90
    constraint kb_hs_stale_range check (stale_after_days >= 7 and stale_after_days <= 365),

  -- Cadence click batch sizes (H6)
  refresh_batch             integer not null default 25
    constraint kb_hs_refresh_range check (refresh_batch >= 1 and refresh_batch <= 100),
  trickle_batch             integer not null default 25
    constraint kb_hs_trickle_range check (trickle_batch >= 1 and trickle_batch <= 100),

  -- Review inbox bounds (H5)
  batch_accept_cap          integer not null default 50
    constraint kb_hs_cap_range check (batch_accept_cap >= 1 and batch_accept_cap <= 200),
  pending_limit             integer not null default 1000
    constraint kb_hs_pending_range check (pending_limit >= 100 and pending_limit <= 5000),

  -- Tier depth presets (H4) — crawler hard ceiling is 50 pages/site
  tier1_max_pages           integer not null default 25
    constraint kb_hs_t1_range check (tier1_max_pages >= 1 and tier1_max_pages <= 50),
  tier2_max_pages           integer not null default 10
    constraint kb_hs_t2_range check (tier2_max_pages >= 1 and tier2_max_pages <= 50),
  tier3_max_pages           integer not null default 3
    constraint kb_hs_t3_range check (tier3_max_pages >= 1 and tier3_max_pages <= 50),
  tier3_delay_seconds       integer not null default 60
    constraint kb_hs_t3delay_range check (tier3_delay_seconds >= 0 and tier3_delay_seconds <= 3600),

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint kb_harvest_settings_singleton check (id = 1)
);

-- Seed the singleton row (no-op if it already exists).
insert into public.kb_harvest_settings (id) values (1) on conflict (id) do nothing;

-- updated_at trigger (reuses the shared helper from 0001).
drop trigger if exists set_updated_at_kb_harvest_settings on public.kb_harvest_settings;
create trigger set_updated_at_kb_harvest_settings
  before update on public.kb_harvest_settings
  for each row execute function public.set_updated_at();

-- RLS — staff read; writes go through the service-role server actions, but we
-- mirror discovery_settings (staff read + write) for consistency. The page
-- itself is additionally gated by the settings.manage permission (owner/admin).
alter table public.kb_harvest_settings enable row level security;

drop policy if exists kb_harvest_settings_read on public.kb_harvest_settings;
create policy kb_harvest_settings_read on public.kb_harvest_settings
  for select using (public.is_staff());

drop policy if exists kb_harvest_settings_write on public.kb_harvest_settings;
create policy kb_harvest_settings_write on public.kb_harvest_settings
  for all using (public.is_staff()) with check (public.is_staff());
