-- 0283_ccrs_sale_slice.sql  (Round 5 / Slice R5-1)
--
-- ONE read-only function, no tables: what the CCRS ledger holds for the sale
-- lines a batch wants to CORRECT (customer returns -> Sale.csv Update/Delete).
--
-- Why: Update "alter an existing record indicated by external identifier",
-- Delete "delete a record indicated by external identifier" [G L0247-L0248];
-- "What happens if an Update operation is performed prior to an Insert
-- operation? The record doesn't exist, so an error message would be received."
-- [FAQ L0052-L0053]; "SaleDetailExternalIdentifier not found" [G L1414]. So a
-- correction may only go out for a sale line this env's ledger holds, and
-- never while another file naming that line is unanswered.
--
-- Answer: { env, entries: [[detail_id, state, quantity, in_flight], ...] }
--   detail_id  one of p_detail_ids that is held OR named by an unanswered file
--   state      ccrs_filed_entities.state for (env, 'Sale', detail_id), or null
--   quantity   last_payload->>'Quantity' (what CCRS was last told), or null
--   in_flight  a row naming the line sits in a Sale file of this env that is
--              emitted or uploaded (sent / to be sent, outcome not recorded)
-- Ids neither held nor in flight are omitted (the caller treats absence as
-- "not held"). Sale entities are keyed by SaleDetailExternalIdentifier
-- (0248 ccrs_emit_files v_idcol).
--
-- Grants: service role only, like every other ccrs_* function (0248 sec. 8).
create or replace function public.ccrs_sale_slice(p_env text, p_detail_ids text[])
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_entries jsonb;
begin
  if p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_SALE_SLICE_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  with ids as (
    select distinct u.id from unnest(coalesce(p_detail_ids, '{}')) as u(id) where coalesce(u.id, '') <> ''
  ), x as (
    select i.id,
           e.state,
           e.last_payload->>'Quantity' as quantity,
           exists (
             select 1 from public.ccrs_file_rows r
               join public.ccrs_files f on f.id = r.file_id
              where f.env = p_env and f.file_type = 'Sale' and f.state in ('emitted', 'uploaded')
                and r.external_id = i.id
           ) as in_flight
      from ids i
      left join public.ccrs_filed_entities e
        on e.env = p_env and e.file_type = 'Sale' and e.external_id = i.id
  )
  select coalesce(jsonb_agg(jsonb_build_array(x.id, x.state, x.quantity, x.in_flight) order by x.id), '[]'::jsonb)
    into v_entries
    from x
   where x.state is not null or x.in_flight;
  return jsonb_build_object('env', p_env, 'entries', v_entries);
end $$;

comment on function public.ccrs_sale_slice(text, text[]) is
  'R5-1: ledger state, last-told quantity and in-flight flag of the sale lines a batch would correct (customer returns). Read-only.';

revoke all on function public.ccrs_sale_slice(text, text[]) from public, anon, authenticated;
grant execute on function public.ccrs_sale_slice(text, text[]) to service_role;
