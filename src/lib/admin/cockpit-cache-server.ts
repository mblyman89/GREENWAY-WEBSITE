/**
 * src/lib/admin/cockpit-cache-server.ts  (PERF P3, server-only)
 *
 * The short shared cache behind the /admin cockpit's heavy figures. Policy,
 * TTLs and the JSON gate live in the pure cockpit-cache-core.ts; this file
 * only wires them to Next's Data Cache (unstable_cache, the same mechanism
 * the nav badges and the Leafly setup count already use).
 *
 * DISPLAY ONLY. Nothing here is imported by the register, a report page, a
 * filing (LIQ-1295, CCRS, Sage) or any write. Those read straight through.
 *
 * A FAILED READ IS NEVER STORED: the underlying readers throw on any database
 * error (rule 135), unstable_cache does not store a throw, and the caller
 * (cockpit-data.ts, via safeData) shows the tile as unavailable. A value that
 * is not plain JSON is not stored either: it is handed back uncached (and
 * logged), so a shape change can never come back from the cache different.
 */
import "server-only";

import { unstable_cache } from "next/cache";

import { getSalesReport, type SalesReport } from "@/lib/reports/sales";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { returnsVoidsForDay, type ReturnsVoidsRange } from "@/lib/admin/returns-metrics-store";
import { buildReorderSuggestions } from "@/lib/purchasing/po-store";
import {
  COCKPIT_CACHE_TAG,
  COCKPIT_PAST_TTL_S,
  COCKPIT_STOCK_TTL_S,
  COCKPIT_TODAY_TTL_S,
  cockpitCacheKey,
  decideCockpitCacheWrite,
} from "@/lib/admin/cockpit-cache-core";

/** Carries a good-but-unstorable value past unstable_cache without storing it. */
class NotStored<T> extends Error {
  constructor(
    readonly value: T,
    reason: string,
  ) {
    super(`cockpit cache: not stored (${reason})`);
    this.name = "NotStored";
  }
}

function gate<T>(value: T): T {
  const v = decideCockpitCacheWrite(value);
  if (!v.store) throw new NotStored(value, v.reason);
  return v.value;
}

async function unwrap<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotStored) {
      console.warn("[cockpit-cache]", e.message);
      return e.value as T;
    }
    throw e;
  }
}

/** Wrap a display-only reader in the cockpit's short shared cache (see the header). */
export function cockpitCached<A extends string[], T>(
  name: string,
  ttl: number,
  read: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return (...args: A) =>
    unwrap(
      unstable_cache(async () => gate(await read(...args)), cockpitCacheKey(name, ...args), {
        revalidate: ttl,
        tags: [COCKPIT_CACHE_TAG],
      })(),
    );
}

/** Today's sales from Pacific midnight to now; at most COCKPIT_TODAY_TTL_S old. */
export const cockpitSalesToday: (todayYmd: string) => Promise<SalesReport> = cockpitCached(
  "sales-today",
  COCKPIT_TODAY_TTL_S,
  (todayYmd: string) => getSalesReport(pacificWallTimeToUtcISO(todayYmd, "start"), new Date().toISOString()),
);

/** A run of FINISHED Pacific days (yesterday, a comparison baseline). */
export const cockpitSalesDays: (fromYmd: string, toYmd: string) => Promise<SalesReport> = cockpitCached(
  "sales-days",
  COCKPIT_PAST_TTL_S,
  (fromYmd: string, toYmd: string) =>
    getSalesReport(pacificWallTimeToUtcISO(fromYmd, "start"), pacificWallTimeToUtcISO(toYmd, "end")),
);

/** Today's returns and voids. */
export const cockpitReturnsToday: (todayYmd: string) => Promise<ReturnsVoidsRange> = cockpitCached(
  "returns-today",
  COCKPIT_TODAY_TTL_S,
  async (todayYmd: string) => {
    const r = await returnsVoidsForDay(todayYmd);
    // ok=false means a read failed: never store it (rule 135).
    if (!r.ok) throw new Error("today's returns and voids could not be read");
    return r;
  },
);

/** How many products are at or below their reorder point. */
export const cockpitLowStockCount: () => Promise<number> = cockpitCached("low-stock", COCKPIT_STOCK_TTL_S, async () => {
  const s = await buildReorderSuggestions({ onlyNeeded: true });
  return s.filter((x) => x.result.belowReorderPoint).length;
});
