/**
 * D248 slice 2 - Time cards (calculate and compare only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __runTimeCardCoreTests, buildTimeCard, rollUp, type CardPunch } from "@/lib/payroll/time-card-core";
import { pickDefaultPeriod } from "@/lib/payroll/time-card-store";
import type { PayPeriodRow } from "@/lib/payroll/timesheet-store";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

const punch = (id: string, day: string, inZ: string, outZ: string | null, kind: "work" | "break" = "work"): CardPunch => ({
  id, employeeId: "e", kind, day, clockInIso: inZ, clockOutIso: outZ, inLocal: "", outLocal: "", source: "web", notes: null, breakReason: null,
});

describe("D248 slice 2 - time-card-core", () => {
  it("passes its embedded self-tests", () => {
    const r = __runTimeCardCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(54);
  });

  it("splits overtime per workweek, never across the period (two 30h weeks = 0 OT)", () => {
    const ps: CardPunch[] = [];
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-09", "2026-11-10", "2026-11-11"]) ps.push(punch(d, d, `${d}T15:00:00Z`, `${d}T01:00:00Z`.replace(d, d.slice(0, 8) + String(Number(d.slice(8)) + 1).padStart(2, "0"))));
    const c = buildTimeCard({ employeeId: "e", fullName: "E", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: ps });
    expect(c.workMinutes).toBe(60 * 60);
    expect(c.overtimeMinutes).toBe(0);
  });

  it("break punches are unpaid and counted separately", () => {
    const c = buildTimeCard({
      employeeId: "e", fullName: "E", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0,
      punches: [punch("w", "2026-11-02", "2026-11-02T16:00:00Z", "2026-11-03T00:30:00Z"), punch("b", "2026-11-02", "2026-11-02T20:00:00Z", "2026-11-02T20:30:00Z", "break")],
    });
    expect(c.breakMinutes).toBe(30);
    expect(c.workMinutes).toBe(510);
  });

  it("an open punch blocks approval of the period", () => {
    const c = buildTimeCard({ employeeId: "e", fullName: "E", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: [punch("o", "2026-11-02", "2026-11-02T16:00:00Z", null)] });
    expect(c.status).toBe("blocked");
    expect(rollUp([c]).canApprove).toBe(false);
  });

  it("picks the period containing today, else the latest past one", () => {
    const P = (id: string, s: string, e: string) => ({ id, start_date: s, end_date: e }) as unknown as PayPeriodRow;
    const list = [P("b", "2026-11-15", "2026-11-28"), P("a", "2026-11-01", "2026-11-14")];
    expect(pickDefaultPeriod(list, "2026-11-17")?.id).toBe("b");
    expect(pickDefaultPeriod(list, "2026-12-30")?.id).toBe("b");
    expect(pickDefaultPeriod([], "2026-11-17")).toBeNull();
  });
});

describe("D248 slice 2 - wiring", () => {
  const page = read("src/app/admin/payroll-center/time-cards/page.tsx");
  const actions = read("src/app/admin/payroll-center/actions.ts");
  const store = read("src/lib/payroll/time-card-store.ts");
  const tools = read("src/components/admin/payroll-center/TimeCardPunchTools.tsx");

  it("owner + admin gate, and punch fixes only for roles that may edit punches", () => {
    expect(page).toContain('requirePermission("settings.manage")');
    expect(page).toContain('can(session.profile.role, "staffing.manage")');
    expect(page).toMatch(/canAdjust \? <AdjustPunch/);
  });

  it("punch fixes reuse the audited time-clock actions (reason required) - no new punch writer", () => {
    expect(tools).toContain("editPunchAction");
    expect(tools).toContain("createPunchAction");
    expect(tools).not.toMatch(/from\("time_punches"\)/);
  });

  it("the store only reads", () => {
    expect(store).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("approval re-runs the pay engine, refuses refused employees, and is audited", () => {
    const fn = actions.slice(actions.indexOf("export async function approveTimeCardsAction"));
    expect(fn).toContain("computeTimesheetForPeriod(periodId)");
    expect(fn).toContain("refusedCount > 0");
    expect(fn).toContain("approvePayPeriod(periodId, session.profile.id)");
    expect(fn).toContain('"payroll.hours.approve"');
    // redirect() throws: it must never sit inside the try block.
    const tryBlock = fn.slice(fn.indexOf("try {"), fn.indexOf("} catch"));
    expect(tryBlock).not.toMatch(/\bto\(|redirect\(/);
  });

  it("books nothing", () => {
    for (const src of [page, actions, store, tools]) {
      expect(src).not.toMatch(/payroll-posting|journal_entries|postJournal|generatePayrollNacha|form-941-store|form-940-store/);
    }
  });

  it("has a tab, a hub tile, the banner and a registered self-test", () => {
    expect(read("src/components/admin/payroll-center/PayrollCenterNav.tsx")).toContain('"/admin/payroll-center/time-cards"');
    expect(read("src/app/admin/payroll-center/page.tsx")).toContain('href: "/admin/payroll-center/time-cards"');
    expect(page).toContain("<CalculateOnlyBanner />");
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("time-card-core", __runTimeCardCoreTests(), 54)');
  });
});
