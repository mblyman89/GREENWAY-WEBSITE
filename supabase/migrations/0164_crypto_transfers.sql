-- =============================================================================
-- 0164_crypto_transfers.sql
--
-- R1-F2 — the persistence layer for CONFIRMED own-wallet transfers.
--
-- R1-D added the PURE matcher (suggestTransferMatches): it pairs a cross-wallet
-- OUT with an IN of the same asset, close in time and amount, and scores a
-- confidence — but it only ever SUGGESTS. R1-F1 added the PURE engine that
-- RELOCATES the moved tax lots (carrying original date + basis, $0 gain, gas as
-- a micro-disposal) once a transfer is confirmed.
--
-- This migration adds the one table that STORES which suggestions the owner has
-- CONFIRMED (or manually entered, or explicitly rejected). That confirmed set is
-- what the R1-F1 engine consumes, so Michael's hot-wallet -> Ledger Stax move
-- (and every earlier hop) becomes a durable, auditable non-taxable relocation
-- instead of two loose legs that look like a sale + a mystery deposit.
--
--   crypto_transfer_matches — one row per confirmed/rejected transfer pair.
--     Records the OUT leg, the IN leg, the asset, the moved quantity, an
--     optional gas leg (paid in the same asset), a status (confirmed/rejected),
--     the confidence at confirmation time, and a light audit trail.
--
-- STANDING RULES honored:
--   * NOTHING DELETED — additive table only; no existing column/table touched.
--   * Idempotent — create table/index if not exists; drop policy if exists then
--     create; safe to re-run.
--   * Ships working PRE-MIGRATION — the store layer degrades gracefully when
--     this table is absent (reads return empty, writes no-op success), so
--     nothing breaks until this migration is applied.
--   * Money/quantity integrity — moved quantity + gas are stored as EXACT text
--     decimals (never a float column); the engine parses them into 18-dec
--     scaled BigInt. USD values are computed in the engine, not stored here.
--   * RLS = staff only (public.is_staff()); set_updated_at() trigger; audit
--     columns (confirmed_by / confirmed_at).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- crypto_transfer_matches — the owner's confirmed own-wallet transfers.
-- ---------------------------------------------------------------------------
create table if not exists public.crypto_transfer_matches (
  id                 uuid primary key default gen_random_uuid(),

  -- The OUT leg (left the source wallet) and IN leg (landed in the dest wallet).
  -- Cascade so a confirmed match vanishes with a (re)built transaction rather
  -- than orphaning. The IN leg is nullable to support a manually-entered
  -- transfer whose destination deposit wasn't captured on-chain yet.
  out_tx_id          uuid not null
                       references public.crypto_transactions(id) on delete cascade,
  in_tx_id           uuid
                       references public.crypto_transactions(id) on delete cascade,

  -- Denormalized wallet ids for the source and destination, so the engine can
  -- relocate lots source -> dest without re-joining the tx rows.
  source_wallet_id   uuid not null references public.crypto_wallets(id) on delete cascade,
  dest_wallet_id     uuid not null references public.crypto_wallets(id) on delete cascade,

  -- The asset that moved.
  asset_id           text references public.crypto_assets(id),

  -- The quantity that LANDED in the destination (net of gas), as an EXACT text
  -- decimal (e.g. '1.234500000000000000'). Never a float column.
  moved_amount       text not null,

  -- Optional gas/network fee PAID IN THIS SAME ASSET, exact text decimal. NULL
  -- or '' => none / paid in a different asset (handled by that asset's ledger).
  gas_amount         text,

  -- 'confirmed' (feed to the relocation engine) or 'rejected' (the owner said
  -- these two legs are NOT a self-transfer — remember the decision so we don't
  -- keep re-suggesting it).
  status             text not null default 'confirmed'
                       check (status in ('confirmed','rejected')),

  -- The R1-D confidence (0..100) at confirmation time — provenance only.
  confidence         integer not null default 0
                       check (confidence >= 0 and confidence <= 100),

  -- 'suggested' (accepted an R1-D suggestion) or 'manual' (owner keyed it in).
  source             text not null default 'suggested'
                       check (source in ('suggested','manual')),

  -- Optional plain-English owner note ("hot wallet -> Ledger Stax, Aug 2024").
  note               text,

  -- Audit trail.
  confirmed_by       uuid references auth.users(id),
  confirmed_at       timestamptz not null default now(),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One decision per OUT leg (the current confirmation). Re-confirming an OUT
-- upserts this row (a given withdrawal is at most one self-transfer).
create unique index if not exists uq_crypto_transfer_matches_out
  on public.crypto_transfer_matches (out_tx_id);

-- Fast lookup of everything moving into / out of a wallet for reconciliation.
create index if not exists idx_crypto_transfer_matches_source_wallet
  on public.crypto_transfer_matches (source_wallet_id);
create index if not exists idx_crypto_transfer_matches_dest_wallet
  on public.crypto_transfer_matches (dest_wallet_id);
create index if not exists idx_crypto_transfer_matches_asset
  on public.crypto_transfer_matches (asset_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger (mirrors the rest of the schema).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_crypto_transfer_matches_updated_at
  on public.crypto_transfer_matches;
create trigger trg_crypto_transfer_matches_updated_at
  before update on public.crypto_transfer_matches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: staff only, mirroring crypto_tx_classifications (migration 0163).
-- ---------------------------------------------------------------------------
alter table public.crypto_transfer_matches enable row level security;

drop policy if exists crypto_transfer_matches_staff_all on public.crypto_transfer_matches;
create policy crypto_transfer_matches_staff_all
  on public.crypto_transfer_matches
  for all
  using (public.is_staff())
  with check (public.is_staff());
