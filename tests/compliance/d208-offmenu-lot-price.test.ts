/**
 * tests/compliance/d208-offmenu-lot-price.test.ts   (D208)
 *
 * Owner: "Will you tell me if I can modify the 5 canna processing lots? They
 * are the only things I've found that came over from Cultivera that doesn't
 * let me change or even see what the price is on the menu if one were to be
 * scanned on the register. Please let me know if that's fixed. I want to set
 * the price in the detail page like all the others. If not, please fix it."
 *
 * The lot page now shows a price box for a lot that is not on the menu yet.
 * Saving it seeds (if needed) and APPROVES the product's onboarding row at
 * that price through approveDraftWithPrice, so every onboarding gate runs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __runLotOnboardCoreTests, offMenuPriceStep, showOffMenuPriceBox } from "@/lib/inventory/lot-onboard-core";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("D208 off-menu price step", () => {
  it("self-tests pass (D207 + D208)", () => {
    const r = __runLotOnboardCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(26);
  });

  it("the CANNA lot with no onboarding row gets the price box (seed then approve)", () => {
    expect(showOffMenuPriceBox({ kind: "send" })).toBe(true);
    expect(offMenuPriceStep({ kind: "send" }).kind).toBe("seed_then_approve");
  });

  it("never prices a lot the verdict refuses", () => {
    expect(showOffMenuPriceBox({ kind: "none", reason: "Trade samples never go on the menu." })).toBe(false);
    expect(offMenuPriceStep({ kind: "none", reason: "x" }).kind).toBe("refuse");
  });
});

describe("D208 wiring", () => {
  it("the action re-checks, seeds one lot, approves through the onboarding gates and audits", () => {
    const s = read("src/app/admin/inventory/actions.ts");
    const fn = s.slice(s.indexOf("export async function setOffMenuLotPriceAction"));
    expect(fn).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(fn).toMatch(/parsePriceCorrection\(/);
    expect(fn).toMatch(/lotOnboardVerdict\(/);
    expect(fn).toMatch(/seedDraftsForManifest\(lot\.manifest_id as string, session\.userId, \{ lotIds: \[lotId\] \}\)/);
    expect(fn).toMatch(/approveDraftWithPrice\(found\.draftId, parsed\.afterTaxMinor/);
    expect(fn).toMatch(/inventory_lot\.off_menu_price_set/);
    expect(fn).toMatch(/inventory_lot\.off_menu_price_refused/);
    expect(fn).toMatch(/res\.firstError/);
  });

  it("the lot page shows the price box for an off-menu lot", () => {
    const s = read("src/app/admin/inventory/[id]/page.tsx");
    expect(s).toMatch(/data-testid="lot-offmenu-price"/);
    expect(s).toMatch(/setOffMenuLotPriceAction\.bind\(null, id\)/);
    expect(s).toMatch(/data-testid="lot-onboard-send"/);
  });

  it("the open-draft finder never guesses between several rows", () => {
    const s = read("src/lib/inventory/lot-link-store.ts");
    const fn = s.slice(s.indexOf("export async function findOpenDraftForLot"));
    expect(fn).toMatch(/\.eq\("status", "draft"\)/);
    expect(fn).toMatch(/rows\.length > 1/);
  });
});
