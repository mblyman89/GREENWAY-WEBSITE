-- =============================================================================
-- SLICE P1 — Plaid foundation (schema only; no money movement, no network)
-- =============================================================================
-- Read-only bookkeeping over Michael's OWN business bank + credit accounts
-- (first-party data only — he connects only accounts he owns): the Timberland
-- operating/ATM accounts and the Citi credit card. Plaid's /transactions/sync
-- feeds these tables; later slices reconcile them against payroll & vendor
-- payments (the loop-closer).
--
-- This slice lays the foundation ONLY:
--   * plaid_items          — one row per linked login (access_token ENCRYPTED)
--   * plaid_accounts       — one row per account under an item (balances in CENTS)
--   * plaid_transactions   — one row per transaction (amount in CENTS, dedup key)
--   * plaid_webhook_events — idempotency + audit of webhook deliveries
--
-- STANDING RULES honored:
--   * MONEY IN CENTS — every amount/balance column is *_cents bigint (integer).
--   * SECRETS ENCRYPTED — access_token & transactions_cursor are written through
--     src/lib/security/at-rest-crypto.ts (encryptSecret) by the store layer;
--     they are stored here as text and are NEVER logged or sent to the browser.
--   * PLAID SIGN CONVENTION — amount_cents preserves Plaid's sign: POSITIVE =
--     money OUT (debit/outflow), NEGATIVE = money IN (credit/inflow). The UI
--     renders inflow/outflow; the DB stores the truth. (See plaid-core.ts.)
--   * NEVER GUESS — full Plaid payload kept in `raw jsonb` for future-proofing.
--
-- Design mirrors 0155/0156:
--   * create table if not exists; unique indexes for idempotent upserts.
--   * public.set_updated_at() trigger; RLS = staff only (public.is_staff()).
--   * Ships WORKING PRE-MIGRATION: the Plaid store treats a missing table as
--     "not configured / no data yet", so nothing breaks until this runs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) plaid_items — one row per linked institution login.
-- -----------------------------------------------------------------------------
create table if not exists public.plaid_items (
  id                     uuid primary key default gen_random_uuid(),

  -- Plaid Item id — plaintext so it is queryable (it is not a secret).
  item_id                text not null unique,

  -- ENCRYPTED at rest via encryptSecret (encv1:...). Never plaintext, never
  -- logged, never shipped to the client.
  access_token           text not null,

  institution_id         text,
  institution_name       text,
  products               text[] not null default '{}',

  -- /transactions/sync cursor. Encrypting is cheap + prudent (opaque token).
  transactions_cursor    text,

  status                 text not null default 'healthy'
                           check (status in ('healthy','login_required','pending_disconnect','error')),
  error_code             text,
  last_successful_sync   timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2) plaid_accounts — one row per account under an item. Balances in CENTS.
-- -----------------------------------------------------------------------------
create table if not exists public.plaid_accounts (
  id                       uuid primary key default gen_random_uuid(),

  account_id               text not null unique,               -- Plaid account_id
  item_id                  text not null
                             references public.plaid_items(item_id) on delete cascade,

  name                     text,
  official_name            text,
  mask                     text,                               -- last-4 ONLY; never a full number
  type                     text,
  subtype                  text,

  -- Owner-assigned role. NULL = unassigned. Enforced in the app + plaid-core.
  role                     text check (role in ('main','atm','credit')),

  current_balance_cents    bigint,
  available_balance_cents  bigint,
  iso_currency_code        text default 'USD',
  balances_updated_at      timestamptz,

  active                   boolean not null default true,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_plaid_accounts_item on public.plaid_accounts (item_id);

-- -----------------------------------------------------------------------------
-- 3) plaid_transactions — one row per transaction. amount_cents in CENTS,
--    Plaid sign preserved (POSITIVE = out / debit). transaction_id = dedup key.
-- -----------------------------------------------------------------------------
create table if not exists public.plaid_transactions (
  id                                   uuid primary key default gen_random_uuid(),

  transaction_id                       text not null unique,   -- Plaid transaction_id (idempotent upsert key)
  account_id                           text not null
                                         references public.plaid_accounts(account_id) on delete cascade,

  amount_cents                         bigint not null,        -- Math.round(amount*100), sign preserved
  date                                 date not null,
  authorized_date                      date,

  name                                 text,
  merchant_name                        text,
  personal_finance_category_primary    text,
  personal_finance_category_detailed   text,

  pending                              boolean not null default false,
  pending_transaction_id               text,                   -- links pending → posted
  removed                              boolean not null default false,  -- soft-delete (never hard-delete)

  payment_channel                      text,
  raw                                  jsonb,                  -- full Plaid payload (future-proofing)

  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now()
);

create index if not exists idx_plaid_transactions_account_date
  on public.plaid_transactions (account_id, date desc);

-- -----------------------------------------------------------------------------
-- 4) plaid_webhook_events — dedup + audit of webhook deliveries. body_sha256 is
--    the idempotency key (mirrors the resend webhook dedup posture).
-- -----------------------------------------------------------------------------
create table if not exists public.plaid_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  webhook_type  text,
  webhook_code  text,
  item_id       text,
  body_sha256   text not null unique,                          -- idempotency
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

-- =============================================================================
-- updated_at triggers (reuse public.set_updated_at())
-- =============================================================================
drop trigger if exists trg_plaid_items_updated on public.plaid_items;
create trigger trg_plaid_items_updated before update on public.plaid_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_plaid_accounts_updated on public.plaid_accounts;
create trigger trg_plaid_accounts_updated before update on public.plaid_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_plaid_transactions_updated on public.plaid_transactions;
create trigger trg_plaid_transactions_updated before update on public.plaid_transactions
  for each row execute function public.set_updated_at();

-- (plaid_webhook_events has no updated_at — it is append-then-mark-processed.)

-- =============================================================================
-- Row-Level Security — staff only (public.is_staff()). This is back-office
-- financial data; the public never touches it. Owner/admin gating for WRITES
-- is enforced in the app via requirePermission("settings.manage").
-- =============================================================================
alter table public.plaid_items          enable row level security;
alter table public.plaid_accounts        enable row level security;
alter table public.plaid_transactions    enable row level security;
alter table public.plaid_webhook_events  enable row level security;

drop policy if exists plaid_items_staff_all on public.plaid_items;
create policy plaid_items_staff_all on public.plaid_items
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists plaid_accounts_staff_all on public.plaid_accounts;
create policy plaid_accounts_staff_all on public.plaid_accounts
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists plaid_transactions_staff_all on public.plaid_transactions;
create policy plaid_transactions_staff_all on public.plaid_transactions
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists plaid_webhook_events_staff_all on public.plaid_webhook_events;
create policy plaid_webhook_events_staff_all on public.plaid_webhook_events
  for all using (public.is_staff()) with check (public.is_staff());
