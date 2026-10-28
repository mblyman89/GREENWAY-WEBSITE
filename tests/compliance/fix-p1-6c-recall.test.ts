/**
 * tests/compliance/fix-p1-6c-recall.test.ts  (Fix Phase 1.6c, G-25)
 *
 * Plan row 1.6 (docs/sop-program/06-FIX-PHASE-PLAN.md, D76-approved):
 * "Destruction record hardening; recall plan and log; expired-stock block at
 * the register" closing G-43, G-25, G-24. This file covers G-25: the recall
 * plan, the recall/market-withdrawal log with the LCB deadlines, a recall
 * reaching the website and online orders (F-05a-16), and G-42 req 6 (a Recall
 * vendor return takes the officer and date from the recall event).
 *
 * The order-pricing gate is EXECUTED here with the menu, promotions and the
 * recall-hold read mocked (the pattern in liquid-limit-ml-server-gate.test.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { GreenwayMenuItem } from "../../src/lib/leafly/types";
import {
  evaluateLcbNotification,
  evaluateRecallClose,
  evaluateRecallEventCreate,
  onlineRecallProblems,
  recallDeadline,
  recallEventIssues,
  recallPlanIssues,
  recallReturnContact,
  withoutRecalled,
  EMPTY_RECALL_PLAN,
  RECALL_ISSUE_CODES,
  RECALL_ONLINE_LINE_MESSAGE,
  RECALL_ONLINE_UNVERIFIED,
  __runRecallEventCoreTests,
} from "../../src/lib/inventory/recall-event-core";

vi.mock("server-only", () => ({}));

const read = (p: string) => readFileSync(p, "utf8");

function menuItem(over: Partial<GreenwayMenuItem>): GreenwayMenuItem {
  return {
    id: "prod-a",
    name: "Blue Dream",
    brand: "House",
    category: "flower" as GreenwayMenuItem["category"],
    strainType: "hybrid" as GreenwayMenuItem["strainType"],
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    compounds: [],
    description: "",
    priceLabel: "$10",
    priceMinorUnits: 1000,
    inventoryStatus: "in-stock",
    variants: [{ id: "var-a", label: "3.5g", priceMinorUnits: 1000, inventoryLevel: 50, medical: false }],
    ...over,
  };
}

const MENU: GreenwayMenuItem[] = [menuItem({}), menuItem({ id: "prod-b", name: "Sour D", variants: [{ id: "var-b", label: "1g", priceMinorUnits: 1000, inventoryLevel: 50, medical: false }] })];

const hold: { keys: Set<string>; fail: boolean } = { keys: new Set(), fail: false };

vi.mock("@/lib/pos/live-menu", () => ({ loadLiveMenuAll: async () => MENU }));
vi.mock("@/lib/promotions/discount-engine", () => ({
  loadActiveRules: async () => [],
  loadProductCosts: async () => new Map<string, number>(),
}));
vi.mock("@/lib/pos/recall-hold-store", () => ({
  recalledProductKeys: async (opts?: { failClosed?: boolean }) => {
    if (hold.fail) {
      if (opts?.failClosed) throw new Error("recall read failed");
      return new Set<string>();
    }
    return hold.keys;
  },
}));

const { repriceOrderLines } = await import("../../src/lib/orders/order-pricing");

function line(productId: string, variantId: string) {
  return {
    productId,
    variantId,
    productName: "x",
    brand: "House",
    variantLabel: "3.5g",
    category: "flower",
    quantity: 1,
    priceMinorUnits: 1000,
    regularPriceMinorUnits: 1000,
  };
}

describe("1.6c core self-tests", () => {
  it("all recall-event-core assertions pass", () => {
    const r = __runRecallEventCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(68);
  });
});

describe("1.6c online orders are fail-closed on a recall (F-05a-16)", () => {
  it("an order with no held product is priced", async () => {
    hold.keys = new Set();
    hold.fail = false;
    const r = await repriceOrderLines([line("prod-a", "var-a")] as never);
    expect(r.ok).toBe(true);
  });
  it("an order holding a recalled product is refused 409 with no 'recall' wording", async () => {
    hold.keys = new Set(["prod-a"]);
    hold.fail = false;
    const r = await repriceOrderLines([line("prod-a", "var-a"), line("prod-b", "var-b")] as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain(RECALL_ONLINE_LINE_MESSAGE);
    expect(r.problems.join(" ").toLowerCase()).not.toContain("recall");
  });
  it("a failed recall read refuses the order (fail-closed)", async () => {
    hold.keys = new Set();
    hold.fail = true;
    const r = await repriceOrderLines([line("prod-a", "var-a")] as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe(RECALL_ONLINE_UNVERIFIED);
    hold.fail = false;
  });
});

describe("1.6c core behaviour", () => {
  it("withoutRecalled drops held cards and held sizes", () => {
    const out = withoutRecalled(MENU, new Set(["prod-a"]));
    expect(out.map((m) => m.id)).toEqual(["prod-b"]);
  });
  it("onlineRecallProblems names only held lines", () => {
    const p = onlineRecallProblems([{ productId: "prod-b", variantId: "var-b", label: "Sour D" }], new Set(["prod-a"]));
    expect(p).toEqual([]);
  });
  it("a recall must be reported to the LCB; a market withdrawal within 48 hours", () => {
    expect(recallDeadline({ type: "recall", receivedAtIso: "2026-11-01T00:00:00.000Z", lcbNotifiedAtIso: null }, "2026-11-01T01:00:00.000Z").kind).toBe("recall_not_notified");
    expect(recallDeadline({ type: "market_withdrawal", receivedAtIso: "2026-11-01T00:00:00.000Z", lcbNotifiedAtIso: null }, "2026-11-03T01:00:00.000Z").kind).toBe("withdrawal_overdue");
    expect(recallDeadline({ type: "market_withdrawal", receivedAtIso: "2026-11-01T00:00:00.000Z", lcbNotifiedAtIso: null }, "2026-11-02T00:00:00.000Z").kind).toBe("withdrawal_due");
  });
  it("a recall with no LCB notification is a blocking Issue", () => {
    const i = recallEventIssues(
      [{ eventId: "e", eventNumber: 1, type: "recall", product: "BD", receivedAtIso: "2026-11-01T00:00:00.000Z", lcbNotifiedAtIso: null, lastWeekOf: null, lastReportedOn: null }] as never,
      "2026-11-01T02:00:00.000Z",
      "2026-11-01",
    );
    expect(i[0].severity).toBe("blocking");
    expect(i[0].code).toBe(RECALL_ISSUE_CODES.recallNotNotified);
  });
  it("a missing recall plan is flagged", () => {
    expect(recallPlanIssues(null, "2026-11-01").length).toBeGreaterThan(0);
    expect(recallPlanIssues(EMPTY_RECALL_PLAN, "2026-11-01").length).toBeGreaterThan(0);
  });
  it("create, LCB notification and close validators refuse bad input", () => {
    expect(evaluateRecallEventCreate({} as never).ok).toBe(false);
    expect(evaluateLcbNotification({} as never).ok).toBe(false);
    expect(evaluateRecallClose({} as never).ok).toBe(false);
  });
  it("G-42 req 6: a Recall return needs the event's LCB contact", () => {
    const day = (iso: string) => iso.slice(0, 10);
    expect(recallReturnContact([], day).ok).toBe(false);
    const ok = recallReturnContact(
      [{ eventId: "e", eventNumber: 1, status: "open", lcbOfficer: "Officer Lee", lcbNotifiedAtIso: "2026-11-01T18:00:00.000Z" }],
      day,
    );
    expect(ok.ok && ok.officer === "Officer Lee" && ok.contactDate === "2026-11-01").toBe(true);
  });
});

describe("1.6c wiring pins", () => {
  it("the website menu leaves recalled products out, outside the cache", () => {
    const s = read("src/lib/pos/live-menu.ts");
    expect(s).toContain("withoutRecalled(all.filter((item) => !item.hidden), await recalledProductKeys())");
    expect(s).toContain("return withoutRecalled(visible, await recalledProductKeys());");
  });
  it("order pricing reads the hold fail-closed", () => {
    expect(read("src/lib/orders/order-pricing.ts")).toContain("recalledProductKeys({ failClosed: true })");
  });
  it("the inventory Issues list carries recall events, open orders and the plan", () => {
    const s = read("src/app/admin/inventory/page.tsx");
    for (const k of ["recallEventIssues", "recallPlanIssues", "ordersHoldingRecalled", "listOpenRecallEventFacts"]) expect(s).toContain(k);
  });
  it("a Recall vendor return takes officer and date from the event", () => {
    const s = read("src/lib/inventory/disposition.ts");
    expect(s).toContain("recallReturnContact(await listRecallEventsForLot(input.lotId)");
    expect(read("src/app/admin/inventory/disposition/actions.ts")).toContain("result.recallOfficer");
  });
  it("adding a lot to a recall uses the audited lifecycle gate, never a direct write", () => {
    const s = read("src/app/admin/inventory/recalls/actions.ts");
    expect(s).toContain("evaluateLotLifecycleChange(");
    expect(s).toContain("updateLotStatus(");
    expect(s).toContain("revalidatePublicMenuSurfaces()");
    // It may READ on_hand_qty; it must never write inventory_lots directly.
    expect(s).not.toMatch(/from\(["']inventory_lots["']\)\s*\.(update|insert|upsert|delete)/);
    expect(s).toContain('requirePermission("inventory.recall.release")');
  });
  it("the migration enables RLS on all three tables", () => {
    const s = read("supabase/migrations/0311_recall_events.sql");
    for (const t of ["recall_events", "recall_event_lots", "recall_event_weekly"]) {
      expect(s).toContain(`alter table public.${t} enable row level security;`);
    }
  });
  it("Recalls is in the nav and Recall plan in Settings", () => {
    expect(read("src/components/admin/admin-nav-data.ts")).toContain('href: "/admin/inventory/recalls"');
    expect(read("src/app/admin/settings/page.tsx")).toContain('href: "/admin/settings/recall-plan"');
  });
});
