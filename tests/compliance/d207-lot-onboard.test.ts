/**
 * tests/compliance/d207-lot-onboard.test.ts   (D207)
 *
 * Owner: "For the canna processing lots, I have fixed all that I can, but it
 * won't let me add/ change the price. And I can't find them in onboarding like
 * it tells me. Please do what you can to let me add/ adjust the price so I can
 * finish fixing them."
 *
 * Five CANNA PROCESSING lots sat on a delivery refused by mistake: no menu card,
 * no onboarding row, so no price box. The lot page now offers "Send to Product
 * Onboarding", which seeds exactly that lot's draft through the finalize seeder.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __runLotOnboardCoreTests, lotOnboardVerdict } from "@/lib/inventory/lot-onboard-core";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("D207 lot onboarding verdict", () => {
  it("self-tests pass", () => {
    const r = __runLotOnboardCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(19);
  });

  it("the owner's CANNA lot (refused by accident, re-activated, no draft) can be sent", () => {
    const v = lotOnboardVerdict(
      { status: "active", disposition: "rejected_at_dock", is_sample: false, pos_product_key: "GF41918905566988", manifest_id: "91d58745" },
      "not-on-menu",
      [],
    );
    expect(v.kind).toBe("send");
  });

  it("a lot still refused is never sent", () => {
    expect(
      lotOnboardVerdict({ status: "rejected", disposition: "rejected_at_dock", is_sample: false, pos_product_key: "K", manifest_id: "m" }, "not-on-menu", []).kind,
    ).toBe("none");
  });
});

describe("D207 wiring", () => {
  it("seeder accepts a single-lot narrowing", () => {
    const s = read("src/lib/inventory/catalog-drafts.ts");
    expect(s).toMatch(/lotIds\?: readonly string\[\]/);
    expect(s).toMatch(/lotQuery = lotQuery\.in\("id", onlyLotIds\)/);
  });

  it("the action re-checks, seeds one lot, reads the error and audits", () => {
    const s = read("src/app/admin/inventory/actions.ts");
    const fn = s.slice(s.indexOf("export async function sendLotToOnboardingAction"));
    expect(fn).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(fn).toMatch(/lotOnboardVerdict\(/);
    expect(fn).toMatch(/seedDraftsForManifest\(lot\.manifest_id as string, session\.userId, \{ lotIds: \[lotId\] \}\)/);
    expect(fn).toMatch(/res\.firstError/);
    expect(fn).toMatch(/inventory_lot\.sent_to_onboarding/);
  });

  it("the lot page shows the button instead of the old dead-end sentence", () => {
    const s = read("src/app/admin/inventory/[id]/page.tsx");
    expect(s).toMatch(/data-testid="lot-onboard-send"/);
    expect(s).toMatch(/Send to Product Onboarding/);
    expect(s).not.toMatch(/Onboarding is not required/);
  });
});
