/**
 * Fix Phase 4b — G-32 items 7–10. Owner, verbatim (D49): "Q-05b-5- yes, plan
 * on the group of smaller fixes. blocked until the manifest cost is entered."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePriceCorrection, COST_UNKNOWN_PRICE_REFUSAL } from "@/lib/inventory/price-correction-core";
import { sharedSizeFloor, sharedFloorRefusal } from "@/lib/inventory/lot-size-link-core";
import { removalCheckFailedCopy } from "@/lib/pos/publish-guard-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("item 7 — publish fails closed (F-05b-10)", () => {
  it("the guard reads strictly and the action refuses when it throws", () => {
    const mv = read("src/lib/pos/menu-version.ts");
    expect(mv).toContain("if (strict) throw new Error(`live menu read failed");
    expect(mv).toMatch(/if \(!staged\.complete\) throw/);
    expect(mv).toMatch(/if \(!base\.complete\) throw/);
    const act = read("src/app/admin/menu-imports/actions.ts");
    expect(act).toContain("await getPublishedVersion({ strict: true })");
    expect(act).toContain("await diffVersions(versionId, published.id, { strict: true })");
    expect(act).toContain("redirect(dest + \"?error=\" + encodeURIComponent(removalCheckFailedCopy()))");
    expect(act).toContain("menu.publish_refused_check_failed");
    expect(removalCheckFailedCopy()).toMatch(/^Not published yet:.*nothing was changed/);
  });
});

describe("item 8 — category audits carry before / after (F-05b-11)", () => {
  it("every update / deactivate / delete audit has a before", () => {
    const src = read("src/app/admin/settings/types/actions.ts");
    for (const action of [
      "website_category.updated",
      "website_category.deactivated",
      "website_category.deleted",
      "inventory_type.updated",
      "inventory_type.deleted",
    ]) {
      const i = src.indexOf(`action: "${action}"`);
      expect(i, action).toBeGreaterThan(0);
      expect(src.slice(i, i + 600), action).toMatch(/before:/);
    }
  });
});

describe("item 9 — no price on a cost-unknown lot (F-05b-12, D49)", () => {
  it("refuses for a null or $0 cost and still allows a priced lot", () => {
    const none = parsePriceCorrection({ afterTaxDollars: "25.00", costMinor: null, category: "flower" });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toBe(COST_UNKNOWN_PRICE_REFUSAL);
    expect(parsePriceCorrection({ afterTaxDollars: "25.00", costMinor: 0, category: "flower" }).ok).toBe(false);
    expect(parsePriceCorrection({ afterTaxDollars: "25.00", costMinor: 1000, category: "flower" }).ok).toBe(true);
  });
  it("a shared price is refused while any sharing lot has no cost", () => {
    const f = sharedSizeFloor(
      [
        { id: "a", unit_cost_minor_units: 1000 },
        { id: "b", unit_cost_minor_units: null },
      ],
      "flower",
    );
    expect(sharedFloorRefusal(100000, f, "1g")).toMatch(/no cost on file/);
  });
  it("the lot page greys out Save sell price when the cost is unknown", () => {
    expect(read("src/app/admin/inventory/[id]/page.tsx")).toContain("disabled={priceFloorMinor == null}");
  });
});

describe("item 10 — classification copy failure warns (F-05b-13)", () => {
  it("redirects with class_warn and the page shows Partly saved", () => {
    expect(read("src/app/admin/inventory/actions.ts")).toContain("class_warn=${encodeURIComponent(lotWriteError.slice(0, 300))}");
    const page = read("src/app/admin/inventory/[id]/page.tsx");
    expect(page).toContain('data-testid="lot-class-warn-banner"');
    expect(page).toContain("Partly saved.");
  });
});
