/**
 * tests/compliance/orders-panels-l40.test.tsx
 *
 * SLICE L-40 — "I want the leafly section to look identical to our section
 * above it. our orders section should be labeled greenway orders, and the
 * leafly section remains labeled leafly orders. but the search bar and sort
 * and filters should look and behave identically … so I want to remove the
 * leafly section moving above our section."
 *
 * What this file proves, by RENDERING the real components (not by grepping):
 *
 *   1. Both panels carry the same controls — the nine status tabs, Search with
 *      the same placeholder, Placed from / Placed to, Total min $ / Total max $,
 *      Sort by with the same options, Apply, and Clear — in the same order.
 *      The ONLY difference allowed is the query-string name (ours `q`, Leafly
 *      `lq`), which keeps one form from driving the other panel.
 *   2. The titles are "Greenway orders" and "Leafly orders".
 *   3. The Leafly panel carries no "15 minutes" copy while auto-accept is on.
 *   4. The controls BEHAVE: a Leafly tab filters the Leafly rows, a Leafly
 *      link keeps our panel's view, and Clear lands back on the right panel.
 *   5. The page renders Greenway then Leafly, fixed, once each.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: false }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

import { OrdersPanel } from "../../src/components/admin/orders/OrdersPanel";
import { LeaflyOrdersPanel } from "../../src/components/admin/orders/LeaflyOrdersPanel";
import {
  ORDERS_PANEL_TABS,
  countByStatus,
  parseOrdersPanelQuery,
  panelHref,
  __runOrdersPanelTests,
} from "../../src/lib/orders/order-panels-core";
import { listWindow } from "../../src/lib/admin/list-window-core";
import { ORDER_SORTS } from "../../src/lib/admin/list-filter-core";
import type { LeaflyBoardOrder, LeaflyBoardState } from "../../src/lib/leafly/order-board-server";
import type { OrderRow } from "../../src/lib/orders/types";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const NOW = new Date("2026-10-01T18:00:00Z");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Every Leafly order a board could hold, with sensible defaults. */
function lo(over: Partial<LeaflyBoardOrder> & { id: string }): LeaflyBoardOrder {
  return {
    leafly_order_id: `aaaaaaaa-0000-0000-0000-${over.id.padStart(12, "0")}`,
    leafly_status: "confirmed",
    fulfillment_mechanism: "pickup",
    marketplace: null,
    medical_status: null,
    payment_preference: null,
    acknowledge_by: null,
    acknowledged_at: "2026-10-01T17:50:00Z",
    canceled_at: null,
    cancelation_reason_code: null,
    local_order_id: null,
    first_seen_at: "2026-10-01T17:49:00Z",
    updated_at: "2026-10-01T17:50:00Z",
    announced_at: "2026-10-01T17:49:05Z",
    printed_at: "2026-10-01T17:49:06Z",
    confirm_push_failed_at: null,
    acknowledged_by_kind: "auto",
    ...over,
  };
}

function local(id: string, status: OrderRow["status"], name: string): OrderRow {
  return {
    id,
    order_number: `GW-${id}`,
    display_name: null,
    public_token: `t-${id}`,
    status,
    customer_first_name: name,
    customer_last_name: null,
    customer_email: null,
    customer_phone: null,
    customer_birthday: null,
    subtotal_minor_units: 2000,
    estimated_tax_minor_units: 0,
    savings_minor_units: 0,
    total_minor_units: 2000,
    item_count: 1,
    origin: "leafly",
    placed_at: "2026-10-01T17:49:00Z",
  } as unknown as OrderRow;
}

function leaflyBoard(): { board: LeaflyBoardState; linked: Map<string, OrderRow> } {
  const orders = [
    lo({ id: "1", local_order_id: "L1" }),
    lo({ id: "2", local_order_id: "L2" }),
    lo({ id: "3", local_order_id: "L3", leafly_status: "completed" }),
  ];
  const linked = new Map<string, OrderRow>([
    ["L1", local("L1", "preparing", "Ada")],
    ["L2", local("L2", "ready", "Bea")],
    ["L3", local("L3", "completed", "Cy")],
  ]);
  return {
    board: { orders, ready: true, orderIntegrationKeyPresent: true, problem: "" },
    linked,
  };
}

function renderLeafly(sp: Record<string, string> = {}, autoAcknowledge = true): string {
  const { board, linked } = leaflyBoard();
  return renderToStaticMarkup(
    <LeaflyOrdersPanel
      board={board}
      now={NOW}
      linkedOrders={linked}
      searchParams={sp}
      query={parseOrdersPanelQuery(sp, "leafly")}
      autoAcknowledge={autoAcknowledge}
      loadCap={200}
    />,
  );
}

