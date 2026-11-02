/**
 * Vitest mirror of the D133–D136 promotions hardening (owner 2026-11-02):
 * register day-correct deals, the one-press daily-deal setup (not Thursday),
 * warn-and-suggest wording checks, and the builder guide.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { __runRegisterPromoDayTests, rulesForSale, STALE_DEALS_WARNING } from "@/lib/pos/register-promo-day-core";
import { __runDailyDealSetupTests, planDailyDeals } from "@/lib/promotions/daily-deal-setup-core";
import { __runPromotionCopyTests, checkPromotionCopy } from "@/lib/promotions/promotion-copy-core";
import { __runPromotionCopyFormTests } from "@/lib/promotions/promotion-copy-form-core";
import { __runPromotionGuideTests } from "@/lib/promotions/promotion-guide-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D133 register promo day", () => {
  it("passes its embedded self-tests", () => {
    const r = __runRegisterPromoDayTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });
  it("applies no deals from an old bundle on a later day", () => {
    const r = rulesForSale(
      { rules: [{ id: "sun" } as never], fetchedAt: "2026-11-01T20:00:00Z" },
      new Date("2026-11-02T16:14:00Z"),
    );
    expect(r.rules).toEqual([]);
    expect(r.source).toBe("stale");
    expect(r.warning).toBe(STALE_DEALS_WARNING);
  });
  it("is wired into the menu route, register and sync", () => {
    expect(read("src/app/api/pos/menu/route.ts")).toMatch(/promoSchedule: promo\.schedule/);
    expect(read("src/app/(site)/pos/RegisterShell.tsx")).toMatch(/rulesForSale\(/);
    expect(read("src/app/(site)/pos/RegisterShell.tsx")).toMatch(/shouldAutoRefreshMenu\(/);
    expect(read("src/lib/pos/sync-store.ts")).toMatch(/PROMO_MISMATCH_AUDIT_ACTION/);
  });
});

describe("D134 daily-deal setup", () => {
  it("passes its embedded self-tests", () => {
    const r = __runDailyDealSetupTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(40);
  });
  it("never plans Thursday", () => {
    expect(planDailyDeals([]).items.map((i) => i.promoKey)).not.toContain("daily.thursday");
  });
  it("cost-floor checks every day before saving and audits", () => {
    const a = read("src/app/admin/promotions/actions.ts");
    const body = a.slice(a.indexOf("export async function applyDailyDealSetupAction"));
    expect(body).toMatch(/requirePermission\("promotions\.manage"\)/);
    expect(body.indexOf("guardPromotionPublish(draft, menu)")).toBeGreaterThan(0);
    expect(body.indexOf("guardPromotionPublish(draft, menu)")).toBeLessThan(body.indexOf("savePromotionChecked("));
    expect(body).toMatch(/promotion\.daily_setup/);
  });
  it("is on the promotions page", () => {
    expect(read("src/app/admin/promotions/page.tsx")).toMatch(/<DailyDealSetupPanel/);
  });
});

describe("D135 wording check", () => {
  it("passes its embedded self-tests", () => {
    expect(__runPromotionCopyTests().failed).toBe(0);
    expect(__runPromotionCopyFormTests().failed).toBe(0);
  });
  it("warns, never throws", () => {
    const f = checkPromotionCopy({ title: "Free candy for kids" });
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.every((x) => x.suggest.length > 0)).toBe(true);
  });
  it("is live in the form and never wired into a save/publish refusal", () => {
    expect(read("src/components/admin/promotions/PromotionForm.tsx")).toMatch(/<PromotionCopyCheck/);
    expect(read("src/app/admin/promotions/actions.ts")).not.toMatch(/checkPromotionCopy/);
  });
});

describe("D136 builder guide", () => {
  it("passes its embedded self-tests", () => {
    expect(__runPromotionGuideTests().failed).toBe(0);
  });
  it("removed the stale 'saves less' help", () => {
    expect(read("src/components/admin/promotions/PromotionForm.tsx")).not.toMatch(/saves the customer LESS/);
    expect(read("src/app/admin/promotions/page.tsx")).not.toMatch(/whichever saves less/);
    expect(read("src/components/admin/promotions/PromotionForm.tsx")).toMatch(/<PromotionBuildGuide/);
  });
});
