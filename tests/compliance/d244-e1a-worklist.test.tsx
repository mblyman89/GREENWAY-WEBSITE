/**
 * D244 E-1a — the vendor-first, on-hand-first worklist.
 *
 * F-50 true vendor filter with counts, F-51 "on hand" default + quantity
 * column/sort, F-52 vendor progress strip + "Next vendor", F-42 pages
 * instead of a hard 300 cap.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __runWorklistCoreTests,
  matchesWorklistStock,
  nextVendor,
  onHandByCard,
  pageWindow,
  parseWorklistStock,
  parseWorklistVendor,
  resolveCardVendor,
  vendorOptionLabel,
  vendorProgress,
} from "@/lib/enrichment/worklist-core";
import { ProductGrid, type ProductGridCard } from "@/components/admin/products/ProductGrid";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

describe("D244 E-1a — worklist core", () => {
  it("self-tests pass", () => {
    const r = __runWorklistCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(36);
  });

  it("vendor resolves enrichment -> delivery lot -> brand -> POS name, only to known vendors", () => {
    const l = { known: new Set([V1, V2]), brandVendor: new Map([["phat panda", V2]]), vendorByName: new Map([["grow op", V1]]) };
    expect(resolveCardVendor({ ownVendorId: V1, attrVendorIds: [V2], brandName: "Phat Panda", posVendorName: null }, l).via).toBe("enrichment");
    expect(resolveCardVendor({ ownVendorId: null, attrVendorIds: [V2], brandName: null, posVendorName: null }, l).vendorId).toBe(V2);
    expect(resolveCardVendor({ ownVendorId: null, attrVendorIds: [], brandName: " PHAT PANDA ", posVendorName: null }, l).via).toBe("brand");
    expect(resolveCardVendor({ ownVendorId: null, attrVendorIds: null, brandName: "", posVendorName: "Grow Op" }, l).via).toBe("pos");
    expect(resolveCardVendor({ ownVendorId: "33333333-3333-4333-8333-333333333333", attrVendorIds: null, brandName: "", posVendorName: "" }, l).vendorId).toBeNull();
  });

  it("on hand (in + low) is the default; all includes sold-out", () => {
    expect(parseWorklistStock(undefined)).toBe("on-hand");
    expect(parseWorklistStock("")).toBe("on-hand");
    expect(parseWorklistStock("all")).toBe("all");
    expect(matchesWorklistStock("low-stock", "on-hand")).toBe(true);
    expect(matchesWorklistStock("unavailable", "on-hand")).toBe(false);
    expect(matchesWorklistStock("unavailable", "all")).toBe(true);
    expect(parseWorklistVendor("none")).toBe("none");
    expect(parseWorklistVendor("'; drop")).toBe("");
  });

  it("quantity sums each card's lots once", () => {
    const q = onHandByCard([{ posKey: "A", lotKeys: ["A", "A2", "A"] }, { posKey: "B", lotKeys: ["B"] }], [
      { pos_product_key: "A", on_hand_qty: 3 },
      { pos_product_key: "A2", on_hand_qty: "2.5" },
      { pos_product_key: "B", on_hand_qty: -1 },
    ]);
    expect(q.get("A")).toBe(5.5);
    expect(q.get("B")).toBe(0);
  });

  it("progress counts on-hand only, and Next vendor skips finished vendors and 'none'", () => {
    const labels = new Map([[V1, "Alpha"], [V2, "Bravo"]]);
    const list = vendorProgress(
      [
        { vendorId: V1, inventoryStatus: "in-stock", enrichmentStatus: "published", hasImage: true, hasDescription: true },
        { vendorId: V1, inventoryStatus: "unavailable", enrichmentStatus: null, hasImage: false, hasDescription: false },
        { vendorId: V2, inventoryStatus: "low-stock", enrichmentStatus: "draft", hasImage: true, hasDescription: false },
        { vendorId: null, inventoryStatus: "in-stock", enrichmentStatus: null, hasImage: false, hasDescription: false },
      ],
      labels,
    );
    expect(list.map((p) => p.id)).toEqual([V1, V2, "none"]);
    expect(vendorOptionLabel(list[0]!)).toBe("Alpha (2 · 1 on hand)");
    expect(list[1]!.onHandReady).toBe(1);
    expect(nextVendor(list, V2)).toBeNull(); // Alpha is fully published; none is never suggested
    expect(nextVendor(list, "")?.id).toBe(V2);
    expect(nextVendor(list, V1)?.id).toBe(V2);
  });

  it("pages of 300, clamped", () => {
    expect(pageWindow(650, "2")).toEqual({ page: 2, pages: 3, start: 300, end: 600 });
    expect(pageWindow(650, "99").page).toBe(3);
    expect(pageWindow(650, "x").page).toBe(1);
    expect(pageWindow(0, "1")).toEqual({ page: 1, pages: 1, start: 0, end: 0 });
  });
});

describe("D244 E-1a — grid card shows units on hand", () => {
  const card: ProductGridCard = {
    posKey: "K1",
    name: "Blue Dream 3.5g",
    brand: "Phat Panda",
    category: "Flower",
    hasDescription: true,
    hasImage: true,
    hasBrandLink: false,
    enrichmentStatus: "draft",
    thumbnailUrl: null,
  };
  it("renders the qty only when it was read", () => {
    expect(renderToStaticMarkup(<ProductGrid cards={[{ ...card, onHandQty: 7 }]} />)).toContain("7 on hand");
    expect(renderToStaticMarkup(<ProductGrid cards={[{ ...card, onHandQty: null }]} />)).not.toContain("on hand");
    expect(renderToStaticMarkup(<ProductGrid cards={[card]} />)).not.toContain("on hand");
  });
});

describe("D244 E-1a — page wiring", () => {
  const page = read("src/app/admin/products/page.tsx");
  it("true vendor (?vv=) is separate from S22's delivery ?vendor=", () => {
    expect(page).toContain("const vv = parseWorklistVendor(sp.vv);");
    expect(page).toContain('<Select name="vv" defaultValue={vv}');
    expect(page).toContain('<Select name="vendor"');
    expect(page).toContain("{vendorOptionLabel(p)}");
    expect(page).toContain("if (vendorData && vv) filtered = filtered.filter((g) => matchesVendor(cardVendor.get(g.posKey) ?? null, vv));");
  });
  it("on hand is the default focus; Include sold-out is offered", () => {
    expect(page).toContain("const stockFocus = parseWorklistStock(sp.stock);");
    expect(page).toContain('if (stockFocus === "on-hand") filtered = filtered.filter((g) => isOnHandStatus(g.inventoryStatus));');
    expect(page).toContain('<option value="all">Include sold-out (every card)</option>');
    expect(page).toContain('<option value="">On hand (in + low stock)</option>');
  });
  it("quantity column and sort, with an honest note when unread", () => {
    expect(page).toContain('{onHandQty && <th className="px-4 py-3 text-right">On hand</th>}');
    expect(page).toContain('{onHandQty && <option value="onhand">Sort: most on hand first</option>}');
    expect(page).toContain("if (sortOnHand && onHandQty) filtered = sortByOnHand(filtered, onHandQty);");
    expect(page).toContain('data-testid="onhand-unavailable"');
    expect(page).toContain('data-testid="vendor-unavailable"');
  });
  it("progress strip with Next vendor", () => {
    expect(page).toContain('data-testid="vendor-progress"');
    expect(page).toContain("Next vendor: {upNext.label} →");
    expect(page).toContain("const upNext = vendorData ? nextVendor(vendorList, vv) : null;");
  });
  it("pages instead of a hard 300 cap", () => {
    expect(page).toContain("const pw = pageWindow(filtered.length, sp.page);");
    expect(page).toContain("const shown = filtered.slice(pw.start, pw.end);");
    expect(page).toContain("{shown.map((g) => (");
    expect(page).not.toContain("filtered.slice(0, 300)");
    expect(page).not.toContain("Showing first 300");
    expect(page).toContain('data-testid="worklist-pager"');
  });
  it("the reads are server-only, read-only, named-column", () => {
    const src = read("src/lib/enrichment/worklist-server.ts");
    expect(src).toMatch(/^import "server-only";$/m);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(src).not.toMatch(/select\("\*"\)/);
    expect(src).toContain('.select("id, pos_product_key, on_hand_qty")');
  });
  it("the pure runner calls the core", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runWorklistCoreTests } from "../../src/lib/enrichment/worklist-core";');
    expect(runner).toContain('assertRan("worklist-core", __runWorklistCoreTests(), 36);');
  });
});