function renderGreenway(sp: Record<string, string> = {}): string {
  const counts = countByStatus([{ status: "new" }, { status: "preparing" }]);
  return renderToStaticMarkup(
    <OrdersPanel
      panel="greenway"
      title="Greenway orders"
      subtitle="Orders placed on our website."
      icon="🧾"
      counts={counts}
      query={parseOrdersPanelQuery(sp, "greenway")}
      searchParams={sp}
      window={listWindow(2, 1, 25)}
      total={2}
      emptyDescription="none"
    >
      <div>ROW-A</div>
      <div>ROW-B</div>
    </OrdersPanel>,
  );
}

/** The control skeleton a person sees, with panel-specific names normalised. */
function controls(html: string) {
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  return {
    labels: [...form.matchAll(/<label[^>]*>([^<]+)<\/label>/g)].map((m) => m[1].trim()),
    tabs: [...form.matchAll(/<a [^>]*>([A-Za-z-]+)<span/g)].map((m) => m[1]),
    placeholders: [...form.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]),
    options: [...form.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]),
    // The shared Button wraps its label in a <span>; read the words a person sees.
    buttons: [...form.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1])),
    inputNames: [...form.matchAll(/<(?:input|select)[^>]*name="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((n) => !["status", "lstatus"].includes(n)),
    method: /method="get"/.test(form),
  };
}

