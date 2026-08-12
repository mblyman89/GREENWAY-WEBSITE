-- =============================================================================
-- 0165_crypto_owner_wallets.sql
--
-- R1-G4 — persistence for OWNERSHIP decisions on wallets DISCOVERED during the
-- Origin Trace back-trace.
--
-- R1-G1 walks a coin's lineage backwards toward its exchange/owner origin. When
-- a receipt came from an OUTSIDE address we don't yet trust, the trace SURFACES
-- that address as a "discovered wallet" instead of guessing it's Michael's. This
-- migration stores Michael's decision on each discovered address:
--
--   * 'confirmed' — "yes, that upstream wallet is mine." The trace then treats a
--     hop from it as a non-taxable self-transfer (basis carries over) and we go
--     pull that wallet's own history and re-run the trace one hop further back.
--   * 'rejected'  — "no, that's someone else's wallet." We remember the decision
--     so we don't keep re-suggesting it, and the receipt stays flagged as
--     needing a manual basis instead.
--
--   crypto_owner_wallet_confirmations — one row per (address, chain) decision.
--
-- STANDING RULES honored:
--   * NOTHING DELETED — additive table only; no existing column/table touched.
--   * Idempotent — create table/index if not exists; drop policy if exists then
--     create; safe to re-run.
--   * Ships working PRE-MIGRATION — the store layer degrades gracefully when
--     this table is absent (reads return empty, writes no-op success), so
--     nothing breaks until this migration is applied.
--   * Addresses stored LOWER-CASED + trimmed (matches normalizeAddress in the
--     pure trace core) so lookups are case-insensitive.
--   * RLS = staff only (public.is_staff()); set_updated_at() trigger; audit
--     columns (decided_by / decided_at).
-- =============================================================================

create table if not exists public.crypto_owner_wallet_confirmations (
  id            uuid primary key default gen_random_uuid(),

  -- The discovered upstream address (LOWER-CASED, trimmed) and its chain. Kept
  -- as plain text (not an FK to crypto_wallets) because a discovered address is
  -- often NOT yet a tracked wallet — it's a candidate we're deciding on.
  address       text not null,
  chain         text not null,

  -- Michael's decision. 'confirmed' => his wallet (self-transfer, basis carries;
  -- pull its history + trace further back). 'rejected' => someone else's.
  status        text not null default 'confirmed'
                  check (status in ('confirmed','rejected')),

  -- How many traced receipts pointed at this address at decision time
  -- (provenance / helps prioritize the review queue). Never used for money.
  reference_count integer not null default 0
                  check (reference_count >= 0),

  -- Optional plain-English owner note ("my old MetaMask, retired 2023").
  note          text,

  -- Audit trail.
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One current decision per (address, chain). Re-deciding upserts this row.
create unique index if not exists uq_crypto_owner_wallet_addr_chain
  on public.crypto_owner_wallet_confirmations (address, chain);

-- Fast filter of confirmed vs rejected for the review queue.
create index if not exists idx_crypto_owner_wallet_status
  on public.crypto_owner_wallet_confirmations (status);

-- ---------------------------------------------------------------------------
-- updated_at trigger (mirrors the rest of the schema).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_crypto_owner_wallet_confirmations_updated_at
  on public.crypto_owner_wallet_confirmations;
create trigger trg_crypto_owner_wallet_confirmations_updated_at
  before update on public.crypto_owner_wallet_confirmations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: staff only, mirroring crypto_transfer_matches (migration 0164).
-- ---------------------------------------------------------------------------
alter table public.crypto_owner_wallet_confirmations enable row level security;

drop policy if exists crypto_owner_wallet_confirmations_staff_all
  on public.crypto_owner_wallet_confirmations;
create policy crypto_owner_wallet_confirmations_staff_all
  on public.crypto_owner_wallet_confirmations
  for all
  using (public.is_staff())
  with check (public.is_staff());
