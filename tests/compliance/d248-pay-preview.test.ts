/**
 * D248 slice 3 - Pay preview register (calculate and compare only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PREVIEW_COLUMNS,
  __runPayPreviewCoreTests,
  buildPreviewRow,
  previewCsv,
  previewTotals,
  sickPayEstimate,
  type PreviewLineInput,
} from "@/lib/payroll/pay-preview-core";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

function line(over: Partial<PreviewLineInput> = {}): PreviewLineInput {
  const gross = 100000;
  return {
    employeeId: "e1",
    employeeName: "Pat",
    status: "ready",
    netPayCents: gross - 15000,
    grossWagesCents: gross,
    totalGarnishedCents: 0,
    refusals: [],
    attentionNotes: [],
    breakdown: { totalVoluntaryCents: 0 },
    taxes: {
      grossWagesCents: gross,
      federalIncomeTax: { line4b_withholdingCents: 5850 },
      fica: { employeeOasdiCents: 6200, employerOasdiCents: 6200, employeeMedicareCents: 1450, employerMedicareCents: 1450, employeeAdditionalMedicareCents: 0, oasdiCeilingReached: false },
      futa: { netFutaCents: 600 },
      pfml: { employeeShareCents: 807, employerShareCents: 323 },
      waCares: { employeeCents: 580, exempt: false },
      suta: { ok: true, value: { employerCents: 400 } },
      lni: { ok: true, value: { employeeCents: 113, employerCents: 400 } },
      totalEmployeeWithheldCents: 15000,
      uncollectedEmployeeTaxCents: 0,
      totalEmployerTaxCents: 6200 + 1450 + 600 + 400 + 323 + 400,
      netPayCents: gross - 15000,
    },
    ...over,
  };
}

const HOURS = { regularHundredthHours: 4000, overtimeHundredthHours: 0, straightTimeCents: 100000, overtimePremiumCents: 0, hourlyRateMilliCents: 2500000, sickMinutes: 120, tipsCents: 4321 };

describe("D248 slice 3 - pay-preview-core", () => {
  it("passes its embedded self-tests", () => {
    const r = __runPayPreviewCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(40);
  });

  it("lays every engine amount into a Sage-ordered column and re-adds", () => {
    const r = buildPreviewRow(line(), HOURS);
    expect(r.amounts.gross).toBe(100000);
    expect(r.amounts.federal).toBe(5850);
    expect(r.amounts.socialSecurity).toBe(6200);
    expect(r.amounts.net).toBe(85000);
    expect(r.amounts.totalCost).toBe(100000 + 9373);
    expect(r.reAdds).toBe(true);
    expect(PREVIEW_COLUMNS.map((c) => c.key)[4]).toBe("gross");
  });

  it("sick pay and tips are reported beside gross, never added", () => {
    const r = buildPreviewRow(line(), HOURS);
    expect(r.sickPayEstimateCents).toBe(5000);
    expect(r.tipsCents).toBe(4321);
    expect(r.amounts.gross).toBe(100000);
    expect(sickPayEstimate(60, null)).toBeNull();
  });

  it("blocked rows carry the engine's reason and stay out of the totals", () => {
    const b = buildPreviewRow(line({ employeeId: "e2", status: "blocked", taxes: null, refusals: [{ message: "Open punch.", whatToDo: "Close it." }] }), null);
    expect(b.problems[0]).toContain("Open punch.");
    const t = previewTotals([buildPreviewRow(line(), HOURS), b]);
    expect(t.gross).toBe(100000);
  });

  it("the CSV says calculated for comparison only", () => {
    const csv = previewCsv([buildPreviewRow(line(), HOURS)], { periodLabel: "P", payDate: "2026-11-20" });
    expect(csv).toContain("CALCULATED FOR COMPARISON ONLY");
    expect(csv.split("\n")[1]).toContain("Federal income tax");
  });
});

describe("D248 slice 3 - wiring", () => {
  const page = read("src/app/admin/payroll-center/pay-preview/page.tsx");
  const store = read("src/lib/payroll/pay-preview-store.ts");

  it("page is owner/admin (settings.manage) and shows the calculate-only banner", () => {
    expect(page).toContain('requirePermission("settings.manage")');
    expect(page).toContain("CalculateOnlyBanner");
    expect(page).toContain('current="pay-preview"');
  });

  it("store reads through the existing engine and never writes", () => {
    expect(store).toContain('import "server-only"');
    expect(store).toContain("loadPayRun(periodId)");
    expect(store).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(store).not.toMatch(/postJournal|bookJournal|journal_entries/);
  });

  it("shows rate refusals by name rather than computing with a stale rate", () => {
    expect(page).toContain("missingRates");
    expect(page).toContain("RATES_NOT_ON_FILE");
  });

  it("is reachable from the nav tab and the hub", () => {
    expect(read("src/components/admin/payroll-center/PayrollCenterNav.tsx")).toContain("/admin/payroll-center/pay-preview");
    expect(read("src/app/admin/payroll-center/page.tsx")).toContain("/admin/payroll-center/pay-preview");
  });

  it("self-test is registered", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("pay-preview-core", __runPayPreviewCoreTests(), 40)');
  });
});
