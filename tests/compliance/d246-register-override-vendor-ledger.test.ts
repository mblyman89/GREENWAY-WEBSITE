import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runVendorLedgerTests } from "../../src/lib/vendors/vendor-ledger-core";
import { __runPublicProfileCollapseTests } from "../../src/lib/vendors/public-profile-collapse-core";
import { __runRegisterLimitExplainTests, explainRegisterLimit } from "../../src/lib/inventory/register-limit-explain-core";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

/**
 * D246: (1) a back-office re-file (product_classification_overrides) must
 * reach the REGISTER, not just the website; (2) vendor facts come from the
 * manifests/invoices, and every change from the ledger page is a
 * human-confirmed, re-checked, audited write.
 */
describe("D246 register sees the back-office re-file", () => {
  it("the register's menu loader applies overrides, read uncached", () => {
    const src = read("src/lib/pos/live-menu.ts");
    expect(src).toContain("listAllOverrides()");
    expect(src).toContain("applyClassificationOverrideRows(rows.map(menuRowToGreenwayItem), overrideRows)");
    const store = read("src/lib/pos/product-classification-overrides.ts");
    expect(store).toContain("export async function listAllOverrides(");
    expect(store).not.toMatch(/listAllOverrides[\s\S]*unstable_cache/);
  });

  it("the Blueberry Jaeger case: Infused Pre-roll is the 7 g bucket, re-filed Pre-roll is 28 g", () => {
    const before = explainRegisterLimit({ menuCategory: "infused-preroll", overrideCategory: null, inventoryType: "Usable Marijuana", productName: "Full Flower Little Snappers - Blueberry Jaeger - 20pk (20x0.5g)", unitGrams: 10 });
    expect(before.bucket).toBe("concentrate");
    expect(before.oneUnitOverLimit).toBe(true);
    expect(before.looksLikeFlowerFiledAsInfused).toBe(true);
    const after = explainRegisterLimit({ menuCategory: "infused-preroll", overrideCategory: "preroll", inventoryType: "Usable Marijuana", productName: "Full Flower Little Snappers - Blueberry Jaeger - 20pk (20x0.5g)", unitGrams: 10 });
    expect(after.source).toBe("override");
    expect(after.bucket).toBe("usable");
    expect(after.oneUnitOverLimit).toBe(false);
  });

  it("the lot page shows an 'At the register' panel", () => {
    const page = read("src/app/admin/inventory/[id]/page.tsx");
    expect(page).toContain('id="at-the-register"');
    expect(page).toContain("explainRegisterLimit(");
  });

  it("pure cores pass", () => {
    expect(__runRegisterLimitExplainTests().passed).toBeGreaterThanOrEqual(17);
    expect(__runVendorLedgerTests().passed).toBeGreaterThanOrEqual(30);
    expect(__runPublicProfileCollapseTests().passed).toBeGreaterThanOrEqual(12);
  });
});

describe("D246 vendor ledger", () => {
  it("public vendor profiles fold merged duplicate cards into the survivor", () => {
    const store = read("src/lib/vendors/store.ts");
    expect(store).toContain("collapseMergedVendorProfiles(");
  });

  it("every ledger action requires vendors.manage, re-reads the paperwork, and audits", () => {
    const a = read("src/app/admin/vendors/ledger/actions.ts");
    for (const fn of ["ledgerMoveLotsAction", "ledgerAddLicenseAction", "ledgerFillBrandAction"]) {
      const body = a.slice(a.indexOf(`export async function ${fn}(`));
      const end = body.indexOf("\nexport async function", 10);
      const one = end > 0 ? body.slice(0, end) : body;
      expect(one).toContain('requirePermission("vendors.manage")');
      expect(one).toContain("await loadVendorLedger()");
      expect(one).toContain("ledger.problems.length");
      expect(one).toContain("recordAudit(");
    }
    // Writes are guarded on the value the ledger saw (no blind overwrite) and nothing is deleted.
    expect(a).toContain('guard.equals === null ? base.is(guard.column, null) : base.eq(guard.column, guard.equals)');
    expect(a).not.toMatch(/\.delete\(/);
  });

  it("the merge reused by the ledger only returns to known pages", () => {
    const a = read("src/app/admin/vendors/actions.ts");
    expect(a).toContain('String(formData.get("return_to") ?? "") === "/admin/vendors/ledger" ? "/admin/vendors/ledger" : "/admin/vendors/merge"');
  });

  it("the vendors page links the ledger and the vendor page shows paperwork facts", () => {
    expect(read("src/app/admin/vendors/page.tsx")).toContain('"/admin/vendors/ledger"');
    const detail = read("src/app/admin/vendors/[id]/page.tsx");
    expect(detail).toContain("loadVendorPaperworkPanel(id)");
    expect(detail).toContain('id="paperwork-facts"');
  });

  it("the server read is paged with a stable order", () => {
    const s = read("src/lib/vendors/vendor-ledger-server.ts");
    expect(s).toContain('import "server-only"');
    expect((s.match(/\.order\("id"\)/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(s).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
