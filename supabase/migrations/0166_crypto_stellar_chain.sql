-- =============================================================================
-- 0166_crypto_stellar_chain.sql
-- Add "stellar" as a supported chain across the crypto tables.
--
-- WHY: We're folding XLM (Stellar) into the watch-only crypto portfolio. Stellar
-- is an account-based ledger (a close cousin of XRPL) with G... addresses and a
-- native coin (XLM) that uses 7-decimal integer minor units ("stroops"). The
-- app code (crypto-core.ts) now lists "stellar" in the Chain type, so the
-- database CHECK constraints that pin `chain` (and `match_chain`) to the old
-- five-chain set must be widened to accept 'stellar' too -- otherwise inserting
-- a Stellar wallet/asset/transaction would be rejected by the constraint.
--
-- The original constraints (migrations 0160 / 0163) were written INLINE, so
-- Postgres auto-named them (conventionally <table>_<column>_check). Rather than
-- assume the exact auto-name, each block below finds the CHECK constraint that
-- actually guards the target column (via pg_constraint) and drops it by its real
-- name, then re-adds a widened, explicitly-named CHECK. Using IF EXISTS + a
-- pg_constraint existence guard makes this fully idempotent and safe to re-run.
--
-- SAFETY: additive only -- widening an allow-list can never invalidate existing
-- rows (every current row is one of the old five chains, still allowed). No data
-- is moved or deleted. Idempotent.
-- =============================================================================

-- Helper pattern (repeated per table/column):
--   1) Drop ANY existing CHECK constraint on the column (auto-named or explicit)
--      by looking it up in pg_constraint and running a dynamic ALTER.
--   2) Add the widened, explicitly-named CHECK if it isn't already present.

-- crypto_assets.chain -----------------------------------------------------------
do $$
declare
  c_name text;
begin
  for c_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.crypto_assets'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%chain%'
      and pg_get_constraintdef(con.oid) not ilike '%stellar%'
  loop
    execute format('alter table public.crypto_assets drop constraint %I', c_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crypto_assets'::regclass
      and conname = 'crypto_assets_chain_check'
  ) then
    alter table public.crypto_assets
      add constraint crypto_assets_chain_check
      check (chain in ('ethereum','flare','songbird','xrpl','coreum','stellar'));
  end if;
end $$;

-- crypto_wallets.chain ----------------------------------------------------------
do $$
declare
  c_name text;
begin
  for c_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.crypto_wallets'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%chain%'
      and pg_get_constraintdef(con.oid) not ilike '%stellar%'
  loop
    execute format('alter table public.crypto_wallets drop constraint %I', c_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crypto_wallets'::regclass
      and conname = 'crypto_wallets_chain_check'
  ) then
    alter table public.crypto_wallets
      add constraint crypto_wallets_chain_check
      check (chain in ('ethereum','flare','songbird','xrpl','coreum','stellar'));
  end if;
end $$;

-- crypto_transactions.chain -----------------------------------------------------
do $$
declare
  c_name text;
begin
  for c_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.crypto_transactions'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%chain%'
      and pg_get_constraintdef(con.oid) not ilike '%stellar%'
  loop
    execute format('alter table public.crypto_transactions drop constraint %I', c_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crypto_transactions'::regclass
      and conname = 'crypto_transactions_chain_check'
  ) then
    alter table public.crypto_transactions
      add constraint crypto_transactions_chain_check
      check (chain in ('ethereum','flare','songbird','xrpl','coreum','stellar'));
  end if;
end $$;

-- crypto_classification_rules.match_chain --------------------------------------
-- NOTE: match_chain lives on crypto_classification_rules (migration 0163),
-- NOT crypto_transfer_matches. The CHECK is nullable (match_chain is null OR ...).
do $$
declare
  c_name text;
begin
  for c_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.crypto_classification_rules'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%match_chain%'
      and pg_get_constraintdef(con.oid) not ilike '%stellar%'
  loop
    execute format('alter table public.crypto_classification_rules drop constraint %I', c_name);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crypto_classification_rules'::regclass
      and conname = 'crypto_classification_rules_match_chain_check'
  ) then
    alter table public.crypto_classification_rules
      add constraint crypto_classification_rules_match_chain_check
      check (match_chain is null or
             match_chain in ('ethereum','flare','songbird','xrpl','coreum','stellar'));
  end if;
end $$;
