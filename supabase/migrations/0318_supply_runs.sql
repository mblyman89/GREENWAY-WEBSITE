-- 0318_supply_runs.sql  (Fix Phase 2.7c · G-11 · F-02-11 · owner D17)
--
-- WHY. The owner, verbatim:
--   books-98  "Sometimes my employees need to run to the store and buy some
--              supplies, so they take cash from the master, and replace it
--              with a receipt. How do we account for this and replace the
--              receipt with cash again?"
--             (register-cash-journal-core.ts L474-476)
--   D17       "Q-02-4- id like the supply run screen built"
--             (00-OWNER-REQUEST-VERBATIM.md L63, L72)
-- books-98 built both journal builders (buildSupplyAdvanceJournal,
-- buildSupplySettleJournal) but nothing called them (F-02-11; ledger census
-- row cash_and_banking.employee_supply_advance, "No screen records a supply
-- run yet"). This file is the record the new screen writes.
--
-- WHAT. public.supply_runs: one row per supply run, in two halves.
--   CASH OUT (the row is inserted): business_day, taken_by (the employee
--     whose PIN was entered), approved_by (a manager or lead, a different
--     person), amount_minor, reason ("why not the shop card", form 8.4),
--     taken_at. The server then posts DR 12100 Employee Advances Receivable /
--     CR 10100 Vault and fills advance_journal_id once.
--   SETTLE (filled once, later): settled_by (the employee who received the
--     receipt and change), settled_at, settled_day, receipt_minor,
--     change_minor, expense_account, receipt_note. The database refuses a
--     settle whose receipt + change is not exactly the amount taken. The
--     server then posts DR expense (receipt) / DR 10100 (change) /
--     CR 12100 (amount taken) and fills settle_journal_id once.
--   A run with no settle is an OPEN advance: money out with a named person.
--
-- GUARDS. A trigger refuses DELETE, refuses any change to the cash-out
-- columns, lets the settle columns go from empty to filled exactly once,
-- and lets each journal id be filled once. The factory reset hatch
-- (gl_factory_reset_active(), 0209) is let through, as in 0316.
--
-- FACTORY RESET. supply_runs is KEEP (factory-reset-core.ts): a cash-custody
-- record like little_safe_exchanges (0317), and the pinned 139-table WIPE
-- list in 0240 is not reopened. Its only links are to employees (KEEP). The
-- journal ids are plain uuids with NO foreign key to gl_journals (WIPE), as
-- deposit_bags.seal_journal_id (0316), so no kept row points at a wiped one.
--
-- SAFE / IDEMPOTENT: create ... if not exists; constraints and policies
-- dropped and re-made by name; create or replace for the function. Row level
-- security: managers read (public.is_manager()); no write policy, so every
-- write goes through the server, which checks the PINs and records an audit
-- row. Apply MANUALLY in the Supabase SQL editor after 0317. Before it is
-- applied the supply-run screen says the migration is pending and saves
-- nothing; use paper form 8.4 (SOP-02).

do $precheck$
begin
  if to_regclass('public.employees') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0318 depends on employees';
  end if;
  if to_regprocedure('public.is_manager()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0318 depends on is_manager() from 0130_security_rls_hardening.sql';
  end if;
  if to_regprocedure('public.gl_factory_reset_active()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0318 depends on gl_factory_reset_active() from 0209_factory_reset.sql';
  end if;
  if to_regclass('public.little_safe_exchanges') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: apply 0317_little_safe_exchanges.sql before 0318';
  end if;
end
$precheck$;

create table if not exists public.supply_runs (
  id                  uuid primary key default gen_random_uuid(),
  business_day        date not null,
  -- CASH OUT
  taken_by            uuid references public.employees(id) on delete set null,
  approved_by         uuid references public.employees(id) on delete set null,
  amount_minor        integer not null,
  reason              text not null,
  taken_at            timestamptz not null default now(),
  -- Books entry for the cash out (no FK: gl_journals is WIPE, this is KEEP).
  advance_journal_id  uuid,
  -- SETTLE (all empty until the receipt and change come back)
  settled_by          uuid references public.employees(id) on delete set null,
  settled_at          timestamptz,
  settled_day         date,
  receipt_minor       integer,
  change_minor        integer,
  expense_account     text,
  receipt_note        text,
  settle_journal_id   uuid,
  created_at          timestamptz not null default now()
);

-- At most the whole master till ($1,000.00, safe-core.ts SAFE_TARGET_MINOR).
alter table public.supply_runs drop constraint if exists supply_runs_amount_check;
alter table public.supply_runs add constraint supply_runs_amount_check
  check (amount_minor > 0 and amount_minor <= 100000);

alter table public.supply_runs drop constraint if exists supply_runs_reason_len;
alter table public.supply_runs add constraint supply_runs_reason_len
  check (length(btrim(reason)) between 1 and 500);

alter table public.supply_runs drop constraint if exists supply_runs_note_len;
alter table public.supply_runs add constraint supply_runs_note_len
  check (receipt_note is null or length(receipt_note) <= 500);

-- Taker and approver are two different people.
alter table public.supply_runs drop constraint if exists supply_runs_two_people;
alter table public.supply_runs add constraint supply_runs_two_people
  check (taken_by is null or approved_by is null or taken_by <> approved_by);

-- The settle is all-or-nothing, and receipt + change = the cash taken.
alter table public.supply_runs drop constraint if exists supply_runs_settle_whole;
alter table public.supply_runs add constraint supply_runs_settle_whole
  check (
    (settled_at is null and settled_day is null and receipt_minor is null
       and change_minor is null and expense_account is null and settle_journal_id is null)
    or (
      settled_at is not null and settled_day is not null
      and receipt_minor is not null and change_minor is not null
      and receipt_minor >= 0 and change_minor >= 0
      and receipt_minor + change_minor = amount_minor
    )
  );

-- A receipt needs an expense account from the supply list; no receipt, none.
alter table public.supply_runs drop constraint if exists supply_runs_expense_account;
alter table public.supply_runs add constraint supply_runs_expense_account
  check (
    settled_at is null
    or (receipt_minor = 0 and expense_account is null)
    or (receipt_minor > 0 and expense_account in ('76020','76010','70060','70030','77010','76030'))
  );

create index if not exists supply_runs_open_idx
  on public.supply_runs (taken_at) where settled_at is null;
create index if not exists supply_runs_day_idx
  on public.supply_runs (business_day desc, taken_at desc);

create or replace function public.supply_runs_guard()
returns trigger
language plpgsql
as $$
begin
  -- Factory reset (0209/0238 hatch): let the wipe through, DELETE and UPDATE.
  if public.gl_factory_reset_active() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'SUPPLY_RUN_PERMANENT: supply run % cannot be deleted. Supply runs are kept; settle it, or ask the owner (SOP-02 4.13).', old.id;
  end if;

  if new.business_day is distinct from old.business_day
     or new.taken_by is distinct from old.taken_by
     or new.approved_by is distinct from old.approved_by
     or new.amount_minor is distinct from old.amount_minor
     or new.reason is distinct from old.reason
     or new.taken_at is distinct from old.taken_at
     or new.created_at is distinct from old.created_at then
    raise exception 'SUPPLY_RUN_CASH_OUT_FIXED: supply run % already records who took how much. That cannot be changed.', old.id;
  end if;

  if old.advance_journal_id is not null and new.advance_journal_id is distinct from old.advance_journal_id then
    raise exception 'SUPPLY_RUN_CASH_OUT_FIXED: supply run % already names its cash-out books entry.', old.id;
  end if;

  if old.settled_at is not null and (
       new.settled_at is distinct from old.settled_at
       or new.settled_day is distinct from old.settled_day
       or new.settled_by is distinct from old.settled_by
       or new.receipt_minor is distinct from old.receipt_minor
       or new.change_minor is distinct from old.change_minor
       or new.expense_account is distinct from old.expense_account
       or new.receipt_note is distinct from old.receipt_note) then
    raise exception 'SUPPLY_RUN_SETTLED: supply run % is already settled. The receipt and change cannot be changed.', old.id;
  end if;

  if old.settle_journal_id is not null and new.settle_journal_id is distinct from old.settle_journal_id then
    raise exception 'SUPPLY_RUN_SETTLED: supply run % already names its settle books entry.', old.id;
  end if;

  return new;
end $$;

drop trigger if exists trg_supply_runs_guard on public.supply_runs;
create trigger trg_supply_runs_guard
  before update or delete on public.supply_runs
  for each row execute function public.supply_runs_guard();

alter table public.supply_runs enable row level security;

drop policy if exists supply_runs_mgr_read on public.supply_runs;
create policy supply_runs_mgr_read on public.supply_runs
  for select using (public.is_manager());

comment on table public.supply_runs is
  '0318 (G-11, owner D17): cash taken from the master till for supplies. Cash out (who, approver, amount, why not the shop card) posts 12100 <- 10100; the settle (receipt, change, expense account) posts expense + 10100 <- 12100. Open = not settled. No delete; settle filled once; KEEP in the factory reset.';
comment on column public.supply_runs.reason is
  '0318 (form 8.4): why the shop card was not used. books-99: "I don''t want to use the master till any more for petty cash."';
comment on column public.supply_runs.advance_journal_id is
  '0318: the cash-out books entry (sourceRef supply-advance:<id>). Plain uuid, no FK (gl_journals is WIPE). Filled once.';
comment on column public.supply_runs.settle_journal_id is
  '0318: the settle books entry (sourceRef supply-settle:<id>). Plain uuid, no FK. Filled once.';
