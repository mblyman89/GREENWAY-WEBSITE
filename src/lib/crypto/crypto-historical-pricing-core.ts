/**
 * src/lib/crypto/crypto-historical-pricing-core.ts
 *
 * R1-G3 — Historical FMV-at-timestamp pricing bridge (PURE half).
 *
 * When Origin Trace (R1-G1/G2) reconstructs an acquisition — e.g. crypto that
 * arrived straight from a now-dead exchange with NO receipt — we must book its
 * cost basis at the fair market value (FMV) *as of the moment it was received*,
 * not today's price. Michael directed us to use historical prices wherever we
 * can find them and he'll fill in the gaps we can't.
 *
 * This file is the FLOAT-FREE, network-free core of that bridge. It:
 *
 *   1. Converts a receive timestamp (ms since epoch, UTC) into the exact date
 *      string CoinGecko's historical endpoint wants: DD-MM-YYYY.
 *      (GET /coins/{id}/history?date=DD-MM-YYYY returns that day's price.)
 *
 *   2. Converts the same instant into the store's ISO YYYY-MM-DD priceDate so a
 *      reconstructed price snapshot lands on the correct calendar day (UTC).
 *
 *   3. Builds a provenance `source` string that PERMANENTLY marks a price as a
 *      reconstructed FMV-at-date figure (not a live spot price), so the audit
 *      binder can always distinguish "reconstructed" basis from "live".
 *
 *   4. Plans the set of (coinId, date) history fetches needed for a batch of
 *      lineages that still need pricing — de-duplicated so we never hit the same
 *      coin/day twice.
 *
 *   5. Assembles fetched USD decimals into reconstructed-basis rows using the
 *      SAME toScaledCents() path R3 uses, so persistence + valuation stay on one
 *      float-free rail. Anything we could NOT price is SURFACED as unpriced —
 *      never silently booked at $0.
 *
 * The actual HTTP call lives in crypto-price-fetch.ts (server-only). This core
 * has no `server-only` import so it runs under the pure self-test harness.
 */

import { toScaledCents, PRICE_SCALE } from "./crypto-pricing-core";

// ---------------------------------------------------------------------------
// 1) Timestamp -> date strings (UTC), two flavours.
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * CoinGecko's /coins/{id}/history endpoint wants the date as DD-MM-YYYY (UTC).
 * Throws on a non-finite / non-integer millisecond value so a bad timestamp can
 * never become a silently-wrong price date.
 */
