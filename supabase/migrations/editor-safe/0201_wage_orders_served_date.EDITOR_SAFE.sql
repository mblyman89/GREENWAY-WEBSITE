alter table public.wage_orders
  add column if not exists served_date date;

comment on column public.wage_orders.served_date is
  'The date this order or writ was SERVED on Greenway - not the date the court '
  'signed it (that is order_date). RCW 26.18.110(1) runs the twenty-day answer '
  'deadline from the date of service, and RCW 6.27.350(1) defines the effective '
  'date of a writ - the start of the sixty-day continuing lien - as the date of '
  'service. Read it off the delivery receipt or the envelope. Never inferred.';

do $mig0201a$begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wage_orders_served_after_ordered'
       and conrelid = 'public.wage_orders'::regclass
  ) then
    alter table public.wage_orders
      add constraint wage_orders_served_after_ordered
      check (served_date is null
             or order_date is null
             or served_date >= order_date);
    raise notice '0201: added wage_orders_served_after_ordered.';
  else
    raise notice '0201: wage_orders_served_after_ordered already present.';
  end if;
end
$mig0201a$;

do $mig0201b$declare
  gaps       bigint;
  gap_cases  text;
  total      bigint;
  already    boolean;
begin
  select attnotnull
    into already
    from pg_attribute
   where attrelid = 'public.wage_orders'::regclass
     and attname  = 'served_date'
     and attnum   > 0
     and not attisdropped;

  if already then
    raise notice '0201: served_date is already NOT NULL. Nothing to do.';
    return;
  end if;

  select count(*),
         coalesce(string_agg(case_number, ', ' order by case_number), '')
    into gaps, gap_cases
    from public.wage_orders
   where served_date is null;

  if gaps = 0 then
    alter table public.wage_orders
      alter column served_date set not null;

    select count(*) into total from public.wage_orders;

    if total = 0 then
      raise notice '0201: wage_orders holds no orders yet, so served_date is '
                   'now NOT NULL.';
    else
      raise notice '0201: all % existing order(s) now record a service date, '
                   'so served_date is now NOT NULL.', total;
    end if;
    raise notice '0201: every future order must record the date it was served.';
  else
    raise notice '0201: % existing order(s) have no served_date, so the column '
                 'stays nullable for now.', gaps;
    raise notice '0201: case number(s) needing a service date: %', gap_cases;
    raise notice '0201: find the delivery receipt or envelope for each, set '
                 'served_date, then re-run this file. Do not guess the date - '
                 'it is what RCW 26.18.110(1) and RCW 6.27.350(1) measure from.';
  end if;
end
$mig0201b$;

create index if not exists wage_orders_served_date_idx
  on public.wage_orders (served_date)
  where status = 'active';
