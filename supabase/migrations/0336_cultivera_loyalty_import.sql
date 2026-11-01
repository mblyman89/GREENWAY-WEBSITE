-- 0336_cultivera_loyalty_import.sql  (CVL - owner interrupt, 2026-11-01)
--
-- Owner (verbatim): "cultivera, naturally, does not provide the total loyalty
-- earned, spent, or current amount in the downloadable spreadsheet. which means
-- I need you to add to this fetcher the ability to slowly crawl through each
-- customer record and pull out this info and automatically apply the data to
-- the customers in our back office."
--
-- The crawler (crawler/app/cultivera_loyalty.py) reads every Cultivera customer
-- record. The site matches each one to our customer by customers.external_id
-- (the Cultivera "Customer ID", unique since 0029) and calls
-- apply_cultivera_loyalty in batches of up to 500 after a staff member reviews
-- the preview (rule 3).
--
-- What this does (safe to re-run):
--   1. public.customer_cultivera_loyalty - one row per customer: what Cultivera
--      said (current balance, points spent, dollars spent, and the accrual
--      history sums by type). History only; it never changes a balance itself.
--   2. loyalty_ledger.import_key + a partial UNIQUE index. The opening-balance
--      ledger row for a customer has import_key 'cultivera-opening:<customer id>',
--      so a customer can receive Cultivera's balance ONCE, ever (rule 15: a
--      claim on a unique key; a repeat is "already done", never a double credit).
--   3. public.apply_cultivera_loyalty(...) - one transaction per batch:
--      upserts the history rows, enrolls customers who have a balance and no
--      account (no signup bonus: these points were earned in Cultivera), inserts
--      the opening 'adjust' rows (ON CONFLICT on the import key does nothing),
--      then recomputes balance / lifetime / tier from the ledger exactly as
--      0129 step 1e does (the ledger is the source of truth).
--
-- Grants (rule 15, stated in full):
--   customer_cultivera_loyalty: RLS on, no policies; service_role select,
--     insert, update (the history row is refreshed by a later crawl); never
--     delete; nothing for anon / authenticated. KEPT by the factory reset (the
--     old system's record), so it has no foreign key into a wiped table.
--   apply_cultivera_loyalty: security invoker, pinned search_path, execute for
--     service_role only.
--   loyalty_ledger / loyalty_accounts grants are unchanged (one new column and
--     one new index on the ledger).

create table if not exists public.customer_cultivera_loyalty (
  -- Keyed by the Cultivera Customer ID, with NO foreign key into a table the
  -- factory reset empties: this is the old system's record and is KEPT by the
  -- reset (src/lib/accounting/factory-reset-core.ts). A kept row may not point
  -- at a wiped one (0240 preflight RESET_KEPT_TABLE_POINTS_AT_WIPE).
  cultivera_customer_id     text primary key,
  -- Our customer this record was last applied to (customers.id; deliberately not a foreign key, see above).
  customer_id               uuid not null,
  -- Cultivera's numbers, exactly as its customer record / accrual report gave them (points are decimals there).
  balance_points            numeric(14,2) not null,
  spent_points              numeric(14,2) not null,
  spent_amount_minor_units  bigint not null,
  earned_order_points       numeric(14,2),
  initial_points            numeric(14,2),
  adjusted_points           numeric(14,2),
  returned_points           numeric(14,2),
  cancelled_points          numeric(14,2),
  accrual_rows              integer,
  cultivera_order_count     integer,
  cultivera_total_minor_units bigint,
  deleted_in_cultivera      boolean not null,
  -- The whole points our ledger receives (Cultivera balance rounded to the nearest point; 0 = nothing to add).
  -- Frozen once the opening ledger row exists. Whether it was credited is read from loyalty_ledger.import_key.
  opening_points            integer not null check (opening_points >= 0),
  run_id                    text not null,
  captured_at               timestamptz not null,
  imported_by               uuid references public.staff_profiles(id) on delete set null,
  imported_at               timestamptz not null,
  updated_at                timestamptz not null
);

create index if not exists customer_cultivera_loyalty_customer_idx
  on public.customer_cultivera_loyalty (customer_id);

comment on table public.customer_cultivera_loyalty is
  'CVL (0336): each customer''s loyalty as Cultivera recorded it (current balance, points spent, dollars spent, accrual sums by type), keyed by the Cultivera Customer ID. Kept by the factory reset. The balance itself enters loyalty_ledger once as an opening adjust row (import_key cultivera-opening:<customer id>).';

alter table public.customer_cultivera_loyalty enable row level security;

revoke all on table public.customer_cultivera_loyalty from public, anon, authenticated;
revoke delete, truncate, references, trigger on table public.customer_cultivera_loyalty from service_role;
grant select, insert, update on table public.customer_cultivera_loyalty to service_role;

alter table public.loyalty_ledger add column if not exists import_key text;
comment on column public.loyalty_ledger.import_key is
  'CVL (0336): set only on a row brought in from another system (''cultivera-opening:<customer id>''). Unique, so it can be applied once.';
create unique index if not exists loyalty_ledger_import_key_uidx
  on public.loyalty_ledger (import_key) where import_key is not null;

create or replace function public.apply_cultivera_loyalty(
  p_run_id text,
  p_captured_at timestamptz,
  p_actor uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rows int;
  v_matched int;
  v_accounts int;
  v_openings int;
  v_wanted int;
  v_already int;
begin
  if p_run_id is null or p_run_id !~ '^\d{8}T\d{6}Z-[0-9a-f]{8}$' then
    raise exception 'apply_cultivera_loyalty: bad run id %', p_run_id using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'apply_cultivera_loyalty: p_rows must be a json array' using errcode = '22023';
  end if;
  v_rows := jsonb_array_length(p_rows);
  if v_rows > 500 then
    raise exception 'apply_cultivera_loyalty: at most 500 rows per call (got %)', v_rows using errcode = '22023';
  end if;

  -- 1. History rows (refreshed on a later crawl; opening points freeze once the opening row exists).
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(
      external_id text, balance numeric, spent_points numeric, spent_minor bigint,
      earned_orders numeric, initial numeric, adjusted numeric, returned numeric, cancelled numeric,
      accrual_rows int, orders int, total_minor bigint, deleted boolean, opening_points int)
  ), m as (
    select distinct on (s.external_id) c.id as customer_id, s.*
      from src s join public.customers c on c.external_id = s.external_id
     order by s.external_id
  ), up as (
    insert into public.customer_cultivera_loyalty as t (
      cultivera_customer_id, customer_id, balance_points, spent_points, spent_amount_minor_units,
      earned_order_points, initial_points, adjusted_points, returned_points, cancelled_points, accrual_rows,
      cultivera_order_count, cultivera_total_minor_units, deleted_in_cultivera, opening_points,
      run_id, captured_at, imported_by, imported_at, updated_at)
    select external_id, customer_id, balance, spent_points, spent_minor,
           earned_orders, initial, adjusted, returned, cancelled, accrual_rows,
           orders, total_minor, coalesce(deleted, false), greatest(coalesce(opening_points, 0), 0),
           p_run_id, p_captured_at, p_actor, now(), now()
      from m
    on conflict (cultivera_customer_id) do update set
      customer_id = excluded.customer_id,
      balance_points = excluded.balance_points,
      spent_points = excluded.spent_points,
      spent_amount_minor_units = excluded.spent_amount_minor_units,
      earned_order_points = excluded.earned_order_points,
      initial_points = excluded.initial_points,
      adjusted_points = excluded.adjusted_points,
      returned_points = excluded.returned_points,
      cancelled_points = excluded.cancelled_points,
      accrual_rows = excluded.accrual_rows,
      cultivera_order_count = excluded.cultivera_order_count,
      cultivera_total_minor_units = excluded.cultivera_total_minor_units,
      deleted_in_cultivera = excluded.deleted_in_cultivera,
      -- once the opening row exists, the opening points stay what was credited
      opening_points = case
        when exists (select 1 from public.loyalty_ledger l
                      where l.import_key = 'cultivera-opening:' || excluded.customer_id::text)
          and t.customer_id = excluded.customer_id
        then t.opening_points else excluded.opening_points end,
      run_id = excluded.run_id,
      captured_at = excluded.captured_at,
      imported_by = excluded.imported_by,
      updated_at = now()
    returning 1
  )
  select count(*) into v_matched from up;

  -- 2. Enroll customers who still need an opening credit and have no account (no signup bonus).
  insert into public.loyalty_accounts (customer_id, balance_points, lifetime_points, tier_id, enrolled_at, is_active,
                                       created_at, updated_at)
  select b.customer_id, 0, 0, null, now(), true, now(), now()
    from (select h.customer_id, h.cultivera_customer_id as external_id, h.opening_points, h.balance_points
        from public.customer_cultivera_loyalty h
       where h.cultivera_customer_id in (select r.external_id from jsonb_to_recordset(p_rows) as r(external_id text))
         and exists (select 1 from public.customers c where c.id = h.customer_id and c.external_id = h.cultivera_customer_id)) b
   where b.opening_points > 0
     and not exists (select 1 from public.loyalty_ledger l where l.import_key = 'cultivera-opening:' || b.customer_id::text)
  on conflict (customer_id) do nothing;
  get diagnostics v_accounts = row_count;

  -- 3. The opening balance: one adjust row per customer, ever (unique import_key; a repeat does nothing).
  select count(*) filter (where not exists (select 1 from public.loyalty_ledger l where l.import_key = 'cultivera-opening:' || b.customer_id::text)),
         count(*) filter (where exists (select 1 from public.loyalty_ledger l where l.import_key = 'cultivera-opening:' || b.customer_id::text))
    into v_wanted, v_already
    from (select h.customer_id, h.cultivera_customer_id as external_id, h.opening_points, h.balance_points
        from public.customer_cultivera_loyalty h
       where h.cultivera_customer_id in (select r.external_id from jsonb_to_recordset(p_rows) as r(external_id text))
         and exists (select 1 from public.customers c where c.id = h.customer_id and c.external_id = h.cultivera_customer_id)) b
   where b.opening_points > 0;

  with ins as (
    insert into public.loyalty_ledger (account_id, kind, points, order_id, basis_minor, promotion_id, redemption_id,
                                       note, created_by, created_at, import_key)
    select a.id, 'adjust', b.opening_points, null, null, null, null,
           'Cultivera opening balance (' || b.balance_points::text || ' pts in Cultivera, run ' || p_run_id || ')',
           p_actor, now(), 'cultivera-opening:' || b.customer_id::text
      from (select h.customer_id, h.cultivera_customer_id as external_id, h.opening_points, h.balance_points
        from public.customer_cultivera_loyalty h
       where h.cultivera_customer_id in (select r.external_id from jsonb_to_recordset(p_rows) as r(external_id text))
         and exists (select 1 from public.customers c where c.id = h.customer_id and c.external_id = h.cultivera_customer_id)) b
      join public.loyalty_accounts a on a.customer_id = b.customer_id
     where b.opening_points > 0
    on conflict (import_key) where import_key is not null do nothing
    returning 1
  )
  select count(*) into v_openings from ins;

  -- 4. Recompute the caches from the ledger (mirrors 0129 step 1e).
  update public.loyalty_accounts a
     set balance_points  = coalesce(s.bal, 0),
         lifetime_points = coalesce(s.life, 0),
         tier_id = (
           select t.id from public.loyalty_tiers t
            where t.is_active and t.min_points <= coalesce(s.life, 0)
            order by t.min_points desc
            limit 1),
         updated_at = now()
    from (
      select l.account_id, sum(l.points) as bal, sum(greatest(l.points, 0)) as life
        from public.loyalty_ledger l
       where l.account_id in (
         select a2.id from public.loyalty_accounts a2 join (select h.customer_id, h.cultivera_customer_id as external_id, h.opening_points, h.balance_points
        from public.customer_cultivera_loyalty h
       where h.cultivera_customer_id in (select r.external_id from jsonb_to_recordset(p_rows) as r(external_id text))
         and exists (select 1 from public.customers c where c.id = h.customer_id and c.external_id = h.cultivera_customer_id)) b on b.customer_id = a2.customer_id)
       group by l.account_id
    ) s
   where s.account_id = a.id;

  return jsonb_build_object(
    'rows', v_rows,
    'matched', v_matched,
    'unmatched', v_rows - v_matched,
    'accountsCreated', v_accounts,
    'openingsCredited', v_openings,
    -- already credited before this call, plus any another call credited in the meantime
    'openingsAlreadyDone', v_already + (v_wanted - v_openings));
end;
$$;

comment on function public.apply_cultivera_loyalty(text, timestamptz, uuid, jsonb) is
  'CVL (0336): apply up to 500 crawled Cultivera loyalty records: history rows, enrollment, one opening adjust per customer (unique import_key), cache recompute. Server only.';

revoke all on function public.apply_cultivera_loyalty(text, timestamptz, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_cultivera_loyalty(text, timestamptz, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
