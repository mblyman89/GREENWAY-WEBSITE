-- ═══════════════════════════════════════════════════════════════════════════
-- 0201  THE DATE THE PAPER WAS HANDED TO YOU
--
-- books-38. This migration adds ONE column to public.wage_orders:
--
--     served_date date
--
-- It is one column and it carries two statutory clocks, and getting it wrong
-- in either direction costs Greenway real money. This header explains why the
-- column has to exist separately, why nothing is backfilled into it, and what
-- Michael should expect to see when he runs this file.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY order_date IS NOT GOOD ENOUGH
-- ───────────────────────────────────────────────────────────────────────────
--
-- 0198 created wage_orders with an `order_date` column. That is the date the
-- judge signed the order. It is printed at the bottom of the judgement, near
-- the signature, and it is the date most people would write down if you asked
-- them "when is this order from?".
--
-- It is NOT the date any deadline runs from.
--
-- Every clock in Washington garnishment law runs from the date the paper was
-- SERVED on the employer. Two of them:
--
--   RCW 26.18.110(1) -- the answer:
--     "An employer upon whom service of a wage assignment order or income
--      withholding order has been made shall answer the order by sworn
--      affidavit within twenty days after the date of service."
--
--   RCW 6.27.350(1) -- the sixty-day continuing lien:
--     "...until the expiration of the employer's payroll period ending on or
--      before sixty days after the effective date of the writ... The
--      'effective date' of a writ is the date of service of the writ if there
--      is no previously served writ..."
--
-- Both say DATE OF SERVICE. Neither says the date the judge signed it.
--
-- The gap between the two is not academic. A court signs an order, it goes to
-- the support registry or a process server, and it reaches the employer days
-- or weeks later. If the engine measured twenty days from the SIGNATURE date
-- on an order signed three weeks before it arrived, it would tell Michael the
-- answer was already overdue on the day he opened the envelope -- or, far
-- worse in the other direction on a writ that arrived quickly, it would give
-- him a deadline LATER than the true one and he would miss it while looking
-- at a screen that said he had time.
--
-- Missing the answer on a support order is an independent route to liability
-- under RCW 26.18.110(6)(b) for the FULL support debt. Missing it on a
-- creditor writ exposes Greenway to a default judgment under RCW 6.27.200 for
-- "the full amount claimed by the plaintiff against the defendant". Not the
-- slice that should have been withheld. The whole debt, somebody else's debt,
-- entered against the company.
--
-- So the two dates are different facts with different consequences, and a
-- column that stores one of them cannot be asked to answer for the other.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THERE IS NO BACKFILL
-- ───────────────────────────────────────────────────────────────────────────
--
-- The obvious convenience here is `update wage_orders set served_date =
-- order_date where served_date is null`. This migration deliberately does not
-- do that, and will never do that.
--
-- Copying the signature date into the service date does not fill a gap in the
-- data. It manufactures a fact nobody observed, and then hands that invented
-- fact to a function that computes a legal deadline from it. The screen would
-- go from honestly blank to confidently wrong, which is the worse of the two
-- states, because a blank field gets asked about and a filled one does not.
--
-- The service date is a real-world event with real-world evidence: the
-- delivery receipt, the certified-mail card, the date stamped when the process
-- server handed it over, or the envelope. Somebody has to read it off that
-- evidence and type it in. That is not friction to be engineered away; it is
-- the only honest source for the number.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THE COLUMN IS ADDED NULLABLE AND THEN TIGHTENED CONDITIONALLY
-- ───────────────────────────────────────────────────────────────────────────
--
-- `alter table ... add column served_date date not null` fails outright if the
-- table has any rows, because there is no default to give them -- and per the
-- section above there must not be one.
--
-- At the time of writing wage_orders is provably empty in this codebase: there
-- has never been a write path to it. `grep -rn "insert into public.wage_orders"
-- supabase/ src/` returns nothing, and garnishment-store.ts exports exactly one
-- function, loadGarnishmentBoard(), which only reads. books-38 is the slice
-- that builds the write path, so this migration runs BEFORE the first row can
-- possibly exist.
--
-- But "provably empty in the repo" is not the same as "empty in Michael's
-- database", and this file is applied by hand to a live system. So it does the
-- careful thing:
--
--   1. add the column nullable  (always safe, never fails)
--   2. count the rows that lack it
--   3. if there are none -> set not null, so the database itself guarantees
--      every future order records when it was served
--   4. if there are some -> leave it nullable, and RAISE A NOTICE naming the
--      exact case numbers that need a human to look at the envelope
--
-- Branch 4 does not silence the problem, it addresses it to a person. The
-- application layer refuses a draft with no served date regardless of which
-- branch ran (wage-order-entry-core.ts, refusal codes NO_SERVED_DATE and
-- BAD_SERVED_DATE), so a nullable column is a gap in the belt, not in the
-- braces.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHAT MICHAEL SHOULD SEE
-- ───────────────────────────────────────────────────────────────────────────
--
-- On a database that has never held a wage order -- which is the expected case
-- -- running this file prints:
--
--     NOTICE:  0201: wage_orders holds no orders yet, so served_date is now NOT NULL.
--     NOTICE:  0201: every future order must record the date it was served.
--
-- and the audit query at the bottom returns ZERO ROWS. Zero rows is the pass.
--
-- If it instead lists case numbers, those are real orders already in the
-- system whose service date nobody captured. Find the envelope or the delivery
-- receipt for each one and set it, then re-run the tightening block at the
-- bottom of this file. Do not guess at them.
--
-- Running this file a second time is safe and does nothing.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 1. The column.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.wage_orders
  add column if not exists served_date date;

