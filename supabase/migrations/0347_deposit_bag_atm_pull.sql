-- supabase/migrations/0347_deposit_bag_atm_pull.sql  (D198e - $20s out of the deposit bag for the ATM)
--
-- Owner request (verbatim, D198e): "I need a way for the morning employees to exclude 20s from the
-- daily deposit for use in the atm. This should be an option while building the deposit bag, so it
-- can reconcile what was taken out, by who, and then the daily sync will match the money to the cash
-- loaded into the machine. ... Same level of scrutiny, thinking about the fraud triangle as this is a
-- highly vulnerable cash handling activity."
--
-- The pull lives ON the bag, written in the SAME insert that records the bag, so a bag and its ATM
-- pull can never be half-saved:
--   atm_pull_twenties            how many $20 bills were taken out of the day's deposit for the ATM
--   atm_pull_minor               ALWAYS atm_pull_twenties x 2000 (a CHECK, not a hope)
--   atm_pulled_by                the employee (by PIN) who took the bills out - the bag builder
--   atm_pull_witnessed_by        a DIFFERENT employee (by PIN) who watched, when given
--   atm_pulled_at                when (the PAI cash-load match runs from this time)
--   atm_pull_terminal_id         the ATM the bills go into (matches atm_cash_loads.terminal_id)
--   atm_pull_flags               the review flags the server raised at the time (NO_WITNESS, ...)
--   atm_pull_balance_seen_cents  the ATM's cash per PAI at the time (NULL = no reading), and
--   atm_pull_balance_seen_at     when PAI read it: "the ATM had $X and they still took $Y";
--   atm_pull_reason              the builder's reason, when the server asked for one.
--
-- Trigger deposit_bags_atm_pull_immutable: once written, a pull is never changed - not even before
-- the bag is sealed - and a pull can never be ADDED to a bag after it was saved. The only update
-- allowed is an employee deletion nulling a person through the foreign key. A wrong pull is explained
-- on /admin/atm/drops (atm_drop_reviews, 0346), never by editing the money. Deleting a bag is already
-- refused (0316 DEPOSIT_BAG_PERMANENT).
--
-- What the app does with it: the bag should hold (expected deposit - the pull); the morning blind
-- recount and the end-of-day sheet compare against that; the owner's ATM match page treats the pull
-- like a till ATM drop, so the daily PAI cash-load sync matches it to the cash loaded in the machine.
--
-- Factory reset: deposit_bags is WIPE (0240, truncate), so these columns go with their bags. No new
-- table; the pinned 0240 list is not touched.
-- Idempotent: safe to run twice. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied the bag screen keeps working exactly as before; a bag WITH an ATM pull is
-- refused ("run migration 0347") rather than saved without it.
-- ROLLBACK: supabase/rollbacks/0347_deposit_bag_atm_pull.rollback.sql

