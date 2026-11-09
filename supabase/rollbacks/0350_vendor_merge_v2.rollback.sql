-- supabase/rollbacks/0350_vendor_merge_v2.rollback.sql  (D220)
--
-- Undo 0350_vendor_merge_v2.sql: removes the follow-the-merge triggers, the four functions and the
-- vendors.merged_into_id / merged_at columns. merge_vendors() (0104) is untouched and keeps working.
--
-- What it does NOT undo (on purpose, nothing is ever deleted by a merge): rows that 0350 moved from an
-- archived duplicate card to its surviving card stay on the survivor, and the cards 0350 merged stay
-- archived. Every merge is still written in the Internal notes of both cards (Merged into <name> (<uuid>)),
-- which is exactly what 0350 backfills merged_into_id from, so re-applying 0350 restores the columns.
-- Run the whole file as ONE transaction (the Supabase SQL editor does).

do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory_lots', 'inbound_manifests', 'catalog_product_drafts', 'kb_products', 'kb_brands',
    'brands', 'product_enrichments', 'purchase_orders', 'vendor_returns', 'trade_sample_events',
    'vendor_manifest_payments', 'noncannabis_invoices', 'vendor_platform_map',
    'leaflink_menu_snapshots', 'cultivera_menu_snapshots', 'growflow_menu_snapshots', 'emailed_menu_snapshots'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_vendor_follow_merge on public.%I', t);
    end if;
  end loop;
end
$$;

drop function if exists public.vendor_follow_merge();
drop function if exists public.sweep_merged_vendor_rows();
drop function if exists public.merge_vendors_v2(uuid, uuid[]);
drop function if exists public.vendor_repoint_references(uuid, uuid[]);
drop function if exists public.vendor_survivor_id(uuid);

drop index if exists public.idx_vendors_merged_into;
alter table public.vendors drop constraint if exists vendors_merged_into_not_self;
alter table public.vendors drop constraint if exists vendors_merged_into_fk;
alter table public.vendors drop column if exists merged_at;
alter table public.vendors drop column if exists merged_into_id;
