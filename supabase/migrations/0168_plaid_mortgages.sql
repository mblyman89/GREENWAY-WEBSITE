-- 0168_plaid_mortgages.sql
-- Store the extra mortgage detail Plaid's /liabilities/get returns for a
-- loan/mortgage account (interest rate, next payment, escrow, origination,
-- YTD interest/principal, property address, ...). The remaining PRINCIPAL is
-- NOT duplicated here — it lives on plaid_accounts.current_balance_cents, which
-- Plaid populates as the mortgage account's balance.
--
-- STANDING RULES:
--   • Every dollar amount is stored as INTEGER CENTS (bigint).
--   • Interest rate is stored as INTEGER BASIS POINTS (399 = 3.99%).
--   • Dates are stored as text ISO (YYYY-MM-DD) exactly as Plaid returns them.
-- One row per Plaid account (a mortgage account) — keyed on account_id, which
-- references plaid_accounts.account_id so a deleted account cleans up its
-- mortgage detail too.

create table if not exists public.plaid_mortgages (
  account_id                    text primary key
                                references public.plaid_accounts(account_id) on delete cascade,

  account_number_mask           text,                 -- last-4 / masked loan number
  interest_rate_bps             integer,              -- 399 = 3.99%
  interest_rate_type            text,                 -- 'fixed' | 'variable' | servicer text

  next_monthly_payment_cents    bigint,
  next_payment_due_date         text,                 -- ISO YYYY-MM-DD
  last_payment_amount_cents     bigint,
  last_payment_date             text,

  escrow_balance_cents          bigint,
  current_late_fee_cents        bigint,
  past_due_amount_cents         bigint,

  origination_principal_cents   bigint,
  origination_date              text,
  maturity_date                 text,
  loan_term                     text,                 -- e.g. '30 year'
  loan_type_description         text,                 -- e.g. 'conventional'

  has_pmi                       boolean,
  has_prepayment_penalty        boolean,

  ytd_interest_paid_cents       bigint,
  ytd_principal_paid_cents      bigint,

  property_address              text,                 -- one-line, human-readable

  updated_at                    timestamptz not null default now()
);

comment on table public.plaid_mortgages is
  'Extra Plaid Liabilities detail for mortgage accounts; remaining principal lives on plaid_accounts.current_balance_cents.';

-- Row-level security — mirror the sibling plaid_* tables (staff-only; the
-- server reads/writes via the service-role admin client, which bypasses RLS).
alter table public.plaid_mortgages enable row level security;

drop policy if exists plaid_mortgages_staff_all on public.plaid_mortgages;
create policy plaid_mortgages_staff_all on public.plaid_mortgages
  for all using (public.is_staff()) with check (public.is_staff());
