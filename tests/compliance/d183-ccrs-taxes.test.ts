/**
 * tests/compliance/d183-ccrs-taxes.test.ts   (D183, round slice S6)
 *
 * Owner (2026-11-04): "The numbers and data need to make it to CCRS and I need
 * to pay the correct amount in taxes."
 *
 * Pins: both pure cores' self-tests; the completeness verdict is never
 * "complete" on a read error or a running week; the lot repairs are owner
 * only, re-check before writing, change no stock (no apply_lot_delta, no
 * on_hand write) and the move is guarded by the old lot; no new cron and no
 * migration; both pages are in the CCRS nav on reports.view.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runCcrsCompletenessTests,
  buildCompleteness,
  type SaleLineFact,
} from "@/lib/compliance/ccrs-completeness-core";
import { __runTaxesOwedTests, dorDueDate, liqDueDate } from "@/lib/compliance/taxes-owed-core";
import { adminNav } from "@/components/admin/admin-nav-data";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const line = (id: string, money = 1000): SaleLineFact => ({ detailId: id, orderNumber: "1", day: "2026-11-01", quantity: 1, moneyMinor: money, excluded: false });

describe("D183 S6: CCRS completeness and taxes owed", () => {
  it("the pure self-tests pass", () => {
    const a = __runCcrsCompletenessTests();
    expect(a.failed).toBe(0);
    expect(a.passed).toBeGreaterThanOrEqual(50);
    const b = __runTaxesOwedTests();
    expect(b.failed).toBe(0);
    expect(b.passed).toBeGreaterThanOrEqual(20);
  });

  it("a read error is never complete", () => {
    const r = buildCompleteness({ lines: [line("a")], filed: [{ detailId: "a", fileName: "f", fileState: "emitted", moneyMinor: 1000 }], held: [], readErrors: ["boom"], weekLabel: "W", weekEnded: true });
    expect(r.status).toBe("unknown");
  });

  it("a running week reports pending, an ended week reports missing", () => {
    const base = { lines: [line("a"), line("b")], filed: [{ detailId: "a", fileName: "f", fileState: "emitted", moneyMinor: 1000 }], held: [], weekLabel: "W" };
    expect(buildCompleteness({ ...base, weekEnded: false }).status).toBe("pending");
    expect(buildCompleteness({ ...base, weekEnded: true }).status).toBe("missing");
  });

  it("money off by more than a cent a line is flagged", () => {
    const r = buildCompleteness({ lines: [line("a")], filed: [{ detailId: "a", fileName: "f", fileState: "emitted", moneyMinor: 990 }], held: [], weekLabel: "W", weekEnded: true });
    expect(r.status).toBe("money");
  });

  it("due dates: LIQ-1295 the 20th, DOR the 25th rolled", () => {
    expect(liqDueDate("2026-11")).toBe("2026-12-20");
    expect(dorDueDate("2026-10")).toBe("2026-11-25");
    expect(dorDueDate("2026-09")).toBe("2026-10-26"); // Oct 25 2026 is a Sunday
    expect(dorDueDate("2026-11")).toBe("2026-12-28"); // Christmas Friday, then the weekend
  });

  it("the repair actions are owner only", () => {
    const a = read("src/app/admin/compliance/sales-check/actions.ts");
    expect(a.match(/await requireBooksAccess\(\)/g)?.length).toBe(2);
  });

  it("repairs change records, never stock or money", () => {
    const s = read("src/lib/compliance/ccrs-completeness-store.ts");
    expect(s).not.toMatch(/apply_lot_delta/);
    // the only writes: one order_lines lot pointer update and one count adjustment insert
    expect(s.match(/\.update\(/g)?.length).toBe(1);
    expect(s).toMatch(/\.update\(\{ ccrs_inventory_external_id: r\.toExt \}\)/);
    expect(s).not.toMatch(/from\("inventory_lots"\)\s*\.(update|upsert|insert)/);
    expect(s).not.toMatch(/from\("orders"\)\s*\.(update|upsert|insert)/);
    // the move is guarded by the old lot id, so a second press changes nothing
    expect(s).toMatch(/\.eq\("ccrs_inventory_external_id", r\.fromExt\)/);
    // both re-check against fresh data before writing, and both audit
    expect(s.match(/const f = await factsWithProdFlags\(admin\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // checkLots + both repairs
    expect(s).toMatch(/ccrs\.lot_repair\.move_line/);
    expect(s).toMatch(/ccrs\.lot_repair\.count_correction/);
  });

  it("the pages are reports.view and the buttons show to the owner only", () => {
    const p = read("src/app/admin/compliance/sales-check/page.tsx");
    expect(p).toMatch(/requirePermission\("reports\.view"\)/);
    expect(p).toMatch(/isOwner && s\.repair\?\.kind === "move"/);
    expect(p).toMatch(/isOwner && s\.repair\?\.kind === "count"/);
    const t = read("src/app/admin/compliance/taxes-owed/page.tsx");
    expect(t).toMatch(/requirePermission\("reports\.view"\)/);
  });

  it("both pages are in the CCRS nav on reports.view", () => {
    for (const href of ["/admin/compliance/sales-check", "/admin/compliance/taxes-owed"]) {
      const item = adminNav.find((i) => i.href === href);
      expect(item?.group).toBe("CCRS");
      expect(item?.permission).toBe("reports.view");
    }
  });

  it("no new cron", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.some((c) => /sales-check|taxes-owed|completeness/.test(c.path))).toBe(false);
  });

  it("both cores are in the pure self-test harness", () => {
    const h = read("scripts/compliance/run-pure-selftests.ts");
    expect(h).toMatch(/assertRan\("ccrs-completeness-core"/);
    expect(h).toMatch(/assertRan\("taxes-owed-core"/);
  });
});
