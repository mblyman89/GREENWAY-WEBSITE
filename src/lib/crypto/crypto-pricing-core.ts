/**
 * src/lib/crypto/crypto-pricing-core.ts
 *
 * PURE pricing core for the Crypto Portfolio USD valuation (R3). NO I/O, no
 * server-only imports — safe under tsx and vitest. All money math is float-free
 * BigInt on integer scaled-cents, consistent with crypto-core.ts.
 *
 * Responsibilities (pure):
 *   1. toScaledCents(usdString, scale)  — turn a USD price string ("73.08") into
 *      an integer "cents * 10^scale" string (the shape crypto_price_snapshots
 *      stores and usdValueCents() consumes). Round HALF-UP, reject bad input.
 *   2. resolvePriceSource(asset)        — map a held asset to its VERIFIED price
 *      source using an EXPLICIT allow-list (never a guessed id/contract). An
 *      asset not in the allow-list resolves to { kind: "none" } => unpriced.
 *   3. buildPriceSnapshotRows / applyPricesToBalances — pure typed builders that
 *      turn resolved USD prices into snapshot upsert rows and per-balance
 *      usd_value_cents, using each balance's own VERIFIED decimals.
 *
 * Every CoinGecko id and Flare contract encoded below was LIVE-verified on
 * 2026-08-12 against the free CoinGecko + GeckoTerminal APIs and the Songbird
 * RPC (see research/r3-usd-valuation-recon.md §6). Michael's decisions:
 *   - rFLR priced from WFLR at documented 1:1 (source "derived:wflr-1to1").
 *   - SFIN via CoinGecko id "songbird-finance".
 *   - exUSDT valued 1:1 to real USDT (CoinGecko "tether"), source
 *     "assumed:usdt-1to1" — Michael has direct confirmation Enosys honors the
 *     bridge; a directed, transparently-recorded assumption, not a guess.
 */

import type { Chain } from "./crypto-core";
import { usdValueCents } from "./crypto-core";
import type { CryptoAssetRecord } from "./crypto-store-core";

// ---------------------------------------------------------------------------
// ES2017-safe BigInt constants (no 0n literals, no numeric separators).
// ---------------------------------------------------------------------------
const BI_ONE = BigInt(1);
const BI_TWO = BigInt(2);
const BI_TEN = BigInt(10);

/** The scale used for every snapshot: cents * 10^6 gives sub-cent precision. */
export const PRICE_SCALE = 6;

// ---------------------------------------------------------------------------
// 1) toScaledCents — USD decimal string -> integer "cents * 10^scale" string.
// ---------------------------------------------------------------------------

/**
 * Convert a USD price string (of ONE whole token) to an integer
 * "cents * 10^scale" decimal string, rounded HALF-UP. Float-free.
 *
 *   toScaledCents("73.08", 6)      -> "7308000000"   ($73.08)
 *   toScaledCents("0.00100616", 6) -> "100616"       ($0.00100616 = 0.100616 cents)
 *   toScaledCents("1", 6)          -> "100000000"    ($1.00)
 *
 * Rejects non-numeric, negative, empty, or scientific-notation input (callers
 * must pass a plain decimal string). Rounding to the scale is half-up.
 */
