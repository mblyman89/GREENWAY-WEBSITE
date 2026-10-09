-- ===========================================================================
-- 0254_menu_item_effects_aroma.sql
--
-- R35 #6 (owner-requested). EFFECTS AND AROMA LIVE ON THE MENU ROW.
--
-- Owner request (verbatim, abridged): "I only want to build #4 and #6" -
-- #6 being the open R19 "Next fixes" line "Effects and aroma columns on the
-- menu row" (bible 19.18; S12.2 / S12.3 named exactly these columns).
--
-- WHY. Since S12 the approved product's attached description and strain
-- type travel onto menu_items (the golden record). Its attached EFFECTS and
-- AROMA did not: menu_items had no home for them (bible F-046), so the
-- product page could only show them through the render-time knowledge-base
-- ladder, whose key often misses (F-065) and whose best rung is frequently
-- the STRAIN, not this product. A product approved with its own counted
-- effects/aroma therefore showed none, or another product's.
--
-- WHAT THIS ADDS (menu_items only)
--   effects      text[]  experiential descriptors ("relaxed", "uplifted"),
--                        already cleared by the app through checkEffects()
--                        (the experiential allow-list + medical-claim filter
--                        + the owner's kb_banned_phrases) before any write
--   aroma_notes  text[]  sensory descriptors ("citrus", "pine"), cleared by
--                        lintTerms() + kb_banned_phrases before any write
--   Names match kb_products / kb_strains (effects, aroma_notes) on purpose.
--
-- THE TWO CHECKS (one per column, same rule)
--   NULL means "nothing counted for this product" (the page then falls back
--   to the knowledge base, exactly as before). A stored list is never empty
--   (the app writes NULL instead), never holds a NULL element, and holds at
--   most 8 entries (MENU_SENSORY_MAX in src/lib/pos/menu-sensory-core.ts;
--   tests/compliance/r35-menu-effects-aroma.test.ts pins the two together).
--
-- WHAT IT NEVER DOES
--   * No backfill in SQL: the values must pass the app's compliance gate,
--     which SQL cannot run. Live cards are filled by the owner-pressed,
--     fill-only "Fill effects and aroma on live cards" button (Products).
--   * No change to any other column, table, policy or trigger.
--
-- IDEMPOTENT (standing rule 6): add-column-if-not-exists, constraints dropped
-- and re-added. Before it is applied the app reads and writes menu_items
-- exactly as before (narrow 42703 / PGRST204 fallback, menu-sensory-core).
-- APPLY MANUALLY in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0254_menu_item_effects_aroma.rollback.sql
-- FACTORY RESET: no new table (menu_items is already WIPE).
-- ===========================================================================

alter table public.menu_items
  add column if not exists effects text[],
  add column if not exists aroma_notes text[];

alter table public.menu_items drop constraint if exists menu_items_effects_shape_chk;
alter table public.menu_items
  add constraint menu_items_effects_shape_chk
  check (effects is null or (cardinality(effects) between 1 and 8 and array_position(effects, null) is null));

alter table public.menu_items drop constraint if exists menu_items_aroma_notes_shape_chk;
alter table public.menu_items
  add constraint menu_items_aroma_notes_shape_chk
  check (aroma_notes is null or (cardinality(aroma_notes) between 1 and 8 and array_position(aroma_notes, null) is null));

comment on column public.menu_items.effects is
  '0254 / R35: this product''s counted experiential effects (golden record: a person, the lab, the manifest, the published KB, or an AI / KB-draft / Cultivera value at >= 90%), cleared by checkEffects + kb_banned_phrases before the write. NULL = nothing counted; the product page then uses the knowledge base. Never a medical claim.';
comment on column public.menu_items.aroma_notes is
  '0254 / R35: this product''s counted aroma descriptors (same survivorship as effects), cleared by lintTerms + kb_banned_phrases before the write. NULL = nothing counted; the product page then uses the knowledge base.';

notify pgrst, 'reload schema';
