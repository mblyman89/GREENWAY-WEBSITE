import "server-only";

/**
 * src/lib/crypto/crypto-pricing-server.ts
 *
 * SERVER-ONLY orchestrator for R3 USD valuation. It ties the PURE pricing core
 * (crypto-pricing-core.ts), the GRACEFUL HTTP fetchers (crypto-price-fetch.ts),
 * and the store writers (crypto-store.ts) into ONE run:
 *
 *   1. List all assets + balances from the store (skip hidden assets).
 *   2. Plan the exact network calls needed (planPriceFetches) from the VERIFIED
 *      allow-list \u2014 never a guessed id/contract.
 *   3. Fetch USD prices (CoinGecko ids + GeckoTerminal Flare contracts). Both
 *      fetchers are graceful: a miss = that asset stays unpriced, not a crash.
 *   4. Assemble ResolvedPrice[] (USD -> integer scaled-cents via toScaledCents).
 *   5. Persist today's price snapshots (idempotent) and write usd_value_cents
 *      onto each balance (null = "no market price"). Never deletes anything.
 *
 * This runs at the END of a sync, once balances exist. It NEVER throws \u2014 a
 * pricing failure degrades the portfolio to unpriced rather than breaking the
 * sync or the page. All money math is float-free (BigInt scaled-cents).
 *
 * SECURITY: read-only public price feeds + public wallet balances. No keys.
 */

import {
  planPriceFetches,
  assembleResolvedPrices,
  buildPriceSnapshotRows,
  applyPricesToBalances,
  type FetchedPrices,
  type ResolvedPrice,
  type PriceableBalance,
  type PriceSnapshotUpsert,
} from "./crypto-pricing-core";
import { formatHeldAmount } from "./crypto-ui-core";
import {
  fetchCoinGeckoUsdPrices,
  fetchGeckoTerminalFlarePrices,
} from "./crypto-price-fetch";
import {
  listCryptoAssets,
  listCryptoBalances,
  upsertCryptoPriceSnapshots,
  updateBalanceUsdValues,
  type CryptoAssetRecord,
  type CryptoBalanceRecord,
  type PriceSnapshotUpsertRow,
} from "./crypto-store";

/** Plain-English outcome of a pricing run (surfaced in the sync summary). */
export type CryptoPricingResult = {
  ok: boolean;
  /** Number of assets that got a usable USD price this run. */
  pricedAssets: number;
  /** Number of assets we tried to price but had no honest source/price for. */
  unpricedAssets: number;
  /** Number of balances written with a usd_value_cents (may be null-valued). */
  balancesValued: number;
  message: string;
};

/** Today's date in UTC as YYYY-MM-DD (the snapshot key). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Run the full pricing pass. Safe to call every sync; snapshot upserts are
 * idempotent on (asset_id, price_date, source). Returns a friendly summary and
 * never throws.
 */
export async function runCryptoPricing(): Promise<CryptoPricingResult> {
  let assets: CryptoAssetRecord[];
  let balances: CryptoBalanceRecord[];
  try {
    [assets, balances] = await Promise.all([
      listCryptoAssets(),
      listCryptoBalances(),
    ]);
  } catch {
    return {
      ok: false,
      pricedAssets: 0,
      unpricedAssets: 0,
      balancesValued: 0,
      message: "Couldn't read holdings to price.",
    };
  }

  // Price only VISIBLE, ACTIVE assets. Hidden = owner marked scam/airdrop; it
  // stays in the DB but is excluded from the portfolio view (and pricing).
  const priceable = assets.filter((a) => a.active && a.hidden !== true);
  if (priceable.length === 0) {
    return {
      ok: true,
      pricedAssets: 0,
      unpricedAssets: 0,
      balancesValued: 0,
      message: "No holdings to price yet.",
    };
  }

  // 1) Plan the network calls from the verified allow-list.
  const plan = planPriceFetches(priceable);

  // 2) Fetch USD prices. Both fetchers are graceful (never throw).
  let coinGecko: Map<string, string>;
  let geckoTerminalFlare: Map<string, string>;
  try {
    [coinGecko, geckoTerminalFlare] = await Promise.all([
      fetchCoinGeckoUsdPrices(plan.coinGeckoIds),
      fetchGeckoTerminalFlarePrices(plan.geckoTerminalContracts),
    ]);
  } catch {
    coinGecko = new Map();
    geckoTerminalFlare = new Map();
  }
  const fetched: FetchedPrices = { coinGecko, geckoTerminalFlare };

  // 3) Assemble resolved prices (USD -> integer scaled-cents).
  const resolved: ResolvedPrice[] = assembleResolvedPrices(plan, fetched);
  const pricedAssetIds = new Set(resolved.map((r) => r.assetId));
  const unpricedAssets = priceable.length - pricedAssetIds.size;

  // 4) Persist today's price snapshots (idempotent).
  const snapshotRows: PriceSnapshotUpsert[] = buildPriceSnapshotRows(
    resolved,
    todayUtc(),
  );
  const storeRows: PriceSnapshotUpsertRow[] = snapshotRows.map((r) => ({
    asset_id: r.assetId,
    price_date: r.priceDate,
    price_scaled_cents: r.priceScaledCents,
    price_scale: r.priceScale,
    source: r.source,
  }));
  await upsertCryptoPriceSnapshots(storeRows);

  // 5) Value each balance and write usd_value_cents (null => no market price).
  //    amountText is derived from each asset's VERIFIED decimals via the same
  //    formatHeldAmount() the holdings table uses \u2014 never from a price API.
  const decimalsByAssetId = new Map<string, number | null>();
  for (const a of priceable) decimalsByAssetId.set(a.id, a.decimals);

  const priceById: Record<string, ResolvedPrice> = {};
  for (const r of resolved) priceById[r.assetId] = r;

  const priceableBalances: PriceableBalance[] = [];
  const priceAsof = new Date().toISOString();
  for (const b of balances) {
    // Skip balances whose asset isn't in the priceable set (hidden/inactive).
    if (!decimalsByAssetId.has(b.assetId)) continue;
    const amountText = formatHeldAmount({
      amountRaw: b.amountRaw,
      amountDecimal: b.amountDecimal,
      decimals: decimalsByAssetId.get(b.assetId) ?? null,
    });
    priceableBalances.push({
      balanceId: b.id,
      assetId: b.assetId,
      amountText,
    });
  }

  const valuations = applyPricesToBalances(priceableBalances, priceById);

  // Map balanceId -> walletId for the store update (keyed by wallet+asset).
  const walletByBalanceId = new Map<string, string>();
  for (const b of balances) walletByBalanceId.set(b.id, b.walletId);

  const updates = valuations
    .map((v) => {
      const walletId = walletByBalanceId.get(v.balanceId);
      if (!walletId) return null;
      return {
        walletId,
        assetId: v.assetId,
        usdValueCents: v.usdValueCents,
        priceAsof,
      };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null);

  const writeResult = await updateBalanceUsdValues(updates);
  const balancesValued = writeResult.ok ? writeResult.count : 0;

  const pricedAssets = pricedAssetIds.size;
  const message =
    pricedAssets > 0
      ? `Priced ${pricedAssets} of ${priceable.length} holdings.`
      : "No USD prices were available this run.";

  return {
    ok: true,
    pricedAssets,
    unpricedAssets,
    balancesValued,
    message,
  };
}
