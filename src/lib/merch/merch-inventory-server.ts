/**
 * R73 S7 - live Printful stock for the merch inventory page (server only).
 * D285: reads Printful API v2 availability per garment, filtered to the
 * north_america selling region and the techniques we print with
 * (GET /v2/catalog-products/{id}/availability?techniques=..&selling_region_name=north_america,
 * paged 100 at a time). A garment v2 can't answer falls back to v1
 * GET /products/{id} (US availability_status). One call chain per distinct
 * garment, in parallel, never throws.
 */
import "server-only";
import { printful, printfulConfigured, printfulV2 } from "@/lib/merch-studio/printful-client";
import { stockFromPrintful, stockFromV2, type StockMap } from "./merch-inventory-core";

const V2_ALL = ["dtg", "embroidery", "dtfilm"];

async function v2Availability(id: number, techniques: readonly string[]): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> {
  const rows: unknown[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await printfulV2<unknown[]>("GET", `/v2/catalog-products/${id}/availability?techniques=${techniques.join(",")}&selling_region_name=north_america&limit=100&offset=${offset}`);
    if (!r.ok) return { ok: false, error: r.error };
    const page = Array.isArray(r.data) ? r.data : [];
    rows.push(...page);
    if (page.length < 100 || (r.paging?.total ?? 0) <= offset + 100) break;
  }
  return { ok: true, rows };
}

export async function loadPrintfulStock(productIds: readonly number[], techniques: readonly string[] = V2_ALL): Promise<{ map: StockMap; problem: string }> {
  const map: StockMap = new Map();
  if (!productIds.length) return { map, problem: "" };
  if (!printfulConfigured()) return { map, problem: "Printful isn't connected (PRINTFUL_API_TOKEN), so live stock can't be checked." };
  const ids = [...new Set(productIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 40);
  const failed: string[] = [];
  await Promise.all(ids.map(async (id) => {
    const v2 = await v2Availability(id, techniques);
    if (v2.ok && v2.rows.length) { for (const [k, v] of stockFromV2(v2.rows)) map.set(k, v); return; }
    const r = await printful<unknown>("GET", `/products/${id}`);
    if (!r.ok) { failed.push(`#${id}: ${v2.ok ? r.error : v2.error}`); return; }
    for (const [k, v] of stockFromPrintful(r.result)) map.set(k, v);
  }));
  return { map, problem: failed.length ? `Printful didn't answer for ${failed.length} garment${failed.length === 1 ? "" : "s"} (${failed.slice(0, 2).join("; ")}).` : "" };
}
