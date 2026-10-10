/**
 * R38 S2-S4 — the data-rich table, page sizes + numbered pager top AND
 * bottom with Back to top, display choices that survive filtering, and the
 * intelligent export route.
 *
 * Owner: "pick something like 25, 50, 100, all … The scroll pages feature
 * should be at the bottom and top of the list, with a return to the top of
 * the list button at the bottom … add an export feature. An intelligent one
 * that allows me to export any and all data I need and want."
 *
 *   A. InventoryTablePager rendered for real (renderToStaticMarkup): numbers,
 *      carets, disabled ends, aria-current, page-size links, Back to top
 *      ONLY at the bottom, every link keeps the filters.
 *   B. InventoryTableToolbar: presets, column picker carries filters, export
 *      form carries filters AND the current page (bug found while writing
 *      this test: carryFields drops page, so "this page" exported page 1).
 *   C. InventoryFilterPanel + clearAllFiltersHref keep per/view/cols/density.
 *   D. The export route end-to-end over the real cores + workbook renderer
 *      with only the data loader / auth / audit mocked: scope view/page/all,
 *      columns visible/all, CSV formula guard, 503 fail-closed, permission,
 *      audit row.
 *   E. Page pins: both pagers, toolbar, sticky frame, totals footer, metrics
 *      joined, every registry column rendered behind show().
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type AnyLot = Record<string, unknown>;
const st = vi.hoisted(() => ({
  lots: [] as AnyLot[],
  onboardingComplete: true,
  categoriesComplete: true,
  calls: [] as string[],
  audits: [] as Array<{ action: string; after: Record<string, unknown> }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; after: Record<string, unknown> }) => {
    st.audits.push({ action: a.action, after: a.after });
  },
}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
}));
vi.mock("@/lib/inventory/inventory-table-server", () => ({
  loadInventoryTableLots: async () => {
    st.calls.push("load");
    return {
      lots: st.lots,
      leafly: { keys: new Set(["K2"]), title: "On Leafly" },
      onboardingComplete: st.onboardingComplete,
      categoriesComplete: st.categoriesComplete,
    };
  },
}));

const { InventoryTablePager } = await import("@/components/admin/inventory/InventoryTablePager");
const { InventoryTableToolbar } = await import("@/components/admin/inventory/InventoryTableToolbar");
const { InventoryFilterPanel } = await import("@/components/admin/inventory/InventoryFilterPanel");
const { listWindow } = await import("@/lib/admin/list-window-core");
const tableCore = await import("@/lib/inventory/inventory-table-core");
const urlCore = await import("@/lib/inventory/inventory-url-core");
const filterCore = await import("@/lib/inventory/inventory-filter-core");
const { __testPageLot } = await import("@/lib/inventory/inventory-page-core");
const { GET: exportGET } = await import("@/app/admin/inventory/export/route");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const amp = (s: string) => s.replace(/&amp;/g, "&");
const hrefOf = (html: string, testId: string) => {
  const m = html.match(new RegExp(`<a[^>]*data-testid="${testId}"[^>]*>`)) ?? html.match(new RegExp(`<a[^>]*href="[^"]*"[^>]*data-testid="${testId}"`));
  const tag = m?.[0] ?? "";
  return amp(tag.match(/href="([^"]*)"/)?.[1] ?? "");
};
const hidden = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`type="hidden" name="${name}" value="([^"]*)"`, "g"))].map((m) => amp(m[1]));
const formHidden = (html: string, action: string) => {
  const i = html.indexOf(`action="${action}"`);
  const j = html.indexOf("</form>", i);
  return html.slice(i, j);
};

// ---------------------------------------------------------------------------
describe("R38 S3 A — numbered pager, top and bottom", () => {
  const raw = { status: "active", fVendor: "Phat Panda", page: "10", per: "25" };
  const render = (page: number, total: number, position: "top" | "bottom", per: 25 | 50 | 100 | 250 | "all" = 25) =>
    renderToStaticMarkup(
      <InventoryTablePager
        window={listWindow(total, page, per === "all" ? total : per)}
        total={total}
        raw={{ ...raw, page: String(page) }}
        pageSize={per}
        position={position}
        topAnchorId="inventory-table-top"
      />,
    );

  it("numbers with ellipses, current page marked, carets go one page and keep every filter", () => {
    const html = render(10, 500, "top"); // 20 pages
    expect(html).toContain('data-testid="inventory-pager-top"');
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="inventory-pager-current"[^>]*>10</);
    const nums = [...html.matchAll(/data-testid="inventory-pager-number"[^>]*>(\d+)</g)].map((m) => m[1]);
    expect(nums).toEqual(["1", "8", "9", "11", "12", "20"]);
    expect((html.match(/\u2026/g) ?? []).length).toBe(2);
    expect(hrefOf(html, "inventory-pager-prev")).toBe("/admin/inventory?fVendor=Phat+Panda&page=9&per=25&status=active");
    expect(hrefOf(html, "inventory-pager-next")).toBe("/admin/inventory?fVendor=Phat+Panda&page=11&per=25&status=active");
    expect(hrefOf(html, "inventory-pager-first")).toBe("/admin/inventory?fVendor=Phat+Panda&per=25&status=active");
    expect(hrefOf(html, "inventory-pager-last")).toBe("/admin/inventory?fVendor=Phat+Panda&page=20&per=25&status=active");
    expect(html).toContain("page 10 of 20");
  });

  it("first page: back carets disabled; last page: forward carets disabled", () => {
    const first = render(1, 500, "top");
    expect(first).toContain('data-testid="inventory-pager-first-disabled"');
    expect(first).toContain('data-testid="inventory-pager-prev-disabled"');
    expect(first).not.toContain('data-testid="inventory-pager-prev"');
    expect(hrefOf(first, "inventory-pager-next")).toContain("page=2");
    const last = render(20, 500, "top");
    expect(last).toContain('data-testid="inventory-pager-next-disabled"');
    expect(last).toContain('data-testid="inventory-pager-last-disabled"');
    expect(hrefOf(last, "inventory-pager-prev")).toContain("page=19");
  });

  it("rows-per-page 25/50/100/250/All: current one is not a link, the others reset to page 1 and keep filters", () => {
    const html = render(10, 500, "top");
    expect(html).not.toContain('data-testid="inventory-page-size-25"');
    expect(html).toMatch(/aria-current="true"[^>]*>25</);
    expect(hrefOf(html, "inventory-page-size-50")).toBe("/admin/inventory?fVendor=Phat+Panda&per=50&status=active");
    // 100 is the default, so it carries no param at all.
    expect(hrefOf(html, "inventory-page-size-100")).toBe("/admin/inventory?fVendor=Phat+Panda&status=active");
    expect(hrefOf(html, "inventory-page-size-250")).toBe("/admin/inventory?fVendor=Phat+Panda&per=250&status=active");
    expect(hrefOf(html, "inventory-page-size-all")).toBe("/admin/inventory?fVendor=Phat+Panda&per=all&status=active");
  });

  it("Back to top is at the bottom only, and targets the anchor above the table", () => {
    expect(render(3, 500, "top")).not.toContain("inventory-back-to-top");
    const bottom = render(3, 500, "bottom");
    expect(bottom).toContain('data-testid="inventory-pager-bottom"');
    expect(bottom).toMatch(/href="#inventory-table-top"[^>]*data-testid="inventory-back-to-top"/);
    expect(bottom).toContain("Back to top");
  });

  it("All on one page: no number bar, label says everything, page size still offered", () => {
    const html = render(1, 1234, "bottom", "all");
    expect(html).not.toContain("inventory-pager-number");
    expect(html).not.toContain("inventory-pager-next");
    expect(html).toContain("Showing all 1234 lots");
    expect(html).toMatch(/aria-current="true"[^>]*>All</);
    expect(hrefOf(html, "inventory-page-size-25")).toContain("per=25");
    expect(html).toContain("inventory-back-to-top");
  });
});

// ---------------------------------------------------------------------------
describe("R38 S3 B — toolbar: views, columns, density, export", () => {
  const raw = { status: "active", fVendor: ["A, LLC", "B"], page: "3", per: "50", view: "money" };
  const html = renderToStaticMarkup(
    <InventoryTableToolbar raw={raw} view={tableCore.parseColumnView(raw)} density="comfortable" matchedCount={321} pageCount={50} allCount={4000} />,
  );

  it("every preset is a link; the active one is highlighted; presets keep filters and page size", () => {
    for (const p of tableCore.COLUMN_PRESETS) expect(html).toContain(`data-testid="inventory-view-${p.key}"`);
    expect(hrefOf(html, "inventory-view-lab")).toBe("/admin/inventory?fVendor=A%2C+LLC&fVendor=B&per=50&status=active&view=lab");
    expect(html).toMatch(/class="[^"]*bg-\[var\(--admin-accent\)\][^"]*"[^>]*data-testid="inventory-view-money"/);
    expect(html).not.toMatch(/class="[^"]*bg-\[var\(--admin-accent\)\][^"]*"[^>]*data-testid="inventory-view-lab"/);
  });

  it("column picker: one checkbox per registry column, current view pre-checked, filters carried, product always on", () => {
    const form = formHidden(html, "/admin/inventory");
    const boxes = [...form.matchAll(/type="checkbox"(?: disabled="")? name="cols"(?: checked="")? value="([^"]+)"/g)].map((m) => m[1]);
    // Grouped (Identity, Product, Lab …), so compare as a set; no duplicates.
    expect(boxes).toHaveLength(tableCore.TABLE_COLUMN_IDS.length);
    expect([...boxes].sort()).toEqual([...tableCore.TABLE_COLUMN_IDS].sort());
    expect(form).toMatch(/checked="" value="extcost"/);
    expect(form).not.toMatch(/checked="" value="thc"/);
    expect(form).toMatch(/type="checkbox" disabled="" name="cols" checked="" value="product"/);
    expect(hidden(form, "fVendor")).toEqual(["A, LLC", "B"]);
    expect(hidden(form, "per")).toEqual(["50"]);
    expect(hidden(form, "view")).toEqual([]); // cols replaces the preset
    expect(hidden(form, "cols")).toEqual(["product"]);
  });

  it("density toggles compact and back", () => {
    expect(hrefOf(html, "inventory-density")).toContain("density=compact");
    const compact = renderToStaticMarkup(
      <InventoryTableToolbar raw={{ density: "compact" }} view={tableCore.parseColumnView({})} density="compact" matchedCount={1} pageCount={1} allCount={1} />,
    );
    expect(hrefOf(compact, "inventory-density")).toBe("/admin/inventory");
  });

  it("export form: scope/columns/format radios with counts, carries filters, view AND the current page", () => {
    const form = formHidden(html, "/admin/inventory/export");
    expect(form).toMatch(/name="scope" checked="" value="view"/);
    expect(form).toContain("(321 lots)");
    expect(form).toContain("this page (50)");
    expect(form).toContain("tabs (4000)");
    expect(form).toMatch(/name="columns" checked="" value="visible"/);
    expect(form).toMatch(/name="format" checked="" value="xlsx"/);
    expect(form).toContain('name="format" value="csv"');
    expect(hidden(form, "fVendor")).toEqual(["A, LLC", "B"]);
    expect(hidden(form, "view")).toEqual(["money"]);
    expect(hidden(form, "page")).toEqual(["3"]);
    expect(hidden(form, "scope")).toEqual([]);
    const page1 = renderToStaticMarkup(
      <InventoryTableToolbar raw={{ status: "active" }} view={tableCore.parseColumnView({})} density="comfortable" matchedCount={1} pageCount={1} allCount={1} />,
    );
    expect(hidden(formHidden(page1, "/admin/inventory/export"), "page")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("R38 C — display choices survive filtering", () => {
  const raw = { status: "active", per: "250", cols: ["thc", "status"], density: "compact", fVendor: "A", q: "blue" };
  it("Apply in the filter panel keeps per / view / cols / density", () => {
    const html = renderToStaticMarkup(
      <InventoryFilterPanel raw={raw} state={filterCore.parseInventoryFilters(raw)} allLots={[]} activeCount={1} open />,
    );
    expect(hidden(html, "per")).toEqual(["250"]);
    expect(hidden(html, "cols")).toEqual(["thc", "status"]);
    expect(hidden(html, "density")).toEqual(["compact"]);
    expect(hidden(html, "view")).toEqual([]);
  });
  it("Clear all drops filters but keeps the layout", () => {
    expect(urlCore.clearAllFiltersHref(raw)).toBe("/admin/inventory?cols=thc&cols=status&density=compact&per=250&status=active");
    expect(urlCore.clearAllFiltersHref({ fVendor: "A" })).toBe("/admin/inventory");
    expect([...tableCore.DISPLAY_PARAMS]).toEqual([...urlCore.INVENTORY_DISPLAY_PARAMS]);
  });
});

// ---------------------------------------------------------------------------
function exportLot(i: number, over: AnyLot = {}): AnyLot {
  return {
    ...__testPageLot({
      id: `L${i}`,
      lot_code: `LC-${String(i).padStart(3, "0")}`,
      pos_product_key: `K${i}`,
      product_name: `Lot ${String(i).padStart(3, "0")}`,
      vendor_name: i % 2 ? "Phat Panda" : "Grow Op",
      on_hand_qty: 4,
      unit_cost_minor_units: 500,
      created_at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }),
    onboarding: {},
    website_category: "Flower",
    website_category_value: "flower",
    website_category_source: "menu_item",
    website_category_info: { value: "flower", label: "Flower", source: "menu_item", sourceText: "live menu", sourceTitle: "", unmapped: false, raw: null },
    inv_metrics: { ageDays: 30, agingBucket: "0-30", extCostMinor: 2000, extRetailMinor: null, sellThroughPct: 60, velocityPerDay: 0.2, daysOfSupply: 20, daysToExpiry: null, coaDaysToExpiry: null, abc: "B", onMenu: true },
    ...over,
  };
}
const csvRows = (text: string) => text.split("\n");
const lotsSection = (text: string) => {
  const lines = csvRows(text);
  const start = lines.findIndex((l) => l.startsWith("Lot ID,"));
  const end = lines.findIndex((l, i) => i > start && l === "");
  return lines.slice(start, end === -1 ? undefined : end);
};

describe("R38 S4 D — export route (real cores + real CSV/XLSX renderer)", () => {
  beforeEach(() => {
    st.lots = Array.from({ length: 30 }, (_, i) => exportLot(i + 1));
    st.lots.push(exportLot(99, { status: "sold_out", vendor_name: "Phat Panda", product_name: "=HYPERLINK(\"http://evil\")" }));
    st.onboardingComplete = true;
    st.categoriesComplete = true;
    st.calls = [];
    st.audits = [];
  });

  it("scope=view exports EVERY matching row across pages (not just page 1), honouring filters and sort", async () => {
    const res = await exportGET(
      new Request("http://x/admin/inventory/export?format=csv&fVendor=Phat+Panda&per=25&sc=product&sd=asc&cols=product&cols=vendor"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/greenway-inventory-view-\d{4}-\d{2}-\d{2}\.csv/);
    const text = await res.text();
    const sec = lotsSection(text);
    expect(sec[0]).toBe("Lot ID,Product,Lot code,Vendor,Brand");
    const body = sec.slice(1).filter((l) => !l.startsWith("Total"));
    // 15 odd-numbered active Phat Panda lots (the sold_out lot is outside the Active tab).
    expect(body).toHaveLength(15);
    expect(body[0]).toMatch(/^L1,Lot 001,LC-001,Phat Panda,/);
    expect(body[14]).toMatch(/^L29,Lot 029,/);
    expect(text).toContain("Status tab: active");
    expect(text).toMatch(/Vendor: Phat Panda/);
    expect(st.calls).toEqual(["perm:inventory.manage", "load"]);
    expect(st.audits).toHaveLength(1);
    expect(st.audits[0].action).toBe("inventory.export");
    expect(st.audits[0].after).toMatchObject({ scope: "view", columns: "visible", format: "csv", rows: 15, fields: 5 });
  });

  it("scope=view with MORE matches than one page still exports them all (30 lots at 25 per page, viewing page 1)", async () => {
    const res = await exportGET(new Request("http://x/admin/inventory/export?format=csv&per=25&cols=product"));
    const body = lotsSection(await res.text()).slice(1).filter((l) => !l.startsWith("Total"));
    expect(body).toHaveLength(30);
    expect(st.audits[0].after).toMatchObject({ scope: "view", rows: 30 });
  });

  it("scope=page exports only the page being looked at (page 2 at 25 per page)", async () => {
    const res = await exportGET(new Request("http://x/admin/inventory/export?format=csv&scope=page&per=25&page=2&sc=product&sd=asc&cols=product"));
    const body = lotsSection(await res.text()).slice(1).filter((l) => !l.startsWith("Total"));
    expect(body).toHaveLength(5); // 30 active lots, rows 26-30
    expect(body[0]).toMatch(/^L26,/);
    expect(st.audits[0].after).toMatchObject({ scope: "page", rows: 5 });
  });

  it("scope=all ignores filters and the status tab; columns=all exports every field", async () => {
    const res = await exportGET(new Request("http://x/admin/inventory/export?format=csv&scope=all&columns=all&fVendor=Grow+Op&cols=product"));
    const text = await res.text();
    expect(res.headers.get("Content-Disposition")).toMatch(/greenway-inventory-all-lots-/);
    const sec = lotsSection(text);
    const fields = tableCore.exportFieldsFor(tableCore.TABLE_COLUMN_IDS);
    expect(sec[0].split(",")).toHaveLength(fields.length);
    expect(sec.slice(1).filter((l) => !l.startsWith("Total"))).toHaveLength(31);
    expect(text).not.toContain("Vendor: Grow Op");
    expect(st.audits[0].after).toMatchObject({ scope: "all", columns: "all", rows: 31, fields: fields.length });
  });

  it("formula injection is neutralised in the file (CWE-1236)", async () => {
    const res = await exportGET(new Request("http://x/admin/inventory/export?format=csv&scope=all&cols=product"));
    const text = await res.text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });

  it("xlsx is a real workbook with Lots / Summary / Columns sheets", async () => {
    const res = await exportGET(new Request("http://x/admin/inventory/export?cols=product&cols=extcost"));
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Lots", "Summary", "Columns"]);
  });

  it("fails CLOSED (503, no file, no audit) when onboarding or categories did not load", async () => {
    st.categoriesComplete = false;
    let res = await exportGET(new Request("http://x/admin/inventory/export?format=csv"));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/website categories could not be fully loaded/);
    st.categoriesComplete = true;
    st.onboardingComplete = false;
    res = await exportGET(new Request("http://x/admin/inventory/export?format=csv"));
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/the onboarding decisions could not/);
    expect(st.audits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("R38 E — page wiring pins", () => {
  const inv = read("src/app/admin/inventory/page.tsx");
  it("numbered pager at the top AND bottom, toolbar above, anchor for Back to top", () => {
    expect(inv).toContain('<div id="inventory-table-top"');
    expect(inv).toMatch(/<InventoryTableToolbar[\s\S]*?\/>/);
    expect(inv).toMatch(/<InventoryTablePager[^>]*position="top"/);
    expect(inv).toMatch(/<InventoryTablePager[^>]*position="bottom"[^>]*topAnchorId="inventory-table-top"/);
    expect(inv).not.toContain("<ListPager");
    expect(inv).toContain("const pageSize = effectivePageSize(pageChoice, joinedLots.length);");
    expect(inv).toContain("const win = listWindow(total, view.page, pageSize);");
  });
  it("sticky header + frozen first column inside a two-way scroll frame; totals over all matched rows", () => {
    expect(inv).toContain('data-table-scroll data-testid="inventory-table-scroll"');
    expect(inv).toContain('<thead className="sticky top-0');
    expect(inv).toContain('className="sticky left-0 z-30');
    expect(inv).toContain("const totals = inventoryTotals(view.matched as unknown as TableLot[]);");
    expect(inv).toContain('data-testid="inventory-totals"');
  });
  it("every registry column is rendered behind show(id), header and cell", () => {
    for (const id of tableCore.TABLE_COLUMN_IDS) {
      if (id === "product") continue;
      const n = inv.split(`show("${id}")`).length - 1;
      expect(n, id).toBe(2);
    }
  });
  it("metrics joined in the page and the export loader the same way", () => {
    const srv = read("src/lib/inventory/inventory-table-server.ts");
    for (const src of [inv, srv]) {
      expect(src).toMatch(/attachInventoryMetrics\(categorized\.lots, \{\s*today: pacificToday\(\),\s*liveKeys: categorized\.liveKeys,\s*abcByLot: intel\.center\.abcByLot,/);
    }
  });
  it("the export route is staff-gated and audited", () => {
    const route = read("src/app/admin/inventory/export/route.ts");
    expect(route).toContain('requirePermission("inventory.manage")');
    expect(route).toContain('action: "inventory.export"');
  });
});
