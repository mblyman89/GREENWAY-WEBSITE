-- supabase/rollbacks/0349_drawer_drop_bills.rollback.sql  (D217)
--
-- Undo 0349_drawer_drop_bills.sql. Before the column is dropped, each counted drop's bills are written
-- into its note as "[bills: {...}]" so the pre-0349 app still shows them. The note write needs the
-- money trigger to allow it (notes stay writable under 0346 and 0349). The 0346 trigger function is
-- restored. Run the whole file as ONE transaction (the Supabase SQL editor does).

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'drawer_drops'
                and column_name = 'bills') then
    update public.drawer_drops
       set notes = btrim(coalesce(notes, '') || ' [bills: ' || bills::text || ']')
     where bills is not null
       and coalesce(notes, '') not like '%[bills:%';
  end if;
end
$$;

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
     or new.dropped_at is distinct from old.dropped_at then
    raise exception 'DROP_MONEY_IMMUTABLE: a cash drop''s drawer, amount, destination, $20 count, terminal and time are never changed (D198). Explain a mistake on /admin/atm/drops instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

alter table public.drawer_drops drop constraint if exists drawer_drops_bills_shape;
alter table public.drawer_drops drop column if exists bills;
drop function if exists public.drawer_drop_bills_total(jsonb);

notify pgrst, 'reload schema';
