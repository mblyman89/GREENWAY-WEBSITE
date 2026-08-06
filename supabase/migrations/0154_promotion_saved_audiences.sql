-- =============================================================================
-- PR-P2 — Promotion "smart audiences" (saved, reusable selection predicates)
-- =============================================================================
-- Table: promotion_saved_audiences
--
-- A "smart audience" is a NAMED, saved SelectionPredicate — the typed filter the
-- deterministic selection brain (src/lib/promotions/promotion-selector-core.ts)
-- resolves against the live menu. Example: "All Eighths", "Everything over 20%
-- THC", "CBD & Ratio Products", "New Arrivals This Week". The owner builds a
-- predicate once, saves it with a name, and reuses it on any promotion instead
-- of rebuilding the same conditions every time.
--
-- Michael approved this ("saved audiences is wise as well"). It is the explicit,
-- OWNER-CONTROLLED semantic reuse that enterprise promo engines call "segments"
-- — but grounded in our deterministic resolver, so a saved audience always
-- resolves against the CURRENT menu (never a stale product snapshot).
--
-- Design notes:
--  * predicate is a JSON blob (the SelectionPredicate). Keeping it as one jsonb
--    column means adding a new predicate field never needs another migration.
--  * NOT resolved/materialized here: audiences store the RULE, not a product
--    list, so they self-update as the menu changes (that is the whole point).
--  * name is unique (case-insensitive via a functional unique index) so the
--    picker reads cleanly and saves are idempotent-ish from the UI's view.
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles.
-- Idempotent: create if not exists + drop policy/trigger/index if exists.
-- Code ships WORKING PRE-MIGRATION: the store helpers (promotions-store.ts)
-- treat a missing table as "no saved audiences yet" (empty list, save is a
-- no-op that surfaces a friendly message) so nothing breaks before it is run.
-- =============================================================================

create table if not exists public.promotion_saved_audiences (
  id            uuid primary key default gen_random_uuid(),

  -- Human name shown in the picker (e.g. "All Eighths").
  name          text not null,

  -- Optional one-line description of what the audience selects.
  description   text,

  -- The SelectionPredicate (typed filter). Resolved LIVE against the menu.
  predicate     jsonb not null default '{}'::jsonb,

  -- Provenance.
  created_by    uuid references public.staff_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Case-insensitive unique name (so "All Eighths" and "all eighths" collide).
create unique index if not exists idx_promotion_saved_audiences_name_ci
  on public.promotion_saved_audiences (lower(name));

-- updated_at trigger
drop trigger if exists trg_promotion_saved_audiences_updated on public.promotion_saved_audiences;
create trigger trg_promotion_saved_audiences_updated before update on public.promotion_saved_audiences
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.promotion_saved_audiences enable row level security;

-- Staff only: full read/write. Saved audiences are a back-office tool; the
-- public never reads them.
drop policy if exists promotion_saved_audiences_staff_all on public.promotion_saved_audiences;
create policy promotion_saved_audiences_staff_all on public.promotion_saved_audiences
  for all using (public.is_staff()) with check (public.is_staff());
