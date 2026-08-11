-- =============================================================================
-- SLICE C1 — Crypto Portfolio foundation (schema only; no network, no UI)
-- =============================================================================
-- Watch-only, read-only bookkeeping over Michael's OWN crypto wallets (first-
-- party data only — he adds only addresses he owns). Mirrors the Plaid banking
-- foundation (0157) so the crypto portfolio behaves like the other banking
-- integrations: connect wallet → full historical backfill → once-per-day refresh.
--
-- This slice lays the FOUNDATION ONLY (no reads yet beyond a "not configured"
-- guard in the store layer):
--   * crypto_assets           — registry of assets we track (decimals as DATA)
--   * crypto_wallets          — one row per watch-only address (chain+address)
--   * crypto_balances         — current holdings per wallet+asset (RAW minor units + USD cents)
--   * crypto_transactions     — one row per on-chain event (RAW amounts + USD cents)
--   * crypto_asset_migrations — auditable CORE→TX / SOLO→TX mapping (keep-history)
--   * crypto_sync_state       — per wallet backfill/incremental cursors
--   * crypto_price_snapshots  — cached USD prices (CoinGecko) for valuation
--
-- STANDING RULES honored:
--   * NEVER GUESS — decimals are stored as DATA per asset with a provenance flag
--     (`decimals_source`); the full raw payload of every tx is kept in `raw jsonb`.
--   * MONEY / AMOUNTS AS INTEGERS — token amounts are stored as base-10 INTEGER
--     STRINGS in the asset's smallest unit (numeric(78,0)): EVM wei can exceed
--     bigint, so we use wide numeric, never floats. USD is integer *_cents bigint.
--     XRPL issued tokens (SOLO) have no fixed smallest unit → their human decimal
--     string is preserved verbatim in `amount_decimal text` (15 sig digits).
--   * WATCH-ONLY / NO SECRETS — we store PUBLIC addresses only. There is NO
--     private key, seed, or access token anywhere in this schema. Nothing to
--     encrypt because nothing here is a secret.
--   * KEEP-HISTORY MIGRATIONS — token mergers (Coreum CORE→TX auto-converted;
--     Sologenic SOLO→TX pending) are recorded as migration events that LINK old
--     holdings forward to the new asset. Original assets, lots and history are
--     NEVER deleted or overwritten, so cost basis stays provable for the IRS.
--
-- Design mirrors 0157:
--   * create table if not exists; unique indexes for idempotent upserts.
--   * public.set_updated_at() trigger; RLS = staff only (public.is_staff()).
--   * Ships WORKING PRE-MIGRATION: the crypto store treats a missing table as
--     "not configured / no data yet", so nothing breaks until this runs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) crypto_assets — the registry of assets we track. Decimals are stored as
--    DATA (never hardcoded/guessed downstream) with a provenance flag. Mirrors
--    src/lib/crypto/crypto-core.ts CRYPTO_ASSETS; seeded below.
-- -----------------------------------------------------------------------------
create table if not exists public.crypto_assets (
  id                 text primary key,                    -- stable key, e.g. "eth","usdt-eth","tx","sara"

  symbol             text not null,                       -- ticker for UI (ETH, USDT, TX, SARA)
  name               text not null,                       -- full name for UI

  chain              text not null
                       check (chain in ('ethereum','flare','songbird','xrpl','coreum')),

  -- How amounts are expressed:
  --   'evm-minor'   → integer smallest-unit + `decimals` (EVM, XRP drops, Cosmos)
  --   'xrpl-issued' → decimal string, up to 15 significant digits (SOLO, etc.)
  amount_model       text not null
                       check (amount_model in ('evm-minor','xrpl-issued')),

  -- For 'evm-minor': the fixed decimal count. NULL for 'xrpl-issued'.
  decimals           smallint,

  -- Provenance of `decimals` so tax math is auditable (never a silent guess):
  --   'verified'          — confirmed against a first-party source
  --   'denom-convention'  — Cosmos micro-denom convention; reconfirm from live metadata
  --   'issued-precision'  — XRPL issued token (no fixed decimals)
  decimals_source    text not null default 'verified'
                       check (decimals_source in ('verified','denom-convention','issued-precision')),

  native             boolean not null default false,      -- chain's native coin?

  contract           text,                                -- ERC-20 contract (lower-cased), EVM tokens
  issuer             text,                                -- XRPL issuer (r…), XRPL issued tokens
  currency_code      text,                                -- XRPL currency code
  denom              text,                                -- Cosmos base denom (e.g. "ucoreum")

  -- If this asset is migrating/merging into another asset (CORE→TX, SOLO→TX):
  -- the destination asset id. Keep-history: original asset row is retained.
  migrates_to_asset_id text references public.crypto_assets(id),

  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2) crypto_wallets — one row per watch-only address. PUBLIC address only.
