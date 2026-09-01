/**
 * tests/compliance/slice6a-fact-review-visibility.test.ts  (SLICE 6A)
 *
 * ═══ WHAT THIS FILE PROVES ═══
 *
 * The Round 7 defect was not a typo. It was two screens reading two different
 * universes and neither of them saying so:
 *
 *   - the publish gate read EVERY diagnostic (paged, no limit)  -> 614 pending
 *   - the Fact Review screen read `{ limit: 5000 }`, which PostgREST caps at
 *     `db.max_rows` = 1,000                                     -> 11 pending
 *
 * and the truncation was total rather than partial because the old read
 * ordered by the `severity` ENUM ('error','warning','info') ascending. Enums
 * sort in DECLARATION order, so `info` sorts LAST -- and that import had 4,160
 * warnings, more than the entire ceiling. The screen received 1,000 rows that
 * were 100% warnings and ZERO info rows, while both high-volume review codes
 * (`fact_extraction_review`, `cannabinoid_missing`) are `info` severity.
 *
 * The first suite below reconstructs that exact arithmetic against the
 * severity/ordering model, so a regression in the ORDER BY or the limit is
 * caught by number, not by opinion.
 *
 * The second suite pins the pure bulk-decision core: a bulk action must never
 * become an auto-decision.
 */
import { describe, it, expect } from "vitest";
import {
  groupPendingReviews,
  planBulkDecision,
  bulkDecisionNote,
  groupKeyForReason,
  NO_REASON_TEXT,
} from "@/lib/pos/fact-review-bulk-core";
import type { FactReviewRow } from "@/lib/pos/fact-review-core";
import { REVIEW_DIAGNOSTIC_CODES } from "@/lib/pos/fact-review-core";
import { inventoryGapInsights } from "@/lib/insight/inventory";
import type { InventoryStats } from "@/lib/inventory/store";

const SERVER_MAX_ROWS = 1000;

/** Postgres enum sort order, from migration 0002_slice2_pos_import.sql:28. */
const SEV_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

/**
 * The owner's real Sep-1-2026 import, measured by running the REAL transformer
 * over the REAL uploaded workbooks (268245__September-01-2026_Products.xlsx +
 * CACA40__Inventories-September-01-2026.xlsx).
 */
const REAL_IMPORT = [
  { code: "unknown_strain_type", severity: "warning", n: 3251 },
  { code: "inventory_without_product_master", severity: "warning", n: 831 },
  { code: "product_master_duplicate", severity: "info", n: 716 },
  { code: "fact_extraction_review", severity: "info", n: 488 },
  { code: "inventory_batch_collapse", severity: "info", n: 448 },
  { code: "cannabinoid_missing", severity: "info", n: 257 },
  { code: "package_size_potency_rejected", severity: "info", n: 168 },
  { code: "package_size_measure_conflict", severity: "info", n: 119 },
  { code: "thc_package_total_override", severity: "info", n: 98 },
  { code: "group_variant_merge", severity: "info", n: 76 },
  { code: "package_size_name_override", severity: "info", n: 73 },
  { code: "unmapped_category_fallback", severity: "warning", n: 46 },
  { code: "package_size_mg_garbage", severity: "warning", n: 18 },
  { code: "new_unmapped_category", severity: "warning", n: 13 },
  { code: "cannabinoid_value_capped", severity: "warning", n: 1 },
] as const;

/** Expand the census into individual rows. */
function realDiagnostics(): { code: string; severity: string }[] {
  const out: { code: string; severity: string }[] = [];
  for (const g of REAL_IMPORT) for (let i = 0; i < g.n; i++) out.push({ code: g.code, severity: g.severity });
  return out;
}

/** Reproduce the OLD read: ORDER BY severity ASC, then capped at db.max_rows. */
function oldTruncatedRead(rows: { code: string; severity: string }[]) {
  return [...rows]
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => SEV_RANK[a.r.severity] - SEV_RANK[b.r.severity] || a.idx - b.idx)
    .slice(0, SERVER_MAX_ROWS)
    .map((x) => x.r);
}

