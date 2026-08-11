-- =============================================================================
-- 0161_crypto_sync_progress.sql
--
-- Backfill PROGRESS VISIBILITY for the Crypto Portfolio (Michael asked to SEE
-- how far a wallet's history sync has gotten, with a progress bar, and to know
-- whether it's making progress or stuck looping).
--
-- Adds three NULLABLE columns to crypto_sync_state so the app can render an
-- honest progress view. All additive — existing rows are untouched and NULL is
-- a valid "unknown" that the UI degrades gracefully around:
--
--   * backfill_target      — the backfill TARGET captured at sync time. For EVM
--                            wallets this is the chain-tip BLOCK NUMBER (decimal
--                            string) so we can compute a TRUE percent
--                            (reached / target). NULL for opaque-cursor chains
--                            (XRPL marker, Cosmos next_key) where no honest
--                            percent exists — we NEVER fabricate one.
--   * prev_backfill_cursor — the resume cursor from the PRIOR run, so we can
--                            detect "stuck looping": if the cursor did not
--                            advance across two runs while backfill is still
--                            incomplete, the UI flags "no recent progress".
--   * transactions_total   — running count of transaction rows captured for the
--                            wallet, a progress signal for ALL chains (and the
--                            only numeric signal for opaque-cursor chains).
--
-- STANDING RULES honored:
--   * NEVER GUESS — a percent is only ever shown when it is truthfully
--     computable (EVM with a known tip). NULLs mean "unknown", never "0%".
--   * WATCH-ONLY / NO SECRETS — these are progress counters only; no keys.
--   * Idempotent — `add column if not exists`, safe to re-run. Ships working
--     PRE-MIGRATION: the store reads missing columns as NULL and the progress
--     module falls back to a phase-only view, so nothing breaks until this runs.
-- =============================================================================

alter table if exists public.crypto_sync_state
  add column if not exists backfill_target       text,
  add column if not exists prev_backfill_cursor  text,
  add column if not exists transactions_total    bigint;
