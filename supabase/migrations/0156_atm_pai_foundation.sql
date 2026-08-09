-- =============================================================================
-- SLICE A-1 — ATM / PAI reporting foundation (schema only; no money movement)
-- =============================================================================
-- Michael owns his ATM (terminal HG26499) outright and takes 100% of the
-- surcharge. His ATM data lives in the PAI Reports portal (paireports.com,
-- company "CASCADE GENERAL PARTNERS"). This slice lays the READ-ONLY foundation
-- for pulling that data in and reconciling it against the Timberland ATM bank
-- account (which contains ONLY ATM activity + transfers out).
--
-- Verified from Michael's own portal screenshots (outputs/PAI_PORTAL_REFERENCE.md):
--   * ATM Cash Load Report  (GetATMCashLoadsReport.event) — the AUTOMATIC source
--     for cash loads (Michael loads physical cash, NOT from the bank account).
--   * Simple Summary Report (GetSimpleSummaryReport.event?ReportID=2) — surcharge
--     & interchange by Settlement Date.
--   * Bank Deposits report — the deposit-side truth; the bank receives TWO
--     SEPARATE deposits per settlement (cash-out leg + surcharge leg), confirmed
--     by Michael (Q5). Exact endpoint/columns to be captured at build time.
--
-- STANDING RULES honored:
--   * MONEY IN CENTS — every amount column is *_cents bigint (integer).
--   * READ-ONLY — nothing here transmits or moves money. Ever.
--   * NEVER GUESS — column set mirrors the VERIFIED report columns; anything not
--     yet seen (Bank Deposits exact columns) is kept flexible via a jsonb
--     `raw` snapshot so we store the truth first and map precisely later.
--
-- Design mirrors 0155:
--   * create table if not exists; unique indexes for idempotent upserts.
--   * public.set_updated_at() trigger; RLS = staff only (public.is_staff()).
--   * Ships WORKING PRE-MIGRATION: the ATM store/pages treat a missing table as
--     "not configured / no data yet", so nothing breaks until this runs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) atm_connection — one row: encrypted PAI creds + report config + health.
--    (Owner/admin only; secrets stored via at-rest-crypto, masked in the UI.)
-- -----------------------------------------------------------------------------
create table if not exists public.atm_connection (
  id                 uuid primary key default gen_random_uuid(),

  -- PAI Reports login. Stored ENCRYPTED via src/lib/security/at-rest-crypto.ts
  -- (encryptSecret). NEVER logged, never sent to the client (masked only).
  pai_username_enc   text,
  pai_password_enc   text,

  -- Portal + terminal identity (verified: paireports.com, HG26499,
  -- "CASCADE GENERAL PARTNERS"). Kept as columns so a future second terminal or
  -- a portal move is a data change, not a code change.
  portal_base_url    text not null default 'https://paireports.com/myreports/',
  terminal_id        text,
  company_label      text,

  -- Discovered report endpoints/GUIDs/params for THIS account, captured at
  -- build/discovery time from the real portal (never guessed). jsonb so we can
  -- store exact .event paths + column maps per report as we confirm them.
  report_config      jsonb not null default '{}'::jsonb,

  -- Health.
  status             text not null default 'unconfigured'
                       check (status in ('unconfigured','ok','error')),
  last_sync_at       timestamptz,
  last_error         text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2) atm_settlements — one row per (settlement_date, terminal): the fee/txn