export function toScaledCents(usd: string, scale: number = PRICE_SCALE): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error(`toScaledCents: bad scale ${scale}`);
  }
  const s = (usd ?? "").trim();
  // Plain non-negative decimal only. No leading "+", no exponent, no spaces.
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`toScaledCents: bad usd ${JSON.stringify(usd)}`);
  }
  const [ip, fp = ""] = s.split(".");
  // price in "cents * 10^scale" = dollars * 100 * 10^scale = dollars * 10^(scale+2).
  // Build the scaled integer from the digit string, rounding half-up at the cut.
  const targetFracLen = scale + 2; // extra decimals beyond whole dollars
  const digits = ip + fp; // all significant digits, decimal point removed
  const fracLen = fp.length;

  // We want value = digits * 10^(targetFracLen - fracLen), but if fracLen exceeds
  // targetFracLen we must round the extra low digits half-up.
  if (fracLen <= targetFracLen) {
    const padZeros = targetFracLen - fracLen;
    const scaled = BigInt(digits || "0") * pow10(padZeros);
    return stripLeadingZeros(scaled.toString());
  }
  // fracLen > targetFracLen: cut (fracLen - targetFracLen) low digits, round half-up.
  const excess = fracLen - targetFracLen;
  const full = BigInt(digits || "0");
  const divisor = pow10(excess);
  const twice = full * BI_TWO;
  const denomTwice = divisor * BI_TWO;
  let scaled = twice / denomTwice;
  const remainder = twice % denomTwice;
  if (remainder >= divisor) scaled += BI_ONE;
  return stripLeadingZeros(scaled.toString());
}

function pow10(n: number): bigint {
  let r = BI_ONE;
  for (let i = 0; i < n; i += 1) r *= BI_TEN;
  return r;
}

function stripLeadingZeros(s: string): string {
  const t = s.replace(/^0+/, "");
  return t === "" ? "0" : t;
}

// ---------------------------------------------------------------------------
// 2) resolvePriceSource — explicit VERIFIED allow-list; unknown => none.
// ---------------------------------------------------------------------------

export type PriceSourcePlan =
  | { kind: "coingecko-id"; coinId: string; sourceKey: string }
  | { kind: "geckoterminal-flare"; contract: string; sourceKey: string }
  | { kind: "derived-wflr"; sourceKey: string } // rFLR = WFLR price, 1:1
  | { kind: "assumed-usdt"; sourceKey: string } // exUSDT = tether price, 1:1
  | { kind: "none" };

/** CoinGecko coin-id sources (LIVE-verified ids). Keyed by UPPER-case symbol. */
const COINGECKO_BY_SYMBOL: Record<string, string> = {
  FLR: "flare-networks",
  WFLR: "wrapped-flare",
  SGB: "songbird",
  WSGB: "songbird", // wrapped SGB, 1:1
  XRP: "ripple",
  COREUM: "coreum",
  SFIN: "songbird-finance",
};

/**
 * Flare ERC-20 contracts priceable via GeckoTerminal (network "flare"),
 * LIVE-verified to have a DEX pool. Keyed by LOWER-case contract address.
 * Symbols (for reference): sFLR, HLN, WFLR, USDX, stXRP, eQNT, BUGO, CDP,
 * DYNMX, eUSDT, eETH, FXRP, USD₮0, USDC.e, BNZ, APS.
 */
const GECKOTERMINAL_FLARE_CONTRACTS: Set<string> = new Set([
  "0x12e605bc104e93b45e1ad99f9e555f659051c2bb", // sFLR
  "0x140d8d3649ec605cf69018c627fb44ccc76ec89f", // HLN
  "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d", // WFLR
  "0x4a771cc1a39fdd8aa08b8ea51f7fd412e73b3d2b", // USDX
  "0x4c18ff3c89632c3dd62e796c0afa5c07c4c1b2b3", // stXRP
  "0x60fdc7b744e886e96aa0def5f69ee440db9d8c77", // eQNT
  "0x6cd3a5ba46fa254d4d2e3c2b37350ae337e94a0f", // CDP
  "0x96b41289d90444b8add57e6f265db5ae8651df29", // eUSDT (Flare)
  "0xa76dcddce60a442d69bac7158f3660f50921b122", // eETH
  "0xad552a648c74d49e10027ab8a618a3ad4901c5be", // FXRP
  "0xfbda5f676cb37624f28265a144a48b0d6e87d3b6", // USDC.e
  "0xff56eb5b1a7faa972291117e5e9565da29bc808d", // APS
  "0x6c1490729ce19e809cf9f7e3e223c0490833de02", // BUGO ($0.00007456)
  "0x79bc03d5cfa057fa805f3eed30b8b3b2ae8a3f81", // DYNMX ($0.005030)
  "0xfd3449e8ee31117a848d41ee20f497a9bcb53164", // BNZ ($0.001080)
]);

