/**
 * Fix Phase 0.2 — G-51 (F-15-20, S1) + G-47 (F-15-16).
 * Trade samples never reach the menu, the register or the website
 * (WAC 314-55-096(1)(i); owner D68), and the dead legacy panel is gone.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  __runSampleLotCoreTests,
  isSampleLot,
  withoutSampleLots,
  sampleLotIds,
} from "@/lib/inventory/sample-lot-core";

const src = (p: string) => readFileSync(p, "utf8");

describe("sample-lot-core", () => {
  it("self-tests pass", () => expect(() => __runSampleLotCoreTests()).not.toThrow());
  it("a sample lot sharing a SKU with a sellable lot is filtered out", () => {
    const lots = [
      { id: "sell", pos_product_key: "SKU1", is_sample: false },
      { id: "samp", pos_product_key: "SKU1", is_sample: true },
    ];
    expect(withoutSampleLots(lots).map((l) => l.id)).toEqual(["sell"]);
    expect([...sampleLotIds(lots)]).toEqual(["samp"]);
    expect(isSampleLot(lots[1])).toBe(true);
  });
});

describe("every sellable read path excludes sample lots", () => {
  it("draft seeding skips samples and approval refuses them", () => {
    const s = src("src/lib/inventory/catalog-drafts.ts");
    expect(s).toMatch(/\.neq\("status", "destroyed"\)[\s\S]{0,200}\.eq\("is_sample", false\)/);
    expect(s).toMatch(/isSampleLot\([\s\S]{0,80}\)\)\s*\{\s*return \{ ok: false, error: SAMPLE_NOT_FOR_SALE_MESSAGE \}/);
  });
  it("the register lot draw skips samples", () => {
    expect(src("src/lib/inventory/sale-lot-read.ts")).toMatch(/\.eq\("is_sample", false\)/);
  });
  it("the POS menu lot read (stock + barcodes) skips samples", () => {
    const s = src("src/app/api/pos/menu/route.ts");
    expect(s).toMatch(/is_sample"/);
    expect(s).toMatch(/liveLots = withoutSampleLots\(rows\)/);
  });
  it("sellability, void restock, menu-stock sync, staging and injection skip samples", () => {
    expect(src("src/lib/inventory/register-sellability-store.ts")).toMatch(/\.eq\("is_sample", false\)/);
    expect(src("src/lib/pos/void-store.ts")).toMatch(/\.eq\("is_sample", false\)/);
    expect(src("src/lib/inventory/lot-menu-stock.ts")).toMatch(/if \(isSampleLot\(lot\)\)/);
    for (const p of ["src/lib/pos/intake-menu-staging.ts", "src/lib/pos/draft-injection.ts"]) {
      expect(src(p)).toMatch(/const drafts = draftsAll\.filter\(\(d\) => !\(d\.lot_id && sampleIds\.has\(d\.lot_id\)\)\)/);
    }
  });
});

describe("G-47: legacy Sample-pricing panel removed", () => {
  it("panel, action and guardrail module are gone", () => {
    expect(existsSync("src/lib/inventory/sample-guardrails.ts")).toBe(false);
    expect(src("src/app/admin/inventory/disposition/page.tsx")).not.toMatch(/Sample-pricing rules/);
    expect(src("src/app/admin/inventory/disposition/actions.ts")).not.toMatch(/updateSampleSettingsAction/);
    expect(src("src/lib/admin/concierge-kb.ts")).not.toMatch(/plus sample-pricing rules/);
  });
});
