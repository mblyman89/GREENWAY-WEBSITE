import "server-only";

/**
 * src/lib/crypto/crypto-price-fetch.ts
 *
 * Thin, GRACEFUL, throttled HTTP clients for the two free (keyless) price feeds
 * R3 uses. No business logic here — resolution + valuation live in the PURE
 * crypto-pricing-core.ts. These functions only fetch a USD number for a key and
 * NEVER throw: any failure (network, rate-limit, missing coin/pool) yields "no
 * entry" for that key, so the pipeline treats it as unpriced rather than
 * crashing or guessing.
 *
 * Sources (LIVE-verified 2026-08-12, see research/r3-usd-valuation-recon.md):
 *   - CoinGecko  GET /api/v3/simple/price?ids=<csv>&vs_currencies=usd
 *   - GeckoTerminal GET /api/v2/simple/networks/flare/token_price/<contracts,csv>
 *     (free tier ~30 req/min => we chunk to 5 contracts and pause between calls).
 */

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2";

/** GeckoTerminal free tier is ~30 req/min; keep chunks small + spaced. */
const GT_CHUNK = 5;
const GT_DELAY_MS = 8000;
/** CoinGecko /simple/price takes many ids in ONE call; still cap payload size. */
const CG_CHUNK = 100;
const CG_DELAY_MS = 1500;
/**
 * The free /coins/{id}/history endpoint is ONE coin per call, so a batch of
 * back-traced acquisitions makes many calls. Space them so the keyless tier
 * (~10-30 req/min) doesn't start returning nulls (which we'd honestly treat as
 * unpriced, but throttling avoids the false negatives).
 */
const CG_HISTORY_DELAY_MS = 2500;

/** Per-request timeout so a hung feed can't stall a whole sync. */
const FETCH_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate a value looks like a plain positive USD number string. Anything else
 * (null, 0, negative, NaN, exponent) is dropped so a bad datum never becomes a
 * guessed price. Returns the trimmed decimal string, or null.
 */
function cleanUsd(value: unknown): string | null {
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    s = value.toString();
  } else if (typeof value === "string") {
    s = value.trim();
  } else {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null; // rejects "-", "1e-3", "", "NaN"
  if (/^0(\.0+)?$/.test(s)) return null; // zero => treat as unpriced
  return s;
}

/**
 * Fetch USD prices for CoinGecko coin ids. Returns a Map keyed by the coin id
 * (lower-cased as CoinGecko returns them) => USD decimal string. Missing ids are
 * simply absent from the map (=> unpriced).
 */
export async function fetchCoinGeckoUsdPrices(
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.map((i) => i.trim()).filter((i) => i !== "")));
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += CG_CHUNK) {
    const part = unique.slice(i, i + CG_CHUNK);
    const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(part.join(","))}&vs_currencies=usd`;
    const json = await getJson(url);
    if (json && typeof json === "object") {
      for (const [id, obj] of Object.entries(json as Record<string, unknown>)) {
        const usd = cleanUsd((obj as { usd?: unknown } | null)?.usd);
        if (usd) out.set(id.toLowerCase(), usd);
      }
    }
    if (i + CG_CHUNK < unique.length) await sleep(CG_DELAY_MS);
  }
  return out;
}

/**
 * R1-G3 — fetch a single coin's USD price ON A SPECIFIC HISTORICAL DATE.
 *
 * Uses CoinGecko's free GET /coins/{id}/history?date=DD-MM-YYYY endpoint, which
 * returns that calendar day's market snapshot. We read
 * market_data.current_price.usd. Returns the USD decimal string, or null when
 * the coin/day has no data (=> the caller surfaces it as unpriced, never $0).
 *
 * The `date` argument MUST already be in CoinGecko's DD-MM-YYYY form (produced
 * by toCoinGeckoDate() in crypto-historical-pricing-core.ts). NEVER throws.
 */
export async function fetchCoinGeckoHistoricalUsdPrice(
  coinId: string,
  dateDDMMYYYY: string,
): Promise<string | null> {
  const id = coinId.trim();
  const date = dateDDMMYYYY.trim();
  if (id === "" || !/^\d{2}-\d{2}-\d{4}$/.test(date)) return null;
  // localization=false trims the (large) unused i18n payload.
  const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(id)}/history?date=${encodeURIComponent(date)}&localization=false`;
  const json = await getJson(url);
  const usd = (json as { market_data?: { current_price?: { usd?: unknown } } } | null)
    ?.market_data?.current_price?.usd;
  return cleanUsd(usd);
}

/**
 * R1-G3 — fetch many (coinId, DD-MM-YYYY) historical prices, throttled. Returns
 * a Map keyed by `${coinId}|${date}` (matching fetchKey() in the pure core) =>
 * USD decimal string. Missing lookups are simply absent (=> unpriced). NEVER
 * throws; each call is independent so one failure never poisons the batch.
 */
export async function fetchCoinGeckoHistoricalUsdPrices(
  requests: Array<{ coinId: string; dateDDMMYYYY: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // De-dupe defensively (the pure planner already does, but be safe).
  const seen = new Set<string>();
  const unique: Array<{ coinId: string; dateDDMMYYYY: string }> = [];
  for (const r of requests) {
    const coinId = r.coinId.trim();
    const date = r.dateDDMMYYYY.trim();
    if (coinId === "" || !/^\d{2}-\d{2}-\d{4}$/.test(date)) continue;
    const key = `${coinId}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ coinId, dateDDMMYYYY: date });
  }

  for (let i = 0; i < unique.length; i += 1) {
    const { coinId, dateDDMMYYYY } = unique[i];
    const usd = await fetchCoinGeckoHistoricalUsdPrice(coinId, dateDDMMYYYY);
    if (usd) out.set(`${coinId}|${dateDDMMYYYY}`, usd);
    if (i + 1 < unique.length) await sleep(CG_HISTORY_DELAY_MS);
  }
  return out;
}

/**
 * Fetch USD prices for Flare ERC-20 contracts via GeckoTerminal. Returns a Map
 * keyed by LOWER-case contract => USD decimal string. Chunked to 5 with an ~8s
 * pause to respect the free-tier rate limit (rapid calls return null for
 * priceable tokens — a known false-negative we avoid by throttling).
 */
export async function fetchGeckoTerminalFlarePrices(
  contracts: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(
    new Set(contracts.map((c) => c.trim().toLowerCase()).filter((c) => c !== "")),
  );
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += GT_CHUNK) {
    const part = unique.slice(i, i + GT_CHUNK);
    const url = `${GECKOTERMINAL_BASE}/simple/networks/flare/token_price/${encodeURIComponent(part.join(","))}`;
    const json = await getJson(url);
    const prices = (json as { data?: { attributes?: { token_prices?: Record<string, unknown> } } } | null)
      ?.data?.attributes?.token_prices;
    if (prices && typeof prices === "object") {
      for (const [contract, value] of Object.entries(prices)) {
        const usd = cleanUsd(value);
        if (usd) out.set(contract.toLowerCase(), usd);
      }
    }
    if (i + GT_CHUNK < unique.length) await sleep(GT_DELAY_MS);
  }
  return out;
}