/** rFLR contract on Flare (reward FLR; documented 1:1 claim on WFLR). */
const RFLR_CONTRACT = "0x26d460c3cf931fb2014fa436a49e3af08619810e";

/** exUSDT ("Experimental USDT") contract on Songbird (Michael's holding). */
const EXUSDT_SONGBIRD_CONTRACT = "0x1a7b46656b2b8b29b1694229e122d066020503d0";

/**
 * Resolve a held asset to its price source. Order of precedence:
 *   1. Native / wrapped / listed symbols -> CoinGecko coin id.
 *   2. rFLR (by contract) -> derived from WFLR at 1:1.
 *   3. exUSDT (by contract) -> assumed 1:1 real USDT (Michael-directed).
 *   4. Flare ERC-20 in the verified GeckoTerminal set -> geckoterminal-flare.
 *   5. Anything else -> none (unpriced; shown honestly as "no market price").
 */
export function resolvePriceSource(asset: CryptoAssetRecord): PriceSourcePlan {
  const symbol = (asset.symbol || "").toUpperCase();
  const contract = (asset.contract || "").toLowerCase();

  // 1. CoinGecko-listed symbols (natives, wrapped, SFIN).
  const coinId = COINGECKO_BY_SYMBOL[symbol];
  if (coinId) {
    return { kind: "coingecko-id", coinId, sourceKey: `coingecko:${coinId}` };
  }

  // 2. rFLR -> derived from WFLR (documented 1:1).
  if (contract === RFLR_CONTRACT) {
    return { kind: "derived-wflr", sourceKey: "derived:wflr-1to1" };
  }

  // 3. exUSDT on Songbird -> assumed 1:1 real USDT (Michael-directed).
  if (contract === EXUSDT_SONGBIRD_CONTRACT) {
    return { kind: "assumed-usdt", sourceKey: "assumed:usdt-1to1" };
  }

  // 4. Flare ERC-20 with a verified GeckoTerminal pool.
  if (asset.chain === "flare" && contract && GECKOTERMINAL_FLARE_CONTRACTS.has(contract)) {
    return {
      kind: "geckoterminal-flare",
      contract,
      sourceKey: `geckoterminal:flare:${contract}`,
    };
  }

  // 5. No honest source.
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// 3) Pure builders: resolved USD prices -> snapshot rows + balance valuations.
// ---------------------------------------------------------------------------

/** A resolved USD price for one asset, ready to persist + value against. */
export type ResolvedPrice = {
  assetId: string;
  /** integer "cents * 10^PRICE_SCALE" as a decimal string. */
  priceScaledCents: string;
  priceScale: number;
  /** provenance recorded in crypto_price_snapshots.source. */
  source: string;
};

/** Upsert row for crypto_price_snapshots (one per asset per day per source). */
export type PriceSnapshotUpsert = {
  assetId: string;
  priceDate: string; // YYYY-MM-DD (UTC)
  priceScaledCents: string;
  priceScale: number;
  source: string;
};

/**
 * Build snapshot upsert rows from resolved prices for a given UTC date.
 * priceDate must be an ISO YYYY-MM-DD string (caller supplies "today" in UTC).
 */
export function buildPriceSnapshotRows(
  resolved: ResolvedPrice[],
  priceDate: string,
): PriceSnapshotUpsert[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)) {
    throw new Error(`buildPriceSnapshotRows: bad priceDate ${JSON.stringify(priceDate)}`);
  }
  return resolved.map((r) => ({
    assetId: r.assetId,
    priceDate,
    priceScaledCents: r.priceScaledCents,
    priceScale: r.priceScale,
    source: r.source,
  }));
}

/** A held balance we intend to value (subset of CryptoBalanceRecord fields). */
export type PriceableBalance = {
  balanceId: string;
  assetId: string;
  /** human decimal amount string (e.g. "3.086739302164081614"). */
  amountText: string;
};

