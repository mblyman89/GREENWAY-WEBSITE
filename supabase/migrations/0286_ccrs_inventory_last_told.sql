-- 0286_ccrs_inventory_last_told.sql  (Round 6 / Slice R6-3)
--
-- ONE read-only function, no tables: for the Inventory lots a batch would
-- send as an Update, what CCRS last ACCEPTED for each one, so an unchanged
-- lot is not re-sent every week.
--
-- Why: "Inventory.CSV is required weekly by any licensed facility that owns
-- the inventory, only when inventory exists that is unreported, or unreported
-- updates to an existing inventory. No report is needed if there are no
-- changes." [G L0525-L0527]; "if there is nothing new to report, there is no
-- report to submit" [FAQ L0049]. Today every live lot is re-sent as an Update
-- every week, unchanged or not.
--
-- "Last told" is the payload of the most recent Inventory row for the id in a
-- file of this env that was UPLOADED (any state after upload, never draft /
-- emitted / abandoned) and that CCRS did not reject:
--   * that row is ACCEPTED (row state submitted/confirmed in an ANSWERED file:
--     succeeded / errored / reconciling / closed) -> told = its payload;
--   * otherwise (its file is still waiting for an answer, or the answer left
--     the row uncertain) -> told = null: nobody knows what CCRS holds, so the
--     caller sends the lot.
-- A rejected row never landed, so an earlier accepted row is still the truth.
-- Deliberately NOT ccrs_filed_entities.last_payload: 0284 can set an entity
-- filed from a REFUSED Insert ("Duplicate External Identifier"), whose
-- payload CCRS never stored. Seed rows have no file row, so told = null and
-- the lot is sent once; after our first accepted Update it is compared.
--
-- in_flight: a row naming the id sits in an Inventory file of this env that
-- is emitted or uploaded (outcome not recorded). The caller always sends such
-- a lot: the newer file is uploaded after the older one (group pacing), so
-- skipping could leave the older value in CCRS.
--
-- Answer: { env, entries: [[id, state, told, in_flight], ...] }
--   id         one of p_ids that the ledger holds or that has a sent row
--   state      ccrs_filed_entities.state for (env, 'Inventory', id), or null
--   told       jsonb object column -> value (the CSV cells), or null
--   in_flight  boolean
-- Ids with no entity and no row are omitted (the caller treats absence as
-- "never told": send).
--
-- Grants: service role only, like every other ccrs_* function (0248 sec. 8).
-- Not security definer, search_path pinned, idempotent to re-create.
-- Rollback: supabase/rollbacks/0286_ccrs_inventory_last_told.rollback.sql

create or replace function public.ccrs_inventory_last_told(p_env text, p_ids text[])
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_entries jsonb;
begin
  if p_env is null or p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_INVENTORY_TOLD_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  with ids as (
    select distinct u.id from unnest(coalesce(p_ids, '{}')) as u(id) where coalesce(u.id, '') <> ''
  ), latest as (
    select distinct on (r.external_id)
           r.external_id, r.payload, r.state as row_state, f.state as file_state
      from public.ccrs_file_rows r
      join public.ccrs_files f on f.id = r.file_id
     where f.env = p_env and f.file_type = 'Inventory'
       and f.state in ('uploaded', 'succeeded', 'errored', 'reconciling', 'closed')
       and f.uploaded_at is not null
       and r.state not in ('rejected', 'withheld')
       and r.external_id in (select id from ids)
     order by r.external_id, f.uploaded_at desc, f.stamp_at desc, r.row_no desc
  ), x as (
    select i.id,
           e.state,
           case when l.row_state in ('submitted', 'confirmed')
                 and l.file_state in ('succeeded', 'errored', 'reconciling', 'closed')
                then l.payload end as told,
           exists (
             select 1 from public.ccrs_file_rows r2
               join public.ccrs_files f2 on f2.id = r2.file_id
              where f2.env = p_env and f2.file_type = 'Inventory' and f2.state in ('emitted', 'uploaded')
                and r2.external_id = i.id
           ) as in_flight,
           l.external_id is not null as has_row
      from ids i
      left join public.ccrs_filed_entities e
        on e.env = p_env and e.file_type = 'Inventory' and e.external_id = i.id
      left join latest l on l.external_id = i.id
  )
  select coalesce(jsonb_agg(jsonb_build_array(x.id, x.state, x.told, x.in_flight) order by x.id), '[]'::jsonb)
    into v_entries
    from x
   where x.state is not null or x.has_row or x.in_flight;
  return jsonb_build_object('env', p_env, 'entries', v_entries);
end $$;

comment on function public.ccrs_inventory_last_told(text, text[]) is
  'R6-3: per Inventory id, ledger state, the payload CCRS last ACCEPTED (null when unknown) and an in-flight flag, so unchanged lots are not re-sent ([G L0525-L0527]). Read-only.';

revoke all on function public.ccrs_inventory_last_told(text, text[]) from public, anon, authenticated;
grant execute on function public.ccrs_inventory_last_told(text, text[]) to service_role;
