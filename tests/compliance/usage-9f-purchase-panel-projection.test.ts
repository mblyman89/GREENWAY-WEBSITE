import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PANEL_FIELDS,
  PANEL_NULLISH_FIELDS,
  __runPurchasePanelProjectionTests,
} from "@/lib/menu/purchase-panel-projection-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("USAGE-9f: the PDP purchase panel gets the trimmed projection", () => {
  it("self-test passes", () => {
    expect(__runPurchasePanelProjectionTests().failed).toBe(0);
  });
  it("every item field the panel reads is declared (kept or nullish-safe)", () => {
    const panel = read("src/components/menu/ProductDetailPurchasePanel.tsx");
    const used = new Set([...panel.matchAll(/\bitem\.([a-zA-Z]+)/g)].map((m) => m[1]));
    const declared = new Set<string>([...PANEL_FIELDS, ...PANEL_NULLISH_FIELDS]);
    expect([...used].filter((f) => !declared.has(f))).toEqual([]);
    for (const f of PANEL_NULLISH_FIELDS) expect(panel).toContain(`item.${f} ?? null`);
  });
  it("the page projects only the panel's item", () => {
    const page = read("src/app/(site)/menu/products/[id]/page.tsx");
    expect(page).toContain("<ProductDetailPurchasePanel item={purchasePanelItem(item)} />");
  });
});
