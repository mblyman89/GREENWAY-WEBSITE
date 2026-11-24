import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DISPLAY_RULES_CALLERS,
  MONEY_RULES_CALLERS,
  PUBLISHED_RULES_TAG,
  __runDisplayRulesCacheTests,
} from "@/lib/promotions/display-rules-cache-core";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("USAGE-8d: storefront reads cached display rules; money paths stay live", () => {
  it("self-test passes", () => {
    expect(__runDisplayRulesCacheTests().failed).toBe(0);
  });
  it.each(DISPLAY_RULES_CALLERS)("%s uses the cached display read", (file) => {
    const src = code(file);
    expect(src).toContain("loadDisplayRuleSnapshots");
    expect(src).not.toContain("loadPublishedRuleSnapshots");
  });
  it.each(MONEY_RULES_CALLERS)("%s never imports the display cache (rule 18)", (file) => {
    expect(read(file)).not.toContain("display-rules-cache");
  });
  it("the cache stores only successful reads and is tagged", () => {
    const src = code("src/lib/promotions/display-rules-cache.ts");
    expect(src).toContain("readPublishedRuleSnapshots()");
    expect(src).toContain("tags: [PUBLISHED_RULES_TAG]");
    const engine = read("src/lib/promotions/discount-engine.ts");
    expect(engine).toMatch(/export async function readPublishedRuleSnapshots[\s\S]*?\n\}/);
    const inner = engine.match(/export async function readPublishedRuleSnapshots[\s\S]*?\n\}/)![0];
    expect(inner).not.toContain("catch");
    expect(PUBLISHED_RULES_TAG).toBe("published-rules");
  });
  it("only public pages import the cached entry point", () => {
    for (const f of MONEY_RULES_CALLERS.concat(["src/app/admin/specials/page.tsx", "src/lib/promotions/storefront-bridge.ts"])) {
      expect(read(f)).not.toContain("loadDisplayRuleSnapshots");
    }
  });
  it("every promotion edit clears the tag", () => {
    const actions = code("src/app/admin/promotions/actions.ts");
    for (const fn of ["updatePromotionAction", "setPromotionStatusAction", "deletePromotionAction", "addNeverDiscountAction", "removeNeverDiscountAction", "applyDailyDealSetupAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`)).split(/\nexport async function /)[0];
      expect(body, fn).toContain("revalidateDisplayRules()");
    }
    expect(code("src/app/admin/specials/actions.ts")).toContain("revalidateDisplayRules()");
    expect(code("src/app/admin/promotions/bad-products/actions.ts")).toContain("revalidateDisplayRules()");
  });
});
