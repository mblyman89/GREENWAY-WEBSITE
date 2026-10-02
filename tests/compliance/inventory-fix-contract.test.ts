/**
 * S37 — Inventory fix contract (bible S37.2 / S37.5; F-131, F-134).
 *
 * Bible: "Contract test: every href the Inventory page and its Issues tab can
 * emit resolves to a route file AND that file contains the control (form field
 * name or anchor id) that performs the fix."
 *
 * S31 (pipeline-fix-links-connected) already proves every link lands on a real
 * page with declared keys and a rendered anchor. That is necessary but not
 * sufficient: Round 11 found a link that landed on a real anchor with NO
 * control behind it ("Open lot (see its product details)" — the key was
 * read-only). This file closes that gap. For every inventory fix href it
 * requires a CONTROL RULE naming the exact source text of the control that
 * completes the fix, and checks that text is present in the route file.
 *
 * Four guarantees, each with a negative test:
 *   1. every emitted href matches exactly one rule (an unclassified href fails);
 *   2. each rule's route file is what the href actually resolves to;
 *   3. each rule's control strings are present verbatim;
 *   4. every rule is used by at least one href (no stale rule hides a gap).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildRouteTable, parseHref, resolveRoute, type RouteEntry } from "@/lib/admin/fix-link-contract-core";
import { fixLinkForLot, bulkFixLinkForCause, type BlockedCause } from "@/lib/inventory/blocked-stock-fix-core";
import { buildInventoryIssues, buildIntelIssues, gapBulkFillHref, type Issue } from "@/lib/admin/issues-core";
import { inventoryGapInsights } from "@/lib/insight/inventory";
import { lotGapHref, LOT_GAP_DEFINITIONS } from "@/lib/inventory/lot-gap-core";
import { lotPageHref } from "@/lib/pos/issue-fix-link-core";
import { BULK_FILLABLE_FIELDS } from "@/lib/inventory/bulk-fill-core";
import type { InventoryStats } from "@/lib/inventory/store";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f.replace(/\\/g, "/"));
  }
  return out;
}
const TABLE: RouteEntry[] = buildRouteTable(walk("src").filter((f) => /\/(page|route)\.tsx?$/.test(f)));
const read = (f: string) => readFileSync(f, "utf8");

const LOT = "11111111-1111-4111-8111-111111111111";
const INV = "src/app/admin/inventory/page.tsx";
const LOTPAGE = "src/app/admin/inventory/[id]/page.tsx";
const PANELS = "src/components/admin/inventory/LotLinkPanels.tsx";
const BANNER = "src/components/admin/inventory/RegisterSellabilityBanner.tsx";
const BULK = "src/components/admin/inventory/BulkFillPanel.tsx";

const CAUSES: readonly BlockedCause[] = ["no_product_link", "no_menu_card", "hidden_card", "recall_hold", "lot_not_active", "lot_empty"];

function stats(): InventoryStats {
  return {
    total: 100, active: 90, quarantine: 2, recalled: 1, destroyed: 1, soldOut: 1, emptyActive: 3,
    missingCoa: 4, missingProductLink: 5, expiringSoon: 6, expired: 7, missingExpiry: 8, unknownCost: 9,
    onHandCostMinor: 1000, costSkippedUnknown: 1, missingReceivedDate: 2, missingReceivedDateWithStock: 2,
  };
}

function issueHrefs(issues: readonly Issue[]): string[] {
  const out: string[] = [];
  for (const i of issues) {
    if (i.fix) out.push(i.fix.href);
    for (const e of i.extra ?? []) out.push(e.href);
  }
  return out;
}

/** Every href the Inventory page, its banners and its Issues tab can emit. */
function inventoryHrefs(): Map<string, string> {
  const out = new Map<string, string>();
  const add = (h: string | null | undefined, from: string) => {
    if (!h) return;
    const href = h.startsWith("#") ? `/admin/inventory${h}` : h;
    if (!out.has(href)) out.set(href, from);
  };
  for (const c of CAUSES) {
    add(fixLinkForLot(c, LOT, "SKU-9").href, `fixLinkForLot(${c}, key)`);
    add(fixLinkForLot(c, LOT, null).href, `fixLinkForLot(${c}, null)`);
    add(bulkFixLinkForCause(c, 3)?.href, `bulkFixLinkForCause(${c})`);
  }
  const gaps = inventoryGapInsights(stats());
  for (const g of gaps) {
    add(g.href, `inventoryGapInsights(${g.key})`);
    add(gapBulkFillHref(g.key, g.href), `gapBulkFillHref(${g.key})`);
  }
  for (const d of LOT_GAP_DEFINITIONS) add(lotGapHref(d.key), `lotGapHref(${d.key})`);
  for (const h of issueHrefs(
    buildInventoryIssues({
      receivedDateFlag: "2 lots have no received date",
      receivedMissingWithStock: 2,
      gaps: gaps.map((g) => ({ key: g.key, label: g.label, count: g.count, href: g.href, weight: g.weight })),
      blockedByCause: { no_product_link: 1, no_menu_card: 1, hidden_card: 1, recall_hold: 1 },
      restorableCount: 2,
      intelExpiredRows: 1,
    }),
  )) add(h, "buildInventoryIssues");
  for (const h of issueHrefs(
    buildIntelIssues(
      { supply: { months: 5, overCeiling: true }, overdue: { total: 2 }, medicalInStock: 3 },
      {
        today: "2026-01-10",
        lots: [{ id: LOT, productName: "X", status: "active", expiresOn: "2026-01-01" }],
        medicalEndorsement: false,
      },
    ),
  )) add(h, "buildIntelIssues");
  add(lotPageHref(LOT, "coa"), "lotPageHref(coa)");
  return out;
}

