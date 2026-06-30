-- 0034_ccrs_lot_external_id.sql  (Run 5 / Slice 22)
--
-- CCRS InventoryExternalIdentifier hardening.
--
-- The CCRS Upload Guide requires that an item's Inventory.ExternalIdentifier is
-- the SAME identifier reused on LabTest.csv, Sale.csv, Transfer.csv, and
-- InventoryAdjustment.csv, and is assigned by the licensee. To keep this stable
-- forever we persist ONE canonical external id per inventory lot and reuse it
-- everywhere. (order_lines already has an optional per-sale override from 0031.)
--
-- Idempotent: safe to run multiple times.

ALTER TABLE public.inventory_lots
  ADD COLUMN IF NOT EXISTS ccrs_inventory_external_id text;

-- Helpful for resolving a sold line -> its lot's canonical id at export time.
CREATE INDEX IF NOT EXISTS inventory_lots_pos_product_key_idx
  ON public.inventory_lots (pos_product_key);

CREATE INDEX IF NOT EXISTS inventory_lots_ccrs_ext_id_idx
  ON public.inventory_lots (ccrs_inventory_external_id);

-- Backfill a canonical id for existing lots that don't have one yet, derived
-- deterministically: prefer lot_code, then pos_product_key, then a LOT-<id>
-- fallback. Sanitized to alphanumerics + single hyphens, clamped to 100 chars.
-- This mirrors deriveInventoryExternalId() in the app layer.
UPDATE public.inventory_lots
SET ccrs_inventory_external_id = LEFT(
  TRIM(BOTH '-' FROM regexp_replace(
    COALESCE(
      NULLIF(TRIM(lot_code), ''),
      NULLIF(TRIM(pos_product_key), ''),
      'LOT-' || id::text
    ),
    '[^A-Za-z0-9]+', '-', 'g'
  )),
  100
)
WHERE ccrs_inventory_external_id IS NULL;
