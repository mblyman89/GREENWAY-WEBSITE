/**
 * src/lib/promotions/promo-blocker-fix-core.ts   (R74 S23, owner round 11)
 *
 * Owner, verbatim: "I also need a way to fix the issues the promotion builder
 * is saying it has with publishing the promotion."
 *
 * PURE helpers for the per-blocker fix controls on the promotion page. No I/O,
 * no React, no environment reads. S22 added "Hide from menu"; S23 adds the
 * three real fixes, each with the number that makes it work:
 *
 *  - Leave it out of THIS deal (a product exclusion on this promotion).
 *  - Never discount it (the global never-discount list, every deal).
 *  - Fix the price on the lot: the page shows the LOWEST regular price at
 *    which this deal's worst case still clears the cost floor, computed with
 *    the guard's own worst-case math (promo-guard-core), so the number shown
 *    is exactly the number the guard will accept.
 *
 * The cost on a lot comes from the manifest and is locked against hand edits
 * (lot-edit-core LOCKED_LOT_FIELDS); the page says so instead of offering a
 * cost box.
 */
import { worstCasePriceMinorUnits, type GuardRuleShape } from "./promo-guard-core";

/**
 * The lowest regular price (cents, tax-inclusive) at which this rule's worst
 * case is still at or above the floor. worstCasePriceMinorUnits is monotone
 * non-decreasing in the price, so a binary search finds the exact boundary.
 * Null when no price can clear it (a rule that can take 100% off) or when the
 * floor is unknown (0).
 */