type Rule = {
  name: string;
  /** Does this rule classify the href? */
  match: (href: string) => boolean;
  /** The route file the href must resolve to. */
  route: string;
  /** file -> exact source text of the control that completes the fix. */
  controls: Record<string, string[]>;
};

const q = (href: string) => new URLSearchParams(parseHref(href).query.map(([k, v]) => [k, v]));
const isLot = (href: string, anchor: string) => {
  const p = parseHref(href);
  return p.path === `/admin/inventory/${LOT}` && p.anchor === anchor;
};
const isList = (href: string) => parseHref(href).path === "/admin/inventory" && !parseHref(href).anchor;

/** The lot page's row link: every inventory worklist opens lots here. */
const ROW_LINK = "href={`/admin/inventory/${l.id}`}";

const RULES: readonly Rule[] = [
  {
    name: "lot #product-link -> Link this lot to a product (fill-only form)",
    match: (h) => isLot(h, "product-link"),
    route: LOTPAGE,
    controls: {
      [LOTPAGE]: ['id="product-link"', "<LotProductLinkPanel", "action={productLinkAction}", "linkLotProductAction.bind(null, id)"],
      [PANELS]: ['name="pos_product_key"', "Link product"],
    },
  },
  {
    name: "lot #coa -> Attach a lab result",
    match: (h) => isLot(h, "coa"),
    route: LOTPAGE,
    controls: {
      [LOTPAGE]: ['id="coa"', "<LotCoaAttach", "action={coaLinkAction}", "linkLotCoaAction.bind(null, id)"],
      [PANELS]: ['name="lab_result_id"', 'name="coaSearch"', "Attach this lab result"],
    },
  },
  {
    name: "lot #lifecycle -> Lifecycle status form",
    match: (h) => isLot(h, "lifecycle"),
    route: LOTPAGE,
    controls: { [LOTPAGE]: ['id="lifecycle"', "action={statusAction}", 'name="status"'] },
  },
  {
    name: "lot #adjust -> Adjust quantity form",
    match: (h) => isLot(h, "adjust"),
    route: LOTPAGE,
    controls: { [LOTPAGE]: ['id="adjust"', "action={adjustAction}", 'name="qty_delta"'] },
  },
  {
    name: "inventory list in Bulk fill mode -> BulkFillPanel preselected on a fillable field",
    match: (h) => isList(h) && q(h).get("bulk") === "1",
    route: INV,
    controls: {
      [INV]: ["<BulkFillPanel", "field={sp.bulkField}"],
      [BULK]: ["<form action={bulkFillLotsAction}>", 'name="mode" value="apply"'],
    },
  },
  {
    name: "missing-product-link worklist -> rows open the lot's Product link form",
    match: (h) => isList(h) && q(h).get("missingProductLink") === "1" && q(h).get("bulk") !== "1",
    route: INV,
    controls: { [INV]: [ROW_LINK, "Bulk fill missing fields"], [LOTPAGE]: ['id="product-link"', "action={productLinkAction}"] },
  },
  {
    name: "missing-COA worklist -> rows open the lot's Attach a lab result control",
    match: (h) => isList(h) && q(h).get("coa") === "no",
    route: INV,
    controls: { [INV]: [ROW_LINK], [LOTPAGE]: ["<LotCoaAttach", "action={coaLinkAction}"] },
  },
  {
    name: "missing-expiry / unknown-cost worklists -> Bulk fill on this list",
    match: (h) => isList(h) && (q(h).get("missingExpiry") === "1" || q(h).get("unknownCost") === "1") && q(h).get("bulk") !== "1",
    route: INV,
    controls: { [INV]: ["Bulk fill missing fields", "<BulkFillPanel"] },
  },
  {
    name: "status / expiry worklists -> rows open the lot's Lifecycle form",
    match: (h) =>
      isList(h) &&
      !q(h).get("bulk") &&
      (q(h).has("expiring") || ["quarantine", "recalled"].includes(q(h).get("status") ?? "")) &&
      !q(h).get("missingProductLink"),
    route: INV,
    controls: { [INV]: [ROW_LINK], [LOTPAGE]: ['id="lifecycle"', "action={statusAction}"] },
  },
  {
    name: "empty-active worklist -> rows open the lot's Adjust form",
    match: (h) => isList(h) && q(h).get("emptyActive") === "1",
    route: INV,
    controls: { [INV]: [ROW_LINK], [LOTPAGE]: ['id="adjust"', "action={adjustAction}"] },
  },
  {
    name: "received-date worklist -> rows open the lot's Received date form",
    match: (h) => isList(h) && q(h).get("needsReceivedDate") === "1",
    route: INV,
    controls: { [INV]: [ROW_LINK], [LOTPAGE]: ["action={receivedDateAction}", 'name="received_on"'] },
  },
  {
    name: "#register-blocked -> the banner lists each blocked lot with its own fix link",
    match: (h) => parseHref(h).path === "/admin/inventory" && parseHref(h).anchor === "register-blocked",
    route: INV,
    controls: { [INV]: ["<RegisterSellabilityBanner"], [BANNER]: ["id={REGISTER_BLOCKED_ANCHOR}", "fixLinkForLot(g.code, lot.lotId, lot.productKey)"] },
  },
  {
    name: "#restore-to-sale -> Restore to sale form",
    match: (h) => parseHref(h).path === "/admin/inventory" && parseHref(h).anchor === "restore-to-sale",
    route: INV,
    controls: { [INV]: ["<RestoreToSalePanel"], [BANNER]: ["id={RESTORE_TO_SALE_ANCHOR}", "<form action={restoreProductToSaleAction}>"] },
  },
  {
    name: "Product Onboarding -> Approve",
    match: (h) => parseHref(h).path === "/admin/inventory/drafts",
    route: "src/app/admin/inventory/drafts/page.tsx",
    controls: { "src/app/admin/inventory/drafts/page.tsx": ["approveDraftAction.bind(null, d.id)"] },
  },
  {
    name: "product page -> Visibility control",
    match: (h) => /^\/admin\/products\/[^/]+$/.test(parseHref(h).path),
    route: "src/app/admin/products/[key]/page.tsx",
    controls: { "src/app/admin/products/[key]/page.tsx": ['id="visibility"', 'name="visibility"'] },
  },
  {
    name: "Purchasing -> New purchase order",
    match: (h) => parseHref(h).path === "/admin/purchasing",
    route: "src/app/admin/purchasing/page.tsx",
    controls: { "src/app/admin/purchasing/page.tsx": ['<Link href="/admin/purchasing/new">'] },
  },
  {
    name: "Cycle counts -> open a scoped count",
    match: (h) => parseHref(h).path === "/admin/inventory/cycle-counts",
    route: "src/app/admin/inventory/cycle-counts/page.tsx",
    controls: { "src/app/admin/inventory/cycle-counts/page.tsx": ["href={`/admin/inventory/cycle-counts/${s.id}`}"] },
  },
];