export function toCoinGeckoDate(receivedAtMs: number): string {
  if (!Number.isFinite(receivedAtMs) || !Number.isInteger(receivedAtMs)) {
    throw new Error(`toCoinGeckoDate: bad ms ${JSON.stringify(receivedAtMs)}`);
  }
  const d = new Date(receivedAtMs);
  const day = pad2(d.getUTCDate());
  const month = pad2(d.getUTCMonth() + 1);
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * The store keeps priceDate as ISO YYYY-MM-DD (UTC). Same instant, different
 * layout, so a reconstructed snapshot lands on the correct calendar day.
 */
export function toIsoPriceDate(receivedAtMs: number): string {
  if (!Number.isFinite(receivedAtMs) || !Number.isInteger(receivedAtMs)) {
    throw new Error(`toIsoPriceDate: bad ms ${JSON.stringify(receivedAtMs)}`);
  }
  const d = new Date(receivedAtMs);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// 2) Provenance source key — permanently tags a price as reconstructed FMV.
// ---------------------------------------------------------------------------

/**
 * Build the `source` string stored on a reconstructed price snapshot. The
 * "reconstructed" prefix is what lets the audit binder tell a back-traced
 * FMV-at-date figure apart from a normal live spot price.
 *
 *   historicalSourceKey("ripple", "15-06-2024")
 *     -> "reconstructed:coingecko:ripple:history:15-06-2024"
 */
export function historicalSourceKey(coinId: string, dateDDMMYYYY: string): string {
  const id = (coinId || "").trim();
  const date = (dateDDMMYYYY || "").trim();
  if (id === "") {
    throw new Error("historicalSourceKey: empty coinId");
  }
  if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) {
    throw new Error(`historicalSourceKey: bad date ${JSON.stringify(dateDDMMYYYY)}`);
  }
  return `reconstructed:coingecko:${id}:history:${date}`;
}

/** True when a snapshot's `source` marks it as a reconstructed FMV-at-date. */
export function isReconstructedSource(source: string): boolean {
  return typeof source === "string" && source.startsWith("reconstructed:");
}

// ---------------------------------------------------------------------------
// 3) Pricing plan — which (coinId, date) history calls do we need?
// ---------------------------------------------------------------------------

/** One receipt that needs a reconstructed FMV before it can book basis. */
export interface PricingNeed {
  /** Stable id of the receipt/lineage this need belongs to. */
  receiptId: string;
  /** Held asset this receipt is denominated in. */
  assetId: string;
  /** CoinGecko coin id resolved for the asset (via resolvePriceSource). */
  coinId: string;
  /** Instant the crypto was received (ms since epoch, UTC). */
  receivedAtMs: number;
}

/** A single de-duplicated historical price lookup to perform. */
export interface HistoricalFetchRequest {
  coinId: string;
  /** CoinGecko date form DD-MM-YYYY. */
  dateDDMMYYYY: string;
}

/**
 * Reduce a batch of per-receipt pricing needs to the UNIQUE set of history
 * lookups (one per coin per calendar day). Skips needs with a blank coin id or
 * a non-finite timestamp (those are surfaced as unpriced by assembleHistorical-
 * Basis, never guessed).
 */
export function planHistoricalFetches(needs: readonly PricingNeed[]): HistoricalFetchRequest[] {
  const seen = new Set<string>();
  const out: HistoricalFetchRequest[] = [];
  for (const n of needs) {
    const coinId = (n.coinId || "").trim();
    if (coinId === "") continue;
    if (!Number.isFinite(n.receivedAtMs) || !Number.isInteger(n.receivedAtMs)) continue;
    const dateDDMMYYYY = toCoinGeckoDate(n.receivedAtMs);
    const key = `${coinId}|${dateDDMMYYYY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ coinId, dateDDMMYYYY });
  }
  return out;
}

/** Map key for a fetched historical price: `${coinId}|${DD-MM-YYYY}`. */
export function fetchKey(coinId: string, dateDDMMYYYY: string): string {
  return `${(coinId || "").trim()}|${(dateDDMMYYYY || "").trim()}`;
}

// ---------------------------------------------------------------------------
// 4) Assemble fetched prices -> reconstructed-basis rows (+ unpriced list).
// ---------------------------------------------------------------------------

/** A reconstructed price snapshot ready to persist + a booked basis figure. */
export interface ReconstructedBasisRow {
  receiptId: string;
  assetId: string;
  coinId: string;
  /** ISO YYYY-MM-DD (UTC) for the price snapshot store. */
  priceDate: string;
  /** integer "cents * 10^PRICE_SCALE" as a decimal string. */
  priceScaledCents: string;
  /** Provenance tag; always starts "reconstructed:". */
  source: string;
  /** The USD decimal we priced at (echoed for the assumptions register). */
  usd: string;
}

/** A receipt we could NOT price — surfaced so Michael can fill it in. */
export interface UnpricedNeed {
  receiptId: string;
  assetId: string;
  coinId: string;
  /** DD-MM-YYYY we tried (or "" if the timestamp was unusable). */
  dateDDMMYYYY: string;
  /** Plain-English reason. Never a dollar figure. */
  reason: string;
}

export interface HistoricalBasisResult {
  priced: ReconstructedBasisRow[];
  unpriced: UnpricedNeed[];
  pricedCount: number;
  unpricedCount: number;
}

/**
 * Turn a batch of pricing needs + a map of fetched USD decimals into
 * reconstructed-basis rows. `prices` is keyed by fetchKey(coinId, DD-MM-YYYY).
 *
 * Guarantees:
 *   - Uses toScaledCents() — no floats — so basis math matches R3 exactly.
 *   - A need with a blank coin id, unusable timestamp, or missing/blank price is
 *     pushed to `unpriced` with a reason and NEVER booked at $0.
 */
export function assembleHistoricalBasis(
  needs: readonly PricingNeed[],
  prices: ReadonlyMap<string, string>,
  scale: number = PRICE_SCALE,
): HistoricalBasisResult {
  const priced: ReconstructedBasisRow[] = [];
  const unpriced: UnpricedNeed[] = [];

  for (const n of needs) {
    const coinId = (n.coinId || "").trim();
    if (coinId === "") {
      unpriced.push({
        receiptId: n.receiptId,
        assetId: n.assetId,
        coinId: "",
        dateDDMMYYYY: "",
        reason: "no known price source for this asset",
      });
      continue;
    }
    if (!Number.isFinite(n.receivedAtMs) || !Number.isInteger(n.receivedAtMs)) {
      unpriced.push({
        receiptId: n.receiptId,
        assetId: n.assetId,
        coinId,
        dateDDMMYYYY: "",
        reason: "no usable receive timestamp to look up a historical price",
      });
      continue;
    }

    const dateDDMMYYYY = toCoinGeckoDate(n.receivedAtMs);
    const usd = prices.get(fetchKey(coinId, dateDDMMYYYY));
    if (typeof usd !== "string" || usd.trim() === "") {
      unpriced.push({
        receiptId: n.receiptId,
        assetId: n.assetId,
        coinId,
        dateDDMMYYYY,
        reason: "no historical price found for this coin on this date",
      });
      continue;
    }

    // toScaledCents rejects anything that isn't a plain non-negative decimal, so
    // a malformed fetched value throws here rather than booking a wrong basis.
    let priceScaledCents: string;
    try {
      priceScaledCents = toScaledCents(usd.trim(), scale);
    } catch {
      unpriced.push({
        receiptId: n.receiptId,
        assetId: n.assetId,
        coinId,
        dateDDMMYYYY,
        reason: "historical price value was not a valid USD amount",
      });
      continue;
    }
    if (priceScaledCents === "0") {
      // A zero price is not a real basis — surface it, don't book $0.
      unpriced.push({
        receiptId: n.receiptId,
        assetId: n.assetId,
        coinId,
        dateDDMMYYYY,
        reason: "historical price resolved to zero",
      });
      continue;
    }

    priced.push({
      receiptId: n.receiptId,
      assetId: n.assetId,
      coinId,
      priceDate: toIsoPriceDate(n.receivedAtMs),
      priceScaledCents,
      source: historicalSourceKey(coinId, dateDDMMYYYY),
      usd: usd.trim(),
    });
  }

  return {
    priced,
    unpriced,
    pricedCount: priced.length,
    unpricedCount: unpriced.length,
  };
}

// ---------------------------------------------------------------------------
// Pure self-tests (bare-call; thrown on first failure).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-historical-pricing-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function truthy(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`crypto-historical-pricing-core: ${msg} — expected truthy`);
  }
}

export function __runCryptoHistoricalPricingCoreTests(): void {
  // --- date conversions (UTC) ---
  // 2024-06-15T12:34:56Z
  const ms = Date.UTC(2024, 5, 15, 12, 34, 56);
  eq(toCoinGeckoDate(ms), "15-06-2024", "CoinGecko date DD-MM-YYYY");
  eq(toIsoPriceDate(ms), "2024-06-15", "ISO priceDate YYYY-MM-DD");
  // single-digit day/month get zero-padded
  const ms2 = Date.UTC(2023, 0, 5, 0, 0, 0); // 2023-01-05
  eq(toCoinGeckoDate(ms2), "05-01-2023", "zero-padded CoinGecko date");
  eq(toIsoPriceDate(ms2), "2023-01-05", "zero-padded ISO date");
  // just-before-midnight stays on the same UTC day
  const ms3 = Date.UTC(2024, 11, 31, 23, 59, 59);
  eq(toCoinGeckoDate(ms3), "31-12-2024", "late-night stays same UTC day (CG)");
  eq(toIsoPriceDate(ms3), "2024-12-31", "late-night stays same UTC day (ISO)");

  let threw = false;
  try { toCoinGeckoDate(Number.NaN); } catch { threw = true; }
  eq(threw, true, "NaN ms rejected (CG)");
  threw = false;
  try { toIsoPriceDate(1.5); } catch { threw = true; }
  eq(threw, true, "non-integer ms rejected (ISO)");

  // --- provenance source key ---
  eq(
    historicalSourceKey("ripple", "15-06-2024"),
    "reconstructed:coingecko:ripple:history:15-06-2024",
    "source key format",
  );
  truthy(isReconstructedSource("reconstructed:coingecko:ripple:history:15-06-2024"), "reconstructed tag detected");
  eq(isReconstructedSource("coingecko:ripple"), false, "live source not flagged reconstructed");
  threw = false;
  try { historicalSourceKey("", "15-06-2024"); } catch { threw = true; }
  eq(threw, true, "empty coinId rejected");
  threw = false;
  try { historicalSourceKey("ripple", "2024-06-15"); } catch { threw = true; }
  eq(threw, true, "wrong date layout rejected");

  // --- plan de-duplication ---
  const needs: PricingNeed[] = [
    { receiptId: "r1", assetId: "aXRP", coinId: "ripple", receivedAtMs: ms },
    // same coin, same day -> collapses
    { receiptId: "r2", assetId: "aXRP", coinId: "ripple", receivedAtMs: ms + 1000 },
    // same coin, different day -> separate
    { receiptId: "r3", assetId: "aXRP", coinId: "ripple", receivedAtMs: ms2 },
    // different coin, same day as r1 -> separate
    { receiptId: "r4", assetId: "aFLR", coinId: "flare-networks", receivedAtMs: ms },
    // no coin id -> skipped from the plan
    { receiptId: "r5", assetId: "aX", coinId: "", receivedAtMs: ms },
  ];
  const plan = planHistoricalFetches(needs);
  eq(plan.length, 3, "plan de-duplicates coin/day and drops blank coin");
  truthy(
    plan.some((p) => p.coinId === "ripple" && p.dateDDMMYYYY === "15-06-2024"),
    "plan includes ripple 15-06-2024",
  );
  truthy(
    plan.some((p) => p.coinId === "ripple" && p.dateDDMMYYYY === "05-01-2023"),
    "plan includes ripple 05-01-2023",
  );
  truthy(
    plan.some((p) => p.coinId === "flare-networks" && p.dateDDMMYYYY === "15-06-2024"),
    "plan includes flare 15-06-2024",
  );

  // --- assemble: priced + unpriced ---
  const prices = new Map<string, string>();
  prices.set(fetchKey("ripple", "15-06-2024"), "0.50"); // $0.50
  prices.set(fetchKey("ripple", "05-01-2023"), "0"); // zero -> unpriced
  // flare-networks 15-06-2024 intentionally MISSING -> unpriced
  const res = assembleHistoricalBasis(needs, prices);

  // r1 & r2 both price at the ripple 15-06-2024 figure.
  const r1 = res.priced.find((p) => p.receiptId === "r1");
  truthy(!!r1, "r1 priced");
  eq(r1?.priceScaledCents, "50000000", "r1 $0.50 -> scaled cents");
  eq(r1?.priceDate, "2024-06-15", "r1 priceDate ISO");
  eq(r1?.source, "reconstructed:coingecko:ripple:history:15-06-2024", "r1 provenance");
  eq(r1?.usd, "0.50", "r1 echoes usd");
  const r2 = res.priced.find((p) => p.receiptId === "r2");
  eq(r2?.priceScaledCents, "50000000", "r2 shares the same-day price");

  // r3 -> zero price -> unpriced (never $0 basis).
  truthy(res.unpriced.some((u) => u.receiptId === "r3" && u.reason.includes("zero")), "r3 zero surfaced");
  // r4 -> missing price -> unpriced.
  truthy(
    res.unpriced.some((u) => u.receiptId === "r4" && u.reason.includes("no historical price")),
    "r4 missing surfaced",
  );
  // r5 -> no coin id -> unpriced.
  truthy(
    res.unpriced.some((u) => u.receiptId === "r5" && u.reason.includes("no known price source")),
    "r5 no-source surfaced",
  );

  eq(res.pricedCount, 2, "two receipts priced");
  eq(res.unpricedCount, 3, "three receipts unpriced");

  // Never assigns a $0 basis: every priced row is a positive scaled-cents string.
  for (const p of res.priced) {
    truthy(/^[1-9]\d*$/.test(p.priceScaledCents), "priced row has positive basis, never 0");
  }

  // Bad-timestamp need -> surfaced, not thrown at the batch level.
  const bad = assembleHistoricalBasis(
    [{ receiptId: "b1", assetId: "aX", coinId: "ripple", receivedAtMs: Number.NaN }],
    new Map<string, string>(),
  );
  eq(bad.unpricedCount, 1, "bad timestamp surfaced");
  truthy(bad.unpriced[0].reason.includes("no usable receive timestamp"), "bad ts reason");

  console.log("crypto-historical-pricing-core self-tests: all passed");
}
