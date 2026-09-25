/**
 * SLICE L-38 — the online-orders dashboard is split, and steps move only on
 * the details pages.
 *
 * The owner's instruction, in his words:
 *   - Leafly orders must not show in the online-orders table, "not in the
 *     open view, and not in the hidden/closed views reached by search or
 *     filters". They stay findable in their own Leafly section.
 *   - The Leafly section looks identical to the online-order rows, with a
 *     Details button on the far right; online-order rows first, Leafly below.
 *   - "Instead of progressing through the steps in the dashboard, it should
 *     be done in the details page only" — for BOTH kinds of order.
 *
 * Each of those is pinned here, by execution where there is logic (the pure
 * core) and by source where the fact is wiring. Where a check could pass for
 * an unrelated reason it is anchored so a rename cannot satisfy it (the L-29 /
 * L-31 lesson).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  BOARD_EXCLUDED_ORIGINS,
  excludedOriginsFilter,
  leaflyDetailPath,
  LEAFLY_DETAIL_BASE,
  RETURN_TO_DETAIL,
  leaflyActionReturnHref,
  localStatusAfterLeaflyStep,
  stepsBelongToMarketplace,
  greenwayStatusChangeAllowed,
  MARKETPLACE_STEPS_REFUSAL,
  leaflySearchTerms,
  __runOrderBoardSplitTests,
} from "../../src/lib/orders/order-board-split-core";
import { buildBoardView, type BoardViewRow } from "../../src/lib/leafly/board-view-core";
import { TRANSIENT_QUERY_KEYS } from "../../src/lib/admin/back-link-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Strip comments so prose that mentions a name cannot satisfy a check. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PAGE = code(read("src/app/admin/orders/page.tsx"));
const STORE = code(read("src/lib/orders/orders-store.ts"));
const PANEL = code(read("src/components/admin/orders/LeaflyOrdersPanel.tsx"));
const ROW = code(read("src/components/admin/orders/OrderBoardRow.tsx"));
const WORKFLOW = code(read("src/components/admin/orders/LeaflyOrderWorkflow.tsx"));
const ACTIONS_UI = code(read("src/components/admin/orders/LeaflyOrderActions.tsx"));
const DETAIL_UI = code(read("src/components/admin/orders/LeaflyOrderDetail.tsx"));
const LEAFLY_ACTIONS = code(read("src/app/admin/orders/leafly-actions.ts"));
const ORDER_ACTIONS = code(read("src/app/admin/orders/actions.ts"));
const ORDER_PAGE = code(read("src/app/admin/orders/[id]/page.tsx"));
const LEAFLY_ROUTE_PATH = "src/app/admin/orders/leafly/[leaflyOrderId]/page.tsx";
const HARNESS = read("scripts/compliance/run-pure-selftests.ts");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `anchor not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b === -1 ? src.length : b);
}

// ===========================================================================
describe("L-38 · the pure core", () => {
  it("its own self-tests pass, and the harness runs them with a floor", () => {
    const r = __runOrderBoardSplitTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(40);
    expect(HARNESS).toMatch(/assertRan\("order-board-split-core", __runOrderBoardSplitTests\(\), \d+\)/);
  });

  it("excludes exactly the marketplace origins, as a safe PostgREST list", () => {
    expect([...BOARD_EXCLUDED_ORIGINS]).toEqual(["leafly"]);
    expect(excludedOriginsFilter()).toBe("(leafly)");
    expect(excludedOriginsFilter([])).toBeNull();
    // Anything that is not a bare identifier is dropped, never interpolated.
    expect(excludedOriginsFilter(["leafly", "x),or(id.gt.0"])).toBe("(leafly)");
  });

  it("the Details button opens the Greenway copy once it exists, else the Leafly page", () => {
    expect(leaflyDetailPath({ leaflyOrderId: "abc", localOrderId: "L1" })).toBe("/admin/orders/L1");
    expect(leaflyDetailPath({ leaflyOrderId: "abc", localOrderId: null })).toBe(`${LEAFLY_DETAIL_BASE}/abc`);
    expect(leaflyDetailPath({ leaflyOrderId: "  ", localOrderId: " " })).toBeNull();
    expect(leaflyDetailPath({ leaflyOrderId: "a/b", localOrderId: null })).toBe(`${LEAFLY_DETAIL_BASE}/a%2Fb`);
  });

  it("a step pressed on a details page comes back to that page (with the view)", () => {
    const href = leaflyActionReturnHref({
      returnTo: RETURN_TO_DETAIL,
      leaflyOrderId: "abc",
      back: "/admin/orders?q=smith",
      params: { leaflyMsg: "Confirmed" },
    });
    expect(href.startsWith(`${LEAFLY_DETAIL_BASE}/abc?`)).toBe(true);
    const qs = new URLSearchParams(href.split("?")[1]);
    expect(qs.get("leaflyMsg")).toBe("Confirmed");
    expect(qs.get("back")).toBe("/admin/orders?q=smith");
    // Without returnTo it is the old dashboard redirect, unchanged.
    expect(leaflyActionReturnHref({ returnTo: null, leaflyOrderId: "abc", params: { leaflyErr: "x" } })).toBe(
      "/admin/orders?leaflyErr=x",
    );
  });

  it("our copy follows a Leafly step forward only", () => {
    expect(localStatusAfterLeaflyStep({ pushedLeaflyStatus: "confirmed", localStatus: "new" })).not.toBeNull();
    expect(localStatusAfterLeaflyStep({ pushedLeaflyStatus: "confirmed", localStatus: "completed" })).toBeNull();
    expect(localStatusAfterLeaflyStep({ pushedLeaflyStatus: "nonsense", localStatus: "new" })).toBeNull();
  });

  it("the Greenway status buttons are refused for open Leafly orders only", () => {
    expect(stepsBelongToMarketplace("leafly")).toBe(true);
    expect(stepsBelongToMarketplace("greenway")).toBe(false);
    expect(stepsBelongToMarketplace(null)).toBe(false);
    expect(greenwayStatusChangeAllowed({ origin: "leafly", fromClosed: false })).toBe(false);
    // A logged reopen of a closed Leafly order is still allowed, as before.
    expect(greenwayStatusChangeAllowed({ origin: "leafly", fromClosed: true })).toBe(true);
    expect(greenwayStatusChangeAllowed({ origin: "greenway", fromClosed: false })).toBe(true);
    expect(greenwayStatusChangeAllowed({ origin: "register", fromClosed: false })).toBe(true);
  });

  it("the Leafly search can find a name, a phone or an order number", () => {
    const terms = leaflySearchTerms({
      order_number: "GW-1042",
      display_name: "Maple",
      customer_first_name: "Ada",
      customer_last_name: "Smith",
      customer_phone: "555-0100",
    });
    expect(terms).toEqual(["GW-1042", "Maple", "Ada Smith", "555-0100"]);
    const row: BoardViewRow = {
      bucket: "to_build",
      leaflyOrderId: "uuid-zzz",
      localOrderId: null,
      acknowledgeBy: null,
      updatedAt: "2025-01-01T00:00:00Z",
      searchTerms: terms,
    };
    const hits = (q: string) => buildBoardView([row], { filter: "all", search: q }).rows.length;
    expect(hits("smith")).toBe(1);
    expect(hits("1042")).toBe(1);
    expect(hits("555-0100")).toBe(1);
    expect(hits("nobody")).toBe(0);
    // A Leafly order not accepted yet has no Greenway copy: no extra terms,
    // and it is still found by its Leafly id.
    expect(leaflySearchTerms(null)).toEqual([]);
  });
});

// ===========================================================================
describe("L-38 · Leafly orders are off the online-orders table (every view)", () => {
  it("the dashboard query and its counts both pass the exclusion", () => {
    const filter = between(PAGE, "const queryFilter", ";\n");
    expect(filter).toContain("excludeOrigins: BOARD_EXCLUDED_ORIGINS");
    expect(PAGE).toContain("getOrderStatusCounts({ excludeOrigins: BOARD_EXCLUDED_ORIGINS })");
    // Every listOrdersPaged call on the page spreads that one filter, so the
    // re-fetch for an out-of-range page cannot drop it.
    const calls = PAGE.match(/listOrdersPaged\(\{[^}]*\}/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c).toContain("...queryFilter");
  });

  it("the exclusion is applied BEFORE search/status narrowing (so search cannot reach them)", () => {
    const q = between(STORE, "export async function listOrdersPaged", "export async function listOrders(");
    expect(q).toMatch(/q = q\.not\("origin", "in", notOrigins\)/);
    const counts = between(STORE, "export async function getOrderStatusCounts", "\n}\n");
    expect(counts).toMatch(/q = q\.not\("origin", "in", notOrigins\)/);
  });

  it("other readers (the nav count, the cockpit) are unchanged", () => {
    expect(code(read("src/app/api/admin/orders/count/route.ts"))).toContain("getOrderStatusCounts()");
    expect(code(read("src/lib/admin/cockpit-data.ts"))).toContain("getOrderStatusCounts()");
  });
});

// ===========================================================================
describe("L-38 · no step buttons on the dashboard, one row shape for both", () => {
  it("the dashboard posts no status change at all", () => {
    expect(PAGE).not.toContain("setOrderStatusAction");
    expect(PAGE).not.toContain("ORDER_FORWARD_TRANSITIONS");
  });

  it("the shared row has a Details button and no forms", () => {
    expect(ROW).toMatch(/<Button href=\{href\}[^>]*>\s*Details\s*<\/Button>/);
    expect(ROW).not.toContain("<form");
    expect(ROW).not.toContain("action=");
  });

  it("website rows and Leafly rows both render through OrderBoardRow", () => {
    expect(PAGE).toMatch(/<OrderBoardRow[\s\n]/);
    expect(PANEL).toMatch(/<OrderBoardRow[\s\n]/);
  });

  it("the Leafly row carries no workflow: no step buttons, no forms", () => {
    expect(PANEL).not.toMatch(/<LeaflyOrderActions[\s/>]/);
    expect(PANEL).not.toMatch(/<LeaflyLifecycleStrip[\s/>]/);
    expect(PANEL).not.toMatch(/<LeaflyOrderDetailPanel[\s/>]/);
    expect(PANEL).not.toContain("leafly-actions");
  });

  it("the Leafly row's Details goes through leaflyDetailPath and keeps the view", () => {
    const row = between(PANEL, "const detailPath = leaflyDetailPath(", "const blockingCount");
    expect(row).toContain("localOrderId: order.local_order_id");
    expect(row).toMatch(/withBackParam\(detailPath, searchParams\)/);
    expect(PANEL).toMatch(/<OrderBoardRow[\s\S]{0,200}href=\{href\}/);
  });

  it("online-order rows come first, the Leafly section below", () => {
    // SLICE L-40 — FIXED order, by source position. L-22's runtime promotion
    // (Leafly on top while an order was racing the 15-minute auto-cancel) was
    // removed at the owner's request: Leafly orders are accepted
    // automatically, so there is nothing to race.
    const g = PAGE.indexOf("{greenwaySection}");
    const l = PAGE.indexOf("{leaflySection}");
    expect(g).toBeGreaterThan(-1);
    expect(l).toBeGreaterThan(g);
    expect(PAGE).not.toMatch(/boardLayout/);
    expect(PAGE).not.toMatch(/decideBoardLayout/);
  });
});

// ===========================================================================
describe("L-38 · the steps live on the details pages", () => {
  it("the workflow posts back to the details page it was pressed on", () => {
    expect(WORKFLOW).toMatch(/<LeaflyOrderActions[\s\S]{0,800}returnTo=\{RETURN_TO_DETAIL\}/);
    expect(WORKFLOW).toMatch(/<LeaflyOrderDetailPanel[\s\S]{0,600}returnTo=\{RETURN_TO_DETAIL\}/);
    expect(ACTIONS_UI).toMatch(/name="returnTo"/);
    expect(ACTIONS_UI).toMatch(/name="back"/);
    expect(DETAIL_UI).toMatch(/name="returnTo"/);
  });

  it("every Leafly action redirect honours returnTo", () => {
    // backTo is the one exit; each call passes the submitted form.
    expect(LEAFLY_ACTIONS).toMatch(/function backTo\(params[^)]*from\?: FormData\)/);
    expect(LEAFLY_ACTIONS).toContain("leaflyActionReturnHref(");
    const calls = LEAFLY_ACTIONS.match(/backTo\(/g) ?? [];
    const withForm = LEAFLY_ACTIONS.match(/backTo\([\s\S]{0,400}?,\s*formData\)/g) ?? [];
    // minus the declaration itself
    expect(withForm.length).toBe(calls.length - 1);
  });

  it("a pushed step is mirrored onto our copy, audited, and never fatal", () => {
    const status = between(LEAFLY_ACTIONS, "export async function setLeaflyOrderStatusAction", "\nexport async function");
    expect(status).toContain("localStatusAfterLeaflyStep(");
    expect(status).toMatch(/setOrderStatus\(\s*local\.id/);
    expect(status).toContain("(Leafly step)");
    expect(status).toContain("withExtraWarning(");
  });

  it("the server refuses a Greenway status change on an open Leafly order", () => {
    const action = between(ORDER_ACTIONS, "export async function setOrderStatusAction", "\nexport async function");
    const lockAt = action.indexOf("greenwayStatusChangeAllowed(");
    const gateAt = action.indexOf("runCompletionGate(");
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(gateAt);
    // MUTATION SWEEP FINDING: "the call is present" survived `false && …`.
    // Pin the guard's whole shape: refuse exactly when the order exists and
    // the core says no — nothing may be ANDed/ORed in front of it.
    expect(action).toMatch(
      /if \(\s*current &&\s*!greenwayStatusChangeAllowed\(\{\s*origin: current\.origin,/,
    );
    expect(action).toContain('action: "order.transition_blocked"');
    expect(action).toContain("encodeURIComponent(MARKETPLACE_STEPS_REFUSAL)");
    expect(action).toContain("CLOSED_ORDER_STATUSES.includes(current.status)");
  });

  it("the Greenway order page shows the Leafly steps instead of the status buttons", () => {
    expect(ORDER_PAGE).toContain("stepsBelongToMarketplace(order.origin) && !isClosed");
    expect(ORDER_PAGE).toMatch(/\{leaflySteps \? \([\s\S]*<LeaflyOrderWorkflow[\s\S]*\) : !isClosed \? \(/);
    expect(ORDER_PAGE).toMatch(/<LeaflyOutcomeBanners[\s/>]/);
    expect(ORDER_PAGE).toContain("export const maxDuration = 300");
    expect(ORDER_PAGE).toContain("blockedMessage === MARKETPLACE_STEPS_REFUSAL");
  });

  it("the Leafly details route exists, is protected, and forwards once accepted", () => {
    expect(existsSync(join(ROOT, LEAFLY_ROUTE_PATH))).toBe(true);
    const route = code(read(LEAFLY_ROUTE_PATH));
    expect(route).toContain('requirePermission("orders.view")');
    expect(route).toContain("export const maxDuration = 300");
    expect(route).toContain("notFound()");
    expect(route).toMatch(/redirect\(`\/admin\/orders\/\$\{encodeURIComponent\(localId\)\}/);
    expect(route).toMatch(/<LeaflyOrderWorkflow[\s/>]/);
    expect(route).toMatch(/<BackLink[\s\S]{0,200}back=\{sp\.back\}/);
  });

  it("the step outcome never sticks to the Back link", () => {
    for (const k of ["leaflyMsg", "leaflyWarn", "leaflyErr", "leaflyFix", "leaflyCode", "blocked"]) {
      expect(TRANSIENT_QUERY_KEYS.has(k)).toBe(true);
    }
  });

  it("the refusal text is plain English and names the right place", () => {
    expect(MARKETPLACE_STEPS_REFUSAL).toMatch(/Leafly steps on this page/);
  });
});
