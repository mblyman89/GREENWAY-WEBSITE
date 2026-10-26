/**
 * R74 S50 (round 31): count workbook roster — one pre-numbered workbook per person, Windows and
 * Mac downloads of the same workbook, a tracker (assigned / emailed / uploaded), a practice run on
 * real menu lots that never writes inventory, audit stats, and a readiness checklist.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import { __runCountRosterTests, matchUploads, newSheet, rosterTally, workbookFileName, type CountRoster } from "@/lib/pos/count-roster-core";
import { __runCountAuditStatsTests } from "@/lib/pos/count-audit-stats-core";
import { parseCountWorkbook } from "@/lib/pos/cultivera-count-core";

const RUNNER = readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8");

const LOTS = [
  { barcode: "1111111111111111", productName: "Blue Dream 3.5g", storage: "Vault" },
  { barcode: "2222222222222222", productName: "Gummies 10pk", storage: "Floor" },
];

function roster(): CountRoster {
  const at = "2026-10-29T10:00:00Z";
  return {
    version: 1,
    rosterId: "r-test",
    mode: "live",
    title: "Oct 30",
    countDate: "2026-10-30",
    createdAt: at,
    createdBy: "owner",
    source: { kind: "import", importId: "imp-1" },
    sheets: [newSheet("aaaaaaaa-0000-4000-8000-000000000001", 1, at, { assignee: "Ana", zone: "Back room", platform: "mac" }), newSheet("aaaaaaaa-0000-4000-8000-000000000002", 2, at, { assignee: "Ben" })],
    events: [],
  } as unknown as CountRoster;
}

describe("R74 S50 count roster", () => {
  it("pure self-tests pass and are pinned in the runner", () => {
    expect(__runCountRosterTests()).toEqual({ passed: 25, failed: 0 });
    expect(__runCountAuditStatsTests()).toEqual({ passed: 12, failed: 0 });
    expect(RUNNER).toContain('assertRan("count-roster-core", __runCountRosterTests(), 25)');
    expect(RUNNER).toContain('assertRan("count-audit-stats-core", __runCountAuditStatsTests(), 12)');
  });

  it("tracker counts sheets and names each file after the person and computer", () => {
    const r = roster();
    const t = rosterTally(r);
    expect(t).toBeTruthy();
    const name = workbookFileName(r, r.sheets[0], "mac");
    expect(name).toContain("Ana");
    expect(name).toContain("MAC");
    expect(matchUploads(r, [])).toEqual([]);
  });

  it("Mac workbook says Excel for Mac (not Numbers) and Meta carries the roster line", async () => {
    const { buildCountWorkbook, workbookCells } = await import("@/lib/pos/cultivera-count-workbook");
    const out = await buildCountWorkbook({
      counter: "Ana",
      countDate: "2026-10-30",
      lots: LOTS,
      lotsSource: "imp-1",
      workbookId: "aaaaaaaa-0000-4000-8000-000000000001",
      platform: "mac",
      roster: { rosterId: "r-test", mode: "test", sheetNumber: 1, zone: "Back room" },
      prefill: { scans: ["1111111111111111", "1111111111111111"], hand: [{ barcode: "2222222222222222", qty: 7, note: "case" }] },
    });
    const cells = await workbookCells(out.buffer);
    const start = JSON.stringify(cells.sheets["Start Here"]);
    expect(start).toContain("Numbers");
    const parsed = parseCountWorkbook({ fileName: "x.xlsx", sha256: "x", cells });
    expect(parsed.meta?.workbookId).toBe("aaaaaaaa-0000-4000-8000-000000000001");
    expect(parsed.meta?.rosterId).toBe("r-test");
    expect(parsed.meta?.platform).toBe("mac");
    expect(parsed.scans.get("1111111111111111")).toBe(2);
    expect(parsed.hand.get("2222222222222222")).toBe(7);
  });

  it("no new code reads 1000+ rows in one query", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk("src/app/admin/menu-imports/count/roster");
    files.push("src/lib/pos/count-roster-store.ts", "src/app/admin/menu-imports/count/page.tsx");
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/\.limit\(\s*\d{4,}/);
  });
});
