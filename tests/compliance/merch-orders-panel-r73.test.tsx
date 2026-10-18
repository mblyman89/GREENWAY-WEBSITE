/**
 * R73 S1 - the Greenway Merch orders panel is the LAST panel on /admin/orders
 * and is identical to the other two (same shell, same controls, same row),
 * with a details page where it is managed.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

import { MerchOrdersPanel } from "../../src/components/admin/orders/MerchOrdersPanel";
import { OrdersPanel } from "../../src/components/admin/orders/OrdersPanel";
import { countByStatus, parseOrdersPanelQuery } from "../../src/lib/orders/order-panels-core";
import { listWindow } from "../../src/lib/admin/list-window-core";
import { parsePrintfulOrder, __runMerchOrdersPanelTests } from "../../src/lib/orders/merch-orders-core";
import type { MerchBoard } from "../../src/lib/orders/merch-orders-server";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const NOW = new Date("2026-10-01T18:00:00Z");

const pf = (id: number, status: string, name: string, state = "WA") =>
  parsePrintfulOrder({
    id,
    external_id: `gm-ord${id}00-a`,
    status,
    created: Math.floor(Date.parse("2026-10-01T17:00:00Z") / 1000) - id * 60,
    recipient: { name, city: "Spokane", state_code: state, zip: "99201", country_code: "US", email: `${name.toLowerCase()}@x.com` },
    items: [{ name: "Tee", quantity: 1, retail_price: "25.00", price: "11.00" }],
    costs: { total: "15.00" },
    retail_costs: { total: "31.00", tax: "2.50" },
  })!;

const board = (): MerchBoard => ({
  configured: true,
  totalAtPrintful: 3,
  problem: "",
  orders: [pf(1, "draft", "Ada"), pf(2, "inprocess", "Bea", "OR"), pf(3, "fulfilled", "Cy")],
});

const renderMerch = (sp: Record<string, string> = {}, b: MerchBoard = board()) =>
  renderToStaticMarkup(<MerchOrdersPanel board={b} query={parseOrdersPanelQuery(sp, "merch")} searchParams={sp} now={NOW} />);

const renderGreenway = () =>
  renderToStaticMarkup(
    <OrdersPanel
      panel="greenway"
      title="Greenway orders"
      subtitle="x"
      icon="🧾"
      counts={countByStatus([])}
      query={parseOrdersPanelQuery({}, "greenway")}
      searchParams={{}}
      window={listWindow(0, 1, 25)}
      total={0}
      emptyDescription="none"
    >
      {null}
    </OrdersPanel>,
  );

function controls(html: string) {
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  return {
    labels: [...form.matchAll(/<label[^>]*>([^<]+)<\/label>/g)].map((m) => m[1].trim()),
    tabs: [...form.matchAll(/<a [^>]*>([A-Za-z-]+)<span/g)].map((m) => m[1]),
    inputNames: [...form.matchAll(/<(?:input|select)[^>]*name="([^"]+)"/g)].map((m) => m[1]).filter((n) => !/status$/.test(n)),
  };
}

describe("R73 S1 · merch panel is identical to the other two", () => {
  it("passes the core self-tests", () => {
    expect(__runMerchOrdersPanelTests().failed).toBe(0);
  });
  it("same labels and tabs as Greenway; m-prefixed names", () => {
    const g = controls(renderGreenway());
    const m = controls(renderMerch());
    expect(m.labels).toEqual(g.labels);
    expect(m.tabs).toEqual(g.tabs);
    expect(m.inputNames).toEqual(g.inputNames.map((n) => `m${n}`));
  });
  it("is its own landmark with an anchor", () => {
    expect(renderMerch()).toMatch(/<section id="merch-orders" aria-labelledby="merch-orders-title"/);
    expect(renderMerch()).toContain(">Greenway Merch orders<");
  });
  it("Active shows draft + in production, not shipped; Details links to the merch page with back", () => {
    const html = renderMerch({ status: "ready" });
    expect(html).toContain("Ada");
    expect(html).toContain("Bea");
    expect(html).not.toContain(">Cy<");
    expect(html).toContain('href="/admin/orders/merch/gm-ord100-a?back=status%3Dready"');
    expect(html).toContain("waiting for you to confirm");
  });
  it("flags an out-of-state ship-to", () => {
    expect(renderMerch()).toContain("Ships to OR");
  });
  it("says plainly when Printful is not connected", () => {
    expect(renderMerch({}, { configured: false, orders: [], totalAtPrintful: null, problem: "" })).toContain("PRINTFUL_API_TOKEN");
  });
  it("the page renders it LAST, after Greenway and Leafly", () => {
    const page = read("src/app/admin/orders/page.tsx");
    const g = page.indexOf("{greenwaySection}");
    const l = page.indexOf("{leaflySection}");
    const m = page.indexOf("<MerchOrdersPanel");
    expect(g).toBeGreaterThan(-1);
    expect(l).toBeGreaterThan(g);
    expect(m).toBeGreaterThan(l);
    expect(page).toContain('parseOrdersPanelQuery(sp, "merch")');
  });
  it("steps are guarded by permission and a fresh status read", () => {
    const actions = read("src/app/admin/orders/merch-actions.ts");
    expect(actions).toContain('requirePermission("orders.manage")');
    expect(actions).toMatch(/getMerchOrder\(handle\)[\s\S]*MERCH_CONFIRMABLE\.has\(status\)/);
    expect(actions).toContain("recordAudit(");
  });
});
