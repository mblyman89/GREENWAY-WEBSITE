-- cogs_cost_linkage.sql
--
-- Run this in the Supabase SQL editor to understand WHY a sold item shows $0
-- COGS on the Inventory & COGS report. It checks the full cost chain:
--
--   inventory_lots.pos_product_key  ==  menu_items.source_item_id
--                                   ==  order_lines.product_id
--   AND inventory_lots.unit_cost_minor_units IS NOT NULL
--
-- Read-only. Safe to run anytime.

-- 1) Sold lines and whether a matching lot + cost exists.
SELECT
  ol.product_id,
  ol.product_name,
  SUM(ol.quantity)                                   AS units_sold,
  SUM(ol.price_minor_units * ol.quantity)            AS revenue_cents,
  COUNT(DISTINCT il.id)                              AS matching_lots,
  COUNT(DISTINCT il.id) FILTER (WHERE il.unit_cost_minor_units IS NOT NULL)
                                                     AS lots_with_cost,
  MAX(il.unit_cost_minor_units)                      AS sample_unit_cost_cents,
  CASE
    WHEN COUNT(il.id) = 0 THEN 'NO LOT matches product_id'
    WHEN COUNT(il.id) FILTER (WHERE il.unit_cost_minor_units IS NOT NULL) = 0
      THEN 'LOT exists but unit_cost_minor_units is NULL'
    ELSE 'OK - cost available'
  END AS diagnosis
FROM order_lines ol
LEFT JOIN inventory_lots il
  ON il.pos_product_key = ol.product_id
JOIN orders o ON o.id = ol.order_id
WHERE o.status <> 'cancelled'
GROUP BY ol.product_id, ol.product_name
ORDER BY revenue_cents DESC;

-- 2) Lots that have NO unit cost at all (fix these at intake).
SELECT id, lot_code, product_name, pos_product_key, received_qty, on_hand_qty, status
FROM inventory_lots
WHERE unit_cost_minor_units IS NULL
ORDER BY created_at DESC
LIMIT 100;

-- 3) Menu items whose source_item_id has no inventory lot (key mismatch source).
SELECT mi.source_item_id, mi.name, mi.category
FROM menu_items mi
LEFT JOIN inventory_lots il ON il.pos_product_key = mi.source_item_id
WHERE il.id IS NULL
ORDER BY mi.name
LIMIT 100;