// ===========================================================================
describe("L-40 · both panels render the SAME controls", () => {
  const g = controls(renderGreenway());
  const l = controls(renderLeafly());

  it("the same field labels, in the same order", () => {
    expect(g.labels).toEqual([
      "Search",
      "Placed from",
      "Placed to",
      "Total min $",
      "Total max $",
      "Sort by",
    ]);
    expect(l.labels).toEqual(g.labels);
  });

  it("the same nine status tabs, in the same order", () => {
    const want = ["Active", "New", "Acknowledged", "Preparing", "Ready", "Completed", "Cancelled", "No-show", "All"];
    expect(ORDERS_PANEL_TABS.map((t) => t.label)).toEqual(want);
    expect(g.tabs).toEqual(want);
    expect(l.tabs).toEqual(want);
  });

  it("the same placeholder, sort options and Apply button", () => {
    expect(g.placeholders[0]).toBe("Name, phone, order #");
    expect(l.placeholders).toEqual(g.placeholders);
    expect(g.options).toEqual(ORDER_SORTS.map((o) => o.label));
    expect(l.options).toEqual(g.options);
    expect(g.buttons).toEqual(["Apply"]);
    expect(l.buttons).toEqual(["Apply"]);
  });

  it("both are plain GET forms", () => {
    expect(g.method).toBe(true);
    expect(l.method).toBe(true);
  });

  it("the only difference is the l-prefix on Leafly's query names", () => {
    expect(g.inputNames).toEqual(["q", "from", "to", "min", "max", "sort"]);
    expect(l.inputNames).toEqual(g.inputNames.map((n) => `l${n}`));
  });

  it("both show the same four stat cards, in the same order", () => {
    // Read the CARD labels themselves (StatCard's label paragraph). A plain
    // text search is not enough: "Ready" and "New" are also tab labels, so a
    // renamed card would hide behind the tab (a mutation check proved this).
    const cards = (html: string) =>
      [...html.matchAll(/<p class="text-\[0\.7rem\][^"]*">([^<]+)<\/p>/g)].map((m) => m[1].trim());
    const want = ["New", "Preparing", "Ready", "Active total"];
    expect(cards(renderGreenway())).toEqual(want);
    expect(cards(renderLeafly())).toEqual(want);
  });

  it("both show Clear once a filter is on, and not before", () => {
    expect(renderGreenway()).not.toMatch(/>Clear</);
    expect(renderLeafly()).not.toMatch(/>Clear</);
    expect(renderGreenway({ q: "ada" })).toMatch(/>Clear</);
    expect(renderLeafly({ lq: "ada" })).toMatch(/>Clear</);
  });
});

// ===========================================================================
describe("L-40 · titles, containment and copy", () => {
  it("our panel is 'Greenway orders' and theirs stays 'Leafly orders'", () => {
    expect(renderGreenway()).toContain(">Greenway orders<");
    expect(renderLeafly()).toContain(">Leafly orders<");
  });

  it("each panel is its own landmark section with an anchor to land on", () => {
    expect(renderGreenway()).toMatch(/<section id="greenway-orders" aria-labelledby="greenway-orders-title"/);
    expect(renderLeafly()).toMatch(/<section id="leafly-orders" aria-labelledby="leafly-orders-title"/);
  });

  it("no 15-minute deadline copy while orders are accepted automatically", () => {
    const t = text(renderLeafly());
    expect(t).not.toMatch(/15 minutes|fifteen minutes|awaiting acknowledgement from us/i);
    expect(t).toContain("accepted automatically");
  });

  it("says so honestly if automatic acceptance is switched off", () => {
    expect(text(renderLeafly({}, false))).toContain("Automatic acceptance is switched off");
  });

  it("the old L-28 Show / Find controls are gone", () => {
    const html = renderLeafly();
    expect(html).not.toContain('name="lfilter"');
    expect(html).not.toMatch(/>Accept now</);
  });
});

// ===========================================================================
describe("L-40 · the Leafly controls BEHAVE like ours", () => {
  it("Active shows the preparing and ready orders, not the completed one", () => {
    const t = text(renderLeafly());
    expect(t).toContain("Ada");
    expect(t).toContain("Bea");
    expect(t).not.toContain("Cy");
  });

  it("the Ready tab narrows to the ready order", () => {
    const t = text(renderLeafly({ lstatus: "ready" }));
    expect(t).toContain("Bea");
    expect(t).not.toContain("Ada");
  });

  it("Completed shows the finished order", () => {
    expect(text(renderLeafly({ lstatus: "completed" }))).toContain("Cy");
  });

  it("search finds a customer by name", () => {
    const t = text(renderLeafly({ lstatus: "all", lq: "bea" }));
    expect(t).toContain("Bea");
    expect(t).not.toContain("Ada");
  });

  it("the tab counts on the Leafly panel are Leafly's own", () => {
    // Active = preparing + ready = 2; Completed = 1.
    const html = renderLeafly();
    expect(html).toMatch(/Active<span[^>]*>2<\/span>/);
    expect(html).toMatch(/Completed<span[^>]*>1<\/span>/);
  });

  it("a Leafly link keeps our panel's view and lands on the Leafly panel", () => {
    const href = panelHref({ status: "ready", q: "ada", lq: "x" }, "leafly", { kind: "status", status: "completed" });
    const u = new URL(href, "https://x.test");
    expect(u.searchParams.get("status")).toBe("ready");
    expect(u.searchParams.get("q")).toBe("ada");
    expect(u.searchParams.get("lstatus")).toBe("completed");
    expect(u.searchParams.get("lq")).toBe("x");
    expect(u.hash).toBe("#leafly-orders");
  });

  it("the Leafly form carries our view as hidden fields, so Apply leaves ours alone", () => {
    const html = renderLeafly({ status: "ready", q: "ada" });
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    expect(form).toMatch(/type="hidden" name="status" value="ready"/);
    expect(form).toMatch(/type="hidden" name="q" value="ada"/);
  });
});

// ===========================================================================
describe("L-40 · the page wires it up", () => {
  const PAGE = codeOnly(read("src/app/admin/orders/page.tsx"));

  it("renders Greenway then Leafly, fixed, once each", () => {
    const g = PAGE.indexOf("{greenwaySection}");
    const l = PAGE.indexOf("{leaflySection}");
    expect(g).toBeGreaterThan(-1);
    expect(l).toBeGreaterThan(g);
    expect(PAGE).not.toMatch(/boardLayout|decideBoardLayout|leaflyPromoted/);
  });

  it("both panels go through the shared shell", () => {
    expect(PAGE).toMatch(/<OrdersPanel\s+panel="greenway"\s+title="Greenway orders"/);
    const leafly = codeOnly(read("src/components/admin/orders/LeaflyOrdersPanel.tsx"));
    expect(leafly).toMatch(/<OrdersPanel\s+panel="leafly"\s+title="Leafly orders"/);
  });

  it("both panels read their view through the same grammar", () => {
    expect(PAGE).toContain('parseOrdersPanelQuery(sp, "greenway")');
    expect(PAGE).toContain('parseOrdersPanelQuery(sp, "leafly")');
  });

  it("tells the Leafly panel the truth about auto-accept and the load cap", () => {
    expect(PAGE).toContain("autoAcknowledge={isAutoAcknowledgeEnabled(process.env[LEAFLY_AUTO_ACK_ENV_VAR])}");
    expect(PAGE).toContain("loadCap={LEAFLY_BOARD_LIMIT}");
  });

  it("one picked-up-at-register lookup covers both panels", () => {
    expect((PAGE.match(/registerPickedUpOrderIds\(/g) ?? []).length).toBe(1);
    expect(PAGE).toMatch(/leaflyLinkedOrders\.values\(\)/);
    expect(PAGE).toContain("pickedUpAtRegister={pickedUpAtRegister}");
  });

  it("the page-level stat cards and promotion banner are gone (each panel has its own)", () => {
    expect(PAGE).not.toContain("<StatCard");
    expect(PAGE).not.toContain("shown first");
  });
});

// ===========================================================================
describe("L-40 · the pure core is registered and floored", () => {
  it("self-tests pass", () => {
    const r = __runOrdersPanelTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(88);
  });

  it("is in the CI harness with a floor no higher than the measured count", () => {
    const harness = read("scripts/compliance/run-pure-selftests.ts");
    const m = harness.match(/assertRan\("order-panels-core", __runOrdersPanelTests\(\), (\d+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(80);
    expect(Number(m![1])).toBeLessThanOrEqual(__runOrdersPanelTests().passed);
  });
});