-- -----------------------------------------------------------------------------
create table if not exists public.crypto_wallets (
  id                 uuid primary key default gen_random_uuid(),

  chain              text not null
                       check (chain in ('ethereum','flare','songbird','xrpl','coreum')),

  -- The public on-chain address. Case preserved as entered (EVM checksum, r…, core1…).
  address            text not null,

  -- Owner-friendly label ("Main ETH", "Coreum/Pulsara", …). Optional.
  label              text,

  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One wallet row per (chain, address) — idempotent add.
create unique index if not exists uq_crypto_wallets_chain_address
  on public.crypto_wallets (chain, lower(address));

-- -----------------------------------------------------------------------------
-- 3) crypto_balances — current holdings per wallet+asset.
--    amount_raw    : integer smallest-unit (numeric(78,0)) for 'evm-minor' assets
--    amount_decimal: decimal string for 'xrpl-issued' assets (15 sig digits)
--    Exactly one of the two is populated, matching the asset's amount_model.
--    decimals_at_read: the decimals value used at read time (audit trail).
--    usd_value_cents : USD value in integer cents at balances_updated_at.
-- -----------------------------------------------------------------------------
create table if not exists public.crypto_balances (
  id                 uuid primary key default gen_random_uuid(),

  wallet_id          uuid not null
                       references public.crypto_wallets(id) on delete cascade,
  asset_id           text not null
                       references public.crypto_assets(id),

  amount_raw         numeric(78,0),                       -- integer minor units (evm-minor)
  amount_decimal     text,                                -- decimal string (xrpl-issued)
  decimals_at_read   smallint,                            -- decimals used for this snapshot

  usd_value_cents    bigint,                              -- integer cents (nullable until priced)
  balances_updated_at timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One balance row per (wallet, asset) — upsert target.
create unique index if not exists uq_crypto_balances_wallet_asset
  on public.crypto_balances (wallet_id, asset_id);

-- -----------------------------------------------------------------------------
-- 4) crypto_transactions — one row per on-chain event. Idempotent on
--    (wallet_id, tx_hash, event_index) so the same on-chain event is never
--    double-counted. RAW amounts preserved; USD cents derived later (C9).
-- -----------------------------------------------------------------------------
create table if not exists public.crypto_transactions (
  id                 uuid primary key default gen_random_uuid(),

  wallet_id          uuid not null
                       references public.crypto_wallets(id) on delete cascade,
  asset_id           text
                       references public.crypto_assets(id),

  chain              text not null
                       check (chain in ('ethereum','flare','songbird','xrpl','coreum')),

  tx_hash            text not null,                       -- on-chain tx id / hash
  event_index        integer not null default 0,          -- sub-event within a tx (transfer/log index)

  -- Value direction relative to the tracked wallet.
  direction          text check (direction in ('in','out','self')),

  -- Activity type. Rich enough for DeFi / liquidity-pool history + tax.
  tx_type            text not null default 'other'
                       check (tx_type in ('transfer','swap','lp_add','lp_remove','reward','fee','other')),

  -- Amounts: exactly one populated per asset amount_model (see crypto_balances).
  amount_raw         numeric(78,0),                       -- integer minor units (evm-minor)
  amount_decimal     text,                                -- decimal string (xrpl-issued)
  decimals_at_event  smallint,

  -- Network fee paid (native coin, minor units) — for fee/cost-basis accounting.
  fee_raw            numeric(78,0),
  fee_asset_id       text references public.crypto_assets(id),

  -- USD value at the time of the event, integer cents (nullable until priced).
  usd_value_cents    bigint,
  price_asof         timestamptz,

  counterparty       text,                                -- other address, when known
  block_number       bigint,
  block_time         timestamptz,

  -- If this event is a token migration/conversion (CORE→TX, SOLO→TX), link the
  -- migration record so cost basis carries forward auditably.
  migration_id       uuid,

  raw                jsonb,                               -- full source payload (never guess; future-proof)

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Idempotent upsert key: one row per (wallet, tx hash, sub-event).
create unique index if not exists uq_crypto_transactions_event
  on public.crypto_transactions (wallet_id, tx_hash, event_index);

create index if not exists idx_crypto_transactions_wallet_time
  on public.crypto_transactions (wallet_id, block_time desc);

create index if not exists idx_crypto_transactions_asset
  on public.crypto_transactions (asset_id);

-- -----------------------------------------------------------------------------
-- 5) crypto_asset_migrations — records a token merger/conversion event so the
--    old asset's cost basis links forward to the new asset. KEEP-HISTORY: we
--    never delete the source asset or its lots. The conversion RATIO is stored
--    as data when the event is recorded (verified per-event; NOT guessed here).
-- -----------------------------------------------------------------------------
create table if not exists public.crypto_asset_migrations (
  id                 uuid primary key default gen_random_uuid(),

  from_asset_id      text not null references public.crypto_assets(id),
  to_asset_id        text not null references public.crypto_assets(id),

  -- Conversion ratio as an exact fraction (avoids float drift):
  -- new_amount = old_amount * ratio_numerator / ratio_denominator.
  -- NULL until the official ratio is verified and recorded.
  ratio_numerator    numeric(78,0),
  ratio_denominator  numeric(78,0),

  -- 'automatic' (done in-wallet, e.g. CORE→TX) or 'manual' (owner-initiated, SOLO→TX).
  conversion_kind    text check (conversion_kind in ('automatic','manual')),

  -- Tax treatment note chosen for this migration (documented, not tax advice).
  effective_at       timestamptz,
  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One migration record per (from, to) pair.
create unique index if not exists uq_crypto_asset_migrations_pair
  on public.crypto_asset_migrations (from_asset_id, to_asset_id);

-- -----------------------------------------------------------------------------
-- 6) crypto_sync_state — per-wallet backfill/incremental cursors, so a daily
--    refresh knows where it left off and a backfill is resumable.
-- -----------------------------------------------------------------------------
create table if not exists public.crypto_sync_state (
  id                     uuid primary key default gen_random_uuid(),

  wallet_id              uuid not null
                           references public.crypto_wallets(id) on delete cascade,

  -- Where the backfill has reached (chain-specific cursor kept as text/JSON):
  --   EVM     → last indexed block number
  --   XRPL    → account_tx marker / ledger_index
  --   Cosmos  → last height / pagination key
  backfill_cursor        text,
  backfill_complete      boolean not null default false,

  last_incremental_cursor text,
  last_synced_at         timestamptz,

  status                 text not null default 'idle'
                           check (status in ('idle','backfilling','syncing','error')),
  error_message          text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists uq_crypto_sync_state_wallet
  on public.crypto_sync_state (wallet_id);

-- -----------------------------------------------------------------------------
-- 7) crypto_price_snapshots — cached USD prices for valuation/cost-basis (C9).
--    price_scaled_cents = USD cents * 10^price_scale (integer, sub-cent precision),
--    matching usdValueCents() in crypto-core. Keyed by (asset, as-of date).
-- -----------------------------------------------------------------------------
create table if not exists public.crypto_price_snapshots (
  id                 uuid primary key default gen_random_uuid(),

  asset_id           text not null references public.crypto_assets(id),
  price_date         date not null,                       -- the calendar date the price is for
  price_scaled_cents numeric(78,0) not null,              -- USD cents * 10^price_scale
  price_scale        smallint not null default 6,
  source             text not null default 'coingecko',

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists uq_crypto_price_snapshots_asset_date
  on public.crypto_price_snapshots (asset_id, price_date, source);

-- =============================================================================
-- updated_at triggers (reuse public.set_updated_at())
-- =============================================================================
drop trigger if exists trg_crypto_assets_updated on public.crypto_assets;
create trigger trg_crypto_assets_updated before update on public.crypto_assets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_crypto_wallets_updated on public.crypto_wallets;
create trigger trg_crypto_wallets_updated before update on public.crypto_wallets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_crypto_balances_updated on public.crypto_balances;
create trigger trg_crypto_balances_updated before update on public.crypto_balances
  for each row execute function public.set_updated_at();

drop trigger if exists trg_crypto_transactions_updated on public.crypto_transactions;
create trigger trg_crypto_transactions_updated before update on public.crypto_transactions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_crypto_asset_migrations_updated on public.crypto_asset_migrations;
create trigger trg_crypto_asset_migrations_updated before update on public.crypto_asset_migrations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_crypto_sync_state_updated on public.crypto_sync_state;
create trigger trg_crypto_sync_state_updated before update on public.crypto_sync_state
  for each row execute function public.set_updated_at();

drop trigger if exists trg_crypto_price_snapshots_updated on public.crypto_price_snapshots;
create trigger trg_crypto_price_snapshots_updated before update on public.crypto_price_snapshots
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security — staff only (public.is_staff()). This is back-office
-- financial data; the public never touches it. Owner/admin gating for WRITES is
-- enforced in the app via requirePermission("settings.manage").
-- =============================================================================
alter table public.crypto_assets            enable row level security;
alter table public.crypto_wallets           enable row level security;
alter table public.crypto_balances          enable row level security;
alter table public.crypto_transactions      enable row level security;
alter table public.crypto_asset_migrations  enable row level security;
alter table public.crypto_sync_state        enable row level security;
alter table public.crypto_price_snapshots   enable row level security;

drop policy if exists crypto_assets_staff_all on public.crypto_assets;
create policy crypto_assets_staff_all on public.crypto_assets
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists crypto_wallets_staff_all on public.crypto_wallets;
create policy crypto_wallets_staff_all on public.crypto_wallets
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists crypto_balances_staff_all on public.crypto_balances;
create policy crypto_balances_staff_all on public.crypto_balances
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists crypto_transactions_staff_all on public.crypto_transactions;
create policy crypto_transactions_staff_all on public.crypto_transactions
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists crypto_asset_migrations_staff_all on public.crypto_asset_migrations;
create policy crypto_asset_migrations_staff_all on public.crypto_asset_migrations
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists crypto_sync_state_staff_all on public.crypto_sync_state;
create policy crypto_sync_state_staff_all on public.crypto_sync_state
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists crypto_price_snapshots_staff_all on public.crypto_price_snapshots;
create policy crypto_price_snapshots_staff_all on public.crypto_price_snapshots
  for all using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- Seed the asset registry (idempotent). Decimals mirror crypto-core.ts with
-- VERIFIED provenance. SARA's decimals are a convention placeholder to be
-- reconfirmed from live denom-metadata in the Cosmos connector slice.
-- We insert the migration DESTINATION (tx) is referenced by solo, so order/
-- on-conflict handles re-runs safely.
-- =============================================================================
insert into public.crypto_assets
  (id, symbol, name, chain, amount_model, decimals, decimals_source, native, contract, issuer, currency_code, denom, migrates_to_asset_id)
values
  ('eth',      'ETH',  'Ether',                  'ethereum', 'evm-minor',  18, 'verified',          true,  null,                                         null,                                 null,   null,      null),
  ('usdt-eth', 'USDT', 'Tether USD (Ethereum)',  'ethereum', 'evm-minor',  6,  'verified',          false, '0xdac17f958d2ee523a2206206994597c13d831ec7', null,                                 null,   null,      null),
  ('flr',      'FLR',  'Flare',                  'flare',    'evm-minor',  18, 'verified',          true,  null,                                         null,                                 null,   null,      null),
  ('sgb',      'SGB',  'Songbird',               'songbird', 'evm-minor',  18, 'verified',          true,  null,                                         null,                                 null,   null,      null),
  ('xrp',      'XRP',  'XRP',                    'xrpl',     'evm-minor',  6,  'verified',          true,  null,                                         null,                                 null,   null,      null),
  ('tx',       'TX',   'TX (Coreum)',            'coreum',   'evm-minor',  6,  'verified',          true,  null,                                         null,                                 null,   'ucoreum', null),
  ('sara',     'SARA', 'Pulsara',                'coreum',   'evm-minor',  6,  'denom-convention',  false, null,                                         null,                                 null,   null,      null),
  ('solo',     'SOLO', 'Sologenic',              'xrpl',     'xrpl-issued', null, 'issued-precision', false, null,                                        'rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz', 'SOLO', null,      'tx')
on conflict (id) do update set
  symbol               = excluded.symbol,
  name                 = excluded.name,
  chain                = excluded.chain,
  amount_model         = excluded.amount_model,
  decimals             = excluded.decimals,
  decimals_source      = excluded.decimals_source,
  native               = excluded.native,
  contract             = excluded.contract,
  issuer               = excluded.issuer,
  currency_code        = excluded.currency_code,
  denom                = excluded.denom,
  migrates_to_asset_id = excluded.migrates_to_asset_id,
  updated_at           = now();

-- Record the two known token migrations (keep-history). Ratios left NULL until
-- the official conversion ratio is verified per-event (never guessed).
insert into public.crypto_asset_migrations
  (from_asset_id, to_asset_id, conversion_kind, notes)
values
  ('solo', 'tx', 'manual',    'Sologenic SOLO → TX (owner-initiated conversion; ratio verified at event time).'),
  ('tx',   'tx', 'automatic', 'Coreum CORE → TX auto-converted in-wallet before tracking began; retained for audit trail.')
on conflict (from_asset_id, to_asset_id) do nothing;