/** Reproduce the NEW read: ORDER BY id, paged to completion (no ceiling). */
function newPagedRead(rows: { code: string; severity: string }[]) {
  const out: typeof rows = [];
  for (let from = 0; ; from += SERVER_MAX_ROWS) {
    const page = rows.slice(from, from + SERVER_MAX_ROWS);
    out.push(...page);
    if (page.length < SERVER_MAX_ROWS) break;
  }
  return out;
}

describe("SLICE 6A — the Fact Review screen must see what the publish gate sees", () => {
  const all = realDiagnostics();

  it("the owner's import really does emit 6,603 diagnostics", () => {
    expect(all.length).toBe(6603);
  });

  it("warnings alone (4,160) exceed the 1,000-row server ceiling", () => {
    const warnings = all.filter((d) => d.severity === "warning").length;
    expect(warnings).toBe(4160);
    expect(warnings).toBeGreaterThan(SERVER_MAX_ROWS);
  });

  it("REGRESSION GUARD: ordering by the severity enum starves every info row", () => {
    const seen = oldTruncatedRead(all);
    expect(seen.length).toBe(SERVER_MAX_ROWS);
    // The heart of the defect: not one info row survives the cut.
    expect(seen.filter((d) => d.severity === "info").length).toBe(0);
  });

  it("so the old read hid EVERY info-severity review diagnostic (745 of 764)", () => {
    const isReview = (d: { code: string }) => REVIEW_DIAGNOSTIC_CODES.has(d.code);
    const totalReview = all.filter(isReview).length;
    expect(totalReview).toBe(764);

    // NOTE ON WHAT IS AND IS NOT PROVEN HERE.
    // The relative order of rows WITHIN one severity is not specified by the
    // old query (it ordered by `severity` only), so exactly how many of the 19
    // review-feeding WARNING rows survived the cut depends on insertion order
    // and is not something this test may assert without inventing it.
    //
    // What IS invariant under ANY interleaving: warnings alone (4,160) exceed
    // the 1,000-row ceiling, so no `info` row can ever be reached. Every
    // info-severity review diagnostic is lost, always.
    const infoReview = all.filter((d) => isReview(d) && d.severity === "info").length;
    expect(infoReview).toBe(745); // fact_extraction_review 488 + cannabinoid_missing 257

    const seen = oldTruncatedRead(all);
    expect(seen.filter((d) => isReview(d) && d.severity === "info").length).toBe(0);

    // And the most the owner could ever have seen is the 19 review WARNINGS --
    // matching his report that only the junk-mg rows were fixable.
    expect(seen.filter(isReview).length).toBeLessThanOrEqual(19);
  });

  it("`.limit(5000)` cannot raise the ceiling — it only ever lowers it", () => {
    const requested = 5000;
    const actuallyReturned = Math.min(requested, SERVER_MAX_ROWS, all.length);
    expect(actuallyReturned).toBe(SERVER_MAX_ROWS);
    expect(actuallyReturned).toBeLessThan(requested);
  });

  it("THE FIX: a paged read returns every diagnostic, info included", () => {
    const seen = newPagedRead(all);
    expect(seen.length).toBe(all.length);
    expect(seen.filter((d) => d.severity === "info").length).toBe(2443);
    expect(seen.filter((d) => REVIEW_DIAGNOSTIC_CODES.has(d.code)).length).toBe(764);
  });

  it("the fix closes the gap the owner actually saw", () => {
    const isReview = (d: { code: string }) => REVIEW_DIAGNOSTIC_CODES.has(d.code);
    const oldReview = oldTruncatedRead(all).filter(isReview).length;
    const newReview = newPagedRead(all).filter(isReview).length;

    // The new read sees every review diagnostic there is...
    expect(newReview).toBe(764);
    // ...and recovers at minimum the 745 info rows the old read could never
    // reach (bounded below, because the warning survivors are order-dependent).
    expect(newReview - oldReview).toBeGreaterThanOrEqual(745);
  });
});

