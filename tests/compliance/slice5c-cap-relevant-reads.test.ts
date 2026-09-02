/**
 * SLICE 5C — the remaining cap-relevant reads.
 *
 * The 13 sites in the census (SLICE5C_DIAGNOSIS.md §1) all shared one bug:
 * `.limit(N>=1000)` on a table that can exceed 1,000 rows, which PostgREST
 * silently truncates with no error (chunked-in.ts:13-14).
 *
 * These tests do three jobs:
 *   1. Prove the PURE decision core is right about WHICH fix each shape needs.
 *   2. Prove completeness behaviourally against a FAKE SERVER that enforces the
 *      1,000-row cap exactly like PostgREST — the only way to show the fix
 *      actually works, since the bug produces no error to assert on.
 *   3. Pin the regressions that would silently reintroduce the bug.
 */
import { describe, it, expect } from "vitest";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  planRead,
  evaluateReadTrust,
  describeIncompleteness,
  __runCompleteReadPlanCoreTests,
} from "@/lib/supabase/complete-read-plan-core";
import { wouldTruncate } from "@/lib/supabase/read-completeness-core";

/** PostgREST's real behaviour: a response is clamped, with NO error raised. */
const SERVER_CAP = 1000;

/**
 * A fake PostgREST table. `.range(from,to)` is honoured, but the response is
 * additionally clamped to SERVER_CAP — exactly the silent truncation that made
 * all 13 sites wrong. `failOnPage` lets a test simulate a mid-read outage.
 */
function fakeTable<T>(rows: T[], opts: { failOnPage?: number } = {}) {
  let pageIndex = 0;
  return async (from: number, to: number) => {
    const thisPage = pageIndex++;
    if (opts.failOnPage != null && thisPage === opts.failOnPage) {
      return { rows: [] as T[], ok: false };
    }
    const slice = rows.slice(from, to + 1).slice(0, SERVER_CAP);
    return { rows: slice, ok: true };
  };
}

