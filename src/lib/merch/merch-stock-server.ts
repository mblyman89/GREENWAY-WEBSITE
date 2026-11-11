/**
 * src/lib/merch/merch-stock-server.ts  (D232 slice M-6, SOP-11 G-83)
 *
 * One stock copy (Printful US stock -> each variant's inStock on
 * greenwaymerch.com), shared by:
 *   - /api/cron/merch-stock      every 6 hours (system actor "cron:merch-stock")
 *   - /api/merch-stock           the shop relays Printful's stock_updated event
 *                                (system actor "printful:stock_updated"); the
 *                                event only says WHICH garment changed, we
 *                                still re-read that garment from Printful
 *                                rather than trust the body.
 * Uses the same pieces as the Merch Inventory button (syncMerchStockAction):
 * loadPrintfulStock + applyStock + the compare-and-set catalog write (M-5).
 * A lost compare-and-set is retried once with a fresh read. Audited as
 * merch.stock_synced with the actor and how many variants changed. Only
 * writes when something changed or stockSyncedAt needs moving forward.
 * Never throws.
 */
import "server-only";
import { recordAudit } from "@/lib/auth/audit";
import { applyStock, MERCH_CATALOG_CONFLICT } from "./merch-inventory-core";
import { readMerchCatalog, updateMerchCatalog } from "./merch-inventory-store";
import { loadPrintfulStock } from "./merch-inventory-server";

export type StockCopySource = "cron:merch-stock" | "printful:stock_updated";
export interface StockCopyResult { ok: boolean; checked: number; changed: number; products: number; problem: string }

export async function runMerchStockCopy(opts: { source: StockCopySource; onlyProductIds?: readonly number[] }): Promise<StockCopyResult> {
  const cur = await readMerchCatalog();
  if (cur.readError) return { ok: false, checked: 0, changed: 0, products: 0, problem: `Couldn't read the merch catalog: ${cur.readError}` };
  const all = [...new Set(cur.catalog.items.map((i) => i.pkg.product.blank.printfulProductId))];
  const ids = opts.onlyProductIds ? all.filter((n) => opts.onlyProductIds!.includes(n)) : all;
  if (!ids.length) return { ok: true, checked: 0, changed: 0, products: 0, problem: opts.onlyProductIds ? "That garment is not in the catalog." : "" };
  const stock = await loadPrintfulStock(ids);
  if (stock.map.size === 0) return { ok: false, checked: 0, changed: 0, products: ids.length, problem: stock.problem || "Printful returned no stock." };
  let changed = 0; let checked = 0;
  let res: Awaited<ReturnType<typeof updateMerchCatalog>> = { ok: false, error: "" };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    res = await updateMerchCatalog((c) => { const r = applyStock(c, stock.map, new Date().toISOString()); changed = r.changed; checked = r.checked; return r.catalog; });
    if (res.ok || res.error !== MERCH_CATALOG_CONFLICT) break;
  }
  if (!res.ok) return { ok: false, checked, changed: 0, products: ids.length, problem: res.error };
  await recordAudit({ actorId: null, actorEmail: opts.source, action: "merch.stock_synced", entityType: "merch_catalog", entityId: "merch_catalog", after: { checked, changed, products: ids.length, source: opts.source, ...(stock.problem ? { problem: stock.problem } : {}) } });
  return { ok: true, checked, changed, products: ids.length, problem: stock.problem };
}