--    summary from the Simple Summary report, plus the expected TWO deposit legs.
--    All money in CENTS.
-- -----------------------------------------------------------------------------
create table if not exists public.atm_settlements (
  id                        uuid primary key default gen_random_uuid(),

  settlement_date           date not null,
  terminal_id               text not null,

  -- From Simple Summary (Detail=Low): Total Trxs / WO Trxs / Surch WDs.
  total_trx                 integer,
  withdrawal_trx            integer,      -- "WO Trxs"
  surcharged_wd_trx         integer,      -- "Surch WDs"

  -- The two money legs the bank receives SEPARATELY (Michael's Q5 answer):
  --   terminal_transaction_cents = cash withdrawn from the ATM (vault re-deposit)
  --   surcharge_cents            = fee revenue (Michael keeps 100%)
  terminal_transaction_cents bigint,
  surcharge_cents            bigint,

  -- "Settlement" column total when present (net settled), CENTS.
  settlement_total_cents     bigint,

  -- Exact source row(s) as pulled, for audit/precise remap without re-fetch.
  raw                        jsonb not null default '{}'::jsonb,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- One settlement summary per terminal per settlement date (idempotent upsert).
create unique index if not exists idx_atm_settlements_date_terminal
  on public.atm_settlements (settlement_date, terminal_id);

-- -----------------------------------------------------------------------------
-- 3) atm_transactions — optional per-withdrawal detail (Terminal Transaction
--    Data / Daily Transaction report). Money in CENTS.
-- -----------------------------------------------------------------------------
create table if not exists public.atm_transactions (
  id                 uuid primary key default gen_random_uuid(),

  terminal_id        text not null,
  trx_at             timestamptz,
  trx_date           date,

  -- Amount dispensed to the cardholder + surcharge charged, CENTS.
  amount_cents       bigint,
  surcharge_cents    bigint,

  -- PAI's own transaction identifier when available (dedupe key).
  pai_trx_id         text,

  raw                jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Dedupe on PAI's transaction id when we have one.
create unique index if not exists idx_atm_transactions_pai_id
  on public.atm_transactions (pai_trx_id)
  where pai_trx_id is not null;

-- -----------------------------------------------------------------------------
-- 4) atm_cash_loads — vault cash loaded into the ATM, pulled automatically from
--    the ATM Cash Load Report (Michael's Q4 answer). Columns mirror the report:
--    Trx Time / Cash Load / Balance. Money in CENTS.
-- -----------------------------------------------------------------------------
create table if not exists public.atm_cash_loads (
  id                 uuid primary key default gen_random_uuid(),

  terminal_id        text not null,
  loaded_at          timestamptz,          -- report "Trx Time"
  load_date          date,

  cash_load_cents    bigint not null,      -- report "Cash Load"
  balance_after_cents bigint,              -- report "Balance"

  -- 'pai' = auto-pulled from the report; 'manual' = owner hand-entered fallback.
  source             text not null default 'pai'
                       check (source in ('pai','manual')),

  raw                jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Idempotent upsert key for auto-pulled loads: a terminal can only have one load
-- event at a given instant. (Manual entries get a distinct loaded_at from the UI.)
create unique index if not exists idx_atm_cash_loads_terminal_time
  on public.atm_cash_loads (terminal_id, loaded_at)
  where loaded_at is not null;

-- -----------------------------------------------------------------------------
-- 5) atm_reconciliation — links a settlement's expected deposit legs to what
--    actually posted in the Timberland ATM account (via the bank feed). Two legs
--    per settlement (cash-out + surcharge). Money in CENTS.
-- -----------------------------------------------------------------------------
create table if not exists public.atm_reconciliation (
  id                 uuid primary key default gen_random_uuid(),

  settlement_id      uuid references public.atm_settlements(id) on delete cascade,
  settlement_date    date not null,
  terminal_id        text not null,

  -- Which leg this row reconciles: the vault-cash re-deposit or the surcharge.
  leg                text not null check (leg in ('transaction','surcharge')),

  expected_cents     bigint,               -- from atm_settlements
  matched_cents      bigint,               -- from the bank feed when matched
  bank_posted_date   date,                 -- when the deposit posted (T+1..T+3)

  status             text not null default 'auto'
                       check (status in ('auto','confirmed','mismatch','unmatched')),
  note               text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One reconciliation row per settlement leg (idempotent).
create unique index if not exists idx_atm_reconciliation_settlement_leg
  on public.atm_reconciliation (settlement_date, terminal_id, leg);

-- =============================================================================
-- updated_at triggers (reuse public.set_updated_at())
-- =============================================================================
drop trigger if exists trg_atm_connection_updated on public.atm_connection;
create trigger trg_atm_connection_updated before update on public.atm_connection
  for each row execute function public.set_updated_at();

drop trigger if exists trg_atm_settlements_updated on public.atm_settlements;
create trigger trg_atm_settlements_updated before update on public.atm_settlements
  for each row execute function public.set_updated_at();

drop trigger if exists trg_atm_transactions_updated on public.atm_transactions;
create trigger trg_atm_transactions_updated before update on public.atm_transactions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_atm_cash_loads_updated on public.atm_cash_loads;
create trigger trg_atm_cash_loads_updated before update on public.atm_cash_loads
  for each row execute function public.set_updated_at();

drop trigger if exists trg_atm_reconciliation_updated on public.atm_reconciliation;
create trigger trg_atm_reconciliation_updated before update on public.atm_reconciliation
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security — staff only (public.is_staff()). This is back-office
-- financial data; the public never touches it. Owner/admin gating for WRITES
-- is enforced in the app via requirePermission("settings.manage").
-- =============================================================================
alter table public.atm_connection     enable row level security;
alter table public.atm_settlements     enable row level security;
alter table public.atm_transactions    enable row level security;
alter table public.atm_cash_loads      enable row level security;
alter table public.atm_reconciliation  enable row level security;

drop policy if exists atm_connection_staff_all on public.atm_connection;
create policy atm_connection_staff_all on public.atm_connection
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists atm_settlements_staff_all on public.atm_settlements;
create policy atm_settlements_staff_all on public.atm_settlements
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists atm_transactions_staff_all on public.atm_transactions;
create policy atm_transactions_staff_all on public.atm_transactions
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists atm_cash_loads_staff_all on public.atm_cash_loads;
create policy atm_cash_loads_staff_all on public.atm_cash_loads
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists atm_reconciliation_staff_all on public.atm_reconciliation;
create policy atm_reconciliation_staff_all on public.atm_reconciliation
  for all using (public.is_staff()) with check (public.is_staff());
