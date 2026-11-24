/**
 * src/lib/specials/deal-pool-core.ts — USAGE-7d (owner: Michael, 2026-11-24)
 *
 * HOME AND SPECIALS SHIP THE DEAL POOL, NOT THE WHOLE CATALOG.
 *
 * WHY (measured, AGENTS.md rule 18)
 * ─────────────────────────────────
 * The home page's "Daily Deals" and the Specials page's "Today's deals" are
 * client components that receive `items` and, in the browser, run
 * `selectOnDealItems(items, activeRules, { limit: 64 })` for the store's
 * weekday, then shuffle and show at most 24 cards. Both pages passed the FULL
 * live catalog (2,712 items on 2026-11-24, ≈ 3.4 MB of JSON) into that prop,
 * so each page was 4.5–4.9 MB on the wire and every ISR write of `/` and
 * `/specials` stored megabytes to show ≤ 24 cards.
 *
 * THE POOL (exact, not an approximation)
 * ──────────────────────────────────────
 * The client keeps its logic unchanged; the server only narrows its input to
 * a SUPERSET that provably yields the same cards:
 *
 *   pool = ⋃ over every published rule r of
 *            the first DEAL_POOL_PER_RULE (= 64) items with a deal under r
 *        ∪ an evenly spaced fallback sample (FALLBACK_SAMPLE items)
 *   kept in the ORIGINAL catalog order.
 *
 * Proof the client's selection is identical: for any active set S (whatever
 * weekday/date the browser resolves), the client takes the first 64 items x
 * with menuDiscountForItem(x, S) defined. That is defined iff some r ∈ S gives
 * x a deal. Then x's rank among r's deal items is ≤ its rank among S's deal
 * items ≤ 64, so x is in r's first 64 — in the pool. Order is preserved, so
 * "the first 64" over the pool equals "the first 64" over the catalog.
 *
 * The fallback (days with no per-item deal, e.g. a basket-only Sunday) used
 * to shuffle the whole catalog and show ≤ 24; it now shuffles a FALLBACK_SAMPLE
 * cross-section — still random real products, never blank.
 *
 * NEVER MONEY: this only chooses WHICH cards render. Card prices and badges
 * are still computed by the same client code from the same rules; the cart
 * and register price independently.
 *
 * PURE: generic over the deal predicate so it is testable without the engine.
 */

/** Items kept per published rule (matches the client's `limit: 64`). */
export const DEAL_POOL_PER_RULE = 64;

/** Cross-section kept for the no-per-item-deal fallback (client shows ≤ 24). */
export const DEAL_POOL_FALLBACK_SAMPLE = 96;

/**
 * Narrow `items` to the deal pool. `hasDeal(item, rule)` must be the client's
 * own single-rule predicate (`menuDiscountForItem(item, [rule]) !== undefined`).
 * Returns items in their original order; never mutates the input.
 */
export function buildDealPool<T, R>(
  items: readonly T[],
  rules: readonly R[],
  hasDeal: (item: T, rule: R) => boolean,
  opts: { perRule?: number; fallbackSample?: number } = {},
): T[] {
  const perRule = Math.max(0, Math.trunc(opts.perRule ?? DEAL_POOL_PER_RULE));
  const sample = Math.max(0, Math.trunc(opts.fallbackSample ?? DEAL_POOL_FALLBACK_SAMPLE));
  const keep = new Uint8Array(items.length);

  for (const rule of rules) {
    let taken = 0;
    for (let i = 0; i < items.length && taken < perRule; i += 1) {
      if (hasDeal(items[i], rule)) {
        keep[i] = 1;
        taken += 1;
      }
    }
  }

  if (sample > 0 && items.length > 0) {
    if (items.length <= sample) {
      keep.fill(1);
    } else {
      const step = items.length / sample;
      for (let k = 0; k < sample; k += 1) keep[Math.floor(k * step)] = 1;
    }
  }

  const out: T[] = [];
  for (let i = 0; i < items.length; i += 1) if (keep[i]) out.push(items[i]);
  return out;
}

export function __runDealPoolTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[deal-pool] FAIL: ${label}`);
    }
  };

  // Fixture: items 0..999; rule "mod k" gives a deal when i % k === 0.
  const items = Array.from({ length: 1000 }, (_, i) => i);
  const has = (i: number, k: number) => i % k === 0;
  const firstN = (xs: readonly number[], set: readonly number[], n: number) =>
    xs.filter((x) => set.some((k) => has(x, k))).slice(0, n);
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

  check("constants match the client (64) and exceed max cards (24)", DEAL_POOL_PER_RULE === 64 && DEAL_POOL_FALLBACK_SAMPLE > 24);

  const rules = [3, 7, 11, 50];
  const pool = buildDealPool(items, rules, has, { fallbackSample: 0 });
  check("pool is much smaller than the catalog", pool.length < items.length / 3);
  check("pool keeps original order", pool.every((v, i) => i === 0 || pool[i - 1] < v));
  check("no duplicates", new Set(pool).size === pool.length);

  // The exactness property, over every subset of the rules (any weekday/date).
  let allExact = true;
  for (let mask = 1; mask < 1 << rules.length; mask += 1) {
    const s = rules.filter((_, b) => mask & (1 << b));
    if (!same(firstN(pool, s, 64), firstN(items, s, 64))) allExact = false;
  }
  check("every active subset selects the same first 64 from the pool as from the catalog", allExact);

  check("no rules + no sample = empty", buildDealPool(items, [], has, { fallbackSample: 0 }).length === 0);
  const fb = buildDealPool(items, [], has);
  check("fallback sample size", fb.length === DEAL_POOL_FALLBACK_SAMPLE);
  check("fallback spans the catalog (first and late items)", fb[0] === 0 && fb[fb.length - 1] > 900);
  check("small catalog keeps everything", buildDealPool([1, 2, 3], [], () => false).length === 3);
  check("empty catalog is empty", buildDealPool([], rules, has).length === 0);
  check("perRule caps each rule", buildDealPool(items, [1], has, { perRule: 5, fallbackSample: 0 }).length === 5);
  check("a rule matching nothing adds nothing", buildDealPool(items, [5000], (i, k) => i === k, { fallbackSample: 0 }).length === 0);
  check("input is not mutated", items.length === 1000 && items[999] === 999);
  const p2 = buildDealPool(items, rules, has);
  check("sample + rules union stays ordered", p2.every((v, i) => i === 0 || p2[i - 1] < v));
  check("union contains every rule-only member", pool.every((v) => p2.includes(v)));

  return { passed, failed };
}