/** Result of valuing one balance. usdValueCents null => no price for its asset. */
export type BalanceValuation = {
  balanceId: string;
  assetId: string;
  usdValueCents: number | null;
};

/**
 * Value each balance using its asset's resolved price (integer cents, half-up).
 * Balances whose asset has no resolved price get usdValueCents = null (honest
 * "no market price"). Uses the shared usdValueCents() so all money math is the
 * same float-free BigInt path. Decimals come from the balance's amountText,
 * which is derived upstream from the asset's VERIFIED decimals — never from a
 * price API.
 */
export function applyPricesToBalances(
  balances: PriceableBalance[],
  pricesByAssetId: Record<string, ResolvedPrice>,
): BalanceValuation[] {
  return balances.map((b) => {
    const price = pricesByAssetId[b.assetId];
    if (!price) {
      return { balanceId: b.balanceId, assetId: b.assetId, usdValueCents: null };
    }
    const cents = usdValueCents(b.amountText, price.priceScaledCents, price.priceScale);
    return { balanceId: b.balanceId, assetId: b.assetId, usdValueCents: cents };
  });
}

// ---------------------------------------------------------------------------
// 4) Pure fetch-planning + assembly (bridges resolvePriceSource -> the two HTTP
//    fetchers -> ResolvedPrice[]). Kept PURE so the R3-B runtime mapping (which
//    ids/contracts to fetch, and how to turn fetched USD back into scaled cents
//    per asset) is fully unit-tested and never guesses.
// ---------------------------------------------------------------------------

/** The distinct network calls a set of assets needs, plus each asset's plan. */
export type PriceFetchPlan = {
  /** CoinGecko coin ids to request (deduped, lower-case). */
  coinGeckoIds: string[];
  /** GeckoTerminal Flare contracts to request (deduped, lower-case). */
  geckoTerminalContracts: string[];
  /** True if any asset needs the WFLR price (for rFLR derived-1:1). */
  needsWflr: boolean;
  /** True if any asset needs the tether price (for exUSDT assumed-1:1). */
  needsTether: boolean;
  /** Per-asset resolved plan, so assembly can map fetched prices back. */
  perAsset: Array<{ assetId: string; plan: PriceSourcePlan }>;
};

/** CoinGecko coin id used to price rFLR (via WFLR) at the documented 1:1. */
export const WFLR_COINGECKO_ID = "wrapped-flare";
/** CoinGecko coin id used to price exUSDT (assumed 1:1 real USDT). */
export const TETHER_COINGECKO_ID = "tether";

/**
 * Resolve every asset and collect the exact set of network calls needed. Hidden
 * or inactive assets are skipped by the caller BEFORE this (we plan only what we
 * were given). Pure + deterministic; deduping keeps fetch payloads minimal.
 */
export function planPriceFetches(assets: CryptoAssetRecord[]): PriceFetchPlan {
  const coinGeckoIds = new Set<string>();
  const geckoTerminalContracts = new Set<string>();
  let needsWflr = false;
  let needsTether = false;
  const perAsset: Array<{ assetId: string; plan: PriceSourcePlan }> = [];

  for (const asset of assets) {
    const plan = resolvePriceSource(asset);
    perAsset.push({ assetId: asset.id, plan });
    if (plan.kind === "coingecko-id") {
      coinGeckoIds.add(plan.coinId.toLowerCase());
    } else if (plan.kind === "geckoterminal-flare") {
      geckoTerminalContracts.add(plan.contract.toLowerCase());
    } else if (plan.kind === "derived-wflr") {
      needsWflr = true;
      coinGeckoIds.add(WFLR_COINGECKO_ID);
    } else if (plan.kind === "assumed-usdt") {
      needsTether = true;
      coinGeckoIds.add(TETHER_COINGECKO_ID);
    }
  }

  return {
    coinGeckoIds: Array.from(coinGeckoIds),
    geckoTerminalContracts: Array.from(geckoTerminalContracts),
    needsWflr,
    needsTether,
    perAsset,
  };
}

