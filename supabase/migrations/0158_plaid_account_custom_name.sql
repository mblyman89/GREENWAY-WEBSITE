-- =============================================================================
-- 0158_plaid_account_custom_name.sql
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
