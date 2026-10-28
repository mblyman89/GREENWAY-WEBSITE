/**
 * Phase 0.4 (G-31, F-05b-9) - the cannabis line.
 *
 * Owner D48 (Q05b-4), verbatim: "refused outright, non cannabis should also be
 * refused outright moving them into a cannabis type."
 *
 * Pins: the pure core, all three entry points (lot classification override,
 * Move products, inventory-type mapping), the refusal audit at each, and the
 * daily Issues row on the Inventory page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isNonCannabisSide,
  crossesCannabisLine,
  cannabisLotTargetRefusal,
  inventoryTypeMappingRefusal,
  buildCannabisLineIssue,
  CANNABIS_LINE_ISSUE_CODE,
} from "@/lib/compliance/cannabis-line-core";
import { parseClassificationEdit } from "@/lib/inventory/lot-website-classification-core";
import { buildReassignPlan } from "@/lib/pos/category-registry-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("cannabis-line core", () => {
  it("refuses both directions, allows same-side moves", () => {
    expect(isNonCannabisSide("paraphernalia")).toBe(true);
    expect(crossesCannabisLine("flower", "merch")).toBe(true);
    expect(crossesCannabisLine("accessories", "flower")).toBe(true);
    expect(crossesCannabisLine("flower", "preroll")).toBe(false);
    expect(cannabisLotTargetRefusal("merch")).toMatch(/Refused/);
    expect(cannabisLotTargetRefusal("flower")).toBeNull();
  });
  it("type mapping: cannabis types never become non-cannabis and vice versa", () => {
    expect(inventoryTypeMappingRefusal({ typeLabel: "X", currentMapping: "flower", nextMapping: "merch", cannabisLotCount: 0 })).toMatch(/Refused/);
    expect(inventoryTypeMappingRefusal({ typeLabel: "X", currentMapping: "merch", nextMapping: "flower", cannabisLotCount: 0 })).toMatch(/Refused/);
    expect(inventoryTypeMappingRefusal({ typeLabel: "X", currentMapping: null, nextMapping: "merch", cannabisLotCount: 2 })).toMatch(/Refused/);
    expect(inventoryTypeMappingRefusal({ typeLabel: "X", currentMapping: null, nextMapping: "merch", cannabisLotCount: 0 })).toBeNull();
  });
});

describe("entry point 1: lot classification override", () => {
  it("parseClassificationEdit refuses a non-cannabis category for a cannabis lot", () => {
    const src = read("src/lib/inventory/lot-website-classification-core.ts");
    expect(src).toMatch(/cannabisLine\?:/);
    expect(src).toMatch(/cannabisLotTargetRefusal/);
    const vocab = { validCategoryValues: ["flower", "merch"], validTypeLabels: ["Flower", "Pipe"] };
    const line = { cannabisLot: true, nonCannabisTypeLabels: ["Pipe"] };
    expect(parseClassificationEdit({ website_category: "merch" }, vocab, line).ok).toBe(false);
    expect(parseClassificationEdit({ house_type: "Pipe" }, vocab, line).ok).toBe(false);
    expect(parseClassificationEdit({ website_category: "flower", house_type: "Flower" }, vocab, line).ok).toBe(true);
  });
  it("the action passes cannabisLot:true and audits a refusal", () => {
    const src = read("src/app/admin/inventory/actions.ts");
    expect(src).toMatch(/cannabisLot:\s*true/);
    expect(src).toMatch(/cannabis_line\.refused/);
    expect(src).toMatch(/lot_classification_override/);
  });
});

describe("entry point 2: Move products", () => {
  it("buildReassignPlan reports a crossing", () => {
    const src = read("src/lib/pos/category-registry-core.ts");
    expect(src).toMatch(/crossesCannabisLine/);
    const registry = [
      { value: "flower", label: "Flower", is_active: true },
      { value: "merch", label: "Merch", is_active: true },
    ];
    const counts = { publishedItems: 1, stagedItems: 0, draftPicks: 0, lotOverrides: 0, typeMappings: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = buildReassignPlan({ from: "flower", to: "merch", registry: registry as any, counts: counts as any });
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.crossesCannabisLine).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const back = buildReassignPlan({ from: "merch", to: "flower", registry: registry as any, counts: counts as any });
    expect(!back.ok && back.crossesCannabisLine).toBe(true);
  });
  it("reassignCategoryAction audits the refusal", () => {
    const src = read("src/app/admin/settings/types/actions.ts");
    expect(src).toMatch(/plan\.crossesCannabisLine/);
    expect(src).toMatch(/move_products/);
  });
});

describe("entry point 3: inventory-type mapping", () => {
  it("create, adopt and update all run the refusal helper", () => {
    const src = read("src/app/admin/settings/types/actions.ts");
    const calls = src.match(/await refuseTypeCrossing\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/inventoryTypeMappingRefusal/);
    expect(src).toMatch(/cannabis_line\.refused/);
  });
});

describe("daily Issues row (G-31 req. 4)", () => {
  it("builds a blocking issue naming crossed lots, null when clean", () => {
    expect(buildCannabisLineIssue([{ id: "a", website_category_value: "flower" }])).toBeNull();
    const iss = buildCannabisLineIssue([{ id: "lot-9", product_name: "OG", website_category_value: "accessories" }]);
    expect(iss?.severity).toBe("blocking");
    expect(iss?.code).toBe(CANNABIS_LINE_ISSUE_CODE);
    expect(iss?.fix?.href).toContain("lot-9");
  });
  it("the Inventory page wires it into the Issues list", () => {
    const src = read("src/app/admin/inventory/page.tsx");
    expect(src).toMatch(/buildCannabisLineIssue\(categorized\.lots\)/);
    expect(src).toMatch(/\.\.\.\(cannabisLineIssue \? \[cannabisLineIssue\] : \[\]\)/);
  });
});
