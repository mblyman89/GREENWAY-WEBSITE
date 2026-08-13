-- 0170_plaid_holdings.sql
-- Store the per-position investment holdings Plaid's /investments/holdings/get
-- returns for a brokerage account (Fidelity is Michael's first). One row per
-- position: (account_id, security_id). The holding is joined to its security so
-- we keep the display name / ticker / type alongside the numbers.
--
-- STANDING RULES:
--   • Every dollar amount is stored as INTEGER CENTS (bigint):
--       institution_price_cents (per-share price), institution_value_cents
--       (position market value), cost_basis_cents (total cost).
--   • Share quantity is stored as INTEGER MICRO-UNITS (quantity × 1,000,000)
--       in quantity_micros, so fractional shares (e.g. 0.317) stay off floats.
--   • account_id references plaid_accounts.account_id so a deleted account
--       cleans up its holdings too.
--
-- Holdings are REPLACED (delete-then-insert) for each account on every refresh,
-- so a sold-off position disappears; the composite PK dedups within a refresh.

create table if not exists public.plaid_holdings (
  account_id                 text not null
                             references public.plaid_accounts(account_id) on delete cascade,
  security_id                text not null,

  security_name              text,                 -- e.g. 'Apple Inc.'
  ticker_symbol              text,                 -- e.g. 'AAPL'
  security_type              text,                 -- e.g. 'equity' | 'etf' | 'mutual fund'

  quantity_micros            bigint,               -- shares × 1,000,000
  institution_price_cents    bigint,               -- per-share price, in cents
  institution_value_cents    bigint,               -- position market value, in cents
  cost_basis_cents           bigint,               -- total cost basis, in cents
  iso_currency_code          text default 'USD',

  updated_at                 timestamptz not null default now(),

  primary key (account_id, security_id)
);

comment on table public.plaid_holdings is
  'Per-position Plaid Investments holdings (Fidelity, etc.); money in integer cents, quantity in micro-units.';

-- Row-level security — mirror the sibling plaid_* tables (staff-only; the
-- server reads/writes via the service-role admin client, which bypasses RLS).
alter table public.plaid_holdings enable row level security;

drop policy if exists plaid_holdings_staff_all on public.plaid_holdings;
create policy plaid_holdings_staff_all on public.plaid_holdings
  for all using (public.is_staff()) with check (public.is_staff());
