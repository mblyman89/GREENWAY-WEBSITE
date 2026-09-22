/**
 * src/lib/leafly/setup-cache-server.ts
 *
 * SLICE L-18 — the I/O shell around `setup-cache-core.ts`.
 *
 * ONE JOB: answer "how many variants are published to Leafly?" for the setup
 * panel, without rebuilding the entire published menu on every render of
 * /admin/orders.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ───────────────────────────────────────────────────────────────────────────
 * It does NOT cache `buildLeaflyVariantLookup()`.
 *
 * That function's other caller is the order_preview webhook, which prices a
 * real shopper's real cart. Caching it would violate the house rule stated in
 * `menu-cache-policy-core.ts` — "CACHE THE DISPLAY. NEVER CACHE THE MONEY" —
 * and, because `unstable_cache` stores its result as JSON and JSON.stringify
 * silently deletes functions, it would also return a `lookup` of `undefined`
 * to the webhook and throw on every shopper's cart.
 *
 * So this is a SEPARATE, display-only entry point. The preview webhook is
 * untouched and still reads straight through to the database. The fast path is
 * opt-in and the money path cannot inherit it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS CACHED, EXACTLY
 * ───────────────────────────────────────────────────────────────────────────
 * A `VariantCountOutcome` — a small plain object, `{kind:"counted",count:N}`
 * or `{kind:"empty"}`. No functions, no Maps, no Dates. `isCacheableShape()`
 * asserts that before it is stored, so the JSON trap cannot come back.
 *
 * A FAILED READ IS NEVER STORED. `unstable_cache` cannot tell success from
 * failure — it caches whatever the callback returns — so the guard is applied
 * here, by throwing past it. See `loadPublishedVariantCountOutcome` below.
 */
import "server-only";

import { unstable_cache } from "next/cache";

import {
  classifyVariantCount,
  decideCacheWrite,
  leaflySetupCacheOptions,
  LEAFLY_SETUP_CACHE_KEY,
  type VariantCountOutcome,
} from "./setup-cache-core";

/**
 * A sentinel thrown to stop `unstable_cache` from storing a failed read.
 *
 * WHY THROWING IS THE MECHANISM: `unstable_cache` has no "do not store this"
 * return value. It serialises whatever the callback returns. The only way to
 * get a value back to the caller WITHOUT it being written to the cache is for
 * the callback to throw, and for us to catch it on the outside.
 *
 * This is not an error condition in the ordinary sense — the caller gets a
 * perfectly good "unreadable" outcome and the panel says "couldn't check just
 * now". It is a control-flow signal with a name, so that the next reader of
 * this file does not see a bare `throw` and assume something is broken.
 */
class UncacheableRead extends Error {
  readonly outcome: VariantCountOutcome;
  constructor(outcome: VariantCountOutcome) {
    super("leafly setup count: read failed, deliberately not cached");
    this.name = "UncacheableRead";
    this.outcome = outcome;
  }
}

/**
 * The uncached read. Rebuilds the published menu and counts what it can price.
 *
 * Throws `UncacheableRead` when the menu could not be read, so the wrapper
 * below never commits that to the cache.
 */
async function readPublishedVariantCount(): Promise<VariantCountOutcome> {
  let outcome: VariantCountOutcome;
  try {
    const { buildLeaflyVariantLookup } = await import("./preview-lookup");
    const built = await buildLeaflyVariantLookup();
    outcome = classifyVariantCount({
      loaded: built.loaded,
      variantCount: built.variantCount,
    });
  } catch (err) {
    outcome = {
      kind: "unreadable",
      reason: err instanceof Error ? err.message : "the published menu could not be loaded",
    };
  }

  // BOTH TRAPS, ONE GATE. The judgement lives in the pure core
  // (`decideCacheWrite`) so that it is reachable by tests; this shell only
  // carries out the verdict. See the long comment on that function for why it
  // is not two ifs right here — in short, a mutation that deleted those ifs
  // survived, because nothing could execute them.
  const verdict = decideCacheWrite(outcome);
  if (!verdict.store) {
    throw new UncacheableRead(verdict.outcome);
  }

  return verdict.outcome;
}

/**
 * The cached wrapper. Tagged `live-menu`, so publishing the menu clears it
 * instantly via the existing `revalidateTag` at public-surfaces.ts:61 — there
 * is no new invalidation call to remember.
 */
const readPublishedVariantCountCached = unstable_cache(
  readPublishedVariantCount,
  [...LEAFLY_SETUP_CACHE_KEY],
  leaflySetupCacheOptions(),
);

/**
 * How many variants the published menu can price, as a three-valued outcome.
 *
 * Never throws. A failed read comes back as `{kind:"unreadable"}` and is not
 * cached, so the next page load tries again.
 */
export async function loadPublishedVariantCountOutcome(): Promise<VariantCountOutcome> {
  try {
    return await readPublishedVariantCountCached();
  } catch (err) {
    if (err instanceof UncacheableRead) return err.outcome;
    // `unstable_cache` itself can throw when there is no incremental cache
    // available (it is called outside a render, or the cache is missing).
    // Falling back to the uncached read keeps the panel working rather than
    // failing the page for a caching concern.
    try {
      return await readPublishedVariantCount();
    } catch (inner) {
      if (inner instanceof UncacheableRead) return inner.outcome;
      return {
        kind: "unreadable",
        reason: inner instanceof Error ? inner.message : "the published menu could not be loaded",
      };
    }
  }
}
