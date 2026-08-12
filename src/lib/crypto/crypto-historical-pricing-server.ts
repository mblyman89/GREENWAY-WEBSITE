import "server-only";

/**
 * src/lib/crypto/crypto-historical-pricing-server.ts
 *
 * R1-G3 — Historical FMV-at-timestamp pricing bridge (SERVER half).
 *
 * Ties the pure back-trace pricing core to the real world:
 *
 *   trace lineages that need pricing
 *     -> resolve each asset's CoinGecko coin id  (crypto-pricing-core)
 *     -> plan the unique (coinId, date) history lookups  (pure core)
 *     -> fetch each day's FMV from CoinGecko  (crypto-price-fetch, throttled)
 *     -> assemble reconstructed-basis rows, float-free  (pure core)
 *     -> persist them as RECONSTRUCTED price snapshots    (crypto-store)
 *
 * Everything numeric/date-shaped lives in the PURE core so it is self-tested and
 * float-free. This file only does IO: resolving assets, calling the feed, and
 * writing snapshots. It is GRACEFUL — no DB / no network simply yields "nothing
 * priced" with the unpriced needs surfaced, never a guessed or $0 basis.
 */

import { listCryptoAssets, upsertCryptoPriceSnapshots } from "./crypto-store";
import type { CryptoAssetRecord } from "./crypto-store-core";
import { resolvePriceSource, PRICE_SCALE } from "./crypto-pricing-core";
import { fetchCoinGeckoHistoricalUsdPrices } from "./crypto-price-fetch";
import {
  planHistoricalFetches,
  assembleHistoricalBasis,
  type PricingNeed,
  type ReconstructedBasisRow,
  type UnpricedNeed,
} from "./crypto-historical-pricing-core";
import type { ReceiptLineage } from "./crypto-origin-trace-core";

/** What the bridge did on one run. */
export interface HistoricalPricingRunResult {
  /** Reconstructed-basis rows we successfully priced + persisted. */
  priced: ReconstructedBasisRow[];
  /** Receipts we could not price — surfaced for Michael to fill in. */
  unpriced: UnpricedNeed[];
  pricedCount: number;
  unpricedCount: number;
  /** True once the snapshots were written (or gracefully no-op'd). */
  persisted: boolean;
  /** Non-fatal note when persistence was skipped/failed (never throws). */
  persistNote: string | null;
}

/**
 * Build the per-receipt pricing needs from trace lineages. Only lineages that
 * the trace flagged `needsPricing` (i.e. exchange_origin reconstructions) are
 * considered. Each needs the held asset it's denominated in so we can resolve a
 * coin id; the caller supplies `assetByReceiptId` because a receipt's asset is
 * known upstream (from the transaction record), not on the lineage itself.
 *
 * A lineage with no resolvable coin id or no timestamp is STILL included (with a
 * blank coinId / its raw ms) so assembleHistoricalBasis surfaces it as unpriced
 * rather than dropping it silently.
 */
export function buildPricingNeeds(
  lineages: readonly ReceiptLineage[],
  assetByReceiptId: ReadonlyMap<string, CryptoAssetRecord>,
): PricingNeed[] {
  const needs: PricingNeed[] = [];
  for (const lin of lineages) {
    if (!lin.needsPricing) continue;
    const asset = assetByReceiptId.get(lin.receiptId);
    let coinId = "";
    if (asset) {
      const plan = resolvePriceSource(asset);
      if (plan.kind === "coingecko-id") coinId = plan.coinId;
    }
    needs.push({
      receiptId: lin.receiptId,
      assetId: asset ? asset.id : "",
      coinId,
      // receivedAtMs may be null -> use NaN so the pure core surfaces it.
      receivedAtMs: typeof lin.receivedAtMs === "number" ? lin.receivedAtMs : Number.NaN,
    });
  }
  return needs;
}

/**
 * Run the historical pricing bridge for a set of trace lineages.
 *
 * @param lineages          the trace output (only `needsPricing` ones are used).
 * @param assetByReceiptId  receiptId -> held asset (for coin-id resolution).
 * @param persist           write reconstructed snapshots (default true).
 */
export async function runHistoricalPricing(
  lineages: readonly ReceiptLineage[],
  assetByReceiptId: ReadonlyMap<string, CryptoAssetRecord>,
  persist: boolean = true,
): Promise<HistoricalPricingRunResult> {
  const needs = buildPricingNeeds(lineages, assetByReceiptId);

  if (needs.length === 0) {
    return {
      priced: [],
      unpriced: [],
      pricedCount: 0,
      unpricedCount: 0,
      persisted: true,
      persistNote: null,
    };
  }

  // 1) Plan the unique (coin, day) lookups and fetch them (throttled).
  const plan = planHistoricalFetches(needs);
  const prices = await fetchCoinGeckoHistoricalUsdPrices(plan);

  // 2) Assemble float-free reconstructed basis + surface the rest.
  const result = assembleHistoricalBasis(needs, prices, PRICE_SCALE);

  // 3) Persist the priced rows as RECONSTRUCTED snapshots (idempotent).
  let persisted = false;
  let persistNote: string | null = null;
  if (!persist) {
    persistNote = "persistence skipped by caller";
  } else if (result.priced.length === 0) {
    persisted = true; // nothing to write is a clean success
  } else {
    const rows = result.priced
      .filter((r) => r.assetId !== "")
      .map((r) => ({
        asset_id: r.assetId,
        price_date: r.priceDate,
        price_scaled_cents: r.priceScaledCents,
        price_scale: PRICE_SCALE,
        source: r.source,
      }));
    const write = await upsertCryptoPriceSnapshots(rows);
    persisted = write.ok;
    if (!write.ok) persistNote = write.error ?? "snapshot write failed";
  }

  return {
    priced: result.priced,
    unpriced: result.unpriced,
    pricedCount: result.pricedCount,
    unpricedCount: result.unpricedCount,
    persisted,
    persistNote,
  };
}

/**
 * Convenience: resolve the caller's assets from the store and price a set of
 * lineages by matching each receipt to its asset via a receiptId->assetId map.
 * Used by callers that only have ids (not full asset records) to hand in.
 */
export async function runHistoricalPricingByAssetId(
  lineages: readonly ReceiptLineage[],
  assetIdByReceiptId: ReadonlyMap<string, string>,
  persist: boolean = true,
): Promise<HistoricalPricingRunResult> {
  const assets = await listCryptoAssets();
  const byId = new Map<string, CryptoAssetRecord>();
  for (const a of assets) byId.set(a.id, a);

  const assetByReceiptId = new Map<string, CryptoAssetRecord>();
  for (const [receiptId, assetId] of assetIdByReceiptId) {
    const asset = byId.get(assetId);
    if (asset) assetByReceiptId.set(receiptId, asset);
  }
  return runHistoricalPricing(lineages, assetByReceiptId, persist);
}