export function minPriceToClearFloor(rule: GuardRuleShape, floorMinorUnits: number): number | null {
  if (!Number.isFinite(floorMinorUnits) || floorMinorUnits <= 0) return null;
  const clears = (p: number) => worstCasePriceMinorUnits(rule, p) >= floorMinorUnits;
  let hi = Math.max(floorMinorUnits, 1);
  let steps = 0;
  while (!clears(hi)) {
    hi *= 2;
    steps += 1;
    if (steps > 40) return null;
  }
  let lo = 0; // clears(0) is false because the floor is > 0
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (clears(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A percent deal's largest discount this product can take at its current price (whole percent, rounded down). */
export function maxSafePercent(priceMinorUnits: number, floorMinorUnits: number): number | null {
  if (!(priceMinorUnits > 0) || !(floorMinorUnits > 0)) return null;
  if (priceMinorUnits <= floorMinorUnits) return 0;
  // Guard math: Math.round(price * (1 - pct/100)) >= floor. Step down from the
  // algebraic bound until the rounded price clears (at most a step or two).
  let pct = Math.floor((1 - floorMinorUnits / priceMinorUnits) * 100);
  while (pct > 0 && Math.round(priceMinorUnits * (1 - pct / 100)) < floorMinorUnits) pct -= 1;
  return Math.max(0, pct);
}

export type ExclusionRule = { scope: string; value: string | null };

/** Product keys to add as exclusions on this promotion (not already excluded), in order. */
export function planProductExclusions(existing: ExclusionRule[], keys: string[]): string[] {
  const have = new Set(existing.filter((e) => e.scope === "product").map((e) => (e.value ?? "").trim()));
  const out: string[] = [];
  for (const raw of keys) {
    const k = (raw ?? "").trim();
    if (!k || have.has(k)) continue;
    have.add(k);
    out.push(k);
  }
  return out;
}

/** The reason stored on a never-discount entry added from a promotion page. */
export function neverDiscountReason(promoTitle: string): string {
  const t = (promoTitle ?? "").trim() || "a promotion";
  return `Added from the promotion page (${t}): a deal would put it below the cost of acquisition.`;
}

export type LotRef = { id: string; posProductKey: string; status: string; createdAt: string };

/**
 * The lot to open for "Fix price": prefer an active lot, newest first; else
 * the newest lot of any status. Null when the product has no lot.
 */
export function lotForPriceFix(lots: LotRef[], key: string): string | null {
  const mine = lots.filter((l) => l.posProductKey === key);
  if (mine.length === 0) return null;
  const newest = (a: LotRef, b: LotRef) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
  const active = mine.filter((l) => l.status === "active").sort(newest);
  return (active[0] ?? mine.sort(newest)[0]).id;
}

export type FixKind = "exclude" | "never";

export type FixOutcome = {
  kind: FixKind;
  done: { key: string; name: string }[];
  already: { key: string; name: string }[];
  failed: { key: string; name: string; error: string }[];
  stillBlocking: number;
};

/** The banner after an exclude / never-discount press. */
export function fixOutcomeMessage(o: FixOutcome): { tone: "ok" | "error"; text: string } {
  const names = (refs: { key: string; name: string }[]) =>
    refs.slice(0, 5).map((r) => r.name || r.key).join(", ") + (refs.length > 5 ? ` and ${refs.length - 5} more` : "");
  const verb = o.kind === "exclude" ? "Left out of this deal" : "Added to never discount";
  const parts: string[] = [];
  if (o.done.length > 0) parts.push(`${verb}: ${names(o.done)}.`);
  if (o.already.length > 0) {
    parts.push(`${o.kind === "exclude" ? "Already left out" : "Already on never discount"}: ${names(o.already)}.`);
  }
  if (o.failed.length > 0) {
    parts.push(
      `Could not change ${o.failed.length}: ` +
        o.failed.slice(0, 3).map((f) => `${f.name || f.key} (${f.error})`).join("; ") +
        (o.failed.length > 3 ? ` and ${o.failed.length - 3} more` : "") +
        ".",
    );
  }
  parts.push(
    o.stillBlocking > 0
      ? `${o.stillBlocking} product${o.stillBlocking === 1 ? " still blocks" : "s still block"} publishing.`
      : "Nothing blocks publishing now: press Publish (go live).",
  );
  parts.push(
    o.kind === "exclude"
      ? "Undo: Specific products, Exclude list, on this page."
      : "Undo: Promotions, Never discount list.",
  );
  return { tone: o.failed.length > 0 ? "error" : "ok", text: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPromoBlockerFixCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL promo-blocker-fix-core: ${name}`);
    }
  };
  const rule = (over: Partial<GuardRuleShape>): GuardRuleShape => ({
    discountType: "percent",
    discountPercent: 30,
    discountFixed: 0,
    config: {},
    ...over,
  });

  // minPriceToClearFloor
  {
    const r = rule({});
    const p = minPriceToClearFloor(r, 1640)!;
    ok(worstCasePriceMinorUnits(r, p) >= 1640, "min price clears the floor");
    ok(worstCasePriceMinorUnits(r, p - 1) < 1640, "one cent less does not");
    ok(p === 2343, "30% off: 1640 / 0.7 rounded the guard's way = 2343");
    const f = rule({ discountType: "fixed", discountFixed: 500 });
    ok(minPriceToClearFloor(f, 1000) === 1500, "fixed $5 off: floor + 5 dollars");
    ok(minPriceToClearFloor(r, 0) === null, "unknown floor -> null");
    ok(minPriceToClearFloor(r, Number.NaN) === null, "NaN floor -> null");
    const big = minPriceToClearFloor(rule({ discountPercent: 99 }), 100000)!;
    ok(big > 0 && worstCasePriceMinorUnits(rule({ discountPercent: 99 }), big) >= 100000, "99% off still finds a price");
    ok(minPriceToClearFloor(rule({ discountPercent: 0 }), 1234) === 1234, "no discount: the floor itself");
    ok(minPriceToClearFloor(r, 1) === 1 || minPriceToClearFloor(r, 1) === 2, "tiny floor");
  }

  // maxSafePercent
  {
    ok(maxSafePercent(2000, 1640) === 18, "20.00 over a 16.40 floor -> 18% max");
    ok(Math.round(2000 * (1 - 18 / 100)) >= 1640 && Math.round(2000 * (1 - 19 / 100)) < 1640, "18 clears, 19 does not");
    ok(maxSafePercent(1000, 1000) === 0, "price at floor -> 0%");
    ok(maxSafePercent(900, 1000) === 0, "price below floor -> 0%");
    ok(maxSafePercent(0, 1000) === null, "no price -> null");
    ok(maxSafePercent(1000, 0) === null, "no floor -> null");
    ok(maxSafePercent(10000, 5000) === 50, "exact half");
  }

  // planProductExclusions
  {
    const ex = [
      { scope: "product", value: "a" },
      { scope: "brand", value: "b" },
    ];
    const add = planProductExclusions(ex, ["a", "b", " c ", "c", "", "d"]);
    ok(add.join() === "b,c,d", "skips already-excluded products, dedupes, trims; a brand exclusion does not count");
    ok(planProductExclusions([], []).length === 0, "nothing to add");
  }

  // neverDiscountReason
  {
    ok(neverDiscountReason("Wax Wednesday").includes("(Wax Wednesday)"), "reason names the promotion");
    ok(neverDiscountReason("").includes("(a promotion)"), "blank title");
  }

  // lotForPriceFix
  {
    const lots: LotRef[] = [
      { id: "old-active", posProductKey: "k", status: "active", createdAt: "2026-01-01" },
      { id: "new-active", posProductKey: "k", status: "active", createdAt: "2026-03-01" },
      { id: "newest-sold", posProductKey: "k", status: "sold_out", createdAt: "2026-05-01" },
      { id: "other", posProductKey: "z", status: "active", createdAt: "2026-06-01" },
      { id: "z-sold", posProductKey: "y", status: "sold_out", createdAt: "2026-01-01" },
      { id: "y-new", posProductKey: "y", status: "quarantine", createdAt: "2026-02-01" },
    ];
    ok(lotForPriceFix(lots, "k") === "new-active", "newest active lot wins over a newer sold-out one");
    ok(lotForPriceFix(lots, "y") === "y-new", "no active lot: newest of any status");
    ok(lotForPriceFix(lots, "none") === null, "no lot -> null");
  }

  // fixOutcomeMessage
  {
    const A = { key: "a", name: "Alpha" };
    const m1 = fixOutcomeMessage({ kind: "exclude", done: [A], already: [], failed: [], stillBlocking: 0 });
    ok(m1.tone === "ok" && m1.text.startsWith("Left out of this deal: Alpha."), "exclude names it");
    ok(m1.text.includes("Nothing blocks publishing now") && m1.text.includes("Exclude list"), "publish + undo");
    const m2 = fixOutcomeMessage({ kind: "never", done: [], already: [A], failed: [{ key: "b", name: "", error: "x" }], stillBlocking: 2 });
    ok(m2.tone === "error", "failure is an error");
    ok(m2.text.includes("Already on never discount: Alpha.") && m2.text.includes("Could not change 1: b (x)."), "already + failure");
    ok(m2.text.includes("2 products still block publishing.") && m2.text.includes("Never discount list"), "still + undo");
    const many = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, name: `P${i}` }));
    ok(fixOutcomeMessage({ kind: "never", done: many, already: [], failed: [], stillBlocking: 1 }).text.includes("P4 and 1 more") , "long list shortened");
    ok(fixOutcomeMessage({ kind: "never", done: many, already: [], failed: [], stillBlocking: 1 }).text.includes("1 product still blocks"), "singular still");
  }

  return { passed, failed };
}
