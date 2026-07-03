-- =============================================================================
-- 0072_fold_brand_facts_into_brands.sql   (Slice 7 / brand unification)
--
-- MDM golden-record principle (Profisee): ONE authoritative record per entity.
-- We had two brand tables: operational `brands` (0003, vendor-linked master data)
-- and `kb_brands` (0019, brand *facts* / voice). The KB hub counted kb_brands and
-- showed 0 while real brands live in `brands`. Owner decision: FOLD the brand
-- FACTS into the operational `brands` table so a brand is a single golden record.
--
-- This migration ADDS the brand-facts columns to `brands` (idempotent), then
-- BACKFILLS them from any existing kb_brands rows matched by slug (or by the
-- kb_brands.brand_id FK). kb_brands is LEFT IN PLACE (not dropped) so nothing
-- breaks mid-transition; retrieval + editor move to `brands` in code. A later
-- migration can retire kb_brands once verified.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- Money stays in minor units elsewhere; no money here.
-- =============================================================================

-- 1) Add brand-facts columns to the operational brands table (if not present).
alter table public.brands
  add column if not exists known_for       text,
  add column if not exists house_style     text,
  add column if not exists signature_lines text[] not null default '{}',
  add column if not exists sensory_notes   text[] not null default '{}';

-- 2) Backfill facts from kb_brands into brands.
--    Prefer the explicit kb_brands.brand_id link; fall back to slug match.
--    Only fills columns that are currently NULL/empty on brands (non-destructive).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'kb_brands'
  ) then
    -- Match by explicit FK first.
    update public.brands b
       set known_for       = coalesce(b.known_for, k.known_for),
           house_style     = coalesce(b.house_style, k.house_style),
           signature_lines = case when array_length(b.signature_lines, 1) is null
                                  then k.signature_lines else b.signature_lines end,
           sensory_notes   = case when array_length(b.sensory_notes, 1) is null
                                  then k.sensory_notes else b.sensory_notes end
      from public.kb_brands k
     where k.brand_id = b.id;

    -- Then match remaining by slug (where not already linked).
    update public.brands b
       set known_for       = coalesce(b.known_for, k.known_for),
           house_style     = coalesce(b.house_style, k.house_style),
           signature_lines = case when array_length(b.signature_lines, 1) is null
                                  then k.signature_lines else b.signature_lines end,
           sensory_notes   = case when array_length(b.sensory_notes, 1) is null
                                  then k.sensory_notes else b.sensory_notes end
      from public.kb_brands k
     where lower(k.slug) = lower(b.slug)
       and k.brand_id is null;
  end if;
end $$;

-- 3) Keep kb_products.kb_brand_id meaningful during transition: nothing to do
--    here (the code will populate kb_products.brand_id → brands directly).

-- Note: kb_brands is intentionally retained for now. Once the app reads/writes
-- brand facts on `brands` and this is verified in production, a follow-up
-- migration can drop kb_brands.
