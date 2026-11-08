-- supabase/migrations/0349_drawer_drop_bills.sql  (D217 - a safe drop is a count of bills)
--
-- Owner request (verbatim, D217): "We built a message requiring the employee to drop cash after it goes
-- over 2k in sales. That has now happened, the register told the employee to withdraw x amount of money,
-- but it told them it needed to be in 20s. ... When the register tells the employee to make a drop, it
-- should be more clear about how it wants that removed. Should we require they enter the quantities of
-- the bills taken? ... if it's enterprise grade, professional method, add the bill quantity to the fix."
--
-- On 2026-11-08 two safe drops were TYPED as dollar amounts; one recorded $2,080.00 while its own note
-- says $1,540 left the drawer. From D217 the iPad records a SAFE drop as a count of each bill and adds
-- it up (an ATM drop was already a count of $20s, 0346). This file stores that count:
--   1. drawer_drops.bills  jsonb, e.g. {"hundreds": 3, "fifties": 1, "twenties": 103, "ones": 10}.
--      NULL = not counted bill by bill (every drop before D217, back-office drops, ATM drops).
--   2. drawer_drop_bills_total(jsonb): the cents a bill count adds up to; -1 when the shape is wrong
--      (unknown key, coin, negative, fraction, over 2,500 of one bill, not an object).
--   3. CHECK drawer_drops_bills_shape: bills only on a SAFE drop, and they must add up EXACTLY to
--      amount_minor (the amount is the bills; it can never disagree).
--   4. The write-once money trigger (0346) now also protects bills.
--
-- No new table. Factory reset: drawer_drops is WIPE (0240), unchanged.
-- Idempotent: safe to run twice. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Until it is applied the registers keep working: the bill count is saved in the drop's note as
-- "[bills: 3 x $100, ...]" and in the audit log (drawer.drop), so nothing is lost.

do $precheck$
begin
  if to_regclass('public.drawer_drops') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0349 depends on drawer_drops';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'drawer_drops'
                    and column_name = 'destination') then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0349 comes after 0346_atm_cash_drops.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'time_punches'
                    and column_name = 'break_reason') then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0349 comes after 0348_time_punch_breaks.sql';
  end if;
end
$precheck$;

-- 1. The column.
alter table public.drawer_drops add column if not exists bills jsonb;

-- 2. What a bill count adds up to (cents); -1 = not a valid bill count.
create or replace function public.drawer_drop_bills_total(p jsonb)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
  n numeric;
  total bigint := 0;
  face bigint;
begin
  if p is null then
    return null;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return -1;
  end if;
  for k, v in select key, value from jsonb_each(p) loop
    face := case k
      when 'hundreds' then 10000
      when 'fifties' then 5000
      when 'twenties' then 2000
      when 'tens' then 1000
      when 'fives' then 500
      when 'twos' then 200
      when 'ones' then 100
      else null
    end;
    if face is null or jsonb_typeof(v) <> 'number' then
      return -1;
    end if;
    n := (v #>> '{}')::numeric;
    if n <> trunc(n) or n < 0 or n > 2500 then
      return -1;
    end if;
    total := total + n::bigint * face;
  end loop;
  return total;
end
$$;

revoke all on function public.drawer_drop_bills_total(jsonb) from public, anon, authenticated;

-- 3. Bills only on a safe drop, and they ARE the amount.
do $m$
begin
  if not exists (select 1 from pg_constraint where conname = 'drawer_drops_bills_shape') then
    alter table public.drawer_drops
      add constraint drawer_drops_bills_shape
      check (
        bills is null
        or (destination = 'safe'
            and public.drawer_drop_bills_total(bills) > 0
            and public.drawer_drop_bills_total(bills) = amount_minor)
      );
  end if;
end
$m$;

comment on column public.drawer_drops.bills is
  'D217 (0349): the bills a SAFE drop carried, counted on the iPad, e.g. {"hundreds":3,"twenties":103}. amount_minor is their total (CHECK drawer_drops_bills_shape). NULL = not counted bill by bill (before D217, back office, ATM drops).';

-- 4. The money on a drop is write-once, now including its bills.
create or replace function public.drawer_drops_money_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.session_id is distinct from old.session_id
     or new.amount_minor is distinct from old.amount_minor
     or new.destination is distinct from old.destination
     or new.twenties_count is distinct from old.twenties_count
     or new.atm_terminal_id is distinct from old.atm_terminal_id
     or new.dropped_at is distinct from old.dropped_at
     or new.bills is distinct from old.bills then
    raise exception 'DROP_MONEY_IMMUTABLE: a cash drop''s drawer, amount, bills, destination, $20 count, terminal and time are never changed (D198/D217). Explain a mistake on /admin/atm/drops instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists drawer_drops_money_immutable on public.drawer_drops;
create trigger drawer_drops_money_immutable
  before update on public.drawer_drops
  for each row execute function public.drawer_drops_money_immutable();

revoke all on function public.drawer_drops_money_immutable() from public, anon, authenticated;

notify pgrst, 'reload schema';
