/**
 * D248 - Payroll command center (calculate + compare with Sage; no journals, no forms).
 *
 * Slice 1: pay schedule (pay Friday + period), workweek, pay calendar, hub.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  __runPayScheduleCoreTests,
  diffPlan,
  insertRowsFor,
  periodAt,
  planYear,
  scheduleNow,
  validateScheduleInput,
} from "@/lib/payroll/pay-schedule-core";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

const S = { frequency: "biweekly" as const, anchorPayDate: "2026-11-20", lagDays: 6, holidayRule: "pay_banking_day_before" as const };

describe("D248 slice 1 - pay-schedule-core", () => {
  it("passes its embedded self-tests", () => {
    const r = __runPayScheduleCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(51);
  });

  it("derives period dates from the pay Friday and the lag (never typed)", () => {
    const p = periodAt(S, 0);
    expect([p.startDate, p.endDate, p.payDate]).toEqual(["2026-11-01", "2026-11-14", "2026-11-20"]);
  });

  it("taxes wages in the year they are PAID (Jan 1 holiday payday -> Dec 31)", () => {
    const y26 = planYear(S, 2026);
    expect(y26.at(-1)?.payDate).toBe("2026-12-31");
    expect(y26.at(-1)?.taxYear).toBe(2026);
    const y27 = planYear(S, 2027);
    expect(y27.every((p) => p.taxYear === 2027)).toBe(true);
    expect(y27[0].payDate).toBe("2027-01-15");
  });

  it("never defaults a missing field", () => {
    const r = validateScheduleInput({ frequency: "biweekly", anchorPayDate: "2026-11-20", lagDays: "", holidayRule: "pay_banking_day_before" });
    expect(r.ok).toBe(false);
  });

  it("today on the live schedule: Nov 17 2026 -> next payday Fri Nov 20 for Nov 1-14", () => {
    const n = scheduleNow(S, "2026-11-17");
    expect(n.nextPayday.payDate).toBe("2026-11-20");
    expect(n.current.startDate).toBe("2026-11-15");
  });

  it("only inserts NEW planned rows; on-file and clashing rows are left alone", () => {
    const plan = planYear(S, 2027);
    const existing = [{ id: "x", start_date: plan[0].startDate, end_date: plan[0].endDate, pay_date: plan[0].payDate, pay_frequency: "biweekly", status: "approved", label: "l" }];
    const rows = insertRowsFor(diffPlan(plan, existing));
    expect(rows).toHaveLength(plan.length - 1);
    expect(rows.every((r) => r.status === "planned")).toBe(true);
  });
});

/* ── store: inserts only, never updates or deletes pay_periods ─────────── */

type Call = { table: string; op: string; payload?: unknown };
function fakeDb(existing: Record<string, unknown>[] = [], settings: unknown = null) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    let op = "select";
    let payload: unknown;
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["select", "eq", "lte", "gte", "order", "neq"]) b[m] = chain;
    b.insert = (p: unknown) => {
      op = "insert";
      payload = p;
      calls.push({ table, op, payload });
      return b;
    };
    b.update = (p: unknown) => {
      op = "update";
      payload = p;
      calls.push({ table, op, payload });
      return b;
    };
    b.upsert = (p: unknown) => {
      calls.push({ table, op: "upsert", payload: p });
      return Promise.resolve({ error: null });
    };
    b.delete = () => {
      calls.push({ table, op: "delete" });
      return b;
    };
    b.maybeSingle = () => Promise.resolve({ data: table === "site_settings" ? (settings ? { value_json: settings } : null) : null, error: null });
    b.then = (res: (v: unknown) => unknown) => {
      if (op === "insert") return Promise.resolve({ data: (payload as unknown[]).map((_, i) => ({ id: `n${i}` })), error: null }).then(res);
      return Promise.resolve({ data: table === "pay_periods" ? existing : [], error: null }).then(res);
    };
    return b;
  };
  return { calls, admin: { from: (t: string) => builder(t) } };
}

describe("D248 slice 1 - pay-schedule-store", () => {
  beforeEach(() => vi.resetModules());

  it("generateYear inserts planned rows and never updates/deletes a pay period", async () => {
    const { generateYear } = await import("@/lib/payroll/pay-schedule-store");
    const plan = planYear(S, 2027);
    const db = fakeDb([{ id: "a", label: "on", start_date: plan[0].startDate, end_date: plan[0].endDate, pay_date: plan[0].payDate, pay_frequency: "biweekly", status: "approved" }]);
    const out = await generateYear({ ...S, v: 1, updatedAt: null, updatedBy: null }, 2027, db.admin as never);
    expect(out.inserted).toBe(plan.length - 1);
    expect(out.alreadyOnFile).toBe(1);
    expect(db.calls.filter((c) => c.table === "pay_periods").map((c) => c.op)).toEqual(["insert"]);
  });

  it("loadPaySchedule returns null (not a default) when nothing is saved", async () => {
    const { loadPaySchedule } = await import("@/lib/payroll/pay-schedule-store");
    expect(await loadPaySchedule(fakeDb().admin as never)).toBeNull();
  });
});

/* ── wiring ────────────────────────────────────────────────────────────── */

describe("D248 slice 1 - wiring", () => {
  const actions = read("src/app/admin/payroll-center/actions.ts");
  const hub = read("src/app/admin/payroll-center/page.tsx");
  const sched = read("src/app/admin/payroll-center/schedule/page.tsx");
  const store = read("src/lib/payroll/pay-schedule-store.ts");

  it("owner + admin gate (settings.manage) on every page and action", () => {
    expect(hub).toContain('requirePermission("settings.manage")');
    expect(sched).toContain('requirePermission("settings.manage")');
    expect(actions.match(/requirePermission\("settings\.manage"\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("every save is audited", () => {
    for (const a of ["payroll.schedule.save", "payroll.workweek.save", "payroll.periods.generate"]) expect(actions).toContain(a);
  });

  it("books nothing: no journal, posting, NACHA or filing code is reachable", () => {
    for (const src of [actions, hub, sched, store]) {
      expect(src).not.toMatch(/payroll-posting|journal_entries|postJournal|generatePayrollNacha|form-941-store|form-940-store/);
    }
    expect(store).not.toMatch(/\.from\("pay_periods"\)[\s\S]{0,80}\.(update|delete)\(/);
  });

  it("is in the Employee menu for owner and admin", () => {
    expect(read("src/components/admin/admin-nav-data.ts")).toMatch(
      /label: "Payroll Command Center", href: "\/admin\/payroll-center", permission: "settings\.manage",[^\n]*group: "Employee"/,
    );
  });

  it("owner-only books screens are listed only for the owner", () => {
    expect(hub).toContain('can(session.profile.role, "books.view")');
    expect(hub).toContain("isOwner || !t.ownerOnly");
  });

  it("the self-test is registered", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("pay-schedule-core", __runPayScheduleCoreTests(), 51)');
  });

  it("the calculate-only promise is on every screen", () => {
    expect(hub).toContain("<CalculateOnlyBanner />");
    expect(sched).toContain("<CalculateOnlyBanner />");
  });
});
