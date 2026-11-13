/**
 * tests/compliance/d238-online-orders-picked-up-completed.test.ts
 *
 * D238 - "I am not able to see completed online orders. I am only able to
 * see total orders and canceled orders. Please fix this for me so I can
 * filter to see online orders that were completed at the register."
 *
 * Online orders collected at the register keep the NON-REVENUE status
 * "cancelled" (SLICE L-37, so the sale is never counted twice). The board now
 * files them under Completed: tab filter, tab counts, both panels.
 *
 * Pins:
 *   1. the pure core (register-picked-up-filter-core) and the Leafly rows;
 *   2. listOrdersPaged reads the pickup embed for Completed / Cancelled only,
 *      with the sync's note prefix, and strips the embed from rows;
 *   3. the board page folds the pickup count into Completed; the nav badge /
 *      cockpit callers are untouched;
 *   4. the register still closes the online order as "cancelled" (no revenue
 *      double count) - D238 changes the board, never the stored status;
 *   5. no migration.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  __runRegisterPickedUpFilterTests,
  COMPLETED_WITH_PICKED_UP_OR,
  PICKED_UP_EMBED_FILTERS,
  PICKED_UP_SELECT,
  foldPickedUpIntoCompleted,
  pickedUpTabPlan,
} from "@/lib/orders/register-picked-up-filter-core";
import { __runOrdersPanelTests } from "@/lib/orders/order-panels-core";
import { REGISTER_PICKED_UP_NOTE_PREFIX } from "@/lib/pos/pickup-progress-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D238 pure core", () => {
  it("self-tests pass", () => {
    const r = __runRegisterPickedUpFilterTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(16);
  });
  it("order panel self-tests (incl. Leafly collected copies) pass", () => {
    const r = __runOrdersPanelTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(116);
  });
  it("only the Completed and Cancelled tabs change", () => {
    expect(pickedUpTabPlan("completed")).toEqual({ kind: "completed_or_picked_up" });
    expect(pickedUpTabPlan("cancelled")).toEqual({ kind: "cancelled_not_picked_up" });
    for (const s of ["active", "all", "new", "acknowledged", "preparing", "ready", "no_show"]) {
      expect(pickedUpTabPlan(s)).toBeNull();
    }
  });
  it("the embed filter is the register sync's own note", () => {
    expect(PICKED_UP_EMBED_FILTERS).toContainEqual({ column: "rpu.note", op: "like", value: `${REGISTER_PICKED_UP_NOTE_PREFIX}%` });
    expect(PICKED_UP_EMBED_FILTERS).toContainEqual({ column: "rpu.to_status", op: "eq", value: "cancelled" });
    expect(PICKED_UP_EMBED_FILTERS).toContainEqual({ column: "rpu.event_type", op: "eq", value: "status_changed" });
    expect(PICKED_UP_SELECT).toBe("*, rpu:order_events(id)");
    // Completed only claims a CANCELLED order with the event - never an open one.
    expect(COMPLETED_WITH_PICKED_UP_OR).toContain("and(status.eq.cancelled,rpu.not.is.null)");
  });
  it("counts move, total unchanged", () => {
    const c = { new: 1, acknowledged: 0, preparing: 0, ready: 0, completed: 0, cancelled: 15, no_show: 0 };
    const f = foldPickedUpIntoCompleted(c, 6);
    expect(f).toEqual({ ...c, completed: 6, cancelled: 9 });
  });
});

describe("D238 wiring", () => {
  const store = read("src/lib/orders/orders-store.ts");
  const page = read("src/app/admin/orders/page.tsx");
  const leafly = read("src/components/admin/orders/LeaflyOrdersPanel.tsx");

  it("listOrdersPaged uses the pickup embed on the two tabs and strips it", () => {
    const fn = store.slice(store.indexOf("export async function listOrdersPaged"), store.indexOf("export async function listOrders("));
    expect(fn).toContain("pickedUpTabPlan(filter.status)");
    expect(fn).toContain("PICKED_UP_SELECT");
    expect(fn).toContain("q.or(COMPLETED_WITH_PICKED_UP_OR)");
    expect(fn).toContain('.is(PICKED_UP_EMBED, null)');
    expect(fn).toContain("stripPickedUpEmbed");
  });
  it("the pickup count is one never-throwing head count with the same filters", () => {
    const fn = store.slice(store.indexOf("export async function countRegisterPickedUpOrders"), store.indexOf("export type OrdersBoardSnapshot"));
    expect(fn).toContain("PICKED_UP_COUNT_SELECT");
    expect(fn).toContain("head: true");
    expect(fn).toContain("applySource(q, opts.source)");
    expect(fn).toContain("excludedOriginsFilter");
    expect(fn).toContain("catch");
  });
  it("the board page folds the pickup count into Completed", () => {
    expect(page).toContain("countRegisterPickedUpOrders({ excludeOrigins: BOARD_EXCLUDED_ORIGINS, source: gq.source })");
    expect(page).toContain("foldPickedUpIntoCompleted(s.counts, pickedUp)");
  });
  it("the nav badge and the cockpit keep their raw counts", () => {
    expect(read("src/app/api/admin/orders/count/route.ts")).not.toContain("countRegisterPickedUpOrders");
    expect(read("src/lib/admin/cockpit-data.ts")).not.toContain("countRegisterPickedUpOrders");
  });
  it("the Leafly panel files collected copies under Completed", () => {
    expect(leafly).toMatch(/toLeaflyPanelRows<WorkflowRow, OrderRow>\(\s*board\.orders\.map\(toWorkflowRow\),\s*linkedOrders,\s*pickedUpAtRegister,\s*\)/);
  });
  it("the register still closes the online order as cancelled (no double revenue)", () => {
    const sync = read("src/lib/pos/sync-store.ts");
    expect(sync).toMatch(/setOrderStatus\(source\.id, "cancelled", \{[\s\S]{0,120}registerPickedUpNote\(/);
  });
  it("adds no migration", () => {
    const names = readdirSync(path.join(ROOT, "supabase/migrations"));
    expect(names.some((n) => /d238|picked_up_completed/i.test(n))).toBe(false);
  });
});
