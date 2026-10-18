/**
 * R73 S7 - live Printful stock for the merch inventory page (server only).
 * GET /products/{id} (Printful catalog, verified in the v1 OpenAPI): each
 * variant has in_stock + availability_status [{region, status}]. One call per
 * distinct garment, in parallel, never throws.
 */
import "server-only";
import { printful, printfulConfigured } from "@/lib/merch-studio/printful-client";
import { stockFromPrintful, type StockStatus } from "./merch-inventory-core";

export async function loadPrintfulStock(productIds: readonly number[]): Promise<{ map: Map<number, StockStatus>; problem: string }> {
  const map = new Map<number, StockStatus>();
  if (!productIds.length) return { map, problem: "" };
  if (!printfulConfigured()) return { map, problem: "Printful isn't connected (PRINTFUL_API_TOKEN), so live stock can't be checked." };
  const ids = [...new Set(productIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 40);
  const results = await Promise.all(ids.map((id) => printful<unknown>("GET", `/products/${id}`)));
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (!r.ok) { failed.push(`#${ids[i]}: ${r.error}`); return; }
    for (const [k, v] of stockFromPrintful(r.result)) map.set(k, v);
  });
  return { map, problem: failed.length ? `Printful didn't answer for ${failed.length} garment${failed.length === 1 ? "" : "s"} (${failed.slice(0, 2).join("; ")}).` : "" };
}
