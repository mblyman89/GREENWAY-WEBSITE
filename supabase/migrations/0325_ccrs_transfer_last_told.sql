-- 0325_ccrs_transfer_last_told.sql  (CCRS pipeline slice C1, D-3)
--
-- ONE read-only function, no tables: for the InventoryTransfer ids CCRS
-- holds, what CCRS last ACCEPTED for each one, so a transfer whose facts
-- changed (received quantity, date, vendor id) can be CORRECTED with an
-- Update that keeps the same ExternalIdentifier, instead of never being
-- corrected (R6-2 sent Insert once, then nothing).
--
-- Why: the examiner (2026-10-29), asked "Correct a filed transfer by Update
-- with same ExternalIdentifier?": "Yes, the update path is the correct way
-- to make corrections." [EXAM2 L0058]. Update = "alter an existing record
-- indicated by external identifier" [G L0247].
--
-- Same rules as 0286 (ccrs_inventory_last_told), for file_type
-- 'InventoryTransfer':
--   * told = payload of the newest InventoryTransfer row for the id in a file
--     of this env that was UPLOADED and that CCRS did not reject, when that
--     row is ACCEPTED (submitted/confirmed in an answered file); otherwise
--     null (unknown -> the caller proposes no correction);
--   * a rejected / withheld row never counts; draft / emitted / abandoned
--     files never count;
--   * in_flight: an emitted / uploaded InventoryTransfer file of this env
--     names the id (the caller waits for its answer).
-- Deliberately NOT ccrs_filed_entities.last_payload (see 0286 header).
--
-- Answer: { env, entries: [[id, state, told, in_flight], ...] }; ids with no
-- entity, no sent row and nothing in flight are omitted.
--
-- Grants: service role only, like every other ccrs_* function (0248 sec. 8).
-- Not security definer, search_path pinned, idempotent to re-create.
-- Rollback: supabase/rollbacks/0325_ccrs_transfer_last_told.rollback.sql

create or replace function public.ccrs_transfer_last_told(p_env text, p_ids text[])
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_entries jsonb;
begin
  if p_env is null or p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_TRANSFER_TOLD_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  with ids as (
    select distinct u.id from unnest(coalesce(p_ids, '{}')) as u(id) where coalesce(u.id, '') <> ''
  ), latest as (
    select distinct on (r.external_id)
           r.external_id, r.payload, r.state as row_state, f.state as file_state
      from public.ccrs_file_rows r
      join public.ccrs_files f on f.id = r.file_id
     where f.env = p_env and f.file_type = 'InventoryTransfer'
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
              where f2.env = p_env and f2.file_type = 'InventoryTransfer' and f2.state in ('emitted', 'uploaded')
                and r2.external_id = i.id
           ) as in_flight,
           l.external_id is not null as has_row
      from ids i
      left join public.ccrs_filed_entities e
        on e.env = p_env and e.file_type = 'InventoryTransfer' and e.external_id = i.id
      left join latest l on l.external_id = i.id
  )
  select coalesce(jsonb_agg(jsonb_build_array(x.id, x.state, x.told, x.in_flight) order by x.id), '[]'::jsonb)
    into v_entries
    from x
   where x.state is not null or x.has_row or x.in_flight;
  return jsonb_build_object('env', p_env, 'entries', v_entries);
end $$;

comment on function public.ccrs_transfer_last_told(text, text[]) is
  'C1: per InventoryTransfer id, ledger state, the payload CCRS last ACCEPTED (null when unknown) and an in-flight flag, so a changed transfer is corrected by an Update with the same id ([EXAM2 L0058]). Read-only.';

revoke all on function public.ccrs_transfer_last_told(text, text[]) from public, anon, authenticated;
grant execute on function public.ccrs_transfer_last_told(text, text[]) to service_role;
