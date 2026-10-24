-- 0297_ccrs_held_sync.sql  (R74 S39: report what we can, track what is owed)
--
-- WHY. Owner (R74 round 19): "we can not be blocked from reporting to the
-- state. we can hold off on reporting until we know for sure, but we cant
-- block good records from being uploaded ... keep track of what we still need
-- to report so that I can fix them and then reupload them."
--
-- A CCRS batch now leaves out the records it cannot prove (held back: E3, E7,
-- E8, E41, E52, E56, ...) and uploads the rest. This table is the list of what
-- is still owed to CCRS, per env and week, written when a batch is emitted.
--
--   * ccrs_record_held(env, week_start, records) in ONE transaction:
--       - upserts every held record of that emission (last_seen_at = now());
--       - resolves open rows no longer held: master data (Strain, Area,
--         Product, Inventory, InventoryTransfer) is re-planned in full by
--         every batch, so it resolves across ALL weeks of the env; Sale and
--         InventoryAdjustment rows belong to their week, so they resolve only
--         when that week is rebuilt and emitted again.
--
-- Rows are written by the service role only. RLS: staff read.
-- Idempotent: safe to run more than once.
-- Rollback: supabase/rollbacks/0297_ccrs_held_sync.rollback.sql

create table if not exists public.ccrs_held_sync (
  id            uuid primary key default gen_random_uuid(),
  env           text not null check (env in ('preprod', 'prod')),
  week_start    date not null,
  record_type   text not null check (record_type in ('Strain', 'Area', 'Product', 'Inventory', 'InventoryAdjustment', 'InventoryTransfer', 'Sale')),
  record_id     text not null check (length(record_id) between 1 and 300),
  label         text,
  code          text not null,
  reason        text,
  first_held_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  constraint ccrs_held_sync_unique unique (env, week_start, record_type, record_id)
);

comment on table public.ccrs_held_sync is
  'R74 S39: records a CCRS batch left out (held back) and still owes to CCRS, per env and week. resolved_at is set when a later emission no longer holds them.';

create index if not exists ccrs_held_sync_open_idx
  on public.ccrs_held_sync (env, week_start desc)
  where resolved_at is null;

alter table public.ccrs_held_sync enable row level security;
drop policy if exists ccrs_held_sync_staff_read on public.ccrs_held_sync;
create policy ccrs_held_sync_staff_read on public.ccrs_held_sync
  for select using (public.is_staff());

create or replace function public.ccrs_record_held(p_env text, p_week_start date, p_records jsonb)
returns table (held integer, resolved integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held integer := 0;
  v_resolved integer := 0;
begin
  if p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_HELD_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  if p_week_start is null then
    raise exception 'CCRS_HELD_NO_WEEK' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(coalesce(p_records, '[]'::jsonb)) <> 'array' then
    raise exception 'CCRS_HELD_NOT_ARRAY' using errcode = 'check_violation';
  end if;

  insert into public.ccrs_held_sync as h (env, week_start, record_type, record_id, label, code, reason)
  select distinct on (r->>'t', r->>'id') p_env, p_week_start, r->>'t', r->>'id', r->>'label', r->>'code', r->>'reason'
  from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
  on conflict (env, week_start, record_type, record_id) do update
    set label = excluded.label, code = excluded.code, reason = excluded.reason,
        last_seen_at = now(), resolved_at = null;
  get diagnostics v_held = row_count;

  update public.ccrs_held_sync h set resolved_at = now()
  where h.env = p_env and h.resolved_at is null
    and (h.week_start = p_week_start
         or h.record_type in ('Strain', 'Area', 'Product', 'Inventory', 'InventoryTransfer'))
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
      where r->>'t' = h.record_type and r->>'id' = h.record_id);
  get diagnostics v_resolved = row_count;

  return query select v_held, v_resolved;
end $$;

revoke all on function public.ccrs_record_held(text, date, jsonb) from public, anon, authenticated;
grant execute on function public.ccrs_record_held(text, date, jsonb) to service_role;

notify pgrst, 'reload schema';
