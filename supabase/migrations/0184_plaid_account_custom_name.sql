-- =============================================================================
-- 0184_plaid_account_custom_name.sql
--
-- RENUMBERED from 0158. It shared that number with
-- `0158_atm_upsert_constraints.sql` (both landed in PR #898). Migrations are
-- applied by hand in numeric order, so a duplicate number is a migration that
-- can quietly get skipped. This file was moved rather than the ATM one because
-- 0183 refers to "the exact bug fixed in 0158", and that breadcrumb should keep
-- pointing at the ATM constraint fix it was written about.
--
-- If you have ALREADY applied this against your database under its old name,
-- nothing needs doing: it is idempotent, and re-running it is harmless.
--
-- Adds an owner-assigned NICKNAME to each Plaid account so Michael can type a
-- friendly name (e.g. "Timberland Checking", "Wife's Citi Costco Visa") that
-- overrides the raw bank-provided name in the back office.
--
-- WHY a separate column (not overwrite `name`): `name`/`official_name` come
-- straight from Plaid and are REFRESHED on every /accounts sync, so anything we
-- wrote there would be clobbered. `custom_name` is written ONLY by the owner via
-- the dedicated rename action and is never touched by a sync.
--
-- Nullable: NULL / blank means "no nickname set — fall back to the bank name".
-- Idempotent: add column if not exists, so re-running is safe.
-- =============================================================================

alter table public.plaid_accounts
  add column if not exists custom_name text;
