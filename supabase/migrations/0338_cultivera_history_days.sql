-- supabase/migrations/0338_cultivera_history_days.sql  (CVB-8)
--
-- Report history from Cultivera (owner request 2026-11-02, decision CVB-D15 in
-- docs/sop-program/00-OWNER-REQUEST-VERBATIM.md).
--
--   1. public.cultivera_history_days - one row per Pacific day of Cultivera's COMPLETED-order sales,
--      rolled up from the archived `orders.YYYY-MM.jsonl.gz` parts in the private cultivera-archive
--      bucket (never from the crawler directly). Each day is cross-checked against Cultivera's own
--      daily report (cultivera_benchmark_days: net_sales + taxes) and the result is stored with it:
--        match     - the orders add up to the daily report to the cent
--        returns   - they differ, and the day had returns (Cultivera nets returns differently)
--        mismatch  - they differ with no returns: shown with a warning, never hidden
--        no_daily  - no daily report row for that day
--      This table is NEVER written into the books (orders, ledger, GL). Reports show it only as
--      "Cultivera (imported)", only for days before the cut-over, and only to the owner.
--   2. public.cvb_upsert_history_days(run_id, rows) - stores up to 1,000 days from an archived run;
--      a day from a newer capture is never overwritten by an older one.
--
-- Grants: RLS on; service_role select / insert / update (a newer harvest refreshes a day); no delete;
-- nothing for anon / authenticated. Kept by the factory reset (src/lib/accounting/factory-reset-core.ts).
-- Idempotent: safe to run twice.

create table if not exists public.cultivera_history_days (
  day                 date primary key,
  -- Sum of Total (tax-inclusive, after discounts) of the day's completed orders, in cents.
  revenue_minor       bigint not null,
  -- Sum of TotalReturned of those orders, in cents (>= 0).
  returned_minor      bigint not null default 0,
  orders              integer not null check (orders >= 0),
  -- Items sold (Cultivera's Units can be fractional for bulk lines).
  units               numeric(14, 3) not null default 0,
  -- Cultivera's daily report for the same day (net_sales + taxes, cents); null when there is none.
  daily_check_minor   bigint,
  diff_minor          bigint,
  check_status        text not null check (check_status in ('match', 'returns', 'mismatch', 'no_daily')),
  run_id              text not null references public.cultivera_archive_runs(run_id) on delete restrict,
  captured_at         timestamptz not null,
  updated_at          timestamptz not null default now()
);

comment on table public.cultivera_history_days is
  'CVB-8 (0338): Cultivera completed-order sales per Pacific day (cents), from an archived run, cross-checked against Cultivera''s daily report. Report history only ("Cultivera (imported)", before the cut-over, owner only); never written into the books. Kept by the factory reset.';

alter table public.cultivera_history_days enable row level security;
revoke all on table public.cultivera_history_days from public, anon, authenticated;
revoke delete, truncate, references, trigger on table public.cultivera_history_days from service_role;
grant select, insert, update on table public.cultivera_history_days to service_role;

create or replace function public.cvb_upsert_history_days(
  p_run_id text,
  p_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_captured timestamptz;
  v_n int;
  v_written int;
begin
  select captured_at into v_captured from public.cultivera_archive_runs where run_id = p_run_id;
  if not found then
    raise exception 'cvb_upsert_history_days: run % is not archived', p_run_id
      using errcode = 'invalid_parameter_value';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'cvb_upsert_history_days: rows must be a list of at most 1,000' using errcode = 'invalid_parameter_value';
  end if;
  v_n := jsonb_array_length(p_rows);

  with src as (
    select (r->>'day')::date as day,
           (r->>'revenue_minor')::bigint as rev,
           coalesce((r->>'returned_minor')::bigint, 0) as ret,
           (r->>'orders')::int as ord,
           coalesce((r->>'units')::numeric, 0) as u,
           (r->>'daily_check_minor')::bigint as chk,
           (r->>'diff_minor')::bigint as diff,
           r->>'check_status' as st
      from jsonb_array_elements(p_rows) r
  ), up as (
    insert into public.cultivera_history_days as h
      (day, revenue_minor, returned_minor, orders, units, daily_check_minor, diff_minor, check_status,
       run_id, captured_at, updated_at)
    select day, rev, ret, ord, u, chk, diff, st, p_run_id, v_captured, now() from src
    on conflict (day) do update set
      revenue_minor = excluded.revenue_minor, returned_minor = excluded.returned_minor,
      orders = excluded.orders, units = excluded.units,
      daily_check_minor = excluded.daily_check_minor, diff_minor = excluded.diff_minor,
      check_status = excluded.check_status, run_id = excluded.run_id,
      captured_at = excluded.captured_at, updated_at = now()
    where h.captured_at <= excluded.captured_at
    returning 1
  )
  select count(*) into v_written from up;

  return jsonb_build_object('rows', v_n, 'written', v_written, 'kept_newer', v_n - v_written);
end;
$$;

comment on function public.cvb_upsert_history_days(text, jsonb) is
  'CVB-8 (0338): store up to 1,000 Cultivera history days (cents) from an archived run; a day from a newer capture is never overwritten by an older one. Server only.';

revoke all on function public.cvb_upsert_history_days(text, jsonb) from public, anon, authenticated;
grant execute on function public.cvb_upsert_history_days(text, jsonb) to service_role;

notify pgrst, 'reload schema';