describe("SLICE 5C — cap-relevant reads", () => {
  it("passes the embedded pure self-tests", () => {
    expect(__runCompleteReadPlanCoreTests()).toContain("all assertions passed");
  });

  // ── The decision: which fix does each read shape need? ────────────────────
  describe("choosing the right fix, not just 'add paging everywhere'", () => {
    it("a count-only read uses a server-side COUNT, never paging", () => {
      // catalog-drafts.ts:360 pulled 5,000 rows to produce 3 numbers.
      // count:"exact",head:true is immune to db.max_rows (SLICE4_WORKPLAN.md:40-43).
      expect(planRead({ needsRows: false, posture: "advisory" }).strategy).toBe("exact_count");
    });

    it("a read whose rows are consumed must page", () => {
      // forecast.ts:64 needs each order's date+amount to build the series.
      expect(planRead({ needsRows: true, posture: "advisory" }).strategy).toBe("paged_rows");
    });

    it("a data-integrity caller may NEVER act on a partial read", () => {
      // This is the duplicate-SKU guard (noncannabis/store.ts).
      const plan = planRead({ needsRows: true, posture: "data_integrity" });
      const decision = evaluateReadTrust({
        plan,
        verdict: { complete: false, reason: "limit_reached", rowsRead: 1000, missing: null, message: "x" },
      });
      expect(decision.trustworthy).toBe(false);
      expect(decision.usableWithLabel).toBe(false);
    });

    it("an advisory caller may show partial data, but only labelled", () => {
      const plan = planRead({ needsRows: true, posture: "advisory" });
      const decision = evaluateReadTrust({
        plan,
        verdict: { complete: false, reason: "read_failed", rowsRead: 1000, missing: null, message: "x" },
      });
      expect(decision.trustworthy).toBe(false);
      expect(decision.usableWithLabel).toBe(true);
    });

    it("missing evidence is never mistaken for a complete read", () => {
      const plan = planRead({ needsRows: true, posture: "advisory" });
      expect(evaluateReadTrust({ plan }).reason).toBe("missing_evidence");
    });

    it("an unusable count is never coerced to zero", () => {
      // "We could not find out" must never render as a confident "0 drafts".
      const plan = planRead({ needsRows: false, posture: "advisory" });
      for (const bad of [null, undefined, Number.NaN, -1, 2.5]) {
        const d = evaluateReadTrust({ plan, count: bad as number | null });
        expect(d.trustworthy).toBe(false);
        expect(d.reason).toBe("unusable_count");
      }
      // ...but a real zero IS trustworthy.
      expect(evaluateReadTrust({ plan, count: 0 }).trustworthy).toBe(true);
    });
  });

  // ── Behavioural proof against a server that really does cap at 1,000 ──────
  describe("completeness under a simulated 1,000-row server cap", () => {
    it("reads ALL 4,179 inventory_lots rows (the measured barcode-index case)", async () => {
      // SLICE 3 proved 4,179 lot rows survive the cap (SLICE3_WORKPLAN.md:58).
      const lots = Array.from({ length: 4179 }, (_, i) => ({ id: `lot-${i}` }));
      const { rows, verdict } = await pagedAllChecked(fakeTable(lots), { maxRows: 100_000 });
      expect(rows).toHaveLength(4179);
      expect(verdict.complete).toBe(true);
    });

    it("the OLD .limit(5000) would have returned only 1,000 of those", async () => {
      // Non-vacuous guard: proves the fake server really does truncate, so the
      // test above is meaningful rather than trivially passing.
      const lots = Array.from({ length: 4179 }, (_, i) => ({ id: `lot-${i}` }));
      const oneShot = await fakeTable(lots)(0, 4999);
      expect(oneShot.rows).toHaveLength(SERVER_CAP);
      expect(oneShot.ok).toBe(true); // ← no error. This is why it went unnoticed.
    });

    it("reads all 3,333 staged menu_items (the measured Sage category case)", async () => {
      // The owner's real import stages 3,333 items (SLICE6B_DIAGNOSIS.md).
      const items = Array.from({ length: 3333 }, (_, i) => ({ category: `cat-${i % 40}` }));
      const { rows, verdict } = await pagedAllChecked(fakeTable(items), { maxRows: 100_000 });
      expect(rows).toHaveLength(3333);
      expect(verdict.complete).toBe(true);
      // The distinct set is what listUnmappedCategories actually needs.
      expect(new Set(rows.map((r) => r.category)).size).toBe(40);
    });

    it("reads all 1,775 vendors (documented table size) for the Sage export", async () => {
      const vendors = Array.from({ length: 1775 }, (_, i) => ({ id: `v-${i}` }));
      const { rows, verdict } = await pagedAllChecked(fakeTable(vendors), { maxRows: 100_000 });
      expect(rows).toHaveLength(1775);
      expect(verdict.complete).toBe(true);
    });

    it("exactly 1,001 rows — the smallest number that used to break", async () => {
      const rows0 = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
      const { rows, verdict } = await pagedAllChecked(fakeTable(rows0), { maxRows: 100_000 });
      expect(rows).toHaveLength(1001);
      expect(verdict.complete).toBe(true);
    });

    it("exactly 1,000 rows still reads clean (no off-by-one)", async () => {
      const rows0 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
      const { rows, verdict } = await pagedAllChecked(fakeTable(rows0), { maxRows: 100_000 });
      expect(rows).toHaveLength(1000);
      expect(verdict.complete).toBe(true);
    });

    it("an empty table is complete, not suspicious", async () => {
      const { rows, verdict } = await pagedAllChecked(fakeTable([]), { maxRows: 100_000 });
      expect(rows).toHaveLength(0);
      expect(verdict.complete).toBe(true);
    });
  });

  // ── The failure that used to look like success ────────────────────────────
  describe("a mid-read failure is reported, not silently swallowed", () => {
    it("a failed page marks the read incomplete", async () => {
      const rows0 = Array.from({ length: 3000 }, (_, i) => ({ id: i }));
      const { rows, verdict } = await pagedAllChecked(fakeTable(rows0, { failOnPage: 1 }), {
        maxRows: 100_000,
      });
      expect(verdict.complete).toBe(false);
      expect(verdict.reason).toBe("read_failed");
      // Short by an unknown amount — the caller must not treat this as the total.
      expect(rows.length).toBeLessThan(3000);
    });

    it("the SKU generator refuses on an incomplete read (duplicate-SKU guard)", async () => {
      // Mirrors listExistingSkusChecked -> previewSkuAndName -> create.
      const skus = Array.from({ length: 3000 }, (_, i) => ({ sku: `SKU-${i}` }));
      const { verdict } = await pagedAllChecked(fakeTable(skus, { failOnPage: 1 }), {
        maxRows: 100_000,
      });
      const plan = planRead({ needsRows: true, posture: "data_integrity" });
      const decision = evaluateReadTrust({ plan, verdict });
      // If this ever flips to true, the app can mint a duplicate SKU.
      expect(decision.usableWithLabel).toBe(false);
      expect(decision.trustworthy).toBe(false);
    });

    it("hitting our OWN ceiling is reported as incomplete, not accepted", async () => {
      const rows0 = Array.from({ length: 5000 }, (_, i) => ({ id: i }));
      const { verdict } = await pagedAllChecked(fakeTable(rows0), { maxRows: 2000 });
      expect(verdict.complete).toBe(false);
      expect(verdict.reason).toBe("limit_reached");
    });
  });

  // ── What the owner is told ────────────────────────────────────────────────
  describe("disclosure is honest and directional", () => {
    it("says the number is UNDER-stated, not merely 'unavailable'", () => {
      const text = describeIncompleteness(
        { complete: false, reason: "read_failed", rowsRead: 1000, missing: null, message: "x" },
        "vendor list",
      );
      expect(text).toContain("vendor list");
      expect(text).toContain("lower than the real one");
    });

    it("stays silent when the read was complete (no false alarms)", () => {
      expect(
        describeIncompleteness(
          { complete: true, reason: "complete", rowsRead: 10, missing: null, message: "ok" },
          "orders",
        ),
      ).toBeNull();
    });

    it("quantifies the shortfall when it is known, and never invents one", () => {
      const known = describeIncompleteness(
        { complete: false, reason: "read_failed", rowsRead: 1000, missing: 1234, message: "x" },
        "orders",
      );
      expect(known).toContain("1,234");
      const unknown = describeIncompleteness(
        { complete: false, reason: "read_failed", rowsRead: 1000, missing: null, message: "x" },
        "orders",
      );
      expect(unknown).not.toContain("more row(s) exist");
    });
  });

  // ── Source-level pins for the WIRING, not just the core ──────────────────
  //
  // Found by sabotage: hardcoding `complete: true` inside
  // listExistingSkusChecked() passed the entire 13,162-test suite, because the
  // pure core was tested but the STORE's use of it was not. These read the
  // shipped source so the wiring itself is pinned. Source-level assertions are
  // a deliberate last resort — these call sites need a live Postgres to
  // exercise honestly, and an untested wire is how the duplicate-SKU bug got
  // in to begin with.
  describe("the fixes are actually WIRED, not just available", () => {
    const read = async (p: string) => {
      const { readFileSync } = await import("node:fs");
      return readFileSync(p, "utf8");
    };

    it("the SKU collision guard returns the REAL verdict, never a hardcoded true", async () => {
      const src = await read("src/lib/noncannabis/store.ts");
      expect(src).toContain("return { skus, complete: verdict.complete };");
      // The exact sabotage that slipped through must be impossible.
      expect(src).not.toContain("complete: true }; //");
    });

    it("creating a non-cannabis product REFUSES when the SKU base is unproven", async () => {
      const src = await read("src/lib/noncannabis/store.ts");
      expect(src).toContain("if (!skuBaseComplete) {");
      expect(src).toContain("a new SKU cannot be issued safely");
      // ...and the flag must come from the checked read, not be invented.
      expect(src).toContain("listExistingSkusChecked()");
    });

    it("the manifest backfill refuses a partial run", async () => {
      const src = await read("src/lib/inventory/manifest-kb-bridge.ts");
      expect(src).toContain("refusing to run a partial backfill");
    });

    it("the Sage vendor export warns when it may be short", async () => {
      const src = await read("src/lib/accounting/sage-exports.ts");
      expect(src).toContain("This vendor list may be INCOMPLETE");
    });

    it("the accept-rate report refuses to publish a ratio from a partial sample", async () => {
      const src = await read("src/lib/ai/usage.ts");
      expect(src).toContain("if (!verdict.complete) return empty;");
    });

    it("catalog draft counts use a cap-immune server COUNT, not a JS tally", async () => {
      const src = await read("src/lib/inventory/catalog-drafts.ts");
      expect(src).toContain('count: "exact", head: true');
      // A null count must never be presented as a confident zero.
      expect(src).toContain("usableCount(draftRes.count)");
    });

    it("every new paged read carries a UNIQUE tiebreak so paging is deterministic", async () => {
      // Without a unique sort key, two pages can repeat or skip rows — a
      // subtler wrong answer than truncation.
      for (const f of [
        "src/lib/reports/forecast.ts",
        "src/lib/ai/usage.ts",
        "src/lib/inventory/manifest-kb-bridge.ts",
      ]) {
        const src = await read(f);
        expect(src, `${f} must order by a unique column`).toMatch(/\.order\("id"/);
      }
    });
  });

  // ── Regression pins ───────────────────────────────────────────────────────
  describe("regression pins for the census itself", () => {
    it("the truncation predicate matches the measured tables", () => {
      expect(wouldTruncate(4179)).toBe(true); // inventory_lots
      expect(wouldTruncate(3333)).toBe(true); // staged menu_items
      expect(wouldTruncate(1775)).toBe(true); // vendors
      expect(wouldTruncate(1001)).toBe(true);
      expect(wouldTruncate(1000)).toBe(false);
      expect(wouldTruncate(0)).toBe(false);
    });

    it("no source file under src/ still has a real .limit(N>=1000)", async () => {
      // The whole point of the slice, asserted mechanically so it cannot
      // silently come back. Comments are stripped so the SLICE 5A/5B/5C
      // explanations (which quote the old buggy code) are not false positives.
      const { readFileSync, readdirSync, statSync } = await import("node:fs");
      const { join } = await import("node:path");

      const stripComments = (src: string): string => {
        let out = "";
        let i = 0;
        let inBlock = false;
        let inLine = false;
        let inStr: string | null = null;
        while (i < src.length) {
          const c = src[i];
          const n = src[i + 1];
          if (inLine) {
            if (c === "\n") { inLine = false; out += c; } else out += " ";
            i++; continue;
          }
          if (inBlock) {
            if (c === "*" && n === "/") { inBlock = false; out += "  "; i += 2; continue; }
            out += c === "\n" ? "\n" : " ";
            i++; continue;
          }
          if (inStr) {
            out += c;
            if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
            if (c === inStr) inStr = null;
            i++; continue;
          }
          if (c === "/" && n === "*") { inBlock = true; out += "  "; i += 2; continue; }
          if (c === "/" && n === "/") { inLine = true; out += "  "; i += 2; continue; }
          if (c === '"' || c === "'" || c === "`") { inStr = c; out += c; i++; continue; }
          out += c;
          i++;
        }
        return out;
      };

      const walk = (dir: string, acc: string[] = []): string[] => {
        for (const entry of readdirSync(dir)) {
          const p = join(dir, entry);
          if (statSync(p).isDirectory()) walk(p, acc);
          else if (/\.tsx?$/.test(p)) acc.push(p);
        }
        return acc;
      };

      const offenders: string[] = [];
      for (const file of walk("src")) {
        const stripped = stripComments(readFileSync(file, "utf8"));
        stripped.split("\n").forEach((line, idx) => {
          const m = /\.limit\(\s*([0-9_]+)\s*\)/.exec(line);
          if (m && Number(m[1].replace(/_/g, "")) >= 1000) {
            offenders.push(`${file}:${idx + 1}`);
          }
        });
      }
      expect(offenders).toEqual([]);
    });
  });
});
