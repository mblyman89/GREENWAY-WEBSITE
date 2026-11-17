/**
 * D248 slice 4 - Compare with Sage (comparison only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PREVIEW_COLUMNS } from "@/lib/payroll/pay-preview-core";
import { TOLERANCE, __runSageCompareCoreTests, compareCell, parseAmount, parseSageCsv } from "@/lib/payroll/sage-compare-core";
import { isMissingTable } from "@/lib/payroll/sage-compare-store";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

describe("D248 slice 4 - sage-compare-core", () => {
  it("passes its embedded self-tests", () => {
    const r = __runSageCompareCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(41);
  });

  it("gross must match to the cent; federal is 'rough' (within $5)", () => {
    expect(TOLERANCE.gross.abs).toBeLessThanOrEqual(1);
    expect(compareCell("gross", 100002, 100000).verdict).toBe("off");
    expect(compareCell("federal", 10400, 10000).verdict).toBe("within");
    expect(compareCell("federal", 10600, 10000).verdict).toBe("off");
  });

  it("every paystub line has a stated tolerance and reason", () => {
    for (const c of PREVIEW_COLUMNS) expect(TOLERANCE[c.key].why.length).toBeGreaterThan(5);
  });

  it("parses Sage-style amounts and refuses junk", () => {
    expect(parseAmount("$1,234.56")).toEqual({ ok: true, value: 123456 });
    expect(parseAmount("x").ok).toBe(false);
  });

  it("a pasted CSV never guesses an employee", () => {
    const r = parseSageCsv("Employee,Gross\nSomeone Else,1.00", [{ id: "e1", name: "Pat" }]);
    expect(Object.keys(r.entries)).toHaveLength(0);
    expect(r.problems[0]).toContain("Someone Else");
  });

  it("recognises the not-yet-applied migration", () => {
    expect(isMissingTable({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingTable({ code: "PGRST205", message: "Could not find the table 'public.payroll_sage_comparisons'" })).toBe(true);
    expect(isMissingTable({ code: "23505", message: "dup" })).toBe(false);
  });
});

describe("D248 slice 4 - wiring and safety", () => {
  const page = read("src/app/admin/payroll-center/compare/page.tsx");
  const actions = read("src/app/admin/payroll-center/actions.ts");
  const mig = read("supabase/migrations/0367_payroll_sage_compare.sql");

  it("page is owner/admin and carries the calculate-only banner", () => {
    expect(page).toContain('requirePermission("settings.manage")');
    expect(page).toContain("CalculateOnlyBanner");
    expect(page).toContain('current="compare"');
  });

  it("both save actions are gated, audited, and redirect outside try", () => {
    for (const name of ["saveSageEmployeeAction", "pasteSageCsvAction"]) {
      const i = actions.indexOf(`export async function ${name}`);
      expect(i).toBeGreaterThan(0);
      const body = actions.slice(i, actions.indexOf("\n}\n", i));
      expect(body).toContain('requirePermission("settings.manage")');
      expect(body).toContain("recordAudit(");
      const tryBlock = body.slice(body.indexOf("try {"), body.indexOf("} catch"));
      expect(tryBlock).not.toContain("redirect(");
      expect(tryBlock).not.toContain("toCompare(");
    }
  });

  it("saves only against employees on the pay run", () => {
    expect(actions).toContain("That employee is not on this pay run");
    expect(actions).toContain("runEmployees(periodId)");
  });

  it("0367 is service role only, RLS on, no FK into the wiped pay_periods", () => {
    expect(mig).toContain("create table if not exists public.payroll_sage_comparisons");
    expect(mig).toContain("enable row level security");
    expect(mig).toContain("revoke all on table public.payroll_sage_comparisons from public, anon, authenticated");
    expect(mig).not.toMatch(/references\s+public\.pay_periods/);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0367_payroll_sage_compare.sql");
  });

  it("reachable from the nav and the hub, self-test registered", () => {
    expect(read("src/components/admin/payroll-center/PayrollCenterNav.tsx")).toContain("/admin/payroll-center/compare");
    expect(read("src/app/admin/payroll-center/page.tsx")).toContain("/admin/payroll-center/compare");
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("sage-compare-core", __runSageCompareCoreTests(), 41)');
  });
});
