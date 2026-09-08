-- 0224_receiving_volume_gate.sql
--
-- SLICE L5 — THE RECEIVING VOLUME GATE.
--
-- WHY THIS COLUMN EXISTS
-- ----------------------
-- WAC 314-55-095(1)(d)(i)(E) caps a recreational liquid purchase at 72 FLUID
-- ounces = 2129.292 ml. The limit engine can only enforce that against a
-- MEASURED VOLUME. SLICE L3 derives one from the product name at receiving and
-- writes inventory_lots.net_volume_ml (column added in 0138), but when the name
-- states no size the derivation yields nothing.
--
-- Before this slice that produced a `net_volume_missing` diagnostic at severity
-- "warning" and NOTHING gated on it. The lot onboarded unmeasured, the engine
-- fell back to DEFAULT_UNIT_GRAMS['edible-liquid'] = 28 g, and exactly 72
-- packages of ANY size fit the cap — a 1.5 L bottle counted the same as a 30 ml
-- tincture. That is the defect the owner reported, arriving through the door
-- every product now uses after the Cultivera cutover.
--
-- So the receiver is now REQUIRED to measure a liquid the name did not
-- describe, and this column is where that human measurement lives until the
-- draft is injected into the menu (draft-injection-core.ts copies it to
-- inventory_lots.net_volume_ml / menu_items.net_volume_ml, both of which
-- already exist from 0138 — no new storage is needed downstream).
--
-- WHY NULLABLE, AND WHY NO BACKFILL
-- ---------------------------------
-- NULL means "no human measurement was needed or given", which is the honest
-- state for every non-liquid draft and for every liquid whose name already
-- stated its size. Inventing a number here would be exactly the failure the
-- gate exists to prevent: a value nobody measured that the register would then
-- enforce a legal limit against. Existing rows are therefore left alone.
--
-- Additive and idempotent: safe to run twice, and a database that has not run
-- it keeps working (the approval path only writes the column when a human
-- actually answered).

alter table public.catalog_product_drafts
  add column if not exists chosen_net_volume_ml numeric(12,3);

comment on column public.catalog_product_drafts.chosen_net_volume_ml is
  'SLICE L5 receiving volume gate. Millilitres in ONE package, as MEASURED BY A HUMAN at receiving when the product name stated no size and the shelf is metered by volume (edible-liquid, tincture, topical). This is what WAC 314-55-095(1)(d)(i)(E) 72 FLUID ounce = 2129.292 ml cap is enforced against. Stored in ml regardless of the unit entered: fl oz is converted with the statutory 29.5735 ml/fl oz, litres with 1000. A bare "oz" is REFUSED at entry, never converted, because it is a fluid ounce on a drink and a weight ounce on a salve. NULL = no human measurement was needed or given (non-liquid shelf, or the name already stated the size and SLICE L3 derived it) — never zero, which the engine would read as free of the limit.';
