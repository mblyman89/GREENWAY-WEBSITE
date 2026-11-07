-- supabase/rollbacks/0346_atm_cash_drops.rollback.sql  (D198 S1)
--
-- Undo 0346_atm_cash_drops.sql. The money stays right: before the columns are dropped, every ATM drop
-- gets "[ATM drop: N x $20 into <terminal>]" appended to its notes, so the pre-0346 app (which
-- treats every drop as a safe drop) still shows where the cash went, and the audit log keeps the full
-- record (drawer.atm_drop). The owner sign-off table is dropped only when it is empty, so a rollback
-- never destroys review history; otherwise it is left in place (harmless to the old app).

drop trigger if exists drawer_drops_money_immutable on public.drawer_drops;
drop function if exists public.drawer_drops_money_immutable();

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'drawer_drops'
                and column_name = 'destination') then
    update public.drawer_drops
       set notes = btrim(coalesce(notes, '') || ' [ATM drop: ' || coalesce(twenties_count::text, '?')
                   || ' x $20' || coalesce(' into ' || atm_terminal_id, '') || ']')
     where destination = 'atm'
       and coalesce(notes, '') not like '%[ATM drop:%';
  end if;
end
$$;

drop index if exists public.drawer_drops_atm_dropped_at_idx;
alter table public.drawer_drops drop constraint if exists drawer_drops_amount_positive;
alter table public.drawer_drops drop constraint if exists drawer_drops_recorded_via_known;
alter table public.drawer_drops drop constraint if exists drawer_drops_device_id_len;
alter table public.drawer_drops drop constraint if exists drawer_drops_atm_terminal_shape;
alter table public.drawer_drops drop constraint if exists drawer_drops_atm_twenties;
alter table public.drawer_drops drop constraint if exists drawer_drops_destination_known;
alter table public.drawer_drops drop column if exists recorded_via;
alter table public.drawer_drops drop column if exists device_id;
alter table public.drawer_drops drop column if exists atm_terminal_id;
alter table public.drawer_drops drop column if exists twenties_count;
alter table public.drawer_drops drop column if exists destination;

do $$
begin
  if to_regclass('public.atm_drop_reviews') is not null then
    if not exists (select 1 from public.atm_drop_reviews) then
      execute 'drop table public.atm_drop_reviews';
    else
      raise notice 'atm_drop_reviews kept: it holds owner sign-offs (append-only history).';
    end if;
  end if;
end
$$;

notify pgrst, 'reload schema';
