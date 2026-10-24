-- =============================================================================
-- Migration 0294 - R74 S30: each Cultivera lot remembers WHICH SIZE it sells as
-- =============================================================================
-- Why (owner, R74 round 13): "build the enhancement ... matching the size to
-- the price ... I need full control of Cultivera's products while I am
-- onboarding them."
--
--   A Cultivera menu card can carry several sizes (1g, 3.5g, 7g ...). Each
--   size is one menu_variants row, source_variant_id = "<card key>-<hash>".
--   The import knew which size every inventory row belonged to, but it only
--   stored the CARD key on the lot (inventory_lots.pos_product_key). So on a
--   card with more than one size the lot page could not tell which price was
--   this lot's, showed "No published price yet", and refused price edits.
--   298 live cards are like that (758 lots).
--
-- What: two nullable text columns and one index. No row is changed here.
--   menu_source_variant_id      the menu_variants.source_variant_id of the
--                               lot's size. Null = not linked; the app then
--                               behaves exactly as before 0294.
--   menu_source_variant_source  who set it: 'pos_import' (machine-read from
--                               the stored Cultivera workbooks) or 'owner'
--                               (picked by hand on the lot page). A later
--                               import may refresh a 'pos_import' link (the
--                               size id contains Cultivera's price) but never
--                               an 'owner' one.
-- New imports write both; the "Link lots to their menu sizes" button on the
-- published import fills existing lots from the stored workbooks.
--
-- Not a CCRS field and not a cost: nothing filed with the state reads it.
--
-- APPLIED BY HAND (AGENTS rule 6). Safe to re-run (if not exists).
-- Rollback: supabase/rollbacks/0294_inventory_lot_menu_variant.rollback.sql
-- =============================================================================

do $precheck$
begin
  if to_regclass('public.inventory_lots') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0294 adds a column to public.inventory_lots, created by 0023_pos_inventory_lots.sql. Run the earlier migrations first.';
  end if;
end
$precheck$;

alter table public.inventory_lots
  add column if not exists menu_source_variant_id text;
alter table public.inventory_lots
  add column if not exists menu_source_variant_source text;

-- The pair rule. "source is not null" is spelled out: `null in (...)` is
-- NULL, and a CHECK that evaluates to NULL passes, so without it an id with no
-- source would slip through (caught by the 0294 pg-check).
do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_lots_menu_source_variant_source_check'
      and conrelid = 'public.inventory_lots'::regclass
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_menu_source_variant_source_check
      check (
        (menu_source_variant_id is null and menu_source_variant_source is null)
        or (menu_source_variant_id is not null and menu_source_variant_source is not null
            and menu_source_variant_source in ('pos_import', 'owner'))
      );
  end if;
end
$constraint$;

comment on column public.inventory_lots.menu_source_variant_id is
  'R74 S30: menu_variants.source_variant_id of the size this lot sells as. Null = not linked.';
comment on column public.inventory_lots.menu_source_variant_source is
  'R74 S30: who set menu_source_variant_id: pos_import (stored Cultivera workbooks) or owner (lot page). Imports never overwrite owner.';

create index if not exists inventory_lots_menu_source_variant_id_idx
  on public.inventory_lots (menu_source_variant_id)
  where menu_source_variant_id is not null;

notify pgrst, 'reload schema';
