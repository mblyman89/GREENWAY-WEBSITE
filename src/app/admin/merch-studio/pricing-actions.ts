"use server";
/**
 * D232 M-8 - read-only Printful look-ups for the studio (no orders, no writes).
 *
 *   printfulShippingRateAction  (G-87) Printful's STANDARD rate to ship ONE of
 *                               this garment to Washington (the shop sells only
 *                               in WA: merch-site/lib/region-core.ts SELL_STATE)
 *                               via POST /shipping/rates, plus the shop's flat
 *                               first-item charge from the last Merch Health
 *                               run. Publish & Ads and Fulfillment & Pricing
 *                               put both into the margin.
 *   printfileSizesAction        (G-92) Printful's print-file sizes for a blank
 *                               (GET /mockup-generator/printfiles/{id}) next to
 *                               the studio's studio-default boxes.
 *
 * Permission content.edit (same as the studio). Nothing is saved; no audit row
 * (read-only, like the Proof tab's mockup poll).
 */
import { requirePermission } from "@/lib/auth/session";
import { printful, printfulConfigured } from "@/lib/merch-studio/printful-client";
import { getBlank } from "@/lib/merch-studio/garment-catalog-core";
import { PRINTFUL_VARIANTS } from "@/lib/merch-studio/garment-colors-data";
import { pickStandardRate, type ShippingRate } from "@/lib/merch-studio/fulfillment-core";
import { compareBlank, type PlacementCompare } from "@/lib/merch-studio/printfile-check-core";
import { flatShippingFromReport } from "@/lib/merch/merch-health-core";
import { latestMerchHealthReport } from "@/lib/merch/merch-health-server";

/** A Washington ZIP (Olympia) for the rate quote; the shop only sells in WA. */
const WA_QUOTE = { country_code: "US", state_code: "WA", city: "Olympia", zip: "98501" } as const;

export type ShippingQuoteResult =
  | { ok: true; costCents: number | null; rate: ShippingRate | null; flatCents: number | null; problem: string }
  | { ok: false; error: string };

export async function printfulShippingRateAction(input: { blankId: string; variantId?: number }): Promise<ShippingQuoteResult> {
  await requirePermission("content.edit");
  const b = getBlank(String(input?.blankId ?? ""));
  if (!b) return { ok: false, error: "Unknown garment." };
  const variants = PRINTFUL_VARIANTS[b.printfulId] ?? [];
  const want = Number(input?.variantId);
  const v = variants.find((x) => x[2] === want) ?? variants.find((x) => x[4]) ?? variants[0];
  const last = await latestMerchHealthReport().catch(() => ({ report: null, error: null }));
  const flatCents = flatShippingFromReport(last.report);
  if (!v) return { ok: true, costCents: null, rate: null, flatCents, problem: "No Printful variant for this garment in the catalog snapshot." };
  if (!printfulConfigured()) return { ok: true, costCents: null, rate: null, flatCents, problem: "Printful isn't connected (PRINTFUL_API_TOKEN), so its shipping rate can't be read." };
  const r = await printful<unknown>("POST", "/shipping/rates", { recipient: WA_QUOTE, items: [{ variant_id: v[2], quantity: 1 }], currency: "USD", locale: "en_US" });
  if (!r.ok) return { ok: true, costCents: null, rate: null, flatCents, problem: r.error };
  const rate = pickStandardRate(r.result);
  return { ok: true, costCents: rate?.cents ?? null, rate, flatCents, problem: rate ? "" : "Printful returned no USD rate for Washington." };
}

export type PrintfileSizesResult = { ok: true; rows: PlacementCompare[] } | { ok: false; error: string };

export async function printfileSizesAction(input: { blankId: string }): Promise<PrintfileSizesResult> {
  await requirePermission("content.edit");
  const b = getBlank(String(input?.blankId ?? ""));
  if (!b) return { ok: false, error: "Unknown garment." };
  if (!printfulConfigured()) return { ok: false, error: "Printful isn't connected yet (PRINTFUL_API_TOKEN). Open Printful's file template for this product instead." };
  const r = await printful<unknown>("GET", `/mockup-generator/printfiles/${b.printfulId}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, rows: compareBlank(b.id, r.result) };
}