comment on column public.wage_orders.served_date is
  'The date this order or writ was SERVED on Greenway - not the date the court '
  'signed it (that is order_date). RCW 26.18.110(1) runs the twenty-day answer '
  'deadline from the date of service, and RCW 6.27.350(1) defines the effective '
  'date of a writ - the start of the sixty-day continuing lien - as the date of '
  'service. Read it off the delivery receipt or the envelope. Never inferred.';


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 2. Service cannot precede signature.
--
-- A writ cannot be handed to an employer before the judge signs it. If those
-- two dates arrive out of order, one of them was mistyped, and the likeliest
-- mistype is a transposed year on the date that drives the deadline. Catching
-- it here means it is caught at entry rather than discovered when a default
-- judgment notice arrives.
--
-- The constraint tolerates NULL on both sides so it cannot block step 1 or
-- fight the conditional tightening in step 3.
-- ───────────────────────────────────────────────────────────────────────────
do $mig0201a$
begin
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


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 3. Tighten to NOT NULL, but only if that can be done truthfully.
--
-- See the header. This never backfills and never fails the migration; on a
-- populated table it reports and leaves the column nullable.
-- ───────────────────────────────────────────────────────────────────────────
do $mig0201b$
declare
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

    -- Say WHICH of the two clean states this is. The first version of this
    -- block printed "wage_orders is empty" in both cases, which was a lie in
    -- the second one: on the re-run after someone has filled in the missing
    -- service dates, the table is NOT empty, it is complete. Those are
    -- different facts and the person reading the notice is entitled to the
    -- true one -- especially since one of them means "nothing has happened
    -- yet" and the other means "the gap you were told about is now closed".
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


-- ───────────────────────────────────────────────────────────────────────────
-- STEP 4. Index the answer clock.
--
-- The garnishment board's whole job is to surface "what is about to be
-- overdue". That question is asked by served_date on live orders, every time
-- the page loads.
-- ───────────────────────────────────────────────────────────────────────────
create index if not exists wage_orders_served_date_idx
  on public.wage_orders (served_date)
  where status = 'active';


-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT. Paste this after the migration. ZERO ROWS IS THE PASS.
--
-- It reports any live order that cannot answer the two questions the statutes
-- ask: when were you served, and is that date after the judge signed?
-- ═══════════════════════════════════════════════════════════════════════════
-- select case_number,
--        order_kind,
--        order_date,
--        served_date,
--        case
--          when served_date is null              then 'NO SERVICE DATE - deadline cannot be computed'
--          when served_date <  order_date        then 'SERVED BEFORE SIGNED - one of these is mistyped'
--        end as problem
--   from public.wage_orders
--  where status = 'active'
--    and (served_date is null or served_date < order_date)
--  order by case_number;
