-- =============================================================================
-- SLICE A-2c-2 FIX — ATM upsert ON CONFLICT constraints
-- =============================================================================
-- The live "Sync now (PAI)" flow saves rows with the store layer's
--   .upsert(rows, { onConflict: "..." })
-- which asks PostgREST to use ON CONFLICT. ON CONFLICT can ONLY match a FULL
-- (non-partial) unique constraint or unique index — it CANNOT use a partial
-- unique index (one with a WHERE clause).
--
-- atm_cash_loads was created in 0156 with a PARTIAL unique index:
--     create unique index idx_atm_cash_loads_terminal_time
--       on public.atm_cash_loads (terminal_id, loaded_at)
--       where loaded_at is not null;
-- so the sync failed with:
--     "there is no unique or exclusion constraint matching the ON CONFLICT
--      specification".
--
-- This migration replaces the partial index with a FULL named unique
-- CONSTRAINT on (terminal_id, loaded_at), and backs atm_settlements with a
-- matching FULL named unique CONSTRAINT on (settlement_date, terminal_id) so
-- both upserts resolve unambiguously.
--
-- WHY THIS IS SAFE (not a guess):
--   * loaded_at is NEVER null in practice:
--       - manual entry (store.ts) always writes a concrete timestamp, and
--       - the auto-sync plan (atm-sync-core.ts) SKIPS any row whose time can't
--         be parsed to an ISO timestamp.
--     So dropping the "where loaded_at is not null" partiality removes nothing
--     that is actually used, while making the key usable by ON CONFLICT.
--   * The uniqueness semantics are IDENTICAL for the real (non-null) data.
--
-- STANDING RULES honored:
--   * ONE FEATURE PER PR — schema-only plumbing fix; no data or behavior change.
--   * Idempotent — guarded with "if exists" / DO-block existence checks so it is
--     safe to re-run.
-- =============================================================================

-- 1) atm_cash_loads: replace the PARTIAL unique index with a FULL unique
--    constraint on (terminal_id, loaded_at).
drop index if exists public.idx_atm_cash_loads_terminal_time;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'atm_cash_loads_terminal_time_key'
      and conrelid = 'public.atm_cash_loads'::regclass
  ) then
    alter table public.atm_cash_loads
      add constraint atm_cash_loads_terminal_time_key
      unique (terminal_id, loaded_at);
  end if;
end $$;

-- 2) atm_settlements: back the existing (settlement_date, terminal_id) key with
--    a FULL named unique constraint. Drop the plain index first so the
--    constraint owns the uniqueness (a unique constraint creates its own index).
drop index if exists public.idx_atm_settlements_date_terminal;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'atm_settlements_date_terminal_key'
      and conrelid = 'public.atm_settlements'::regclass
  ) then
    alter table public.atm_settlements
      add constraint atm_settlements_date_terminal_key
      unique (settlement_date, terminal_id);
  end if;
end $$;
