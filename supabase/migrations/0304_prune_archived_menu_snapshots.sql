-- 0304_prune_archived_menu_snapshots.sql  (PERF2 round)
--
-- WHY. Every menu change (each intake approval, fact fix, merge answer, COA
-- re-read, publish) writes a complete copy of the catalog: one menu_items row
-- per product and one menu_variants row per size, under a new menu_versions
-- row. The previous copy is archived and kept forever. At ~5,000 products,
-- 200 menu changes = ~1,000,000 item rows and more variant rows - almost all
-- of them dead history that every unscoped read, every sequential scan,
-- autovacuum and the buffer cache still have to wade through.
--
-- WHAT THIS FILE DOES. It ONLY creates a function. Nothing is deleted when
-- this file runs. The owner decides when to call it:
--
--     select * from public.prune_archived_menu_snapshots(14, 25);
--
-- (keep 14 days of archived history; at most 25 archived versions per call -
-- call again until versions_pruned = 0). Each call is one short transaction.
-- versions_pruned counts only versions that actually had rows removed, and a
-- version is only picked while it still has something removable, so the
-- repeat-until-0 loop always ends.
--
-- WHAT IT REMOVES. menu_items rows (and, by the existing ON DELETE CASCADE,
-- their menu_variants) that belong to an ARCHIVED, non-test version created
-- more than p_keep_days ago, and ONLY when a NEWER menu_items row exists for
-- the same source_item_id. The newest row ever written for every product key
-- is therefore always kept - the reports (sales, COGS, WA tax, CCRS, Sage)
-- look up a sold product's category by key across all versions, and a
-- product that has since left the menu still resolves exactly as before.
--
-- NEVER TOUCHED: the published version, any staged version, test versions,
-- anything newer than p_keep_days, and the menu_versions rows themselves
-- (the Publish history list keeps every entry and its recorded counts).
--
-- SAFE / IDEMPOTENT: create or replace + revoke + grant. Re-running this
-- file is a no-op. Service role only. Apply MANUALLY in the SQL editor.
-- Needs 0303 first (idx_menu_items_source_item_created makes the "newer row
-- exists" test an index probe).

create or replace function public.prune_archived_menu_snapshots(
  p_keep_days    integer default 14,
  p_max_versions integer default 25
)
returns table (versions_pruned integer, item_rows_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep  integer := greatest(coalesce(p_keep_days, 14), 1);
  v_max   integer := least(greatest(coalesce(p_max_versions, 25), 1), 200);
  v_ids   uuid[];
  v_rows  bigint := 0;
  v_done  integer := 0;
begin
  select coalesce(array_agg(id), '{}')
    into v_ids
    from (
      select mv.id
        from public.menu_versions mv
       where mv.status = 'archived'
         and coalesce(mv.is_test, false) = false
         and mv.created_at < now() - make_interval(days => v_keep)
         -- Only versions that still hold at least one prunable row (an item
         -- with a newer copy of the same product key). A version whose
         -- remaining rows are each the newest copy of their key is finished
         -- and is never picked again, so repeated calls reach 0.
         and exists (
           select 1
             from public.menu_items mi
            where mi.menu_version_id = mv.id
              and exists (
                select 1
                  from public.menu_items n
                 where n.source_item_id = mi.source_item_id
                   and n.created_at > mi.created_at
              )
         )
       order by mv.created_at asc
       limit v_max
    ) oldest;

  if array_length(v_ids, 1) is null then
    versions_pruned := 0;
    item_rows_deleted := 0;
    return next;
    return;
  end if;

  with gone as (
    delete from public.menu_items mi
     where mi.menu_version_id = any (v_ids)
       and exists (
         select 1
           from public.menu_items newer
          where newer.source_item_id = mi.source_item_id
            and newer.created_at > mi.created_at
       )
    returning mi.menu_version_id
  )
  select count(distinct g.menu_version_id)::integer, count(*)::bigint
    into v_done, v_rows
    from gone g;

  versions_pruned := v_done;
  item_rows_deleted := v_rows;
  return next;
end;
$$;

comment on function public.prune_archived_menu_snapshots(integer, integer) is
  'PERF2 / 0304: owner-run cleanup of dead menu snapshot rows. Deletes menu_items (+ cascaded menu_variants) of archived non-test versions older than p_keep_days, only where a newer row exists for the same source_item_id (the newest row per product key is always kept for the reports). Never touches published/staged/test versions or menu_versions rows. Batch with p_max_versions; call until versions_pruned = 0.';

revoke all on function public.prune_archived_menu_snapshots(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_archived_menu_snapshots(integer, integer) to service_role;
