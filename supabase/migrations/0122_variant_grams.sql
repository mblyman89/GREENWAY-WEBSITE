-- ---------------------------------------------------------------------------
-- Migration 0122 — POS Slice AN-1: per-variant grams for the limit engine
--
-- WHY: order_lines carried no weight snapshot, so the WAC 314-55-095
-- completion gate mapped every line to its CATEGORY-DEFAULT grams
-- (a 7 g flower jar counted as 3.5 g). AN-1 snapshots the true per-UNIT
-- grams at sale time — website placement and POS sync both write it, and
-- the completion gate prefers it over the category default.
--
-- Nullable + no backfill: legacy rows and unknown-weight products (mg-dosed
-- edibles, packs, "each" items) stay null and keep the conservative
-- category-default behavior. All writers degrade gracefully when this
-- column is absent (missing-column retry), so applying this migration is
-- safe at any time.
-- ---------------------------------------------------------------------------

alter table public.order_lines
  add column if not exists unit_grams numeric;

comment on column public.order_lines.unit_grams is
  'AN-1: grams ONE unit of the sold variant weighs (from the package-size parse, e.g. 3.5g jar = 3.5). Null = unknown → the WAC 314-55-095 limit gate falls back to the owner''s per-category default. Snapshot at sale time; never recomputed.';