function rulesFor(href: string): Rule[] {
  return RULES.filter((r) => r.match(href));
}

function controlProblems(r: Rule, src: (f: string) => string = read): string[] {
  const out: string[] = [];
  for (const [file, needles] of Object.entries(r.controls)) {
    const text = src(file);
    for (const n of needles) if (!text.includes(n)) out.push(`${r.name}: ${file} lacks ${n}`);
  }
  return out;
}

describe("S37 inventory fix contract — every fix button opens a page that can complete the fix", () => {
  const hrefs = inventoryHrefs();

  it("collects the whole inventory link surface (a shrinking set would hide a gap)", () => {
    // Exact (measured): a new link must be classified here deliberately.
    expect(hrefs.size).toBe(25);
    const all = [...hrefs.keys()];
    for (const must of [
      `/admin/inventory/${LOT}#product-link`,
      `/admin/inventory/${LOT}#coa`,
      `/admin/inventory/${LOT}#lifecycle`,
      `/admin/inventory/${LOT}#adjust`,
      "/admin/inventory#register-blocked",
      "/admin/inventory#restore-to-sale",
      "/admin/inventory?needsReceivedDate=1",
    ]) {
      expect(all, must).toContain(must);
    }
  });

  it("no inventory fix link lands on a bare lot page (every lot link names its control's anchor)", () => {
    const bare = [...hrefs.keys()].filter((h) => parseHref(h).path === `/admin/inventory/${LOT}` && !parseHref(h).anchor);
    expect(bare).toEqual([]);
  });

  it("every href is classified by exactly one control rule", () => {
    const problems: string[] = [];
    for (const [href, from] of hrefs) {
      const n = rulesFor(href).length;
      if (n !== 1) problems.push(`${from}: ${href} matched ${n} rules`);
    }
    expect(problems).toEqual([]);
  });

  it("every href resolves to its rule's route file", () => {
    const problems: string[] = [];
    for (const [href, from] of hrefs) {
      const r = rulesFor(href)[0];
      if (!r) continue;
      const hit = resolveRoute(parseHref(href).path, TABLE);
      if (hit?.file !== r.route) problems.push(`${from}: ${href} -> ${hit?.file ?? "no page"} (rule expects ${r.route})`);
    }
    expect(problems).toEqual([]);
  });

  it("every rule's control is present verbatim in its file", () => {
    expect(RULES.flatMap((r) => controlProblems(r))).toEqual([]);
  });

  it("every rule is used by at least one emitted href (no stale rule)", () => {
    const used = new Set<string>();
    for (const href of hrefs.keys()) for (const r of rulesFor(href)) used.add(r.name);
    expect(RULES.map((r) => r.name).filter((n) => !used.has(n))).toEqual([]);
  });

  it("the Bulk fill links only name fields Bulk fill can actually write", () => {
    for (const href of hrefs.keys()) {
      const field = q(href).get("bulkField");
      if (field) expect(BULK_FILLABLE_FIELDS as readonly string[]).toContain(field);
    }
  });

  it("the lock stays: pos_product_key and lab_result_id are still LOCKED_LOT_FIELDS", () => {
    const core = read("src/lib/inventory/lot-edit-core.ts");
    const locked = core.slice(core.indexOf("export const LOCKED_LOT_FIELDS"), core.indexOf("] as const", core.indexOf("export const LOCKED_LOT_FIELDS")));
    expect(locked).toContain('"pos_product_key"');
    expect(locked).toContain('"lab_result_id"');
  });

  // ── Negative tests: the contract really detects breakage ─────────────────
  it("detects an unclassified href, a wrong route and a missing control", () => {
    expect(rulesFor(`/admin/inventory/${LOT}#no-such-control`)).toEqual([]);
    expect(rulesFor(`/admin/inventory/${LOT}`)).toEqual([]);
    const coaRule = RULES.find((r) => r.name.startsWith("lot #coa"))!;
    const without = (file: string, needle: string) => (f: string) => (f === file ? read(f).split(needle).join("") : read(f));
    expect(controlProblems(coaRule, without(LOTPAGE, "<LotCoaAttach")).join()).toContain("lacks <LotCoaAttach");
    expect(controlProblems(coaRule, without(PANELS, 'name="lab_result_id"')).join()).toContain('lacks name="lab_result_id"');
    const linkRule = RULES.find((r) => r.name.startsWith("lot #product-link"))!;
    expect(controlProblems(linkRule, without(LOTPAGE, 'id="product-link"')).join()).toContain('lacks id="product-link"');
    expect(resolveRoute("/admin/inventory/drafts", TABLE)?.file).not.toBe(LOTPAGE);
  });

  it("the Round 11 dead end is gone: the unlinked-lot link is the Product link form", () => {
    const link = fixLinkForLot("no_product_link", LOT, null);
    expect(link.href).toBe(`/admin/inventory/${LOT}#product-link`);
    expect(rulesFor(link.href).map((r) => r.name)).toEqual(["lot #product-link -> Link this lot to a product (fill-only form)"]);
  });
});
