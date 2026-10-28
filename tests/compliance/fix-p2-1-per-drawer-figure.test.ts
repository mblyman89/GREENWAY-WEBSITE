/**
 * Fix Phase 2.1 (G-05 / F-01-4 / F-01-3; owner message 4: "then i want you
 * to move on to phase 2, Cash, in SOP order 01 → 02 → 03: per-drawer
 * figure, ...").
 *
 * Reconcile no longer asks a manager to TYPE the drawer's cash sales. The
 * server builds the figure from the drawer's own processed cash sales, the
 * refunds tied to it, and its drops. Anything it cannot know (a sale still
 * processing, a refund nobody has tied, an incomplete read, no opening
 * count) blocks reconcile instead of being guessed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDrawerFigure,
  figureReady,
  parsePaidFrom,
  saleCashMinor,
  __runDrawerFigureCoreTests,
  type DrawerFigureInput,
} from "@/lib/registers/drawer-figure-core";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const MIG = read("supabase/migrations/0313_drawer_cash_refunds.sql");
const ACTIONS = read("src/app/admin/registers/actions.ts");
const PAGE = read("src/app/admin/registers/page.tsx");
const STORE = read("src/lib/registers/store.ts");
const FSTORE = read("src/lib/registers/drawer-figure-store.ts");
const VOID_ROUTE = read("src/app/api/pos/void/route.ts");
const VOID_STORE = read("src/lib/pos/void-store.ts");
const RET_ROUTE = read("src/app/api/pos/returns/route.ts");
const RET_ACTIONS = read("src/app/admin/registers/returns/actions.ts");
const DESK = read("src/components/admin/registers/CounterReturnDesk.tsx");
const OVERSIGHT = read("src/lib/registers/oversight.ts");
const TILL = read("src/app/admin/registers/history/[id]/page.tsx");
const SOP = read("docs/sop/SOP-01-register-operations.md");

const S = "11111111-1111-4111-8111-111111111111";
const base: DrawerFigureInput = {
  sessionId: S,
  openingMinor: 20000,
  closingMinor: 41000,
  dropsMinor: 10000,
  saleEvents: [
    { status: "processed", eventType: "sale", payload: { drawerSessionId: S, totalMinor: 32002, paymentMethod: "cash", rounding: { adjustmentMinor: -2 } } },
  ],
  dayRefunds: [{ source: "return", sourceId: "r1", refundMinor: 1000, paidFrom: "drawer", drawerSessionId: S }],
  readsComplete: true,
};

describe("Phase 2.1 drawer figure core", () => {
  it("self-test passes with its full count", () => {
    const r = __runDrawerFigureCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(34);
  });
  it("expected = opening + cash sales - refunds tied to the drawer - drops", () => {
    const f = buildDrawerFigure(base);
    expect(f.cashSalesMinor).toBe(32000);
    expect(f.expectedMinor).toBe(20000 + 32000 - 1000 - 10000);
    expect(f.overShortMinor).toBe(41000 - 41000);
    expect(figureReady(f)).toBe(true);
  });
  it("a refund tied to nothing blocks; it is never guessed into the drawer", () => {
    const f = buildDrawerFigure({
      ...base,
      dayRefunds: [...base.dayRefunds, { source: "void", sourceId: "o1", refundMinor: 500, paidFrom: null, drawerSessionId: null }],
    });
    expect(figureReady(f)).toBe(false);
    expect(f.refundsPaidMinor).toBe(1000);
    expect(f.unattributed).toHaveLength(1);
  });
  it("only cash sales count as drawer cash", () => {
    expect(saleCashMinor({ totalMinor: 100, paymentMethod: "employee_tab" })).toBe(0);
    expect(saleCashMinor({ totalMinor: 100, paymentMethod: "debit" })).toBe(0);
    expect(saleCashMinor({ totalMinor: 100, paymentMethod: "cash" })).toBe(100);
  });
  it("paid-from choice is strict", () => {
    expect(parsePaidFrom("safe")).toEqual({ paidFrom: "safe", drawerSessionId: null });
    expect(parsePaidFrom(`drawer:${S}`)).toEqual({ paidFrom: "drawer", drawerSessionId: S });
    expect(parsePaidFrom("drawer")).toBeNull();
  });
});

describe("Phase 2.1 migration 0313", () => {
  it("adds only columns (no new WIPE table, so the reset function is unchanged)", () => {
    expect(MIG).not.toMatch(/create table/i);
    expect(MIG).toMatch(/add column if not exists refund_paid_from text/);
    expect(MIG).toMatch(/add column if not exists refund_drawer_session_id uuid/);
    expect(MIG).toMatch(/add column if not exists cash_sales_minor integer/);
    expect(MIG).toMatch(/add column if not exists refunds_paid_minor integer/);
    expect(MIG).toMatch(/customer_returns_refund_drawer_has_session/);
  });
});

describe("Phase 2.1 reconcile wiring", () => {
  it("reconcile takes no typed cash sales and no typed reconciler", () => {
    const body = ACTIONS.slice(ACTIONS.indexOf("export async function reconcileDrawerAction"), ACTIONS.indexOf("export async function verifyTillAction"));
    expect(body).not.toMatch(/"cash_sales"/);
    expect(body).not.toMatch(/"reconciled_by"/);
    expect(body).toMatch(/loadDrawerFigure\(sessionId\)/);
    expect(body).toMatch(/figureReady\(figure\)/);
    expect(body).toMatch(/drawer\.reconcile_refused/);
    expect(body).toMatch(/employeeIdForStaff\(session\.profile\.id\)/);
    expect(PAGE).not.toMatch(/name="cash_sales"/);
    expect(PAGE).not.toMatch(/name="reconciled_by"/);
  });
  it("reconcile is compare-and-swap on status closed (F-01-2)", () => {
    const body = STORE.slice(STORE.indexOf("export async function reconcileDrawer"));
    expect(body).toMatch(/\.eq\("status", "closed"\)/);
    expect(body).toMatch(/reconciled by someone else/);
  });
  it("the card shows the system figure and an assign form for untied refunds", () => {
    expect(PAGE).toMatch(/function ReconcileCard/);
    expect(PAGE).toMatch(/= Expected in drawer/);
    expect(PAGE).toMatch(/action=\{assignRefundAction\}/);
    expect(PAGE).toMatch(/disabled=\{!ready\}/);
    expect(PAGE).not.toMatch(/dayRefundTotalMinor/);
    expect(OVERSIGHT).not.toMatch(/refundsForBusinessDay/);
  });
  it("a refund can only be tied once, and never to a reconciled drawer", () => {
    expect(FSTORE).toMatch(/\.is\("refund_paid_from", null\)/);
    expect(FSTORE).toMatch(/already reconciled/);
    expect(ACTIONS).toMatch(/already tied to a drawer or the safe/);
  });
});

describe("Phase 2.1 refunds say which drawer paid", () => {
  it("a register void records the open drawer of its register", () => {
    expect(VOID_ROUTE).toMatch(/drawerSessionId: await openDrawerIdForRegister\(auth\.device\.register_id\)/);
    expect(VOID_STORE).toMatch(/drawerSessionId: input\.drawerSessionId \?\? null/);
  });
  it("a register return is tied to the open drawer of its register", () => {
    expect(RET_ROUTE).toMatch(/openDrawerIdForRegister\(auth\.device\.register_id\)/);
    expect(RET_ROUTE).toMatch(/assignReturnRefund\(/);
  });
  it("the returns desk requires a paid-from choice, never defaulted", () => {
    expect(DESK).toMatch(/useState\(""\)/);
    expect(DESK).toMatch(/Cash paid from/);
    expect(RET_ACTIONS).toMatch(/parsePaidFrom\(input\.paidFrom\)/);
    // Checked BEFORE the return is processed (nothing moves on a bad choice).
    expect(RET_ACTIONS.indexOf("parsePaidFrom(input.paidFrom)")).toBeLessThan(RET_ACTIONS.indexOf("await processCounterReturn("));
  });
  it("the till summary prints the stored split", () => {
    expect(TILL).toMatch(/session\.cash_sales_minor != null/);
    expect(TILL).toMatch(/session\.refunds_paid_minor != null/);
  });
});

describe("Phase 2.1 SOP-01", () => {
  it("SOP-01 describes the system figure and drops the typed formula", () => {
    expect(SOP).toMatch(/\*\*Version\*\* \| 1\.([5-9]|\d\d) /);
    expect(SOP).toMatch(/system figure/i);
    expect(SOP).toMatch(/Tie refund/);
  });
});
