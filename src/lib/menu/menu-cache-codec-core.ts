/**
 * SLICE E — THE 2 MB WALL.
 *
 * WHY THIS MODULE EXISTS
 * ──────────────────────
 * `loadLiveMenuAllCached` (live-menu.ts) wraps the whole published catalog in
 * `unstable_cache`, which writes to Vercel's Data Cache. Vercel's documentation
 * states that the Data Cache and the Runtime Cache both cap **item size at
 * 2 MB**, and that "items larger won't be cached".
 *
 * Measured at the store's real catalog size (4,500 products,
 * `scripts/measure-cache-fit.mjs`):
 *
 *     Data Cache item limit ......  2.00 MB
 *     Published menu, serialized .  5.94 MB   ← 3.94 MB OVER
 *
 * So the write was **silently dropped**. No error, no warning, no log line.
 * The entry was never stored, therefore never read, therefore every single
 * request to /menu re-ran the entire database read path. That is the honest
 * explanation for Slice A's caching producing "no perceptible change" — the
 * cache was right in shape and wrong in size, and the failure mode is invisible.
 *
 * THE FIX
 * ───────
 * Store the payload COMPRESSED inside the cache entry. Same measurement run:
 *
 *     gzipped ....................  153 KB   (40x smaller)
 *     stored as base64 ...........  204 KB   ← fits, 1.85 MB to spare
 *     decode on a cache HIT ......  ~45 ms
 *     encode on a cache MISS .....  ~28 ms   (once per 60s window)
 *     headroom ...................  ~45,000 products before it reaches 2 MB
 *
 * Paying ~45 ms of decode to remove the entire uncached database read path is
 * the right trade, and it keeps working as the catalog grows.
 *
 * WHY base64 AND NOT A RAW Buffer
 * ───────────────────────────────
 * The cache value must survive JSON serialization. A raw `Buffer` does not
 * round-trip through JSON as a Buffer — it degrades to `{type:"Buffer",data:[…]}`,
 * which is far LARGER than the string it replaced and would defeat the purpose.
 * base64 is a plain string, so it round-trips exactly. It costs ~33% over raw
 * gzip (153 KB → 204 KB) and is still an order of magnitude under the limit.
 *
 * SAFETY POSTURE
 * ──────────────
 * Decoding is NEVER allowed to take the storefront down. `decodeMenuCacheEntry`
 * returns `null` on any malformed input rather than throwing, and the caller
 * falls back to the uncached loader. A cache problem must degrade to "slow",
 * never to "broken".
 *
 * This module is PURE (no I/O, no Next.js imports) so it is fully testable.
 */

import { gzipSync, gunzipSync } from "node:zlib";

/**
 * Vercel's documented per-item ceiling for the Data Cache / Runtime Cache.
 * Kept here as a named constant so the guard below and the tests reference the
 * same number the vendor documents.
 */
export const DATA_CACHE_ITEM_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Refuse to hand back an entry that would be dropped anyway.
 *
 * If a future catalog somehow compresses to more than this, we would be back to
 * a silent drop. Rather than pretend, `encodeMenuCacheEntry` returns `null` and
 * the caller skips caching — degrading to today's behavior, loudly documented,
 * instead of failing invisibly.
 */
export const MENU_CACHE_ENCODED_LIMIT_BYTES = DATA_CACHE_ITEM_LIMIT_BYTES;

/**
 * The envelope actually stored in the cache.
 *
 * `v` lets a future format change be detected and rejected rather than
 * misparsed: an entry written by an older deploy that is still warm in the
 * cache will fail the version check and fall back to a fresh read.
 */
export type MenuCacheEnvelope = {
  /** Format version. Bump when the payload encoding changes. */
  v: 1;
  /** gzip of the UTF-8 JSON, base64-encoded so it round-trips through JSON. */
  z: string;
  /** Item count at write time — used only as a cheap integrity signal. */
  n: number;
};

const ENVELOPE_VERSION = 1 as const;

/**
 * Compress a menu payload into a cache-safe envelope.
 *
 * Returns `null` when the encoded form would still exceed the Data Cache item
 * limit, so the caller can skip the write instead of issuing one that would be
 * silently discarded.
 */
export function encodeMenuCacheEntry<T>(items: readonly T[]): MenuCacheEnvelope | null {
  const json = JSON.stringify(items);
  const z = gzipSync(json).toString("base64");
  if (Buffer.byteLength(z, "utf8") > MENU_CACHE_ENCODED_LIMIT_BYTES) return null;
  return { v: ENVELOPE_VERSION, z, n: items.length };
}

/**
 * Restore a menu payload from a cache envelope.
 *
 * Returns `null` — never throws — for anything unexpected: a null/undefined
 * entry, a wrong-shaped object, an unknown version, corrupt gzip, JSON that
 * does not parse, or a payload that is not an array. The caller treats `null`
 * as a cache miss and reads from the database.
 */
