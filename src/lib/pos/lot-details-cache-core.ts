/**
 * src/lib/pos/lot-details-cache-core.ts  (D170 O11: lot details offline)
 *
 * Owner, 2026-11-04: "so we can be fully operational while internet is
 * down ... Everything else should work though."
 *
 * The info card's LOT details (vendor lot number, CCRS id, lab result, COA)
 * come from /api/pos/product-details and are deliberately NOT part of the
 * menu bundle (size cap). To keep them during an outage the register saves
 * every answer it gets in a bounded cache (gw-pos-lot-details), and while
 * online and idle it slowly warms the cache for in-stock products it has not
 * seen yet. Offline, the card shows the saved copy with its age; it never
 * pretends a saved copy is live.
 *
 * Pure: no I/O. Self-tested below and registered in run-pure-selftests.ts.
 */
import { parseProductDetailsResponse, type ProductDetailsResponse } from "./product-detail-view-core";

export const LOT_DETAILS_CACHE_VERSION = 1;
/** Entries kept (most recently saved first). Bounds the iPad's storage. */
export const LOT_DETAILS_CACHE_MAX_ENTRIES = 900;
/** Serialized size cap (characters). Oldest entries drop first. */
export const LOT_DETAILS_CACHE_MAX_CHARS = 3_500_000;
/** A saved copy older than this is re-fetched by the warmer when online. */
export const LOT_DETAILS_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** One warm request per this many ms while idle and online (gentle egress). */
export const LOT_DETAILS_WARM_INTERVAL_MS = 6_000;

export type LotDetailsCacheEntry = {
  /** productId + "|" + variantId */
  k: string;
  /** When the server answered (ms). */
  at: number;
  d: ProductDetailsResponse;
};

export type LotDetailsCache = { v: number; entries: LotDetailsCacheEntry[] };

export function lotDetailsKey(productId: string, variantId: string): string {
  return `${String(productId ?? "").slice(0, 200)}|${String(variantId || productId || "").slice(0, 200)}`;
}

export function emptyLotDetailsCache(): LotDetailsCache {
  return { v: LOT_DETAILS_CACHE_VERSION, entries: [] };
}

/** Parse the stored text. Anything unreadable degrades to an empty cache, never throws. */
export function parseLotDetailsCache(raw: string | null | undefined): LotDetailsCache {
  if (!raw) return emptyLotDetailsCache();
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return emptyLotDetailsCache();
  }
  if (!o || typeof o !== "object" || (o as { v?: unknown }).v !== LOT_DETAILS_CACHE_VERSION) return emptyLotDetailsCache();
  const list = (o as { entries?: unknown }).entries;
  if (!Array.isArray(list)) return emptyLotDetailsCache();
  const entries: LotDetailsCacheEntry[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.k !== "string" || !r.k.includes("|") || seen.has(r.k)) continue;
    if (typeof r.at !== "number" || !Number.isFinite(r.at) || r.at <= 0) continue;
    const d = parseProductDetailsResponse(r.d);
    if (!d) continue;
    seen.add(r.k);
    entries.push({ k: r.k, at: r.at, d });
    if (entries.length >= LOT_DETAILS_CACHE_MAX_ENTRIES) break;
  }
  return { v: LOT_DETAILS_CACHE_VERSION, entries };
}

/**
 * Save a fresh server answer (newest first), then trim by count and size.
 * An answer that carries only read warnings and no lots is NOT saved over a
 * good copy: a back-office hiccup must not erase what the iPad already knows.
 */
export function putLotDetails(cache: LotDetailsCache, key: string, details: ProductDetailsResponse, nowMs: number): LotDetailsCache {
  const prior = cache.entries.find((e) => e.k === key);
  if (details.lots.length === 0 && details.warnings.length > 0 && prior && prior.d.lots.length > 0) return cache;
  const rest = cache.entries.filter((e) => e.k !== key);
  return trimLotDetailsCache({ v: LOT_DETAILS_CACHE_VERSION, entries: [{ k: key, at: nowMs, d: details }, ...rest] });
}

export function trimLotDetailsCache(cache: LotDetailsCache): LotDetailsCache {
  let entries = cache.entries.slice(0, LOT_DETAILS_CACHE_MAX_ENTRIES);
  let text = JSON.stringify({ v: LOT_DETAILS_CACHE_VERSION, entries });
  while (entries.length > 0 && text.length > LOT_DETAILS_CACHE_MAX_CHARS) {
    // Drop roughly the oldest tenth per pass (cheap, bounded).
    entries = entries.slice(0, Math.max(0, Math.floor(entries.length * 0.9)));
    text = JSON.stringify({ v: LOT_DETAILS_CACHE_VERSION, entries });
  }
  return { v: LOT_DETAILS_CACHE_VERSION, entries };
}

export function serializeLotDetailsCache(cache: LotDetailsCache): string {
  return JSON.stringify(trimLotDetailsCache(cache));
}

