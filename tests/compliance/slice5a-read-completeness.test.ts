/**
 * tests/compliance/slice5a-read-completeness.test.ts  (SLICE 5A)
 *
 * SLICE 5A closes a fail-OPEN in the two reads that protect the register:
 *
 *   1. `recalledProductKeys()` — the statutory sale stop. Called with
 *      `failClosed: true` by runCompletionGate (completion-gate.ts:103).
 *      It used `.limit(5000)` and only checked `if (error) throw`. PostgREST
 *      caps a response at db.max_rows (1000) and a capped read sets NO error,
 *      so past 1,000 recalled lots a recalled product could COMPLETE A SALE.
 *
 *   2. `loadProductCosts()` — the acquisition-cost floor. It used
 *      `.limit(10000)`. A key missing from the cost map gets floor 0
 *      (discount-engine-core.ts:226), and `atCostFloor: floor > 0 && …`
 *      (discount-engine-core.ts:592) then never binds — truncation silently
 *      switched OFF below-cost protection.
 *
 * These tests assert on the SOURCE of the shipped modules (no live DB in CI)
 * plus the real behaviour of the pure core and the paging helper under a
 * simulated 1,000-row server cap.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  POSTGREST_DEFAULT_MAX_ROWS,
  usableCount,
  wouldTruncate,
  evaluateReadCompleteness,
  __runReadCompletenessCoreTests,
} from "@/lib/supabase/read-completeness-core";
import { pagedAllChecked, __runChunkedInTests } from "@/lib/supabase/chunked-in";

const ROOT = process.cwd();

/** Read a source file with comments stripped, so doc-prose cannot pass a test. */
function readCode(rel: string): string {
  const raw = readFileSync(join(ROOT, rel), "utf-8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const SERVER_CAP = POSTGREST_DEFAULT_MAX_ROWS;

describe("SLICE 5A — the pure core", () => {
  it("runs its embedded self-tests", async () => {
    await expect(__runReadCompletenessCoreTests()).resolves.toBeUndefined();
  });

  it("keeps chunked-in's own self-tests green", async () => {
    await expect(__runChunkedInTests()).resolves.toBeUndefined();
  });

  it("knows 1,775 vendors exceed the 1,000-row cap (the live bug)", () => {
    // docs/ROADMAP_VENDORS_AND_KB_ENRICHMENT.md:30 — live PostgREST count.
    expect(wouldTruncate(1775)).toBe(true);
    expect(wouldTruncate(1000)).toBe(false);
  });

  it("knows 4,179 inventory lots exceed the cap", () => {
    expect(wouldTruncate(4179)).toBe(true);
  });

  it("never coerces an unusable count to zero", () => {
    expect(usableCount(0)).toBe(true); // zero is a real answer
    expect(usableCount(null)).toBe(false);
    expect(usableCount(NaN)).toBe(false);
    expect(usableCount(-1)).toBe(false);
    expect(usableCount("1000")).toBe(false);
  });

  it("treats a genuinely empty table as COMPLETE, not as a failure", () => {
    const v = evaluateReadCompleteness({ rowsRead: 0, pagesFetched: 1, pageSize: 1000 });
    expect(v.complete).toBe(true);
    expect(v.reason).toBe("complete");
  });

  it("treats empty-because-failed as INCOMPLETE", () => {
    const v = evaluateReadCompleteness({
      rowsRead: 0,
      pagesFetched: 1,
      pageSize: 1000,
      readFailed: true,
    });
    expect(v.complete).toBe(false);
    expect(v.reason).toBe("read_failed");
  });

  it("lets an observed error outrank matching arithmetic", () => {
    const v = evaluateReadCompleteness({
      rowsRead: 500,
      pagesFetched: 1,
      pageSize: 1000,
      readFailed: true,
      expectedTotal: 500,
    });
    expect(v.complete).toBe(false);
  });

  it("uses a COUNT witness to catch a silent truncation", () => {
    const v = evaluateReadCompleteness({
      rowsRead: 1000,
      pagesFetched: 1,
      pageSize: 1000,
      expectedTotal: 1775,
    });
    expect(v.complete).toBe(false);
    expect(v.missing).toBe(775);
  });

  it("treats reading MORE than the witness as benign", () => {
    const v = evaluateReadCompleteness({
      rowsRead: 1776,
      pagesFetched: 2,
      pageSize: 1000,
      expectedTotal: 1775,
    });
    expect(v.complete).toBe(true);
  });
});

describe("SLICE 5A — pagedAllChecked under a simulated server cap", () => {
  it("returns all 4,179 lots despite a 1,000-row cap", async () => {
    const lots = Array.from({ length: 4179 }, (_, i) => ({ i }));
    const res = await pagedAllChecked<{ i: number }>(async (from, to) => ({
      rows: lots.slice(from, to + 1).slice(0, SERVER_CAP),
      ok: true,
    }));
    expect(res.rows).toHaveLength(4179);
    expect(res.verdict.complete).toBe(true);
  });

  it("REPORTS a mid-read failure instead of impersonating end-of-data", async () => {
    const lots = Array.from({ length: 4179 }, (_, i) => ({ i }));
    let call = 0;
    const res = await pagedAllChecked<{ i: number }>(async (from, to) => {
      call++;
      if (call === 2) return { rows: [], ok: false };
      return { rows: lots.slice(from, to + 1).slice(0, SERVER_CAP), ok: true };
    });
    expect(res.rows).toHaveLength(1000);
    expect(res.verdict.complete).toBe(false);
    expect(res.verdict.reason).toBe("read_failed");
  });

  it("reports the safety ceiling rather than silently accepting it", async () => {
    const many = Array.from({ length: 9000 }, (_, i) => ({ i }));
    const res = await pagedAllChecked<{ i: number }>(
      async (from, to) => ({ rows: many.slice(from, to + 1).slice(0, SERVER_CAP), ok: true }),
      { maxRows: 3000 },
    );
    expect(res.verdict.complete).toBe(false);
    expect(res.verdict.reason).toBe("limit_reached");
  });

  it("preserves every row exactly once across pages", async () => {
    const lots = Array.from({ length: 2345 }, (_, i) => ({ i }));
    const res = await pagedAllChecked<{ i: number }>(async (from, to) => ({
      rows: lots.slice(from, to + 1).slice(0, SERVER_CAP),
      ok: true,
    }));
    const sum = res.rows.reduce((a, r) => a + r.i, 0);
    expect(sum).toBe((2344 * 2345) / 2);
  });
});

describe("SLICE 5A — recall-hold-store is the statutory fail-CLOSED read", () => {
  const code = readCode("src/lib/pos/recall-hold-store.ts");

  it("no longer uses a bare .limit() that PostgREST would silently cap", () => {
    expect(code).not.toMatch(/\.limit\(\s*5000\s*\)/);
    expect(code).not.toMatch(/\.limit\(\s*\d{4,}\s*\)/);
  });

  it("pages the read", () => {
    expect(code).toContain("pagedAllChecked");
    expect(code).toContain(".range(from, to)");
  });

  it("orders by a UNIQUE column so paging is deterministic", () => {
    // Without this, WHICH 1,000 recalled lots come back is arbitrary.
    expect(code).toMatch(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  it("takes an independent server-side COUNT witness", () => {
    // count:"exact",head:true returns a NUMBER, so it is immune to db.max_rows.
    expect(code).toMatch(/count:\s*"exact",\s*head:\s*true/);
  });

  it("THROWS on an incomplete read, not merely on an error", () => {
    // This is the fail-closed promise the old code could not keep.
    expect(code).toMatch(/if\s*\(\s*!verdict\.complete\s*\)/);
    expect(code).toMatch(/throw new Error\(`inventory_lots recall query incomplete/);
  });

  it("still preserves the advisory/statutory asymmetry", () => {
    // Advisory callers must keep degrading softly — an outage must never
    // blank every register (recall-hold-store.ts:8-10).
    expect(code).toMatch(/if\s*\(\s*opts\?\.failClosed\s*\)\s*throw e;/);
    expect(code).toMatch(/return new Set\(\);/);
  });

  it("never coerces a failed COUNT to zero", () => {
    // Coercing to 0 would fabricate agreement with an empty read.
    expect(code).toMatch(/let expectedTotal: number \| null = null/);
    expect(code).toMatch(/typeof count === "number"/);
  });

  it("keeps filtering on the recalled status only", () => {
    // quarantine is routine and must NOT hold a product (recall-hold-core.ts:18-26).
    expect(code).toMatch(/\.eq\("status",\s*HOLD_LOT_STATUS\)/);
  });
});

describe("SLICE 5A — the acquisition-cost floor reads every costed lot", () => {
  const code = readCode("src/lib/promotions/discount-engine.ts");

  it("no longer uses .limit(10000)", () => {
    expect(code).not.toMatch(/\.limit\(\s*10000\s*\)/);
  });

  it("pages with a stable unique order", () => {
    expect(code).toContain("pagedAllChecked");
    expect(code).toMatch(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/);
    expect(code).toContain(".range(from, to)");
  });

  it("still filters out lots with no key or no cost", () => {
    expect(code).toMatch(/\.not\("pos_product_key",\s*"is",\s*null\)/);
    expect(code).toMatch(/\.not\("unit_cost_minor_units",\s*"is",\s*null\)/);
  });

  it("keeps loadProductCosts()'s original signature for its 7 callers", () => {
    expect(code).toMatch(/export async function loadProductCosts\(\): Promise<Map<string, number>>/);
    expect(code).toContain("loadProductCostsChecked()).costs");
  });

  it("exposes a checked variant that reports completeness", () => {
    expect(code).toMatch(/export async function loadProductCostsChecked\(\)/);
    expect(code).toContain("ReadCompletenessVerdict");
  });

  it("does not treat an unconfigured database as a read failure", () => {
    // Dev/build contexts have no DB; that must not look like truncation.
    expect(code).toMatch(/if\s*\(!isSupabaseServiceConfigured\)/);
  });
});

describe("SLICE 5A — the weighted-average cost math is unchanged", () => {
  /**
   * Mirrors discount-engine.ts loadProductCostsChecked() exactly, so a
   * regression in the aggregation shows up here rather than in live pricing.
   */
  function weightedAverage(
    rows: { pos_product_key: string | null; received_qty: number | null; unit_cost_minor_units: number | null }[],
  ): Map<string, number> {
    const costs = new Map<string, number>();
    const num = new Map<string, number>();
    const den = new Map<string, number>();
    for (const row of rows) {
      const key = row.pos_product_key;
      if (!key || row.unit_cost_minor_units == null) continue;
      const qty = Math.max(1, Math.round(row.received_qty ?? 1));
      num.set(key, (num.get(key) ?? 0) + row.unit_cost_minor_units * qty);
      den.set(key, (den.get(key) ?? 0) + qty);
    }
    for (const [key, total] of num.entries()) {
      const d = den.get(key) ?? 0;
      if (d > 0) costs.set(key, Math.round(total / d));
    }
    return costs;
  }

  it("weights by received quantity", () => {
    const m = weightedAverage([
      { pos_product_key: "k", received_qty: 10, unit_cost_minor_units: 100 },
      { pos_product_key: "k", received_qty: 30, unit_cost_minor_units: 200 },
    ]);
    // (10*100 + 30*200) / 40 = 175
    expect(m.get("k")).toBe(175);
  });

  it("skips rows with no product key", () => {
    const m = weightedAverage([
      { pos_product_key: null, received_qty: 5, unit_cost_minor_units: 999 },
    ]);
    expect(m.size).toBe(0);
  });

  it("PROVES the truncation harm: a lot past row 1,000 loses its cost", () => {
    // 1,500 lots, one key per lot. A capped read sees only the first 1,000,
    // so key #1400 has NO cost -> costFloorMinorUnits(null) === 0 -> the
    // below-cost clamp does not bind. This is the money-side fail-open.
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      pos_product_key: `key-${i}`,
      received_qty: 1,
      unit_cost_minor_units: 1000,
    }));
    const truncated = weightedAverage(rows.slice(0, SERVER_CAP));
    const complete = weightedAverage(rows);

    expect(truncated.has("key-1400")).toBe(false); // unprotected
    expect(complete.has("key-1400")).toBe(true); // protected
    expect(complete.size - truncated.size).toBe(500);
  });
});
