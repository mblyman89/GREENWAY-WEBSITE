/**
 * src/lib/admin/cockpit-cache-core.ts  (PERF P3, owner 2026-11-05)
 *
 * Owner, verbatim: "I need my back office to be lightning fast ... I want the
 * main admin page to be instant." and "I want optimization and efficiency to
 * be paramount now that we are in live production."
 *
 * The cockpit (/admin) re-read every sales figure from scratch on every load,
 * for every staff member, even though the figures are the same for everyone
 * and a finished day never changes. This module is the POLICY for the short
 * shared cache the cockpit now uses. PURE: no imports, no I/O, no Next.js.
 *
 * THE RULES (the house rule "CACHE THE DISPLAY. NEVER CACHE THE MONEY" from
 * menu-cache-policy-core.ts, applied to the cockpit):
 *
 *   1. Display only. Every cached figure is a number on the dashboard. The
 *      register, the reports, the filings (Reports, LIQ-1295, CCRS, Sage) and
 *      every write read straight through to the database, exactly as before.
 *   2. Short, stated windows. Today's figures: at most COCKPIT_TODAY_TTL_S
 *      seconds old. Finished days (yesterday, the comparison baseline):
 *      COCKPIT_PAST_TTL_S. Low stock: COCKPIT_STOCK_TTL_S. A bounded TTL means
 *      a write path nobody wired to a tag still self-heals in a known window.
 *   3. A failed read is NEVER stored. The cached function throws past the
 *      cache (unstable_cache stores only what it returns), the cockpit shows
 *      "unavailable" for that tile and the next load tries again.
 *   4. Only plain JSON is stored (unstable_cache serialises with JSON; a Map,
 *      Set, Date, function or undefined would silently come back different).
 *      isPlainJson() is checked before every store.
 *   5. Cache keys never contain the current time (a key with `now` in it
 *      never hits). Today's window is keyed by its Pacific DATE; "now" is
 *      taken inside the cached function.
 */

/** Today's sales, taxes and returns on the cockpit: at most this old. */
export const COCKPIT_TODAY_TTL_S = 30;
/** Finished days (yesterday and the comparison baseline): at most this old. */
export const COCKPIT_PAST_TTL_S = 600;
/** The low-stock count (2,000+ lots and 30 days of sales): at most this old. */
export const COCKPIT_STOCK_TTL_S = 120;
/** One tag clears every cockpit figure at once (revalidateTag). */
export const COCKPIT_CACHE_TAG = "admin-cockpit";
/** Bump to invalidate every stored cockpit entry after a shape change. */
export const COCKPIT_CACHE_VERSION = "v2"; // D210: SalesReport gained byDayHour + byDayCategoryType

/**
 * True when `v` survives JSON.stringify -> JSON.parse unchanged: null,
 * booleans, finite numbers, strings, arrays and plain objects of those.
 * A Map/Set/Date/function/undefined/NaN/Infinity/class instance is false.
 */
export function isPlainJson(v: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(v as number);
  if (t !== "object") return false;
  if (Array.isArray(v)) return v.every((x) => isPlainJson(x, depth + 1));
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v as Record<string, unknown>).every((x) => isPlainJson(x, depth + 1));
}

export type CacheWriteVerdict<T> = { store: true; value: T } | { store: false; reason: string };

/** The one gate in front of every cockpit cache write. */
export function decideCockpitCacheWrite<T>(value: T): CacheWriteVerdict<T> {
  if (value === undefined) return { store: false, reason: "no value" };
  if (!isPlainJson(value)) return { store: false, reason: "not plain JSON (would change shape in the cache)" };
  return { store: true, value };
}

/**
 * Which TTL a sales window gets. A window that ends before today (Pacific)
 * is finished; anything touching today is live.
 */
export function salesWindowTtl(windowLastYmd: string, todayYmd: string): number {
  return windowLastYmd < todayYmd ? COCKPIT_PAST_TTL_S : COCKPIT_TODAY_TTL_S;
}

/**
 * Cache key parts for a cockpit figure. Parts are DATES (YYYY-MM-DD) and
 * names, never instants: an instant in a key is usually a clock reading,
 * which makes every key unique (never a hit) and fills the cache.
 */
export function cockpitCacheKey(name: string, ...parts: string[]): string[] {
  for (const p of parts) {
    if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p)) {
      throw new Error(`cockpit cache key "${name}" contains an instant (${p}); key by the Pacific date instead`);
    }
  }
  return ["admin-cockpit", COCKPIT_CACHE_VERSION, name, ...parts];
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runCockpitCacheTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      messages.push(label);
    }
  };

  ok(isPlainJson(null), "null is plain");
  ok(isPlainJson({ a: 1, b: "x", c: [1, 2, { d: true }] }), "nested plain object");
  ok(!isPlainJson(new Map()), "a Map is not plain");
  ok(!isPlainJson(new Set([1])), "a Set is not plain");
  ok(!isPlainJson(new Date()), "a Date is not plain");
  ok(!isPlainJson({ f: () => 1 }), "a function inside is not plain");
  ok(!isPlainJson({ u: undefined }), "undefined inside is not plain");
  ok(!isPlainJson(Number.NaN), "NaN is not plain");
  ok(!isPlainJson([Infinity]), "Infinity is not plain");
  ok(!isPlainJson(undefined), "undefined is not plain");
  class K {
    x = 1;
  }
  ok(!isPlainJson(new K()), "a class instance is not plain");
  ok(isPlainJson(Object.create(null)), "a null-prototype object is plain");

  ok(decideCockpitCacheWrite({ n: 1 }).store === true, "plain value is stored");
  ok(decideCockpitCacheWrite(undefined).store === false, "undefined is never stored");
  ok(decideCockpitCacheWrite({ m: new Map() }).store === false, "a Map is never stored");
  const sampleReport = {
    hasData: true,
    totalRevenueMinorUnits: 1200,
    byHour: [{ hour: 9, label: "9 AM", revenueMinorUnits: 1200, orders: 1 }],
    byDay: [{ date: "2026-11-05", revenueMinorUnits: 1200, orders: 1, units: 2 }],
  };
  ok(decideCockpitCacheWrite(sampleReport).store === true, "a sales-report shape is storable");

  ok(salesWindowTtl("2026-11-04", "2026-11-05") === COCKPIT_PAST_TTL_S, "yesterday is a finished window");
  ok(salesWindowTtl("2026-11-05", "2026-11-05") === COCKPIT_TODAY_TTL_S, "today is live");
  ok(COCKPIT_TODAY_TTL_S <= 60, "today's figures are never more than a minute old");
  ok(COCKPIT_STOCK_TTL_S <= 300, "low stock is never more than five minutes old");

  ok(cockpitCacheKey("today", "2026-11-05").join("|") === "admin-cockpit|v2|today|2026-11-05", "date key");
  ok(cockpitCacheKey("baseline", "yesterday", "2026-11-05").length === 5, "basis + date key");
  let threw = false;
  try {
    cockpitCacheKey("today", new Date(Date.UTC(2026, 10, 5, 21, 13, 7, 123)).toISOString());
  } catch {
    threw = true;
  }
  ok(threw, "a clock reading in a key is refused");
  let threw2 = false;
  try {
    cockpitCacheKey("span", "2026-11-04T07:00:00.000Z");
  } catch {
    threw2 = true;
  }
  ok(threw2, "any instant in a key is refused (key by date)");

  return { passed, failed, messages };
}
