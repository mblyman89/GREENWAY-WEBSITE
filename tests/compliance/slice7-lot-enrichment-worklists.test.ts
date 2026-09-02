/**
 * SLICE 7 — lot enrichment worklists + the two gaps that could not be clicked.
 *
 * THE DEFECT THIS SLICE CLOSES
 * SLICE 6A found that a "Fix →" button could narrow nothing: on the owner's
 * store every lot is `active`, so a link to `?status=active` filtered 3,800
 * lots down to 3,800 lots. Two gaps (`missingProductLink`, `emptyActive`) were
 * therefore shipped WITHOUT a link, and real filters were named as a follow-up.
 * This slice builds those filters, adds two counters that never existed, and
 * makes the on-hand cost total disclose what it had to skip.
 *
 * THE CENTREPIECE TEST
 * A count and its filter are two expressions of one predicate. If they drift,
 * the badge lies about the list. So the suite below applies the store's REAL
 * PostgREST predicates (through a simulator with PostgREST's own semantics) and
 * the pure core's `matches()` to the SAME generated rows, and asserts they
 * select exactly the same lots — including the edge cases that make the naive
 * fix wrong (empty-string keys, negative quantities, a deliberate 0 cost).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LOT_GAP_DEFINITIONS,
  lotGapDefinition,
  lotGapHref,
  countLotGaps,
  computeOnHandCost,
  describeCostIncompleteness,
  parseGapFlag,
  isActive,
  hasNoProductLink,
  isEmptyOnHand,
  hasNoExpiry,
  hasUnknownCost,
  __runLotGapCoreTests,
  type LotGapRow,
  type LotGapKey,
} from "@/lib/inventory/lot-gap-core";
import { inventoryGapInsights } from "@/lib/insight/inventory";
import type { InventoryStats } from "@/lib/inventory/store";

const SRC = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/* ── A PostgREST predicate simulator ──────────────────────────────────────
 * Mirrors the operators the store actually uses, with PostgREST's semantics:
 *   .eq(col, v)      → col = v
 *   .is(col, null)   → col IS NULL          (NOT the same as eq('') )
 *   .lte(col, n)     → col <= n
 *   .or("a,b")       → logical OR of the listed predicates
 * Building this (rather than asserting on strings) is what makes the
 * equivalence test real: it evaluates the SAME operators against rows.
 */
type Pred = (row: LotGapRow) => boolean;

function queryFor(key: LotGapKey): Pred {
  const preds: Pred[] = [];
  // Every gap filter starts scoped to active — matching the counter's guard.
  preds.push((r) => r.status === "active");

  if (key === "missingProductLink") {
    // .or("pos_product_key.is.null,pos_product_key.eq.")
    preds.push((r) => r.pos_product_key === null || r.pos_product_key === "");
  } else if (key === "emptyActive") {
    preds.push((r) => (r.on_hand_qty ?? 0) <= 0); // .lte("on_hand_qty", 0)
  } else if (key === "missingExpiry") {
    preds.push((r) => r.expires_on === null); // .is("expires_on", null)
  } else if (key === "unknownCost") {
    preds.push((r) => r.unit_cost_minor_units === null); // .is(...)
  }
  return (row) => preds.every((p) => p(row));
}

/** A deliberately nasty cross-product of every edge case that matters. */
function generateRows(): LotGapRow[] {
  const statuses = ["active", "quarantine", "recalled", "destroyed", "sold_out", null];
  const keys = ["KEY-1", "", null];
  const qtys = [10, 1, 0, -5, null];
  const expiries = ["2027-01-01", null];
  const costs = [500, 0, null];

  const rows: LotGapRow[] = [];
  for (const status of statuses) {
    for (const pos_product_key of keys) {
      for (const on_hand_qty of qtys) {
        for (const expires_on of expiries) {
          for (const unit_cost_minor_units of costs) {
            rows.push({
              status,
              on_hand_qty,
              unit_cost_minor_units,
              lab_result_id: "lab-1",
              pos_product_key,
              expires_on,
            });
          }
        }
      }
    }
  }
  return rows;
}

function statsFixture(over: Partial<InventoryStats> = {}): InventoryStats {
  return {
    total: 3800,
    active: 3800,
    quarantine: 0,
    recalled: 0,
    destroyed: 0,
    soldOut: 0,
    emptyActive: 0,
    missingCoa: 0,
    missingProductLink: 0,
    expiringSoon: 0,
    expired: 0,
    missingExpiry: 0,
    unknownCost: 0,
    onHandCostMinor: 17_502_400,
    costSkippedUnknown: 0,
    missingReceivedDate: 0,
    missingReceivedDateWithStock: 0,
    ...over,
  };
}

