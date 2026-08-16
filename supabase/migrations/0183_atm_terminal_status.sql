-- =============================================================================
-- SLICE A-2e — ATM Terminal Status (PAI Realtime) snapshots
-- =============================================================================
-- PAI's "Terminal Status" report (Reports -> ATM Realtime Reports -> Terminal
-- Status) is a REALTIME snapshot of the machine: is it up, how much cash is
-- physically in it right now, and how many transactions it has run since the
-- last settlement.
--
-- WHY A NEW TABLE (rather than reusing atm_settlements / atm_cash_loads):
--   * atm_settlements is a DAILY HISTORICAL ledger keyed by settlement_date.
--   * atm_cash_loads is an EVENT log keyed by (terminal_id, loaded_at).
--   * Terminal Status is neither: it is "the machine as of the moment we asked".
--     Forcing it into either table would corrupt the meaning of those keys.
--
-- WHAT THIS GIVES THE OWNER: the ATM page can stop ESTIMATING current cash
-- (balance at last load minus cash settled since, which is only ever a
-- conservative upper bound) and instead show the machine's own live balance.
-- We keep every snapshot so the balance can be trended over time.
--
-- MONEY IS STORED IN MINOR UNITS (integer CENTS) per the repo's money rule.
-- Every measurement column is NULLABLE on purpose: PAI omits columns depending
-- on how the report is configured, and NULL means "not reported" -- never zero.
--
-- STANDING RULES honored:
--   * ONE FEATURE PER PR.
--   * Fully IDEMPOTENT -- safe to run more than once.
--   * Applied MANUALLY by the owner.
-- =============================================================================

create table if not exists public.atm_terminal_status (
  id                      uuid primary key default gen_random_uuid(),

  -- Which machine, and when PAI's reading was captured by our sync.
  terminal_id             text        not null,
  captured_at             timestamptz not null default now(),

  -- PAI's own health word, kept VERBATIM (e.g. "OK"). We never reinterpret it.
  status                  text,
  location                text,
  group_name              text,

  -- Operational readings. NULL = PAI didn't report it.
  days_until_cash_out     integer,
  trxs_since_settlement   integer,

  -- The raw "Last ... Trx" strings exactly as PAI printed them. Stored as text
  -- because PAI's format is M/D/YY h:mm:ss AM and re-parsing it into a
  -- timestamp would invent a timezone we cannot prove.
  last_trx_raw            text,
  last_wd_trx_raw         text,
  last_rev_trx_raw        text,

  -- Money in CENTS. balance_cents is the live cash in the machine.
  balance_prev_eod_cents  bigint,
  balance_cents           bigint,

  -- The untouched CSV row, so a future question can be answered from evidence
  -- instead of a re-sync.
  raw                     jsonb       not null default '{}'::jsonb,

  created_at              timestamptz not null default now()
);

-- One snapshot per machine per capture instant. A repeated sync at the exact
-- same instant overwrites rather than duplicating (matches how the other ATM
-- upserts behave). A FULL (non-partial) unique constraint is required because
-- ON CONFLICT cannot use a partial index -- the exact bug fixed in 0158.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'atm_terminal_status_terminal_captured_key'
  ) then
    alter table public.atm_terminal_status
      add constraint atm_terminal_status_terminal_captured_key
      unique (terminal_id, captured_at);
  end if;
end $$;

-- "Newest snapshot for this machine" is THE hot query for the ATM page card.
create index if not exists idx_atm_terminal_status_terminal_captured
  on public.atm_terminal_status (terminal_id, captured_at desc);

-- Trend/history reads across all machines.
create index if not exists idx_atm_terminal_status_captured
  on public.atm_terminal_status (captured_at desc);

comment on table public.atm_terminal_status is
  'Realtime snapshots of ATM state from PAI''s Terminal Status report. balance_cents is the live cash in the machine (CENTS); NULL means PAI did not report the value, never zero.';

comment on column public.atm_terminal_status.balance_cents is
  'Live cash in the machine, in CENTS, as read by PAI. Supersedes the derived "balance at last load minus cash settled since" estimate.';

comment on column public.atm_terminal_status.trxs_since_settlement is
  'Transactions the machine has run since its last settlement, per PAI.';

-- RLS: identical posture to the other atm_* tables from 0156 -- staff-only,
-- enforced by the same public.is_staff() predicate. The service role (used by
-- the server-side sync) bypasses RLS as usual.
alter table public.atm_terminal_status enable row level security;

drop policy if exists atm_terminal_status_staff_all on public.atm_terminal_status;
create policy atm_terminal_status_staff_all on public.atm_terminal_status
  for all using (public.is_staff()) with check (public.is_staff());
