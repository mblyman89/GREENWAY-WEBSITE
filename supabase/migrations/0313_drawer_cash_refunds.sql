-- 0313_drawer_cash_refunds.sql  (Fix Phase 2.1 · G-05 · F-01-4 · owner message 4)
--
-- WHY. Reconcile asked a manager to TYPE the drawer's cash sales (F-01-4).
-- The sales half can already be computed exactly: every register sale
-- payload carries drawerSessionId, and the sync proves the session is real,
-- belongs to the register and was open when the sale happened
-- (sync-store.ts, AN-3(c)). The refund half could not: neither a void nor a
-- counter return said which drawer paid the cash out (refunds-store.ts
-- header: "Neither record carries register attribution").
--
-- WHAT.
--   customer_returns.refund_paid_from          'drawer' | 'safe' | NULL
--   customer_returns.refund_drawer_session_id  the drawer that paid it
--       Register returns: the open drawer of the register the iPad is bound
--       to. Back-office returns desk: the open drawer or the safe the
--       manager picks. A manager can tie an older return to a drawer at
--       reconcile. NULL = not tied to a drawer (shown as such, never
--       guessed).
--   Voids need no column: a void's only record is its audit entry
--       (register.sale_voided). The app now writes drawerSessionId into that
--       entry, and a manager's later assignment is its own audit entry.
--   drawer_sessions.cash_sales_minor    the system cash-sales figure used at
--                                       reconcile (processed register sales
--                                       for this drawer paid in cash:
--                                       total + cash rounding; employee tab
--                                       and any other tender left out)
--   drawer_sessions.refunds_paid_minor  cash refunds this drawer paid out
--       Both NULL on sessions reconciled before this migration (typed era).
--
-- customer_returns and drawer_sessions are both WIPE in the factory reset,
-- so the new link never points from a kept row at a wiped one, and the reset
-- function needs no change.
--
-- SAFE / IDEMPOTENT: add column if not exists; constraints added only when
-- missing. No existing data changes. Apply MANUALLY in the SQL editor after
-- 0312.

alter table public.customer_returns
  add column if not exists refund_paid_from text;
alter table public.customer_returns
  add column if not exists refund_drawer_session_id uuid
    references public.drawer_sessions (id) on delete set null;

do $m$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_returns_refund_paid_from_check') then
    alter table public.customer_returns
      add constraint customer_returns_refund_paid_from_check
      check (refund_paid_from is null or refund_paid_from in ('drawer', 'safe'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_returns_refund_drawer_has_session') then
    alter table public.customer_returns
      add constraint customer_returns_refund_drawer_has_session
      check (
        refund_paid_from is null
        or (refund_paid_from = 'drawer' and refund_drawer_session_id is not null)
        or (refund_paid_from = 'safe' and refund_drawer_session_id is null)
      );
  end if;
end
$m$;

create index if not exists customer_returns_refund_session_idx
  on public.customer_returns (refund_drawer_session_id)
  where refund_drawer_session_id is not null;

alter table public.drawer_sessions
  add column if not exists cash_sales_minor integer;
alter table public.drawer_sessions
  add column if not exists refunds_paid_minor integer;

comment on column public.customer_returns.refund_paid_from is
  'Fix Phase 2.1: where the cash refund came from (drawer | safe). NULL = not tied to a drawer (logged before 0313, or not yet assigned).';
comment on column public.drawer_sessions.cash_sales_minor is
  'Fix Phase 2.1: system cash sales for this drawer at reconcile (processed CASH register sales carrying this drawerSessionId: total + cash rounding; employee tab and other tenders left out). NULL = reconciled before 0313 (typed figure).';
comment on column public.drawer_sessions.refunds_paid_minor is
  'Fix Phase 2.1: cash refunds this drawer paid out (voids + returns tied to it). NULL = reconciled before 0313.';