export function decodeMenuCacheEntry<T>(entry: unknown): T[] | null {
  if (!isEnvelope(entry)) return null;
  try {
    const json = gunzipSync(Buffer.from(entry.z, "base64")).toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed as T[];
  } catch {
    // Corrupt or truncated entry. A cache problem degrades to "slow", not
    // "broken" — the caller re-reads from the database.
    return null;
  }
}

function isEnvelope(value: unknown): value is MenuCacheEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MenuCacheEnvelope>;
  return (
    candidate.v === ENVELOPE_VERSION &&
    typeof candidate.z === "string" &&
    typeof candidate.n === "number"
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
/**
 * The module proves its own invariants. Called by the compliance test AND
 * runnable directly, so a broken codec cannot reach main.
 */
export function __runMenuCacheCodecTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-cache-codec] FAIL: ${label}`);
    }
  };

  // ── Round-trip fidelity ───────────────────────────────────────────────────
  const sample = [
    { id: "a", name: "Alpha", price: 1500, tags: ["x", "y"], nested: { deep: true } },
    { id: "b", name: "Beta", price: 2500, tags: [], nested: { deep: false } },
  ];
  const env = encodeMenuCacheEntry(sample);
  check("encode returns an envelope", env !== null);
  check("envelope is versioned", env?.v === 1);
  check("envelope records the count", env?.n === 2);
  const back = decodeMenuCacheEntry<(typeof sample)[number]>(env);
  check("round-trip preserves the payload exactly", JSON.stringify(back) === JSON.stringify(sample));

  // ── Order is preserved (the menu is an ordered list) ───────────────────────
  const ordered = Array.from({ length: 250 }, (_, i) => ({ i }));
  const orderedBack = decodeMenuCacheEntry<{ i: number }>(encodeMenuCacheEntry(ordered));
  check(
    "round-trip preserves order",
    !!orderedBack && orderedBack.every((row, i) => row.i === i),
  );

  // ── An empty menu is still a valid entry (not confused with a miss) ────────
  const emptyEnv = encodeMenuCacheEntry([]);
  const emptyBack = decodeMenuCacheEntry(emptyEnv);
  check("empty array encodes", emptyEnv !== null);
  check("empty array decodes to an empty array, not null", Array.isArray(emptyBack) && emptyBack.length === 0);

  // ── It actually compresses (the entire point) ─────────────────────────────
  const bulky = Array.from({ length: 2000 }, (_, i) => ({
    id: `POS-KEY-${i}`,
    name: `Product Name ${i} - Premium Cannabis Flower 3.5g`,
    description: "A curated description written for the storefront, a couple of sentences long.",
    variants: [{ label: "1g" }, { label: "3.5g" }, { label: "7g" }],
  }));
  const rawBytes = Buffer.byteLength(JSON.stringify(bulky), "utf8");
  const encBytes = Buffer.byteLength(encodeMenuCacheEntry(bulky)!.z, "utf8");
  check("encoded form is much smaller than raw", encBytes * 4 < rawBytes);
  check("encoded form is under the Data Cache item limit", encBytes < MENU_CACHE_ENCODED_LIMIT_BYTES);

  // ── Malformed input degrades to a miss, never a throw ─────────────────────
  check("null is a miss", decodeMenuCacheEntry(null) === null);
  check("undefined is a miss", decodeMenuCacheEntry(undefined) === null);
  check("a plain string is a miss", decodeMenuCacheEntry("not-an-envelope") === null);
  check("a number is a miss", decodeMenuCacheEntry(42) === null);
  check("an array is a miss", decodeMenuCacheEntry([1, 2, 3]) === null);
  check("an empty object is a miss", decodeMenuCacheEntry({}) === null);
  check("a wrong version is a miss", decodeMenuCacheEntry({ v: 99, z: "x", n: 0 }) === null);
  check("a non-string payload is a miss", decodeMenuCacheEntry({ v: 1, z: 123, n: 0 }) === null);
  check("corrupt base64/gzip is a miss", decodeMenuCacheEntry({ v: 1, z: "!!!!not-gzip!!!!", n: 1 }) === null);
  check(
    "valid gzip of NON-array JSON is a miss",
    decodeMenuCacheEntry({ v: 1, z: gzipSync('{"a":1}').toString("base64"), n: 1 }) === null,
  );

  // ── The documented vendor limit is what we actually guard against ─────────
  check("limit constant is 2 MB", DATA_CACHE_ITEM_LIMIT_BYTES === 2 * 1024 * 1024);
  check("encode guard uses the vendor limit", MENU_CACHE_ENCODED_LIMIT_BYTES === DATA_CACHE_ITEM_LIMIT_BYTES);

  return { passed, failed };
}
