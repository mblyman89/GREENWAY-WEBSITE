/**
 * D232 slice M-8 (SOP-11 B.6): pricing guard (G-87, owner "Q8: 35% is fine."),
 * help everywhere (G-90: helpers, integration guides, concierge) and the
 * studio-default placements (G-92, owner "Q6: yes." - samples approved, not
 * measured, so never called confirmed).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runFulfillmentTests, MIN_MARGIN_BPS, suggestRetailCents, unitEconomics } from "@/lib/merch-studio/fulfillment-core";
import { __runListingPackageTests } from "@/lib/merch-studio/listing-package-core";
import { __runPrintfileCheckTests, studioDefaultPlacements, STUDIO_DEFAULT_STATUS } from "@/lib/merch-studio/printfile-check-core";
import { __runMerchHealthCoreTests } from "@/lib/merch/merch-health-core";
import { __runPageHelpersTests, PAGE_HELPERS, helperHref } from "@/lib/admin/page-helpers-core";
import { guideById } from "@/lib/integrations/integration-guides";
import { CONCIERGE_KB } from "@/lib/admin/concierge-kb";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-8 G-87: pricing guard", () => {
  it("pure rules pass", () => {
    expect(__runFulfillmentTests().failed).toBe(0);
    expect(__runListingPackageTests().failed).toBe(0);
    expect(__runMerchHealthCoreTests().failed).toBe(0);
  });
  it("the owner's minimum is 35%", () => expect(MIN_MARGIN_BPS).toBe(3500));
  it("the suggestion covers the shipping gap", () => {
    const ship = { chargedCents: 599, costCents: 1360 };
    const r = suggestRetailCents(1560, MIN_MARGIN_BPS, "00", ship);
    expect(unitEconomics({ retailCents: r, printfulCents: 1560, shippingChargedCents: 599, shippingCostCents: 1360 }).marginBps).toBeGreaterThanOrEqual(3500);
  });
  it("Publish no longer starts at a hard-coded $35", () => {
    const src = read("src/components/admin/merch-studio/PublishPanel.tsx");
    expect(src).not.toContain('useState("35")');
    expect(src).toContain("lastRetail");
    expect(src).toContain("printfulShippingRateAction");
  });
  it("the rate quote goes to Washington via POST /shipping/rates, content.edit", () => {
    const src = read("src/app/admin/merch-studio/pricing-actions.ts");
    expect(src).toContain('"/shipping/rates"');
    expect(src).toContain('state_code: "WA"');
    expect(src).toContain('requirePermission("content.edit")');
  });
});

describe("D232 M-8 G-90: help everywhere", () => {
  it("helpers registry passes and covers Merch Inventory + Reports -> Merch", () => {
    expect(__runPageHelpersTests().failures).toEqual([]);
    expect(PAGE_HELPERS.find((h) => h.id === "merch-inventory")?.href).toBe("/admin/inventory/merch");
    expect(PAGE_HELPERS.find((h) => h.id === "merch-report")?.href).toBe("/admin/reports/merch");
    expect(helperHref("merch-report")).toBe("/admin/helpers#merch-report");
  });
  it("both pages link their helper", () => {
    expect(read("src/app/admin/inventory/merch/page.tsx")).toContain('helpId="merch-inventory"');
    expect(read("src/app/admin/reports/merch/page.tsx")).toContain('helperHref("merch-report")');
  });
  it("Printful, Stripe (merch) and Resend (merch) guides exist and render", () => {
    for (const id of ["printful", "stripe-merch", "resend-merch"]) expect(guideById(id)?.steps.length).toBeGreaterThan(2);
    expect(read("src/app/admin/integrations/page.tsx")).toContain('"printful", "stripe-merch", "resend-merch"');
  });
  it("the concierge has a merch topic covering setup, pricing, orders, holds and messages", () => {
    const t = CONCIERGE_KB.find((k) => k.id === "merch");
    expect(t?.href).toBe("/admin/merch-studio");
    const all = (t?.facts ?? []).join(" ");
    for (const s of ["Setup & Launch", "Merch Health", "35%", "Merch Inventory", "Confirm", "7 days", "Checkout isn't open yet", "Reports \u2192 Merch"]) expect(all).toContain(s);
  });
});

describe("D232 M-8 G-92: studio-default placements", () => {
  it("pure rules pass; 8 placements listed", () => {
    expect(__runPrintfileCheckTests().failed).toBe(0);
    expect(studioDefaultPlacements()).toHaveLength(8);
  });
  it("never claims the estimates are confirmed", () => {
    expect(STUDIO_DEFAULT_STATUS).toContain("not measured");
    const cat = read("src/components/admin/merch-studio/CatalogPanel.tsx");
    expect(cat).toContain("awaiting sample measurement");
    expect(read("src/app/admin/merch-studio/pricing-actions.ts")).toContain("/mockup-generator/printfiles/");
  });
});