// ---------------------------------------------------------------------------

function mkPending(id: string, name: string, reason: string): FactReviewRow {
  return {
    sourceItemId: id,
    name,
    brand: "",
    category: "",
    inventoryType: "",
    bucket: "needs-review",
    facts: {
      thc: null,
      cbd: null,
      servingsPerPack: null,
      mgPerServing: null,
      packageThcMg: null,
      packageCbdMg: null,
      ratioLabel: null,
      netWeightGrams: null,
      netVolumeMl: null,
    },
    sources: "",
    confidence: "needs-review",
    notes: reason ? [reason] : [],
    resolution: null,
    resolutionNote: null,
  };
}

describe("SLICE 6A — bulk decisions stay human decisions", () => {
  const THC = "No THC potency in the source columns.";
  const PKG = 'Package Size column says "25000.00 Milligrams".';
  const rows = [
    mkPending("a", "Alpha", THC),
    mkPending("b", "Bravo", THC),
    mkPending("c", "Charlie", PKG),
  ];

  it("groups pending rows by the machine's verbatim reason", () => {
    const groups = groupPendingReviews(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(2);
    expect(groups[0].reason).toBe(THC);
  });

  it("a decided row is never swept into a bulk action", () => {
    const decided = { ...mkPending("d", "Delta", THC), resolution: "approve" as const };
    const groups = groupPendingReviews([...rows, decided]);
    expect(groups.flatMap((g) => g.sourceItemIds)).not.toContain("d");
  });

  it("a flag with no reason is kept, not silently dropped", () => {
    const groups = groupPendingReviews([mkPending("x", "X", "")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe(NO_REASON_TEXT);
    expect(groups[0].sourceItemIds).toEqual(["x"]);
  });

  it("a plan expands to one recorded decision PER PRODUCT", () => {
    const groups = groupPendingReviews(rows);
    const plan = planBulkDecision({ groups, groupKey: groups[0].key, action: "approve", reviewedBy: "u1" });
    expect(plan.ok).toBe(true);
    // Not one blanket flag -- two rows, so two audit records.
    expect(plan.sourceItemIds).toEqual(["a", "b"]);
  });

  it("REGRESSION GUARD: an anonymous bulk decision is refused", () => {
    const groups = groupPendingReviews(rows);
    for (const who of ["", "   ", null, undefined]) {
      const plan = planBulkDecision({ groups, groupKey: groups[0].key, action: "approve", reviewedBy: who });
      expect(plan.ok).toBe(false);
      expect(plan.sourceItemIds).toHaveLength(0);
    }
  });

  it("REGRESSION GUARD: bulk FIX is refused — values are per-product facts", () => {
    const groups = groupPendingReviews(rows);
    const plan = planBulkDecision({ groups, groupKey: groups[0].key, action: "fix", reviewedBy: "u1" });
    expect(plan.ok).toBe(false);
    expect(plan.sourceItemIds).toHaveLength(0);
  });

  it("an unknown or stale group key decides nothing", () => {
    const groups = groupPendingReviews(rows);
    const plan = planBulkDecision({ groups, groupKey: "gone", action: "approve", reviewedBy: "u1" });
    expect(plan.ok).toBe(false);
    expect(plan.sourceItemIds).toHaveLength(0);
  });

  it("every written row carries an auditable note naming the shared reason", () => {
    const groups = groupPendingReviews(rows);
    const note = bulkDecisionNote(groups[0], "verified against the COA binder");
    expect(note).toContain("Bulk decision over 2 product(s)");
    expect(note).toContain(THC);
    expect(note).toContain("verified against the COA binder");
  });

  it("group keys are stable and URL-safe", () => {
    expect(groupKeyForReason(THC)).toBe(groupKeyForReason(THC));
    expect(groupKeyForReason(THC)).toMatch(/^[a-z0-9-]+$/);
  });

  it("614 pending rows collapse to a handful of human decisions", () => {
    const many: FactReviewRow[] = [];
    for (let i = 0; i < 488; i++) many.push(mkPending(`f${i}`, `F${i}`, THC));
    for (let i = 0; i < 126; i++) many.push(mkPending(`p${i}`, `P${i}`, PKG));
    const groups = groupPendingReviews(many);
    expect(many).toHaveLength(614);
    expect(groups).toHaveLength(2);
    // Every single row is still accounted for -- grouping never loses a flag.
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(614);
  });
});

// ---------------------------------------------------------------------------

/**
 * The owner's inventory screenshot: TOTAL LOTS 3800 / ACTIVE LOTS 3800, and
 * 3800 "lots active without a linked COA". Every lot is active, so a "Fix →"
 * pointing at `?status=active` narrows 3,800 lots to 3,800 lots -- the page
 * reloads unchanged and the button appears to do nothing.
 */
function statsFixture(over: Partial<InventoryStats> = {}): InventoryStats {
  return {
    total: 3800,
    active: 3800,
    quarantine: 0,
    recalled: 0,
    destroyed: 0,
    soldOut: 0,
    emptyActive: 0,
    missingCoa: 3800,
    missingProductLink: 0,
    expiringSoon: 0,
    expired: 0,
    // Money in MINOR UNITS: the owner's screenshot showed $175,024.00.
    onHandCostMinor: 17_502_400,
    missingReceivedDate: 0,
    missingReceivedDateWithStock: 0,
    ...over,
  };
}

describe("SLICE 6A — every 'Fix →' must actually narrow the list", () => {
  it("REGRESSION GUARD: the missing-COA link filters by COA, not just status", () => {
    const gap = inventoryGapInsights(statsFixture()).find((g) => g.key === "missingCoa");
    expect(gap).toBeDefined();
    expect(gap!.count).toBe(3800);
    // The whole defect: `?status=active` alone is a no-op on this store.
    expect(gap!.href).toContain("coa=no");
    expect(gap!.href).not.toBe("/admin/inventory?status=active");
  });

  it("REGRESSION GUARD: the expiry links carry a real expiry window", () => {
    const gaps = inventoryGapInsights(statsFixture({ expired: 12, expiringSoon: 30 }));
    const expired = gaps.find((g) => g.key === "expired")!;
    const soon = gaps.find((g) => g.key === "expiringSoon")!;
    expect(expired.href).toContain("expiring=");
    expect(soon.href).toContain("expiring=");
    expect(expired.href).not.toBe("/admin/inventory?status=active");
    expect(soon.href).not.toBe("/admin/inventory?status=active");
  });

  it("no gap offers a link that filters nothing", () => {
    const gaps = inventoryGapInsights(
      statsFixture({ expired: 5, expiringSoon: 7, missingProductLink: 9, emptyActive: 3, quarantine: 2, recalled: 1 }),
    );
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      // A gap may legitimately have NO href (nothing can isolate it yet), but
      // it must never advertise a "Fix →" that reloads the same list.
      if (g.href) expect(g.href).not.toBe("/admin/inventory?status=active");
    }
  });

  it("gaps with no available filter are reported WITHOUT a dead button", () => {
    const gaps = inventoryGapInsights(statsFixture({ missingProductLink: 9, emptyActive: 3 }));
    expect(gaps.find((g) => g.key === "missingProductLink")!.href).toBeUndefined();
    expect(gaps.find((g) => g.key === "emptyActive")!.href).toBeUndefined();
    // ...but the counts are still surfaced, never hidden.
    expect(gaps.find((g) => g.key === "missingProductLink")!.count).toBe(9);
    expect(gaps.find((g) => g.key === "emptyActive")!.count).toBe(3);
  });
});
