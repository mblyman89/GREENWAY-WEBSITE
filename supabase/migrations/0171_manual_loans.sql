-- 0171_manual_loans.sql
-- Manual (owner-entered) loans + their recorded payments. Independent of Plaid:
-- some servicers (e.g. Cenlar for Sound CU's mortgage) will not return full
-- Liabilities detail through Plaid, so the owner enters the loan terms once and
-- the app generates the exact amortization schedule. Payments are later matched
-- against the connected Timberland account for an audit trail.
--
-- STANDING RULES:
--   * Every dollar amount is stored as INTEGER CENTS (bigint).
--   * Interest rate is stored as INTEGER MILLI-PERCENT (thousandths of a
--     percent): 2.375% = 2375, 3.99% = 3990, 0% = 0. The decimal rate is
--     value / 100000. Finer than basis points on purpose: 2.375% is not an
--     integer in bps, and Michael's mortgage needs the exact value.
--   * Dates are stored as text ISO (YYYY-MM-DD).

-- ---------------------------------------------------------------------------
-- 1) manual_loans — one row per loan.
-- ---------------------------------------------------------------------------
create table if not exists public.manual_loans (
  id                          uuid primary key default gen_random_uuid(),

  name                        text not null,                 -- "Sound CU mortgage", "Jared", ...
  kind                        text not null
                                check (kind in ('amortizing','interest_free')),

  original_principal_cents    bigint not null,               -- financed amount
  current_balance_cents       bigint,                        -- owner-provided remaining principal
  rate_milli_pct              integer not null default 0,    -- 2375 = 2.375%; 0 = interest-free
  term_months                 integer not null,              -- 180, 18, ...

  first_payment_date          text not null,                 -- ISO YYYY-MM-DD
  maturity_date               text,                          -- ISO YYYY-MM-DD (optional)

  -- Fixed scheduled P&I payment (no escrow), integer cents. When set we trust it
  -- (it is what the servicer actually charges, e.g. $4,276.16). When null the
  -- app derives it from principal/rate/term.
  scheduled_payment_cents     bigint,

  -- Which connected Plaid account the monthly payment is drawn from (Timberland),
  -- for the audit trail. Nullable; not a FK so a loan survives disconnecting the
  -- bank. Stores the Plaid account_id string.
  funding_account_id          text,

  notes                       text,
  active                      boolean not null default true,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.manual_loans is
  'Owner-entered loans (mortgage, financing) with integer-cents money and milli-percent rates; amortization is generated in app code.';

-- ---------------------------------------------------------------------------
-- 2) manual_loan_payments — recorded/confirmed payments against a loan.
--    Later matched to a Timberland plaid_transactions row for the audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.manual_loan_payments (
  id                     uuid primary key default gen_random_uuid(),

  loan_id                uuid not null
                           references public.manual_loans(id) on delete cascade,

  paid_date              text not null,                       -- ISO YYYY-MM-DD
  amount_cents           bigint not null,                     -- total paid (P&I + escrow if any)
  principal_cents        bigint,                              -- optional split
  interest_cents         bigint,                              -- optional split
  escrow_cents           bigint,                              -- optional split
  fees_cents             bigint,                              -- optional split

  -- Audit trail: the connected Plaid transaction this payment matches, if any.
  matched_transaction_id text,                                -- plaid_transactions.transaction_id
  description            text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.manual_loan_payments is
  'Recorded payments against a manual loan; matched_transaction_id links to a connected Timberland transaction for an audit trail.';

create index if not exists idx_manual_loan_payments_loan_date
  on public.manual_loan_payments (loan_id, paid_date desc);

-- ---------------------------------------------------------------------------
-- 3) Row-level security — staff-only, mirroring the sibling tables. The server
--    reads/writes via the service-role admin client, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.manual_loans enable row level security;

drop policy if exists manual_loans_staff_all on public.manual_loans;
create policy manual_loans_staff_all on public.manual_loans
  for all using (public.is_staff()) with check (public.is_staff());

alter table public.manual_loan_payments enable row level security;

drop policy if exists manual_loan_payments_staff_all on public.manual_loan_payments;
create policy manual_loan_payments_staff_all on public.manual_loan_payments
  for all using (public.is_staff()) with check (public.is_staff());
