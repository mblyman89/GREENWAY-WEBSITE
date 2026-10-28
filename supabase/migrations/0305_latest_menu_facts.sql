-- 0305_latest_menu_facts.sql  (PERF2 round 4: cockpit, reports, CCRS)
--
-- WHY. The sales, COGS, WA tax, CCRS Sale.csv, LIQ-1295 and Sage builders all
-- need "the newest category / type / vendor / brand for each product key".
-- Until now every one of them got it by downloading EVERY menu_items row ever
-- written (every snapshot of every product, newest first) 1,000 rows at a
-- time, one request after another, and keeping the first row per key in
-- JavaScript. The /admin cockpit did that THREE times per load (today,
-- yesterday and the comparison baseline), each report tab at least once.
-- With ~5,000 products and dozens of kept snapshots that is hundreds of
-- serial round trips to answer a question whose answer is ~5,000 rows.
--
-- WHAT THIS FILE DOES. It ONLY creates a read-only function. Postgres picks
-- the newest row per key itself (DISTINCT ON, served by the 0303 index
-- idx_menu_items_source_item_created) and returns one row per product key.
--
--   p_keys = null  -> every product key (one row each)
--   p_keys = array -> only those keys (one row each that exists)
--
-- "Newest" is EXACTLY the rule the app used: created_at descending, then id
-- ascending as the tie-break (the app ordered created_at desc, id asc and
-- kept the first row per key). Rows with a null/blank key are skipped, as
-- before.
--
-- SAFE / IDEMPOTENT: create or replace + revoke + grant. Nothing is written.
-- Re-running is a no-op. Service role only. Apply MANUALLY in the SQL editor.
-- The app falls back to the old (slow) read if this function is missing, so
-- deploying before running this file is harmless.

create or replace function public.latest_menu_facts(p_keys text[] default null)
returns table (
  source_item_id          text,
  category                text,
  pos_inventory_type      text,
  pos_inventory_category  text,
  vendor_name             text,
  brand_name              text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (mi.source_item_id)
         mi.source_item_id,
         mi.category,
         mi.pos_inventory_type,
         mi.pos_inventory_category,
         mi.vendor_name,
         mi.brand_name
    from public.menu_items mi
   where mi.source_item_id is not null
     and mi.source_item_id <> ''
     and (p_keys is null or mi.source_item_id = any (p_keys))
   order by mi.source_item_id, mi.created_at desc, mi.id asc
$$;

comment on function public.latest_menu_facts(text[]) is
  'PERF2 / 0305: newest category, POS type/category, vendor and brand per menu product key (created_at desc, id asc - the rule the reports always used). p_keys null = all keys. Read-only.';

revoke all on function public.latest_menu_facts(text[]) from public, anon, authenticated;
grant execute on function public.latest_menu_facts(text[]) to service_role;
