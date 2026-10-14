/**
 * R50 S4 — "Looks like Cultivera product X" on a Product Onboarding row.
 *
 * Pins:
 *   1. the pure core (self-test count, registered in the runner);
 *   2. REAL naming data: over the committed Cultivera export
 *      (normalized_cultivera/INVENTORIES_NORMALIZED.xlsx) the rule pairs
 *      EXACTLY the 13 distinct imported identities that are spelling
 *      variants of one product - and none of the different flavours /
 *      strains a fuzzy token score paired (measured while building S4);
 *      on the real Old Name -> New Name renames it recovers the measured
 *      number of variants;
 *   3. the server: suggestions come from the SAME reads as the restock
 *      preview (no new table, GET only), only for "New card" rows, and a
 *      scorer failure never costs the preview;
 *   4. the chip: suggestion copy, evidence as visible text, compare links,
 *      no form / no button (never applied);
 *   5. wiring: the page renders the chip only from the preview result and
 *      Approve / staging never read the suggestions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as XLSX from "xlsx";
import {
  SUGGEST_MAX,
  SUGGESTION_DETAIL,
  __runCultiveraIntakeSuggestionCoreTests,
  differentBrands,
  familySimilarity,
  suggestCultiveraMatches,
  suggestionChipCopy,
  type IntakeSuggestion,
} from "@/lib/inventory/cultivera-intake-suggestion-core";
import { collapseFamilyKeyPart, deriveFamily, groupingCategoryAxis } from "@/lib/pos/intake-mastering-core";
import { VENDOR_ID_IDENTITY_ENV } from "@/lib/inventory/vendor-identity-core";
import { CultiveraSuggestionChip } from "@/components/admin/catalog/CultiveraSuggestionChip";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type Req = { method: string; url: URL; body: unknown };
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown }>,
  route: null as null | ((r: { method: string; url: URL; body: unknown }) => { status: number; body?: unknown } | undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null };
    net.reqs.push(r);
    const rep = (net.route && net.route(r)) ?? { status: 200, body: [] };
    return new Response(r.method === "HEAD" ? null : JSON.stringify(rep.body ?? []), {
      status: rep.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch }) };
});

const table = (r: Req) => r.url.pathname.split("/").pop() ?? "";
const inList = (r: Req, col: string) => {
  const m = (r.url.searchParams.get(col) ?? "").match(/^in\.\((.*)\)$/);
  return m ? m[1].split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
};
const pageOf = <T,>(rows: T[], r: Req) => {
  const off = Number(r.url.searchParams.get("offset") ?? "0");
  const lim = Number(r.url.searchParams.get("limit") ?? "1000000");
  return rows.slice(off, off + lim);
};

beforeEach(() => {
  net.reqs.length = 0;
  net.route = null;
  delete process.env[VENDOR_ID_IDENTITY_ENV];
});
afterEach(() => {
  delete process.env[VENDOR_ID_IDENTITY_ENV];
});

// === 1. Pure core ============================================================
describe("R50 S4 pure core", () => {
  it("self-tests pass with the exact count and are registered in the runner", () => {
    expect(__runCultiveraIntakeSuggestionCoreTests().passed).toBe(58);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runCultiveraIntakeSuggestionCoreTests } from "../../src/lib/inventory/cultivera-intake-suggestion-core";');
    expect(runner).toContain('assertRan("cultivera-intake-suggestion-core", __runCultiveraIntakeSuggestionCoreTests(), 58);');
  });
});

// === 2. Real naming data =====================================================
function categoryMap(): Record<string, string> {
  const src = read("src/lib/pos/transform.ts");
  const m = /const CATEGORY_MAP[^{]*\{([\s\S]*?)\n\};/.exec(src)!;
  const out: Record<string, string> = {};
  for (const x of m[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) out[x[1]] = x[2];
  return out;
}

describe("R50 S4 on the REAL Cultivera export", () => {
  it("pairs exactly the 13 imported identities that are spelling variants of one product", () => {
    const cmap = categoryMap();
    const wb = XLSX.read(readFileSync(join(ROOT, "normalized_cultivera/INVENTORIES_NORMALIZED.xlsx")));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    type C = { v: string; b: string; axis: string; fam: string; disp: string };
    const ids = new Map<string, C>();
    for (const r of rows) {
      const cat = cmap[String(r["Category"] ?? "").trim()];
      const vendor = String(r["Vendor"] ?? "").trim();
      if (!cat || !vendor) continue;
      const brand = String(r["Brand"] ?? "").trim();
      const f = deriveFamily({ category: cat, vendor, brand, name: String(r["Product"]), strainName: String(r["Strain"] ?? "") || null });
      if (!f) continue;
      const axis = groupingCategoryAxis(cat);
      const k = [collapseFamilyKeyPart(vendor), axis, f.family].join("|");
      if (!ids.has(k)) ids.set(k, { v: collapseFamilyKeyPart(vendor), b: collapseFamilyKeyPart(brand), axis, fam: f.family, disp: f.display });
    }
    expect(ids.size).toBe(3247);
    const groups = new Map<string, C[]>();
    for (const c of ids.values()) groups.set(`${c.v}|${c.axis}`, [...(groups.get(`${c.v}|${c.axis}`) ?? []), c]);
    const pairs: string[] = [];
    for (const g of groups.values())
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) {
          if (differentBrands(g[i].b, g[j].b)) continue;
          const m = familySimilarity(g[i].fam, g[j].fam, [g[i].v, g[i].b === g[j].b ? g[i].b : ""]);
          if (m) pairs.push(`${m.how}: ${[g[i].disp, g[j].disp].sort().join(" ~ ")}`);
        }
    expect(pairs.sort()).toEqual(
      [
        "same: 420 Bar Mixed ~ 420 Bar Mixed Chocolate",
        "same: Face Lock ~ Facelock",
        "same: Grand Daddy Purple ~ Granddaddy Purple",
        "same: Journeyman Blueberry Lemonade ~ Journeyman Blueberry Lemonade Shots",
        "same: Lemon Loopz ~ Lemon Loopz Shots",
        "same: Ray'S Raspberry ~ Ray'S Raspberry Shots",
        "same: Smokiez Sour Jamberry CBN:THC Fruit ~ Smokiez Sour Jamberry CBN:THC Fruit Chews",
        "same: Toffee Crunch 1:1 ~ Toffee Crunch 1:1 Chocolate",
        "same: Toffee Crunch 1:1 2 ~ Toffee Crunch 1:1 Chocolate 2",
        "typo: Blue Raspberry ~ Blue Rasperry",
        "typo: Golden Pinaepple ~ Golden Pineapple",
        "typo: Rntz S1 ~ Runtz S1",
        "typo: Tropicana Cookies ~ Tropicanna Cookies",
      ].sort(),
    );
  });

  it("never pairs the different products a fuzzy token score paired on this export", () => {
    const real: Array<[string, string, string[]]> = [
      ["ncmx-llc-wyld-sour-cherry", "ncmx-llc-wyld-sour-apple", ["ncmx-llc"]],
      ["cherry-gelato", "berry-gelato", []],
      ["lemon-cherry-gelato", "cherry-gelato", []],
      ["chuckleberry", "huckleberry", []],
      ["journeyman-lemonade-2", "journeyman-watermelon-lemonade-2", []],
      ["doozies-raspberry-60-1-cbd-thc-2", "doozies-peach-60-1-cbd-thc-2", []],
      ["honu-chocolate-caramel-indica-chocolate", "honu-chocolate-caramel-sativa-chocolate", []],
      ["zkittlez-pie", "zkittlez", []],
      ["blueberry", "sour-blueberry", []],
      ["smokiez-sour-green-apple-cbg-thc-10-1", "smokiez-green-apple-cbg-thc-10-1", []],
      ["swell-cherry-fruit-chews", "swell-cherry-lime-fruit-chews", []],
    ];
    for (const [a, b, d] of real) expect(familySimilarity(a, b, d), `${a} vs ${b}`).toBeNull();
    // Two named brands under one distributor (Full Spec / Leafwerx Cranberry 1:1).
    expect(differentBrands("full-spec", "leafwerx")).toBe(true);
  });

  it("recovers the measured spelling variants among the REAL Old Name -> New Name renames", () => {
    const cmap = categoryMap();
    const wb = XLSX.read(readFileSync(join(ROOT, "normalized_cultivera/PRODUCTS_NORMALIZED.xlsx")));
    const prod = new Map<string, Record<string, unknown>>();
    for (const r of XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])) prod.set(String(r["Product Name"]), r);
    const csv = read("normalized_cultivera/PRODUCTS_change_report.csv").replace(/^\uFEFF/, "").split(/\r?\n/).slice(1).filter(Boolean);
    const cells = (l: string) => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === "," && !q) {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const tally: Record<string, number> = {};
    for (const l of csv) {
      const [, oldName, newName] = cells(l);
      const p = prod.get(newName);
      const cat = p ? cmap[String(p["Category"] ?? "")] : undefined;
      if (!p || !cat) continue;
      const brand = String(p["Brand"] ?? "");
      const a = deriveFamily({ category: cat, vendor: brand, brand, name: oldName, strainName: null });
      const b = deriveFamily({ category: cat, vendor: brand, brand, name: newName, strainName: null });
      if (!a || !b || a.family === b.family) continue;
      const m = familySimilarity(a.family, b.family, [collapseFamilyKeyPart(brand)]);
      if (m) tally[m.how] = (tally[m.how] ?? 0) + 1;
    }
    // Spot-check real pairs, then the totals (a weakened rule changes them).
    const pick = (o: string, n: string, brand: string, cat: string) =>
      familySimilarity(
        deriveFamily({ category: cat, vendor: brand, brand, name: o, strainName: null })!.family,
        deriveFamily({ category: cat, vendor: brand, brand, name: n, strainName: null })!.family,
        [collapseFamilyKeyPart(brand)],
      )?.how;
    expect(pick("420 Bar Chocolate Create 1:1 - 3.17oz", "420 Bar Create 1:1 Chocolate 3.17oz", "420 Bar", "edible-solid")).toBe("same");
    expect(pick("2727 - Pre-Rolls - Gas Candy - 5g", "2727 Candy Gas Pre-roll 5g", "2727", "preroll-pack")).toBe("reordered");
    expect(pick("Fire Bros-Disposable Cartridge-Han Zolo-1g", "Fire Bros Han Solo Disposable Cartridge 1g", "Fire Bros", "disposable-cartridge")).toBe("typo");
    // 145 of the renames that change the family are recovered as one product.
    expect(tally).toEqual({ same: 81, reordered: 32, typo: 32 });
  });
});

// === 3. Server ===============================================================
const cultItem = (over: Record<string, unknown> = {}) => ({
  id: "mi-0",
  source_item_id: "pos-0123456789ab",
  name: "Grow Op Farms Granddaddy Purple Pre-roll 1g",
  brand_name: "Grow Op Farms",
  vendor_name: "GROW OP FARMS",
  category: "preroll",
  strain_name: "Granddaddy Purple",
  hidden: false,
  ...over,
});
function world(items = [cultItem()], variantMedical = false) {
  net.route = (r) => {
    const t = table(r);
    if (t === "menu_versions") return { status: 200, body: [{ id: "pub-1" }] };
    if (t === "menu_items") {
      const cats = inList(r, "category");
      return { status: 200, body: pageOf(items.filter((it) => !cats.length || cats.includes(String(it.category))), r) };
    }
    if (t === "menu_variants") {
      const ids = inList(r, "menu_item_id");
      const rows = items
        .filter((it) => ids.includes(it.id))
        .map((it) => ({ menu_item_id: it.id, source_variant_id: `${it.source_item_id}-aa`, label: "1 g", price_minor_units: 1000, inventory_level: 3, medical: variantMedical }));
      return { status: 200, body: pageOf(rows, r) };
    }
    return undefined;
  };
}
const draftRow = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  pos_product_key: "LOT-A",
  name: "Grand Daddy Purple 1g",
  brand_name: "Grow Op Farms",
  vendor_name: "GROW OP FARMS",
  strain_name: "Grand Daddy Purple",
  category: "preroll",
  size_label: "1 g",
  ...over,
});
async function load(rows: Array<ReturnType<typeof draftRow>>) {
  const { loadRestockPreview } = await import("@/lib/inventory/restock-preview-server");
  return loadRestockPreview(rows);
}

describe("R50 S4 server (rides the restock preview reads)", () => {
  it("a New-card row gets the imported card it is spelled like, from the same GET-only reads", async () => {
    world();
    const res = await load([draftRow()]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.verdicts.get("d1")?.kind).toBe("new");
    const s = res.suggestions?.get("d1");
    expect(s?.best.cardKey).toBe("pos-0123456789ab");
    expect(s?.best.how).toBe("same");
    expect(s?.best.sizeMatch).toBe(true);
    expect(suggestionChipCopy(s!)).toBe("Looks like Cultivera product 'Grow Op Farms Granddaddy Purple Pre-roll 1g'");
    expect(net.reqs.every((r) => r.method === "GET")).toBe(true);
    expect(new Set(net.reqs.map(table))).toEqual(new Set(["menu_versions", "menu_items", "menu_variants"]));
  });

  it("a row that already joins the card gets no suggestion (the exact rule wins)", async () => {
    world();
    const res = await load([draftRow({ strain_name: "Granddaddy Purple" })]);
    expect(res.ok && res.verdicts.get("d1")?.kind).toBe("joins");
    expect(res.ok && res.suggestions?.size).toBe(0);
  });

  it("hidden or medical-only imported cards are never suggested", async () => {
    world([cultItem({ hidden: true })]);
    let res = await load([draftRow()]);
    expect(res.ok && res.suggestions?.size).toBe(0);
    world([cultItem()], true);
    res = await load([draftRow()]);
    expect(res.ok && res.suggestions?.size).toBe(0);
  });

  it("a receiving card (not a Cultivera key) is never suggested", async () => {
    world([cultItem({ source_item_id: "LOT-OLD-1" })]);
    const res = await load([draftRow()]);
    expect(res.ok && res.suggestions?.size).toBe(0);
  });

  it("a scorer failure never costs the preview (safeSuggestions)", async () => {
    const mod = await import("@/lib/inventory/restock-preview-server");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = mod.safeSuggestions({
      drafts: [draftRow()],
      liveCards: null as unknown as [],
      verdicts: new Map([["d1", { kind: "new" }]]),
    });
    expect(bad.size).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    const src = read("src/lib/inventory/restock-preview-server.ts");
    expect(src).toContain("suggestions: safeSuggestions({ drafts, liveCards, verdicts: dry.verdicts, vendorIds })");
  });
});

// === 4. Chip =================================================================
describe("R50 S4 chip", () => {
  const sug = (): IntakeSuggestion =>
    suggestCultiveraMatches({
      drafts: [draftRow()],
      liveCards: [
        {
          ...cultItem(),
          variants: [{ source_variant_id: "pos-0123456789ab-aa", medical: false, label: "1 g" }],
        },
        {
          ...cultItem({ source_item_id: "pos-0123456789ac", name: "GOF Grand Daddy Purpel" }),
          strain_name: "Grand Daddy Purpel",
          variants: [{ source_variant_id: "x", medical: false, label: "3.5 g" }],
        },
      ],
      verdicts: new Map([["d1", { kind: "new" }]]),
    }).get("d1")!;

  it("shows the copy, the evidence as text and a link per card - and no form or button", () => {
    const s = sug();
    expect(s.others).toHaveLength(1);
    expect(SUGGEST_MAX).toBe(3);
    const html = renderToStaticMarkup(createElement(CultiveraSuggestionChip, { suggestion: s }));
    expect(html).toContain('data-testid="cultivera-suggestion"');
    expect(html).toContain('data-how="same"');
    expect(html).toContain("Looks like Cultivera product &#x27;Grow Op Farms Granddaddy Purple Pre-roll 1g&#x27; (+1 more)");
    for (const e of s.best.evidence) expect(html).toContain(e.replace(/'/g, "&#x27;"));
    expect(html).toContain(SUGGESTION_DETAIL.replace(/'/g, "&#x27;"));
    expect(html).toContain('href="/admin/products/pos-0123456789ab"');
    expect(html).toContain('href="/admin/products/pos-0123456789ac"');
    expect(html).toContain("Open the imported card");
    expect(html).toContain("Other match 1");
    expect(html).not.toMatch(/<form|<button/);
  });
});

// === 5. Wiring ===============================================================
describe("R50 S4 wiring", () => {
  it("the page renders the chip only from the preview result, under the restock chip", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain('import { CultiveraSuggestionChip } from "@/components/admin/catalog/CultiveraSuggestionChip";');
    expect(page).toContain("const cultiveraSuggestions = restockPreview && restockPreview.ok ? (restockPreview.suggestions ?? null) : null;");
    const chip = page.indexOf("<RestockPreviewChip verdict=");
    const sugg = page.indexOf("<CultiveraSuggestionChip suggestion={cultiveraSuggestions.get(d.id)!} />");
    expect(chip).toBeGreaterThan(0);
    expect(sugg).toBeGreaterThan(chip);
  });

  it("Approve, staging and the merge never read the suggestions (never applied)", () => {
    for (const f of [
      "src/app/admin/inventory/drafts/actions.ts",
      "src/lib/pos/intake-menu-staging.ts",
      "src/lib/pos/intake-mastering-core.ts",
      "src/lib/inventory/vendor-identity-core.ts",
    ]) {
      const src = read(f);
      expect(src, f).not.toContain("cultivera-intake-suggestion");
      expect(src, f).not.toContain("suggestCultiveraMatches");
    }
  });

  it("the core is pure (no server, no supabase, no env)", () => {
    const src = read("src/lib/inventory/cultivera-intake-suggestion-core.ts");
    expect(src).not.toMatch(/server-only|supabase|process\.env|fetch\(/);
  });
});
