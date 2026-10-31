/**
 * Fix Phase 4.5a — the clearance / vendor-day markdown lock can be set from the
 * back office (F-06-17, part 1; owner D57).
 *
 * Owner, verbatim (markdown-lock-core.ts L8–11): "The only other sale we do that
 * is not specific to the day is a 50% off products we have been sitting on for
 * too long and things about to expire. ... Those items are excluded from any and
 * all other sales/ daily deals".
 *
 * Before this slice the engine honoured config.markdownOnly but no screen wrote
 * it (finding F-06-17), and buildConfig rebuilt config from the form on every
 * save, so a markdown set any other way would be dropped by the next edit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isMarkdownConfig, MARKDOWN_LOCK_LABEL } from "@/lib/promotions/markdown-lock-core";
import { parseEngineConfig } from "@/lib/promotions/published-rules-core";
import { computePromotions, type EngineCartLine, type EngineRule } from "@/lib/promotions/discount-engine-core";

const read = (f: string) => readFileSync(f, "utf8");
const ACTIONS = read("src/app/admin/promotions/actions.ts");
const FORM = read("src/components/admin/promotions/PromotionForm.tsx");

const rule = (id: string, percent: number, keys: string[], config: Record<string, unknown>): EngineRule => ({
  id,
  title: id,
  discountType: "percent",
  discountPercent: percent,
  discountFixed: 0,
  priority: 0,
  storewide: keys.length === 0,
  targetCategories: [],
  targetBrands: [],
  targetProductKeys: keys,
  excludeCategories: [],
  excludeBrands: [],
  excludeProductKeys: [],
  config: parseEngineConfig(config),
});

const line: EngineCartLine = {
  lineId: "l1",
  regularPriceMinorUnits: 4000,
  quantity: 1,
  categories: ["flower"],
  brand: "Alpha",
  productKey: "CLEAR-1",
  costMinorUnits: 500,
};

describe("F-06-17 part 1: the lock is readable and strict", () => {
  it("reads only a real true", () => {
    expect(isMarkdownConfig({ markdownOnly: true })).toBe(true);
    expect(isMarkdownConfig({ markdownOnly: "true" })).toBe(false);
    expect(isMarkdownConfig({ markdownOnly: 1 })).toBe(false);
    expect(isMarkdownConfig({})).toBe(false);
    expect(isMarkdownConfig(null)).toBe(false);
    expect(MARKDOWN_LOCK_LABEL).toContain("no other deal applies");
  });

  it("a stored markdown of 10% keeps its 10% on a day a 25% storewide deal runs (the owner's rule)", () => {
    const clearance = rule("clr", 10, ["CLEAR-1"], { markdownOnly: true });
    const monday = rule("mon", 25, [], {});
    const r = computePromotions([line], [clearance, monday]);
    expect(r.lines[0].appliedRuleId).toBe("clr");
    expect(r.lines[0].unitPriceMinorUnits).toBe(3600);
  });

  it("without the lock the same 10% loses to the 25% (what happened before)", () => {
    const plain = rule("clr", 10, ["CLEAR-1"], {});
    const monday = rule("mon", 25, [], {});
    const r = computePromotions([line], [plain, monday]);
    expect(r.lines[0].appliedRuleId).toBe("mon");
  });
});

describe("F-06-17 part 1: the back office writes and keeps the lock", () => {
  it("buildConfig writes markdownOnly from the checkbox, on every save, for any discount type", () => {
    expect(ACTIONS).toContain('if (formData.get("cfg_markdown_only") === "on") config.markdownOnly = true;');
    const i = ACTIONS.indexOf('formData.get("cfg_markdown_only")');
    const j = ACTIONS.indexOf("function buildConfig");
    const k = ACTIONS.indexOf("return config;", j);
    expect(i).toBeGreaterThan(j);
    expect(i).toBeLessThan(k);
  });

  it("the form has the checkbox, ticked from the stored config, with the owner's words", () => {
    expect(FORM).toContain('name="cfg_markdown_only"');
    expect(FORM).toContain("defaultChecked={markdownOnly}");
    expect(FORM).toContain("const markdownOnly = isMarkdownConfig(cfg);");
    expect(FORM).toContain("are excluded from any and all other sales/ daily");
  });

  it("the list and the detail page show the lock", () => {
    expect(read("src/app/admin/promotions/page.tsx")).toContain("isMarkdownConfig(p.config)");
    expect(read("src/app/admin/promotions/[id]/page.tsx")).toContain("isMarkdownConfig(promotion.config)");
  });
});
