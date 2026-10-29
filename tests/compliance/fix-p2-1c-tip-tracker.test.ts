/**
 * tests/compliance/fix-p2-1c-tip-tracker.test.ts
 *
 * Fix Phase 2.1c. Owner, message 6, verbatim: "I want to add to this an
 * employee tip tracker with a new page in the employee drop down menu to
 * track tips and give stats on them."
 *
 * Proves: the stats (closer gets the tips, not-recorded kept apart from
 * $0.00, open drawers skipped); the correction rules; the store's
 * compare-and-swap and audit; the gates (own-only for staff); the nav entry;
 * SOP-01 §4.36, KB and ledgers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

type Res = { data: unknown; error: { message: string; code?: string } | null };
const OPS: string[] = [];
let UPDATE_RESULT: Res = { data: [{ id: "s1" }], error: null };
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["update", "eq", "neq", "is", "select", "limit"]) {
    b[m] = (...a: unknown[]) => {
      OPS.push(`${table}.${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
      return b;
    };
  }
  b.then = (ok: (r: Res) => unknown) => Promise.resolve(UPDATE_RESULT).then(ok);
  return b;
}
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: (t: string) => builder(t) }) }));
const AUDITS: Record<string, unknown>[] = [];
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (a: Record<string, unknown>) => void AUDITS.push(a) }));

import {
  buildTipReport,
  validateTipCorrection,
  checkTipRange,
  tipCsv,
  TIP_REPORT_MAX_DAYS,
  __runTipsCoreTests,
  type TipSessionRow,
} from "@/lib/staffing/tips-core";
import { correctSessionTips } from "@/lib/staffing/tips-store";

const read = (p: string) => readFileSync(p, "utf8");
const row = (over: Partial<TipSessionRow> = {}): TipSessionRow => ({
  sessionId: "s1",
  registerId: "reg1",
  businessDay: "2026-11-02",
  status: "closed",
  openedBy: "e1",
  closedBy: "e1",
  tipsMinor: 2500,
  closedAt: "2026-11-03T04:00:00Z",
  ...over,
});

beforeEach(() => {
  OPS.length = 0;
  AUDITS.length = 0;
  UPDATE_RESULT = { data: [{ id: "s1" }], error: null };
});

describe("Fix Phase 2.1c: tip stats", () => {
  it("its own self-tests run and pass", () => {
    const r = __runTipsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(15);
  });

  it("the closer gets the tips; open drawers are skipped; not recorded is not $0.00", () => {
    const r = buildTipReport({
      sessions: [
        row(),
        row({ sessionId: "s2", openedBy: "e1", closedBy: "e2", tipsMinor: 0 }),
        row({ sessionId: "s3", closedBy: "e2", tipsMinor: null }),
        row({ sessionId: "s4", status: "open", tipsMinor: 9999 }),
      ],
    });
    expect(r.store.sessionsClosed).toBe(3);
    expect(r.store.sessionsRecorded).toBe(2);
    expect(r.store.sessionsNotRecorded).toBe(1);
    expect(r.store.totalMinor).toBe(2500);
    const e2 = r.employees.find((e) => e.employeeId === "e2");
    expect(e2?.sessionsRecorded).toBe(1);
    expect(e2?.sessionsNotRecorded).toBe(1);
    expect(e2?.totalMinor).toBe(0);
    expect(r.sessions.find((s) => s.sessionId === "s2")?.openedByOther).toBe(true);
  });

  it("per hour uses time-clock minutes; no hours means no per-hour figure", () => {
    const r = buildTipReport({ sessions: [row()], workedMinutes: new Map([["e1", 300]]) });
    expect(r.employees[0].perHourMinor).toBe(500);
    const r2 = buildTipReport({ sessions: [row()] });
    expect(r2.employees[0].perHourMinor).toBeNull();
  });

  it("a session with no closer is counted but given to nobody", () => {
    const r = buildTipReport({ sessions: [row({ closedBy: null })] });
    expect(r.unattributed).toEqual({ count: 1, totalMinor: 2500 });
    expect(r.employees).toEqual([]);
  });

  it("range: up to 366 days", () => {
    expect(TIP_REPORT_MAX_DAYS).toBe(366);
    expect(checkTipRange("2026-01-01", "2026-12-31").ok).toBe(true);
    expect(checkTipRange("2025-01-01", "2026-12-31").ok).toBe(false);
  });

  it("CSV keeps blank apart from 0.00 and neutralises formulas", () => {
    const csv = tipCsv([row(), row({ sessionId: "s2", tipsMinor: null })], () => "=cmd", () => "R1");
    expect(csv).toMatch(/25\.00,yes/);
    expect(csv).toMatch(/,not recorded/);
    expect(csv).not.toMatch(/(^|,)=cmd/m);
  });
});

describe("Fix Phase 2.1c: corrections", () => {
  it("validation: open refused, reason required, blank = not recorded, dollars and cents", () => {
    expect(validateTipCorrection({ amountRaw: "10", reason: "miscounted jar", status: "open" }).ok).toBe(false);
    expect(validateTipCorrection({ amountRaw: "10", reason: "x", status: "closed" }).ok).toBe(false);
    expect(validateTipCorrection({ amountRaw: "", reason: "never counted", status: "closed" })).toEqual({ ok: true, tipsMinor: null, reason: "never counted" });
    expect(validateTipCorrection({ amountRaw: "$42.5", reason: "miscounted jar", status: "closed" })).toEqual({ ok: true, tipsMinor: 4250, reason: "miscounted jar" });
    expect(validateTipCorrection({ amountRaw: "4.255", reason: "miscounted jar", status: "closed" }).ok).toBe(false);
    expect(validateTipCorrection({ amountRaw: "20000", reason: "miscounted jar", status: "closed" }).ok).toBe(false);
  });

  it("the store compares and swaps on the old value, never touches an open drawer, and audits before/after", async () => {
    const out = await correctSessionTips({ sessionId: "s1", expectedOld: 2500, tipsMinor: 3000, reason: "miscounted jar", actor: { id: "m1", email: "m@x" } });
    expect(out.ok).toBe(true);
    expect(OPS).toContain('drawer_sessions.neq("status","open")');
    expect(OPS).toContain('drawer_sessions.eq("tips_minor",2500)');
    expect(AUDITS).toHaveLength(1);
    expect(AUDITS[0]).toMatchObject({ action: "drawer.tips_corrected", before: { tipsMinor: 2500 }, after: { tipsMinor: 3000, reason: "miscounted jar" } });
  });

  it("not recorded before: matches IS NULL", async () => {
    await correctSessionTips({ sessionId: "s1", expectedOld: null, tipsMinor: 0, reason: "empty jar", actor: { id: "m1", email: "m@x" } });
    expect(OPS).toContain('drawer_sessions.is("tips_minor",null)');
  });

  it("someone changed it first: nothing changes, nothing is audited, it says reload", async () => {
    UPDATE_RESULT = { data: [], error: null };
    const out = await correctSessionTips({ sessionId: "s1", expectedOld: 2500, tipsMinor: 3000, reason: "miscounted jar", actor: { id: "m1", email: "m@x" } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/reload and try again/);
    expect(AUDITS).toEqual([]);
  });
});

describe("Fix Phase 2.1c: gates, menu, SOP, KB, ledgers", () => {
  it("page and CSV: everyone with a time clock, own only unless staffing.manage", () => {
    for (const f of ["src/app/admin/staffing/tips/page.tsx", "src/app/admin/staffing/tips/csv/route.ts"]) {
      const s = read(f);
      expect(s).toMatch(/requirePermission\("timeclock\.use"\)/);
      expect(s).toMatch(/can\(session\.profile\.role, "staffing\.manage"\)/);
      expect(s).toMatch(/employeeIdForStaff\(session\.userId\)/);
    }
    expect(read("src/app/admin/staffing/tips/csv/route.ts")).toMatch(/409\)/);
  });
  it("the correction action needs staffing.manage before anything else", () => {
    const a = read("src/app/admin/staffing/tips/actions.ts");
    const body = a.slice(a.indexOf("export async function correctTipsAction"));
    expect(body.indexOf('requirePermission("staffing.manage")')).toBeGreaterThan(0);
    expect(body.indexOf('requirePermission("staffing.manage")')).toBeLessThan(body.indexOf("getSession("));
  });
  it("the Employee menu has Tip Tracker", () => {
    expect(read("src/components/admin/admin-nav-data.ts")).toMatch(/label: "Tip Tracker", href: "\/admin\/staffing\/tips", permission: "timeclock\.use"[^\n]*group: "Employee"/);
  });
  it("SOP-01 §4.36, KB, plan row 2.1c and concierge answers", () => {
    expect(read("docs/sop/SOP-01-register-operations.md")).toMatch(/### 4\.36 Tip Tracker \(Employee menu\)/);
    expect(read("src/app/admin/staffing/tips/page.tsx")).toMatch(/SOP-01 §4\.36/);
    expect(read("src/lib/admin/concierge-kb.ts")).toMatch(/Tip Tracker \(Phase 2\.1c\)/);
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 2\.1c \| Tip Tracker[^\n]*\*\*BUILT\*\*/);
    expect(read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toMatch(/Phase 2\.1c \(Tip Tracker\) answers/);
  });
});