/** The two fetched USD price maps (lower-cased keys) fed into assembly. */
export type FetchedPrices = {
  /** CoinGecko coin id (lower-case) => USD decimal string. */
  coinGecko: Map<string, string>;
  /** Flare contract (lower-case) => USD decimal string. */
  geckoTerminalFlare: Map<string, string>;
};

/**
 * Turn a fetch plan + the fetched USD maps into ResolvedPrice[] (one per asset
 * that got a usable price). An asset whose source produced no USD (missing id,
 * empty pool, rate-limited) is simply omitted => it stays unpriced ("no market
 * price"). Every USD string is converted to integer scaled-cents via the shared
 * toScaledCents(), so persistence + valuation use the identical float-free path.
 *
 *   - coingecko-id       -> coinGecko.get(coinId)
 *   - geckoterminal-flare-> geckoTerminalFlare.get(contract)
 *   - derived-wflr       -> coinGecko.get("wrapped-flare")  (rFLR = WFLR, 1:1)
 *   - assumed-usdt       -> coinGecko.get("tether")         (exUSDT = USDT, 1:1)
 *   - none               -> omitted
 */
export function assembleResolvedPrices(
  plan: PriceFetchPlan,
  fetched: FetchedPrices,
  scale: number = PRICE_SCALE,
): ResolvedPrice[] {
  const out: ResolvedPrice[] = [];
  for (const { assetId, plan: p } of plan.perAsset) {
    let usd: string | undefined;
    if (p.kind === "coingecko-id") {
      usd = fetched.coinGecko.get(p.coinId.toLowerCase());
    } else if (p.kind === "geckoterminal-flare") {
      usd = fetched.geckoTerminalFlare.get(p.contract.toLowerCase());
    } else if (p.kind === "derived-wflr") {
      usd = fetched.coinGecko.get(WFLR_COINGECKO_ID);
    } else if (p.kind === "assumed-usdt") {
      usd = fetched.coinGecko.get(TETHER_COINGECKO_ID);
    }
    if (p.kind === "none" || usd === undefined) continue;
    out.push({
      assetId,
      priceScaledCents: toScaledCents(usd, scale),
      priceScale: scale,
      source: p.sourceKey,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`crypto-pricing-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function makeAsset(partial: Partial<CryptoAssetRecord>): CryptoAssetRecord {
  return {
    id: partial.id ?? "asset-x",
    symbol: partial.symbol ?? "X",
    name: partial.name ?? "Token X",
    chain: (partial.chain ?? "flare") as Chain,
    amountModel: partial.amountModel ?? "evm-minor",
    decimals: partial.decimals ?? 18,
    decimalsSource: partial.decimalsSource ?? "verified",
    native: partial.native ?? false,
    contract: partial.contract ?? null,
    issuer: partial.issuer ?? null,
    currencyCode: partial.currencyCode ?? null,
    denom: partial.denom ?? null,
    migratesToAssetId: partial.migratesToAssetId ?? null,
    active: partial.active ?? true,
    hidden: partial.hidden,
  };
}

export function __runCryptoPricingCoreTests(): void {
  // --- toScaledCents ---
  eq(toScaledCents("73.08", 6), "7308000000", "SFIN $73.08 -> scaled");
  eq(toScaledCents("1", 6), "100000000", "$1.00 -> scaled");
  eq(toScaledCents("1.00", 6), "100000000", "$1.00 (trailing zeros) -> scaled");
  eq(toScaledCents("0.00100616", 6), "100616", "SGB $0.00100616 -> scaled");
  eq(toScaledCents("0.006064", 6), "606400", "WFLR $0.006064 -> scaled");
  eq(toScaledCents("1887.42", 6), "188742000000", "eETH $1887.42 -> scaled");
  eq(toScaledCents("0", 6), "0", "$0 -> 0");
  // round half-up at the scale boundary: scale 6 keeps 8 decimals of a dollar.
  eq(toScaledCents("0.000000005", 6), "1", "half-up rounds 0.5 at cut up to 1");
  eq(toScaledCents("0.0000000049", 6), "0", "below tie rounds down to 0");
  eq(toScaledCents("0.0000000051", 6), "1", "above tie rounds up to 1");
  // reject bad input
  let threw = false;
  try { toScaledCents("-1", 6); } catch { threw = true; }
  eq(threw, true, "negative rejected");
  threw = false;
  try { toScaledCents("1e3", 6); } catch { threw = true; }
  eq(threw, true, "scientific rejected");
  threw = false;
  try { toScaledCents("", 6); } catch { threw = true; }
  eq(threw, true, "empty rejected");
  threw = false;
  try { toScaledCents("abc", 6); } catch { threw = true; }
  eq(threw, true, "non-numeric rejected");

  // --- resolvePriceSource ---
  const flrNative = makeAsset({ symbol: "FLR", chain: "flare", native: true, contract: null });
  const flrPlan = resolvePriceSource(flrNative);
  eq(flrPlan.kind, "coingecko-id", "FLR native -> coingecko");
  eq(flrPlan.kind === "coingecko-id" ? flrPlan.coinId : "", "flare-networks", "FLR coin id");
  const sfin = makeAsset({ symbol: "SFIN", chain: "songbird", contract: "0x0d94e59332732d18cf3a3d457a8886a2ae29ea1b" });
  const sfinPlan = resolvePriceSource(sfin);
  eq(sfinPlan.kind === "coingecko-id" ? sfinPlan.coinId : "", "songbird-finance", "SFIN coin id");
  const wsgb = makeAsset({ symbol: "WSGB", chain: "songbird", contract: "0x02f0826ef6ad107cfc861152b32b52fd11bab9ed" });
  const wsgbPlan = resolvePriceSource(wsgb);
  eq(wsgbPlan.kind === "coingecko-id" ? wsgbPlan.coinId : "", "songbird", "WSGB -> songbird id");

  const rflr = makeAsset({ symbol: "RFLR", chain: "flare", contract: RFLR_CONTRACT.toUpperCase() });
  const rflrPlan = resolvePriceSource(rflr);
  eq(rflrPlan.kind, "derived-wflr", "rFLR -> derived from WFLR");
  eq(rflrPlan.kind === "derived-wflr" ? rflrPlan.sourceKey : "", "derived:wflr-1to1", "rFLR source key");

  const exusdt = makeAsset({ symbol: "EXUSDT", chain: "songbird", contract: EXUSDT_SONGBIRD_CONTRACT });
  const exusdtPlan = resolvePriceSource(exusdt);
  eq(exusdtPlan.kind, "assumed-usdt", "exUSDT -> assumed USDT 1:1");
  eq(exusdtPlan.kind === "assumed-usdt" ? exusdtPlan.sourceKey : "", "assumed:usdt-1to1", "exUSDT source key");

  const usdx = makeAsset({ symbol: "USDX", chain: "flare", contract: "0x4A771Cc1a39FDd8AA08B8EA51F7Fd412e73B3d2B" });
  const usdxPlan = resolvePriceSource(usdx);
  eq(usdxPlan.kind, "geckoterminal-flare", "USDX Flare -> geckoterminal");
  eq(
    usdxPlan.kind === "geckoterminal-flare" ? usdxPlan.contract : "",
    "0x4a771cc1a39fdd8aa08b8ea51f7fd412e73b3d2b",
    "USDX contract lower-cased",
  );

  const flrfrog = makeAsset({ symbol: "FLRFROG", chain: "flare", contract: "0xdeadbeef00000000000000000000000000000000", decimals: 9 });
  eq(resolvePriceSource(flrfrog).kind, "none", "FLRFROG (no pool) -> none");
  const unknown = makeAsset({ symbol: "ZZZ", chain: "flare", contract: null });
  eq(resolvePriceSource(unknown).kind, "none", "unknown symbol -> none");

  // --- buildPriceSnapshotRows ---
  const resolved: ResolvedPrice[] = [
    { assetId: "a-sfin", priceScaledCents: "7308000000", priceScale: 6, source: "coingecko:songbird-finance" },
    { assetId: "a-flr", priceScaledCents: "606041", priceScale: 6, source: "coingecko:flare-networks" },
  ];
  const rows = buildPriceSnapshotRows(resolved, "2026-08-12");
  eq(rows.length, 2, "snapshot row count");
  eq(rows[0].assetId, "a-sfin", "snapshot assetId");
  eq(rows[0].priceDate, "2026-08-12", "snapshot date");
  eq(rows[0].source, "coingecko:songbird-finance", "snapshot source");
  threw = false;
  try { buildPriceSnapshotRows(resolved, "2026/08/12"); } catch { threw = true; }
  eq(threw, true, "bad date rejected");

  // --- applyPricesToBalances (uses Michael's REAL amounts) ---
  const pricesByAssetId: Record<string, ResolvedPrice> = {
    "a-sfin": { assetId: "a-sfin", priceScaledCents: "7308000000", priceScale: 6, source: "coingecko:songbird-finance" },
    "a-exusdt": { assetId: "a-exusdt", priceScaledCents: "100000000", priceScale: 6, source: "assumed:usdt-1to1" },
    "a-sgb": { assetId: "a-sgb", priceScaledCents: "100616", priceScale: 6, source: "coingecko:songbird" },
  };
  const balances: PriceableBalance[] = [
    // 3.086739302164081614 SFIN * $73.08 = $225.58... -> 22558 cents
    { balanceId: "b-sfin", assetId: "a-sfin", amountText: "3.086739302164081614" },
    // 2272.482527 exUSDT * $1.00 = $2272.48 -> 227248 cents
    { balanceId: "b-exusdt", assetId: "a-exusdt", amountText: "2272.482527" },
    // 3129943.151727755987620263 WSGB * $0.00100616 = $3149.24... -> 314924 cents
    { balanceId: "b-sgb", assetId: "a-sgb", amountText: "3129943.151727755987620263" },
    // unpriced asset -> null
    { balanceId: "b-frog", assetId: "a-frog", amountText: "1000000" },
  ];
  const vals = applyPricesToBalances(balances, pricesByAssetId);
  eq(vals.length, 4, "valuation count");
  // Exact expected cents computed via the same half-up BigInt path (verified).
  eq(vals[0].usdValueCents, 22558, "SFIN 3.0867 * $73.08 = $225.58");
  eq(vals[1].usdValueCents, 227248, "exUSDT 2272.482527 * $1.00 = $2272.48");
  eq(vals[2].usdValueCents, 314922, "WSGB 3129943.15 * $0.00100616 = $3149.22");
  eq(vals[3].usdValueCents, null, "unpriced -> null");

  // --- planPriceFetches ---
  const planAssets: CryptoAssetRecord[] = [
    makeAsset({ id: "a-flr", symbol: "FLR", chain: "flare", native: true }), // coingecko flare-networks
    makeAsset({ id: "a-sfin", symbol: "SFIN", chain: "songbird" }), // coingecko songbird-finance
    makeAsset({
      id: "a-sflr",
      symbol: "SFLR",
      chain: "flare",
      contract: "0x12e605bc104e93b45e1ad99f9e555f659051c2bb",
    }), // geckoterminal
    makeAsset({
      id: "a-rflr",
      symbol: "RFLR",
      chain: "flare",
      contract: "0x26d460c3cf931fb2014fa436a49e3af08619810e",
    }), // derived-wflr
    makeAsset({
      id: "a-exusdt",
      symbol: "EXUSDT",
      chain: "songbird",
      contract: "0x1a7b46656b2b8b29b1694229e122d066020503d0",
    }), // assumed-usdt
    makeAsset({
      id: "a-frog",
      symbol: "FLRFROG",
      chain: "flare",
      contract: "0x19cf770bbb7b71977b860e7fd8d32fa2513a743c",
    }), // none
  ];
  const fetchPlan = planPriceFetches(planAssets);
  eq(fetchPlan.needsWflr, true, "plan needs WFLR (rFLR present)");
  eq(fetchPlan.needsTether, true, "plan needs tether (exUSDT present)");
  // CoinGecko ids: flare-networks, songbird-finance, wrapped-flare, tether (deduped).
  eq(fetchPlan.coinGeckoIds.includes("flare-networks"), true, "cg ids has flare-networks");
  eq(fetchPlan.coinGeckoIds.includes("songbird-finance"), true, "cg ids has songbird-finance");
  eq(fetchPlan.coinGeckoIds.includes("wrapped-flare"), true, "cg ids has wrapped-flare (rFLR)");
  eq(fetchPlan.coinGeckoIds.includes("tether"), true, "cg ids has tether (exUSDT)");
  eq(fetchPlan.coinGeckoIds.length, 4, "cg ids deduped to 4");
  eq(fetchPlan.geckoTerminalContracts.length, 1, "gt contracts = 1 (sFLR)");
  eq(
    fetchPlan.geckoTerminalContracts[0],
    "0x12e605bc104e93b45e1ad99f9e555f659051c2bb",
    "gt contract is sFLR",
  );
  eq(fetchPlan.perAsset.length, 6, "perAsset covers all 6 assets");

  // --- assembleResolvedPrices ---
  const fetched: FetchedPrices = {
    coinGecko: new Map<string, string>([
      ["flare-networks", "0.0182"],
      ["songbird-finance", "73.08"],
      ["wrapped-flare", "0.0182"], // rFLR uses this
      ["tether", "1"], // exUSDT uses this
    ]),
    geckoTerminalFlare: new Map<string, string>([
      ["0x12e605bc104e93b45e1ad99f9e555f659051c2bb", "0.0195"], // sFLR
    ]),
  };
  const resolvedAssembled = assembleResolvedPrices(fetchPlan, fetched);
  // 5 priced (FLR, SFIN, sFLR, rFLR, exUSDT); FLRFROG omitted (none).
  eq(resolvedAssembled.length, 5, "assembled 5 priced (FLRFROG omitted)");
  const byId: Record<string, ResolvedPrice> = {};
  for (const r of resolvedAssembled) byId[r.assetId] = r;
  eq(byId["a-flr"].priceScaledCents, "1820000", "FLR $0.0182 -> scaled");
  eq(byId["a-flr"].source, "coingecko:flare-networks", "FLR source");
  eq(byId["a-sfin"].priceScaledCents, "7308000000", "SFIN $73.08 -> scaled");
  eq(byId["a-sflr"].priceScaledCents, "1950000", "sFLR $0.0195 -> scaled");
  eq(byId["a-sflr"].source, "geckoterminal:flare:0x12e605bc104e93b45e1ad99f9e555f659051c2bb", "sFLR source");
  eq(byId["a-rflr"].priceScaledCents, "1820000", "rFLR = WFLR $0.0182 -> scaled");
  eq(byId["a-rflr"].source, "derived:wflr-1to1", "rFLR source is derived:wflr-1to1");
  eq(byId["a-exusdt"].priceScaledCents, "100000000", "exUSDT = USDT $1.00 -> scaled");
  eq(byId["a-exusdt"].source, "assumed:usdt-1to1", "exUSDT source is assumed:usdt-1to1");
  eq(byId["a-frog"], undefined, "FLRFROG not in resolved (no price)");

  // Missing fetched price => asset omitted (unpriced), not guessed.
  const partial: FetchedPrices = {
    coinGecko: new Map<string, string>([["songbird-finance", "73.08"]]),
    geckoTerminalFlare: new Map<string, string>(),
  };
  const resolvedPartial = assembleResolvedPrices(fetchPlan, partial);
  eq(resolvedPartial.length, 1, "only SFIN priced when others missing");
  eq(resolvedPartial[0].assetId, "a-sfin", "partial keeps SFIN only");

  console.log("crypto-pricing-core self-tests: all passed");
}
