-- supabase/rollbacks/0344_menu_copy_retention.rollback.sql  (PERF round P1/P2)
--
-- Undo 0344_menu_copy_retention.sql: latest_menu_facts goes back to the 0305 body (reads every
-- menu_items row), the four triggers and their functions, prune_menu_version_items and the
-- product_latest_facts table are dropped.
--
-- WHAT A ROLLBACK CANNOT UNDO: menu copies already pruned are gone (their version rows and
-- summary_json stay). The only thing they held that anything reads is the newest facts per
-- product key, and a key whose ONLY rows were pruned would then fall out of the 0305 answer.
-- So this rollback REFUSES while such a key exists, unless you set greenway.allow_rollback_0344
-- to 'yes' first (then those past sales show "category unknown" in the reports, as before 0305
-- had any row for them). Safe to re-run.

do $$
declare
  v_orphans bigint := 0;
begin
  if to_regclass('public.product_latest_facts') is not null then
    select count(*) into v_orphans
      from public.product_latest_facts f
     where not exists (select 1 from public.menu_items mi where mi.source_item_id = f.source_item_id);
    if v_orphans > 0 and coalesce(current_setting('greenway.allow_rollback_0344', true), '') <> 'yes' then
      raise exception 'ROLLBACK_0344_REFUSED: % product keys now live only in product_latest_facts (their menu copies were pruned). Run "set greenway.allow_rollback_0344 = ''yes'';" in the same session first if you accept losing their category in the reports.', v_orphans;
    end if;
  end if;
end
$$;

drop trigger if exists menu_items_latest_facts_ins on public.menu_items;
drop trigger if exists menu_items_latest_facts_upd on public.menu_items;
drop trigger if exists menu_items_latest_facts_del on public.menu_items;
drop trigger if exists menu_items_latest_facts_trunc on public.menu_items;
drop function if exists public.product_latest_facts_sync();
drop function if exists public.product_latest_facts_on_delete();
drop function if exists public.product_latest_facts_on_truncate();
drop function if exists public.prune_menu_version_items(integer, integer);

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

drop table if exists public.product_latest_facts;