describe("SLICE 7 — lot enrichment worklists", () => {
  it("passes the embedded pure self-tests", () => {
    expect(__runLotGapCoreTests()).toContain("all assertions passed");
  });

  /* ── THE ANTI-DRIFT PIN ────────────────────────────────────────────────── */
  describe("the badge and the list are ONE predicate, not two", () => {
    const rows = generateRows();

    it("generates a fixture that actually exercises the edge cases", () => {
      // Non-vacuous: prove the corpus contains the rows that break naive fixes.
      expect(rows.length).toBeGreaterThan(200);
      expect(rows.some((r) => r.pos_product_key === "")).toBe(true);
      expect(rows.some((r) => (r.on_hand_qty ?? 0) < 0)).toBe(true);
      expect(rows.some((r) => r.unit_cost_minor_units === 0)).toBe(true);
      expect(rows.some((r) => r.status !== "active")).toBe(true);
    });

    for (const def of LOT_GAP_DEFINITIONS) {
      it(`${def.key}: the store's filter selects exactly what the counter counts`, () => {
        const byFilter = rows.filter(queryFor(def.key));
        const byCounter = rows.filter((r) => def.matches(r));

        expect(byFilter).toEqual(byCounter);
        // And it must actually select SOMETHING, or the test proves nothing.
        expect(byFilter.length).toBeGreaterThan(0);
        // The count surfaced to the owner equals the size of the filtered list.
        expect(countLotGaps(rows)[def.key]).toBe(byFilter.length);
      });
    }

    it("REGRESSION GUARD: a naive `is null` key filter would UNDER-select", () => {
      // This is why the fix is `.or(is.null, eq.'')` and not `.is(null)`.
      // If someone 'simplifies' it later, this documents the cost.
      const naive = rows.filter((r) => r.status === "active" && r.pos_product_key === null);
      const correct = rows.filter(queryFor("missingProductLink"));
      expect(naive.length).toBeLessThan(correct.length);
    });

    it("REGRESSION GUARD: a naive `= 0` qty filter would miss negatives", () => {
      const naive = rows.filter((r) => r.status === "active" && r.on_hand_qty === 0);
      const correct = rows.filter(queryFor("emptyActive"));
      expect(naive.length).toBeLessThan(correct.length);
    });

    it("a deliberate ZERO cost is a KNOWN cost, never an 'unknown cost' gap", () => {
      // Free samples are legitimately 0. Flagging them would train the owner to
      // ignore the worklist.
      const zeroCost: LotGapRow = {
        status: "active",
        on_hand_qty: 5,
        unit_cost_minor_units: 0,
        lab_result_id: "l",
        pos_product_key: "K",
        expires_on: "2027-01-01",
      };
      expect(hasUnknownCost(zeroCost)).toBe(false);
      expect(countLotGaps([zeroCost]).unknownCost).toBe(0);
    });
  });

  /* ── The gaps that previously had no link ──────────────────────────────── */
  describe("every gap now offers a link that really narrows", () => {
    it("no href is a bare status filter (the SLICE 6A defect)", () => {
      for (const def of LOT_GAP_DEFINITIONS) {
        const href = lotGapHref(def.key);
        expect(href).not.toBe("/admin/inventory?status=active");
        expect(href).toContain(`${def.param}=1`);
      }
    });

    it("the two formerly link-less gaps are the ones SLICE 6A named", () => {
      const keys = LOT_GAP_DEFINITIONS.map((d) => d.key);
      expect(keys).toContain("missingProductLink");
      expect(keys).toContain("emptyActive");
    });

    it("inventoryGapInsights emits a working href for all four gaps", () => {
      const gaps = inventoryGapInsights(
        statsFixture({ missingProductLink: 9, emptyActive: 3, missingExpiry: 7, unknownCost: 4 }),
      );
      for (const key of ["missingProductLink", "emptyActive", "missingExpiry", "unknownCost"]) {
        const g = gaps.find((x) => x.key === key);
        expect(g, `gap ${key} missing`).toBeDefined();
        expect(g!.href, `gap ${key} has no href`).toBeDefined();
        expect(g!.href).toContain("=1");
      }
    });

    it("a gap with a zero count is not shown at all", () => {
      const gaps = inventoryGapInsights(statsFixture());
      for (const key of ["missingProductLink", "emptyActive", "missingExpiry", "unknownCost"]) {
        expect(gaps.find((x) => x.key === key)).toBeUndefined();
      }
    });
  });

  /* ── The two counters that never existed ───────────────────────────────── */
  describe("gaps that used to be counted by nothing", () => {
    it("a lot with NO expiry date is now counted", () => {
      // Before SLICE 7 the stats loop read `if (r.expires_on)`, so this row
      // was neither `expired` nor `expiringSoon` — it reached no tile at all.
      const row: LotGapRow = {
        status: "active",
        on_hand_qty: 5,
        unit_cost_minor_units: 100,
        lab_result_id: "l",
        pos_product_key: "K",
        expires_on: null,
      };
      expect(hasNoExpiry(row)).toBe(true);
      expect(countLotGaps([row]).missingExpiry).toBe(1);
    });

    it("a lot with NO unit cost is now counted", () => {
      const row: LotGapRow = {
        status: "active",
        on_hand_qty: 5,
        unit_cost_minor_units: null,
        lab_result_id: "l",
        pos_product_key: "K",
        expires_on: "2027-01-01",
      };
      expect(countLotGaps([row]).unknownCost).toBe(1);
    });

    it("only ACTIVE lots are chased — destroyed paperwork is not busywork", () => {
      for (const status of ["quarantine", "recalled", "destroyed", "sold_out"]) {
        const row: LotGapRow = {
          status,
          on_hand_qty: 0,
          unit_cost_minor_units: null,
          lab_result_id: null,
          pos_product_key: null,
          expires_on: null,
        };
        expect(isActive(row)).toBe(false);
        const counts = countLotGaps([row]);
        expect(counts.missingProductLink + counts.emptyActive + counts.missingExpiry + counts.unknownCost).toBe(0);
      }
    });
  });

  /* ── The honest on-hand total ──────────────────────────────────────────── */
  describe("on-hand cost tells the truth about what it could not include", () => {
    it("the total is unchanged for fully-costed stock", () => {
      const rows: LotGapRow[] = [
        { status: "active", on_hand_qty: 2, unit_cost_minor_units: 150, lab_result_id: null, pos_product_key: "A", expires_on: null },
        { status: "active", on_hand_qty: 3, unit_cost_minor_units: 100, lab_result_id: null, pos_product_key: "B", expires_on: null },
      ];
      const cost = computeOnHandCost(rows);
      expect(cost.totalMinor).toBe(600); // money in MINOR UNITS
      expect(cost.complete).toBe(true);
      expect(describeCostIncompleteness(cost.skippedUnknownCost)).toBeNull();
    });

    it("an UNCOSTED in-stock lot is reported, not silently dropped", () => {
      const rows: LotGapRow[] = [
        { status: "active", on_hand_qty: 2, unit_cost_minor_units: 150, lab_result_id: null, pos_product_key: "A", expires_on: null },
        { status: "active", on_hand_qty: 9, unit_cost_minor_units: null, lab_result_id: null, pos_product_key: "B", expires_on: null },
      ];
      const cost = computeOnHandCost(rows);
      expect(cost.totalMinor).toBe(300);
      expect(cost.skippedUnknownCost).toBe(1);
      expect(cost.complete).toBe(false);
      const msg = describeCostIncompleteness(cost.skippedUnknownCost)!;
      expect(msg).toContain("Understated");
      expect(msg).toContain("1");
    });

    it("an uncosted lot with NO stock does not inflate the warning", () => {
      // It contributes 0 either way, so flagging it would be noise.
      const rows: LotGapRow[] = [
        { status: "active", on_hand_qty: 0, unit_cost_minor_units: null, lab_result_id: null, pos_product_key: "A", expires_on: null },
      ];
      const cost = computeOnHandCost(rows);
      expect(cost.skippedUnknownCost).toBe(0);
      expect(cost.complete).toBe(true);
    });

    it("money stays in MINOR UNITS and never goes floating-point", () => {
      const rows: LotGapRow[] = [
        { status: "active", on_hand_qty: 3, unit_cost_minor_units: 333, lab_result_id: null, pos_product_key: "A", expires_on: null },
      ];
      const total = computeOnHandCost(rows).totalMinor;
      expect(Number.isInteger(total)).toBe(true);
      expect(total).toBe(999);
    });
  });

  /* ── Filter grammar: junk never throws ─────────────────────────────────── */
  describe("knob grammar matches the rest of the page", () => {
    it("only the literal '1' switches a filter on", () => {
      expect(parseGapFlag("1")).toBe(true);
      for (const junk of ["0", "yes", "true", "", " 1", "01", undefined, null]) {
        expect(parseGapFlag(junk as string | undefined)).toBeUndefined();
      }
    });

    it("an unknown gap key throws rather than silently filtering wrong", () => {
      expect(() => lotGapDefinition("nope" as LotGapKey)).toThrow();
    });
  });

  /* ── WIRING PINS ───────────────────────────────────────────────────────────
   * SLICE 5C learned this the hard way: a correct core that nothing calls is
   * not a fix. Sabotage 6 there (hardcoding a completeness flag) passed the
   * entire suite because only the core was tested, never the wiring. These
   * pins assert the fixes are actually PLUGGED IN at the source level.
   */
  describe("the fixes are actually WIRED, not just available", () => {
    it("the store counts gaps via the shared core, not a hand-written copy", () => {
      const src = SRC("src/lib/inventory/store.ts");
      expect(src).toContain("countLotGaps(rows)");
      expect(src).toContain("stats.missingExpiry = gapCounts.missingExpiry");
      expect(src).toContain("stats.unknownCost = gapCounts.unknownCost");
      // The old hand-written predicates must be GONE, or they can drift again.
      expect(src).not.toContain("if (!r.pos_product_key) stats.missingProductLink");
      expect(src).not.toContain("if (!r.on_hand_qty || r.on_hand_qty <= 0) stats.emptyActive");
    });

    it("the store computes on-hand cost via the shared core", () => {
      const src = SRC("src/lib/inventory/store.ts");
      expect(src).toContain("computeOnHandCost(rows)");
      expect(src).toContain("stats.costSkippedUnknown = cost.skippedUnknownCost");
      // The old inline accumulation must not survive alongside it.
      expect(src).not.toContain("stats.onHandCostMinor += Math.round(");
    });

    it("the store applies a real predicate for every gap knob", () => {
      const src = SRC("src/lib/inventory/store.ts");
      expect(src).toContain("for (const key of opts.gaps ?? [])");
      expect(src).toContain('query.or("pos_product_key.is.null,pos_product_key.eq.")');
      expect(src).toContain('query.lte("on_hand_qty", 0)');
      expect(src).toContain('query.is("expires_on", null)');
      expect(src).toContain('query.is("unit_cost_minor_units", null)');
    });

    it("the page parses the knobs and passes them to the store", () => {
      const src = SRC("src/app/admin/inventory/page.tsx");
      expect(src).toContain("parseGapFlag");
      expect(src).toContain("gaps: activeGaps");
    });

    it("the page discloses an understated on-hand total", () => {
      const src = SRC("src/app/admin/inventory/page.tsx");
      expect(src).toContain("describeCostIncompleteness(stats.costSkippedUnknown)");
    });

    it("the insight panel derives hrefs from the core, not string literals", () => {
      const src = SRC("src/lib/insight/inventory.ts");
      expect(src).toContain("lotGapHref(def.key)");
      expect(src).toContain("LOT_GAP_DEFINITIONS");
    });

    it("the pure core is registered in the self-test sweep", () => {
      const src = SRC("scripts/compliance/run-pure-selftests.ts");
      expect(src).toContain("__runLotGapCoreTests");
      expect(src).toContain("console.log(__runLotGapCoreTests());");
    });

    it("missingExpiry actually reaches the Needs-attention tile", () => {
      const src = SRC("src/app/admin/inventory/page.tsx");
      expect(src).toContain("stats.missingExpiry");
    });
  });

  /* ── Predicate unit checks ─────────────────────────────────────────────── */
  describe("individual predicates", () => {
    it("hasNoProductLink treats null AND empty string as missing", () => {
      const base = { status: "active", on_hand_qty: 1, unit_cost_minor_units: 1, lab_result_id: null, expires_on: null };
      expect(hasNoProductLink({ ...base, pos_product_key: null })).toBe(true);
      expect(hasNoProductLink({ ...base, pos_product_key: "" })).toBe(true);
      expect(hasNoProductLink({ ...base, pos_product_key: "K" })).toBe(false);
    });

    it("isEmptyOnHand covers zero, negative and null", () => {
      const base = { status: "active", unit_cost_minor_units: 1, lab_result_id: null, pos_product_key: "K", expires_on: null };
      expect(isEmptyOnHand({ ...base, on_hand_qty: 0 })).toBe(true);
      expect(isEmptyOnHand({ ...base, on_hand_qty: -1 })).toBe(true);
      expect(isEmptyOnHand({ ...base, on_hand_qty: null })).toBe(true);
      expect(isEmptyOnHand({ ...base, on_hand_qty: 0.5 })).toBe(false);
    });
  });
});
