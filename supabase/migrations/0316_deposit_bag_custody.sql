-- 0316_deposit_bag_custody.sql  (Fix Phase 2.6 · G-04 · G-14 · F-00-6 · F-03-9 · F-03-10 · owner D23–D27)
--
-- WHY. The owner's original request: night count -> morning recount -> seal
-- the bag -> safe -> bank. 0212 built the deposit_bags table, but nothing in
-- the app reached it (F-00-6), any staff login could rewrite any bag through
-- the "for all" policy (F-03-9), and the table has no place for the two
-- counts and the people the owner's rules name:
--   D23 "Q-03-3- yes, that is correct"  (counted cash sits unsealed overnight)
--   D24 "no second count at night, just the recount in the morning by any
--        employee"
--   D25 "anyone can seal the bag, I am the only one to take cash to the bank"
--   D26 "yes I plan on using tamper evident pre-numbered bags"
--   D27 "Q-03-7- warning only please"   (undeclared bag at close: warn only)
--
-- WHAT (columns on deposit_bags; every one NULL on rows made before 0316):
--   night_count_minor, night_counted_by, night_counted_at, night_denoms
--       the night closer's count (one person, D24) and the bills and coins.
--   expected_minor
--       what the drawers say should be in the bag: the day's drops plus each
--       closed drawer's closing count minus its opening float, worked out by
--       the server when the night count was saved.
--   night_note
--       what the closer checked when the count differed from expected.
--   morning_count_minor, morning_counted_by, morning_counted_at, morning_denoms
--       the morning recount by a DIFFERENT employee (D24). The database
--       refuses the same person (deposit_bags_recount_other_person).
--   variance_reason
--       why the night and morning counts differ. The app requires it only when
--       they differ by more than $5.00 (D7, D21). Both counts are kept.
--   sealed_by
--       the employee who sealed the bag (anyone, D25). sealed_at is from 0212.
--   seal_journal_id
--       the books entry the seal posted (10400 Undeposited Funds <- 10100
--       Vault). NULL until it posted. No foreign key: gl_journals and this
--       table are both emptied by the factory reset, and a failed post must
--       never stop the seal from being recorded.
--   banked_on, banked_by, bank_note
--       the day the owner took the bag to the bank, the owner's login (D25:
--       only the owner), and the owner's note of anything left behind and why
--       (CASH_DEPOSIT_POLICY_DECISION.md: "write down why the rest stayed
--       behind"). deposit_confirmed_on (0212) stays the bank's receipt date.
--
-- APPEND-ONLY ONCE SEALED (closes F-03-9). The staff "for all" write policy
-- is dropped: staff can still READ bags, and every write now goes through a
-- server action that records an audit row. After a bag is sealed the trigger
-- below refuses any change to its number, day, amounts, counts, people or
-- seal, refuses a delete, and refuses changing its sessions. The only things
-- that may still be filled in, once each, are the books entry id, the bank
-- date with the owner who banked it and the owner's note, and the bank's
-- receipt date. A bag record is never deleted, sealed or not. The factory
-- reset (gl_factory_reset_active(), 0209) is allowed through, as for every
-- other guard. deposit_bags and deposit_bag_sessions stay WIPE in the reset
-- (factory-reset-core.ts L427–428), so the reset function needs no change.
--
-- SAFE / IDEMPOTENT: add column if not exists; constraints and policies are
-- dropped and re-made by name; create or replace for the function. No
-- existing row changes. Apply MANUALLY in the Supabase SQL editor after 0315.

do $precheck$
begin
  if to_regclass('public.deposit_bags') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0316 depends on deposit_bags from 0212_deposit_bags.sql';
  end if;
  if to_regprocedure('public.gl_factory_reset_active()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0316 depends on gl_factory_reset_active() from 0209_factory_reset.sql';
  end if;
end
$precheck$;

alter table public.deposit_bags add column if not exists night_count_minor integer;
alter table public.deposit_bags add column if not exists night_counted_by uuid
  references public.employees (id) on delete set null;
alter table public.deposit_bags add column if not exists night_counted_at timestamptz;
alter table public.deposit_bags add column if not exists night_denoms jsonb;
alter table public.deposit_bags add column if not exists expected_minor integer;
alter table public.deposit_bags add column if not exists night_note text;
alter table public.deposit_bags add column if not exists morning_count_minor integer;
alter table public.deposit_bags add column if not exists morning_counted_by uuid
  references public.employees (id) on delete set null;
alter table public.deposit_bags add column if not exists morning_counted_at timestamptz;
alter table public.deposit_bags add column if not exists morning_denoms jsonb;
alter table public.deposit_bags add column if not exists variance_reason text;
alter table public.deposit_bags add column if not exists sealed_by uuid
  references public.employees (id) on delete set null;
alter table public.deposit_bags add column if not exists seal_journal_id uuid;
alter table public.deposit_bags add column if not exists banked_on date;
alter table public.deposit_bags add column if not exists banked_by uuid
  references public.staff_profiles (id) on delete set null;
alter table public.deposit_bags add column if not exists bank_note text;

do $m$
begin
  alter table public.deposit_bags drop constraint if exists deposit_bags_night_count_positive;
  alter table public.deposit_bags add constraint deposit_bags_night_count_positive
    check (night_count_minor is null or night_count_minor > 0);
  alter table public.deposit_bags drop constraint if exists deposit_bags_morning_count_positive;
  alter table public.deposit_bags add constraint deposit_bags_morning_count_positive
    check (morning_count_minor is null or morning_count_minor > 0);
  alter table public.deposit_bags drop constraint if exists deposit_bags_expected_not_negative;
  alter table public.deposit_bags add constraint deposit_bags_expected_not_negative
    check (expected_minor is null or expected_minor >= 0);
  -- D24: the morning recount is the second count, so it is a different person.
  alter table public.deposit_bags drop constraint if exists deposit_bags_recount_other_person;
  alter table public.deposit_bags add constraint deposit_bags_recount_other_person
    check (morning_counted_by is null or night_counted_by is null or morning_counted_by <> night_counted_by);
  alter table public.deposit_bags drop constraint if exists deposit_bags_text_lengths;
  alter table public.deposit_bags add constraint deposit_bags_text_lengths
    check (
      (variance_reason is null or char_length(variance_reason) <= 500)
      and (night_note is null or char_length(night_note) <= 500)
      and (bank_note is null or char_length(bank_note) <= 500)
      and char_length(bag_no) <= 60
    );
  -- Banked only after sealed.
  alter table public.deposit_bags drop constraint if exists deposit_bags_banked_after_seal;
  alter table public.deposit_bags add constraint deposit_bags_banked_after_seal
    check (banked_on is null or sealed_at is not null);
end
$m$;

-- ---------------------------------------------------------------------------
-- Append-only once sealed (F-03-9).
-- ---------------------------------------------------------------------------
create or replace function public.deposit_bags_sealed_guard()
returns trigger language plpgsql as $$
begin
  -- Factory reset (0209/0238 hatch): let the wipe through, DELETE and UPDATE.
  if public.gl_factory_reset_active() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'DEPOSIT_BAG_PERMANENT: deposit bag % (%) cannot be deleted. Bag records are kept; write a correction on the bag log instead.', old.bag_no, old.business_day;
  end if;

  if old.sealed_at is null then
    return new;
  end if;

  if new.bag_no is distinct from old.bag_no
     or new.business_day is distinct from old.business_day
     or new.status is distinct from old.status
     or new.amount_minor is distinct from old.amount_minor
     or new.pulled_by is distinct from old.pulled_by
     or new.counted_by is distinct from old.counted_by
     or new.sealed_at is distinct from old.sealed_at
     or new.sealed_by is distinct from old.sealed_by
     or new.night_count_minor is distinct from old.night_count_minor
     or new.night_counted_by is distinct from old.night_counted_by
     or new.night_counted_at is distinct from old.night_counted_at
     or new.night_denoms is distinct from old.night_denoms
     or new.expected_minor is distinct from old.expected_minor
     or new.night_note is distinct from old.night_note
     or new.morning_count_minor is distinct from old.morning_count_minor
     or new.morning_counted_by is distinct from old.morning_counted_by
     or new.morning_counted_at is distinct from old.morning_counted_at
     or new.morning_denoms is distinct from old.morning_denoms
     or new.variance_reason is distinct from old.variance_reason
     or new.notes is distinct from old.notes
     or new.created_at is distinct from old.created_at then
    raise exception 'DEPOSIT_BAG_SEALED: bag % (%) is sealed. Its counts, people and amount cannot be changed.', old.bag_no, old.business_day;
  end if;

  -- Filled in once each, never changed after.
  if old.seal_journal_id is not null and new.seal_journal_id is distinct from old.seal_journal_id then
    raise exception 'DEPOSIT_BAG_SEALED: bag % already names its books entry.', old.bag_no;
  end if;
  if old.banked_on is not null and (new.banked_on is distinct from old.banked_on or new.banked_by is distinct from old.banked_by or new.bank_note is distinct from old.bank_note) then
    raise exception 'DEPOSIT_BAG_SEALED: bag % is already recorded as taken to the bank.', old.bag_no;
  end if;
  if old.deposit_confirmed_on is not null and new.deposit_confirmed_on is distinct from old.deposit_confirmed_on then
    raise exception 'DEPOSIT_BAG_SEALED: bag % already has its bank receipt date.', old.bag_no;
  end if;
  return new;
end $$;

drop trigger if exists trg_deposit_bags_sealed_guard on public.deposit_bags;
create trigger trg_deposit_bags_sealed_guard
  before update or delete on public.deposit_bags
  for each row execute function public.deposit_bags_sealed_guard();

create or replace function public.deposit_bag_sessions_sealed_guard()
returns trigger language plpgsql as $$
declare
  v_bag uuid := coalesce(new.bag_id, old.bag_id);
  v_sealed timestamptz;
begin
  -- Factory reset (0209/0238 hatch): let the wipe through, DELETE and UPDATE.
  if public.gl_factory_reset_active() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  select sealed_at into v_sealed from public.deposit_bags where id = v_bag;
  if v_sealed is not null then
    raise exception 'DEPOSIT_BAG_SEALED: the drawers in a sealed bag cannot be changed.';
  end if;
  if tg_op = 'UPDATE' and old.bag_id is distinct from new.bag_id then
    select sealed_at into v_sealed from public.deposit_bags where id = old.bag_id;
    if v_sealed is not null then
      raise exception 'DEPOSIT_BAG_SEALED: the drawers in a sealed bag cannot be changed.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_deposit_bag_sessions_sealed_guard on public.deposit_bag_sessions;
create trigger trg_deposit_bag_sessions_sealed_guard
  before insert or update or delete on public.deposit_bag_sessions
  for each row execute function public.deposit_bag_sessions_sealed_guard();

-- ---------------------------------------------------------------------------
-- RLS (F-03-9): staff keep READ; the "for all" staff write policy is dropped.
-- Writes go through the server (service role), each with an audit row.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['deposit_bags','deposit_bag_sessions']
  loop
    execute format('drop policy if exists %1$s_staff_read on public.%1$s;', t);
    execute format('create policy %1$s_staff_read on public.%1$s for select using (public.is_staff());', t);
    execute format('drop policy if exists %1$s_staff_write on public.%1$s;', t);
  end loop;
end $$;

comment on column public.deposit_bags.night_count_minor is
  'Fix Phase 2.6 (G-04, D24): the night closer''s count of the deposit, cents. One person, no second count at night.';
comment on column public.deposit_bags.expected_minor is
  'Fix Phase 2.6 (G-04): drops plus each closed drawer''s closing count minus its opening float, worked out by the server at the night count.';
comment on column public.deposit_bags.morning_count_minor is
  'Fix Phase 2.6 (G-04, D24): the morning recount by a different employee, cents. This is the amount sealed and posted.';
comment on column public.deposit_bags.variance_reason is
  'Fix Phase 2.6 (G-04, D7/D21): why the night and morning counts differ. Required by the app only when more than $5.00.';
comment on column public.deposit_bags.sealed_by is
  'Fix Phase 2.6 (G-04, D25): the employee who sealed the bag. Anyone may seal.';
comment on column public.deposit_bags.seal_journal_id is
  'Fix Phase 2.6 (G-14): the books entry the seal posted (10400 <- 10100), source ref seal-bag:<bag id>. NULL until posted.';
comment on column public.deposit_bags.banked_on is
  'Fix Phase 2.6 (G-04, D25): the day the owner took the bag to the bank. Only the owner records it.';