do $precheck$
begin
  if to_regclass('public.deposit_bags') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0347 depends on deposit_bags from 0212_deposit_bags.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deposit_bags'
                    and column_name = 'night_counted_by') then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0347 depends on deposit_bags.night_counted_by from 0316_deposit_bag_custody.sql';
  end if;
  if to_regprocedure('public.gl_factory_reset_active()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0347 depends on gl_factory_reset_active() from 0209_factory_reset.sql';
  end if;
  if to_regclass('public.atm_drop_reviews') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0347 depends on atm_drop_reviews from 0346_atm_cash_drops.sql';
  end if;
end
$precheck$;

alter table public.deposit_bags add column if not exists atm_pull_twenties integer;
alter table public.deposit_bags add column if not exists atm_pull_minor integer;
alter table public.deposit_bags add column if not exists atm_pulled_by uuid
  references public.employees (id) on delete set null;
alter table public.deposit_bags add column if not exists atm_pull_witnessed_by uuid
  references public.employees (id) on delete set null;
alter table public.deposit_bags add column if not exists atm_pulled_at timestamptz;
alter table public.deposit_bags add column if not exists atm_pull_terminal_id text;
alter table public.deposit_bags add column if not exists atm_pull_flags text[] not null default '{}';
alter table public.deposit_bags add column if not exists atm_pull_balance_seen_cents bigint;
alter table public.deposit_bags add column if not exists atm_pull_balance_seen_at timestamptz;
alter table public.deposit_bags add column if not exists atm_pull_reason text;

do $m$
begin
  if not exists (select 1 from pg_constraint where conname = 'deposit_bags_atm_pull_shape') then
    alter table public.deposit_bags
      add constraint deposit_bags_atm_pull_shape
      check (
        (atm_pull_twenties is null
          and atm_pull_minor is null
          and atm_pulled_at is null
          and atm_pull_terminal_id is null
          and atm_pulled_by is null
          and atm_pull_witnessed_by is null
          and cardinality(atm_pull_flags) = 0
          and atm_pull_balance_seen_cents is null
          and atm_pull_balance_seen_at is null
          and atm_pull_reason is null)
        or (atm_pull_twenties is not null
          and atm_pull_twenties between 1 and 2500
          and atm_pull_minor = atm_pull_twenties * 2000
          and atm_pulled_at is not null
          and atm_pull_terminal_id is not null
          and char_length(atm_pull_terminal_id) between 1 and 64)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deposit_bags_atm_pull_witness_other_person') then
    alter table public.deposit_bags
      add constraint deposit_bags_atm_pull_witness_other_person
      check (atm_pull_witnessed_by is null or atm_pulled_by is null or atm_pull_witnessed_by <> atm_pulled_by);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deposit_bags_atm_pull_flags_bounded') then
    alter table public.deposit_bags
      add constraint deposit_bags_atm_pull_flags_bounded
      check (cardinality(atm_pull_flags) <= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deposit_bags_atm_pull_reason_len') then
    alter table public.deposit_bags
      add constraint deposit_bags_atm_pull_reason_len
      check (atm_pull_reason is null or char_length(atm_pull_reason) between 3 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deposit_bags_atm_pull_balance_seen') then
    alter table public.deposit_bags
      add constraint deposit_bags_atm_pull_balance_seen
      check (
        (atm_pull_balance_seen_cents is null or atm_pull_balance_seen_cents >= 0)
        and (atm_pull_balance_seen_at is null or atm_pull_balance_seen_cents is not null)
      );
  end if;
end
$m$;

comment on column public.deposit_bags.atm_pull_twenties is
  'D198e (0347): number of $20 bills taken OUT of this day''s deposit for the ATM while the bag was built. NULL = none. Write-once.';
comment on column public.deposit_bags.atm_pull_minor is
  'D198e (0347): atm_pull_twenties x 2000, always (CHECK deposit_bags_atm_pull_shape). The bag should hold the expected deposit minus this.';
comment on column public.deposit_bags.atm_pulled_by is
  'D198e (0347): the employee (by PIN) who took the $20s out - the bag builder.';
comment on column public.deposit_bags.atm_pull_witnessed_by is
  'D198e (0347): a different employee (by PIN) who watched the $20s come out and go to the ATM. NULL = no witness (flagged NO_WITNESS).';
comment on column public.deposit_bags.atm_pulled_at is
  'D198e (0347): when the $20s were taken out. The ATM match page matches the pull to the PAI cash load from this time.';
comment on column public.deposit_bags.atm_pull_terminal_id is
  'D198e (0347): the ATM terminal the $20s go into (matches atm_cash_loads.terminal_id).';
comment on column public.deposit_bags.atm_pull_flags is
  'D198e (0347): review flags raised by the server when the pull was saved (e.g. NO_WITNESS, NO_FRESH_READING, OVER_NEED, MOST_OF_DEPOSIT).';
comment on column public.deposit_bags.atm_pull_balance_seen_cents is
  'D198e (0347): the ATM''s cash per PAI''s Terminal Status when the pull was saved. NULL = no reading.';
comment on column public.deposit_bags.atm_pull_reason is
  'D198e (0347): why, in the builder''s words, when the server asked (e.g. more $20s than the ATM needed, or no fresh ATM reading).';
comment on column public.deposit_bags.atm_pull_balance_seen_at is
  'D198e (0347): when PAI captured atm_pull_balance_seen_cents.';

create index if not exists deposit_bags_atm_pulled_at_idx
  on public.deposit_bags (atm_pulled_at desc)
  where atm_pull_twenties is not null;

-- The pull is write-once.
create or replace function public.deposit_bags_atm_pull_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Factory reset (0209/0240 hatch).
  if public.gl_factory_reset_active() then
    return new;
  end if;
  if new.atm_pull_twenties is distinct from old.atm_pull_twenties
     or new.atm_pull_minor is distinct from old.atm_pull_minor
     or new.atm_pulled_at is distinct from old.atm_pulled_at
     or new.atm_pull_terminal_id is distinct from old.atm_pull_terminal_id
     or new.atm_pull_flags is distinct from old.atm_pull_flags
     or new.atm_pull_balance_seen_cents is distinct from old.atm_pull_balance_seen_cents
     or new.atm_pull_balance_seen_at is distinct from old.atm_pull_balance_seen_at
     or new.atm_pull_reason is distinct from old.atm_pull_reason
     -- people: only the foreign key's ON DELETE SET NULL may change them.
     or (new.atm_pulled_by is distinct from old.atm_pulled_by and new.atm_pulled_by is not null)
     or (new.atm_pull_witnessed_by is distinct from old.atm_pull_witnessed_by and new.atm_pull_witnessed_by is not null) then
    raise exception 'DEPOSIT_BAG_ATM_PULL_IMMUTABLE: bag % (%): the $20s taken out for the ATM, who took them, the witness, the time and the ATM are never changed or added later (D198e). Explain a mistake on /admin/atm/drops instead.', old.bag_no, old.business_day
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists deposit_bags_atm_pull_immutable on public.deposit_bags;
create trigger deposit_bags_atm_pull_immutable
  before update on public.deposit_bags
  for each row execute function public.deposit_bags_atm_pull_immutable();

revoke all on function public.deposit_bags_atm_pull_immutable() from public, anon, authenticated;

notify pgrst, 'reload schema';
