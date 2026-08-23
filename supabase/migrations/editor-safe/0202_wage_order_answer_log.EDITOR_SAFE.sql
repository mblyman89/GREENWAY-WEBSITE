alter table public.wage_orders
  add column if not exists answer_filed_at date;

alter table public.wage_orders
  add column if not exists answer_filed_note text;

alter table public.wage_orders
  add column if not exists answer_not_required boolean not null default false;

alter table public.wage_orders
  add column if not exists answer_waived_reason text;

comment on column public.wage_orders.answer_filed_at is
  'The date the sworn answer or affidavit for this order was actually filed. '
  'RCW 26.18.110(1) requires it within twenty days of SERVICE (served_date), '
  'and RCW 26.18.110(6)(b) makes failing to answer an independent route to '
  'liability for the whole support debt - withholding correctly does not cure '
  'a missing answer. NULL means no answer is on file, which is what the '
  'watchman reminds about. Never inferred and never backfilled.';

comment on column public.wage_orders.answer_filed_note is
  'What was filed and how, in plain words - "sworn affidavit mailed to the '
  'registry, certified 7014 1120 0000 1234 5678". This is the sentence that '
  'answers the question two years later. Optional, and strongly encouraged.';

comment on column public.wage_orders.answer_not_required is
  'TRUE only where no answer duty exists - a tax levy is not served under '
  'chapter 26.18 or 6.27 RCW and neither answer machinery applies. Requires a '
  'written reason. The application refuses this for child_support and '
  'spousal_support, where an answer is always required.';

comment on column public.wage_orders.answer_waived_reason is
  'Why no answer is required. Mandatory whenever answer_not_required is true, '
  'because an unexplained waiver looks exactly like a mistake.';

do $mig0202a$begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wage_orders_answer_after_served'
       and conrelid = 'public.wage_orders'::regclass
  ) then
    alter table public.wage_orders
      add constraint wage_orders_answer_after_served
      check (answer_filed_at is null
             or served_date is null
             or answer_filed_at >= served_date);
    raise notice '0202: added wage_orders_answer_after_served.';
  else
    raise notice '0202: wage_orders_answer_after_served already present.';
  end if;
end
$mig0202a$;

do $mig0202b$begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wage_orders_waiver_has_reason'
       and conrelid = 'public.wage_orders'::regclass
  ) then
    alter table public.wage_orders
      add constraint wage_orders_waiver_has_reason
      check (answer_not_required = false
             or (answer_waived_reason is not null
                 and length(btrim(answer_waived_reason)) >= 5));
    raise notice '0202: added wage_orders_waiver_has_reason.';
  else
    raise notice '0202: wage_orders_waiver_has_reason already present.';
  end if;
end
$mig0202b$;

do $mig0202c$begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'wage_orders_answer_xor_waiver'
       and conrelid = 'public.wage_orders'::regclass
  ) then
    alter table public.wage_orders
      add constraint wage_orders_answer_xor_waiver
      check (not (answer_filed_at is not null and answer_not_required = true));
    raise notice '0202: added wage_orders_answer_xor_waiver.';
  else
    raise notice '0202: wage_orders_answer_xor_waiver already present.';
  end if;
end
$mig0202c$;

create index if not exists wage_orders_answer_outstanding_idx
  on public.wage_orders (served_date)
  where answer_filed_at is null
    and answer_not_required = false
    and status <> 'terminated';

do $mig0202d$declare
  outstanding bigint;
  supports    bigint;
begin
  select count(*)
    into outstanding
    from public.wage_orders
   where answer_filed_at is null
     and answer_not_required = false
     and status <> 'terminated';

  select count(*)
    into supports
    from public.wage_orders
   where answer_filed_at is null
     and answer_not_required = false
     and status <> 'terminated'
     and order_kind in ('child_support', 'spousal_support');

  if outstanding = 0 then
    raise notice '0202: no live order is missing an answer. The watchman will '
                 'be quiet until the next order is served.';
  else
    raise notice '0202: % live order(s) have no answer on file, % of them '
                 'support orders. This is not a backfill error - nothing has '
                 'ever tracked these, so the honest state is unknown, and '
                 'unknown on a twenty-day deadline is deliberately loud.',
                 outstanding, supports;
    raise notice '0202: clear each one at Books -> Garnishments by recording '
                 'the date the affidavit was filed. Do not guess the date.';
  end if;
end
$mig0202d$;