/** Human age for the offline note ("12 min", "3 h", "2 days"). */
export function ageWords(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/**
 * The saved copy for an offline card, with a plain note at the top of its
 * warnings so the budtender knows it is not live. Null = never saved.
 */
export function cachedLotDetails(cache: LotDetailsCache, key: string, nowMs: number): ProductDetailsResponse | null {
  const e = cache.entries.find((x) => x.k === key);
  if (!e) return null;
  const note = `Offline: these lot details were saved on this iPad ${ageWords(nowMs - e.at)} ago. Stock may have changed since.`;
  return { ...e.d, warnings: [note, ...e.d.warnings].slice(0, 6) };
}

/**
 * The next product the idle warmer should fetch: an in-stock product with no
 * saved copy first, else the stalest copy older than a day. Null = nothing to do.
 */
export function nextLotDetailsToWarm(
  products: readonly { productId: string; variantId: string; inStock: boolean }[],
  cache: LotDetailsCache,
  nowMs: number,
): { productId: string; variantId: string } | null {
  const at = new Map(cache.entries.map((e) => [e.k, e.at]));
  let stale: { productId: string; variantId: string; at: number } | null = null;
  for (const p of products) {
    if (!p.inStock || !p.productId) continue;
    const k = lotDetailsKey(p.productId, p.variantId);
    const t = at.get(k);
    if (t === undefined) return { productId: p.productId, variantId: p.variantId };
    if (nowMs - t > LOT_DETAILS_REFRESH_AFTER_MS && (!stale || t < stale.at)) stale = { productId: p.productId, variantId: p.variantId, at: t };
  }
  return stale ? { productId: stale.productId, variantId: stale.variantId } : null;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLotDetailsCacheCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`lot-details-cache-core FAIL: ${label}`);
    }
  };
  const lot = { lotId: "L1", headline: "Lot A", summary: "3 on hand", sellable: true, sections: [{ title: "Lot", rows: [{ label: "Lot code", value: "A" }] }], terpenes: [], coaUrl: null };
  const good: ProductDetailsResponse = { lots: [lot], lotCount: 1, warnings: [] };
  const bad: ProductDetailsResponse = { lots: [], lotCount: 0, warnings: ["Could not read the lots."] };
  const now = 1_800_000_000_000;

  ok(parseLotDetailsCache(null).entries.length === 0, "null -> empty");
  ok(parseLotDetailsCache("{nope").entries.length === 0, "garbage -> empty");
  ok(parseLotDetailsCache(JSON.stringify({ v: 99, entries: [] })).entries.length === 0, "wrong version -> empty");
  ok(lotDetailsKey("p1", "") === "p1|p1", "variant defaults to product");

  let c = putLotDetails(emptyLotDetailsCache(), "p1|v1", good, now);
  ok(c.entries.length === 1 && c.entries[0].at === now, "put saves");
  const round = parseLotDetailsCache(serializeLotDetailsCache(c));
  ok(round.entries.length === 1 && round.entries[0].d.lots[0].lotId === "L1", "round trip");
  ok(putLotDetails(c, "p1|v1", bad, now + 1).entries[0].d.lots.length === 1, "a warning-only answer never erases a good copy");
  ok(putLotDetails(emptyLotDetailsCache(), "p2|v2", bad, now).entries.length === 1, "a warning-only answer is kept when nothing better exists");
  c = putLotDetails(c, "p2|v2", good, now + 5);
  ok(c.entries[0].k === "p2|v2", "newest first");
  c = putLotDetails(c, "p1|v1", good, now + 9);
  ok(c.entries[0].k === "p1|v1" && c.entries.length === 2, "re-put moves to front, no duplicate");

  const off = cachedLotDetails(c, "p1|v1", now + 9 + 3 * 3600_000);
  ok(!!off && off.warnings[0].startsWith("Offline: these lot details were saved on this iPad 3 h ago"), "offline note with age");
  ok(cachedLotDetails(c, "zz|zz", now) === null, "never saved -> null");
  ok(ageWords(5 * 60000) === "5 min" && ageWords(3 * 86400000) === "3 days", "age words");

  const many: LotDetailsCache = { v: 1, entries: Array.from({ length: LOT_DETAILS_CACHE_MAX_ENTRIES + 50 }, (_, i) => ({ k: `p${i}|v`, at: now, d: good })) };
  ok(trimLotDetailsCache(many).entries.length === LOT_DETAILS_CACHE_MAX_ENTRIES, "count cap");
  const big = "x".repeat(250);
  const heavy: ProductDetailsResponse = { lots: [{ ...lot, sections: [{ title: "T", rows: Array.from({ length: 60 }, () => ({ label: "L", value: big })) }] }], lotCount: 1, warnings: [] };
  const fat: LotDetailsCache = { v: 1, entries: Array.from({ length: 400 }, (_, i) => ({ k: `p${i}|v`, at: now, d: heavy })) };
  ok(serializeLotDetailsCache(fat).length <= LOT_DETAILS_CACHE_MAX_CHARS, "size cap");

  const prods = [
    { productId: "a", variantId: "a1", inStock: false },
    { productId: "p1", variantId: "v1", inStock: true },
    { productId: "b", variantId: "b1", inStock: true },
  ];
  const w = nextLotDetailsToWarm(prods, c, now + 10);
  ok(!!w && w.productId === "b", "warms the first uncached in-stock product");
  const allCached = putLotDetails(c, "b|b1", good, now);
  ok(nextLotDetailsToWarm(prods, allCached, now + 10) === null, "nothing to warm");
  const later = nextLotDetailsToWarm(prods, allCached, now + LOT_DETAILS_REFRESH_AFTER_MS + 60_000);
  ok(!!later && later.productId === "b", "re-warms the stalest copy after a day");
  return { passed, failed };
}
