-- supabase/rollbacks/0347_deposit_bag_atm_pull.rollback.sql  (D198e)
--
-- Undo 0347_deposit_bag_atm_pull.sql. The money stays right: before the columns are dropped, every
-- bag with an ATM pull gets "[ATM pull: N x $20 = $X into <terminal> at <time>]" appended to its
-- night_note, so the pre-0347 app still shows why the bag is short of its expected deposit, and the
-- audit log keeps the full record (deposit_bag.atm_pull). The immutability trigger is dropped FIRST,
-- and the 0316 sealed-bag guard is switched off ONLY around that one note update (inside this
-- transaction) so sealed bags get the note too; it is switched back on straight after. The note is
-- kept inside the 500-character limit (0316 deposit_bags_text_lengths).
-- Run the whole file as ONE transaction (the Supabase SQL editor does).

drop trigger if exists deposit_bags_atm_pull_immutable on public.deposit_bags;
drop function if exists public.deposit_bags_atm_pull_immutable();

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'deposit_bags'
                and column_name = 'atm_pull_twenties') then
    if exists (select 1 from pg_trigger where tgname = 'trg_deposit_bags_sealed_guard'
                 and tgrelid = 'public.deposit_bags'::regclass) then
      alter table public.deposit_bags disable trigger trg_deposit_bags_sealed_guard;
    end if;
    update public.deposit_bags
       set night_note = right(btrim(coalesce(night_note, '') || ' [ATM pull: ' || atm_pull_twenties::text
                   || ' x $20 = $' || to_char(atm_pull_minor / 100.0, 'FM999999990.00')
                   || coalesce(' into ' || atm_pull_terminal_id, '')
                   || ' at ' || to_char(atm_pulled_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') || ']'), 500)
     where atm_pull_twenties is not null
       and coalesce(night_note, '') not like '%[ATM pull:%';
    if exists (select 1 from pg_trigger where tgname = 'trg_deposit_bags_sealed_guard'
                 and tgrelid = 'public.deposit_bags'::regclass) then
      alter table public.deposit_bags enable trigger trg_deposit_bags_sealed_guard;
    end if;
  end if;
end
$$;

drop index if exists public.deposit_bags_atm_pulled_at_idx;
alter table public.deposit_bags drop constraint if exists deposit_bags_atm_pull_balance_seen;
alter table public.deposit_bags drop constraint if exists deposit_bags_atm_pull_reason_len;
alter table public.deposit_bags drop constraint if exists deposit_bags_atm_pull_flags_bounded;
alter table public.deposit_bags drop constraint if exists deposit_bags_atm_pull_witness_other_person;
alter table public.deposit_bags drop constraint if exists deposit_bags_atm_pull_shape;
alter table public.deposit_bags drop column if exists atm_pull_reason;
alter table public.deposit_bags drop column if exists atm_pull_balance_seen_at;
alter table public.deposit_bags drop column if exists atm_pull_balance_seen_cents;
alter table public.deposit_bags drop column if exists atm_pull_flags;
alter table public.deposit_bags drop column if exists atm_pull_terminal_id;
alter table public.deposit_bags drop column if exists atm_pulled_at;
alter table public.deposit_bags drop column if exists atm_pull_witnessed_by;
alter table public.deposit_bags drop column if exists atm_pulled_by;
alter table public.deposit_bags drop column if exists atm_pull_minor;
alter table public.deposit_bags drop column if exists atm_pull_twenties;

notify pgrst, 'reload schema';
