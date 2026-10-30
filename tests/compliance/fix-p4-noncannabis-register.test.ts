/**
 * Fix Phase 4 (plan rows 5.1/5.2; G-29/G-30/G-30A/G-32) — Other Inventory on
 * the register. Owner, verbatim (D45): "Q-05b-1- yes, and any other upgrade,
 * enhancement and such needed to fully utilize non cannabis goods in the
 * system and on the register and on the menu."
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  __runNcPosCatalogTests,
  isNonCannabisProductId,
  ncProductKey,
  signedDeltaForReason,
  validatePriceCostChange,
  weightedAverageCost,
} from "@/lib/noncannabis/pos-catalog-core";
import { can } from "@/lib/auth/roles";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Phase 4 — migration 0323", () => {
  it("ships the migration and its rollback", () => {
    const m = read("supabase/migrations/0323_noncannabis_register.sql");
    for (const fn of ["apply_noncannabis_delta", "record_noncannabis_invoice", "record_noncannabis_return"]) {
      expect(m).toContain(`create or replace function public.${fn}`);
    }
    expect(m).toContain("idx_noncannabis_adjustments_line_once");
    expect(m).not.toMatch(/create table/i);
    expect(existsSync(join(root, "supabase/rollbacks/0323_noncannabis_register.rollback.sql"))).toBe(true);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## Fix 4 — 0323 — Other Inventory on the register");
  });
});

describe("Phase 4 — wiring", () => {
  it("sale and void move Other Inventory stock", () => {
    expect(read("src/lib/inventory/sale-decrement.ts")).toContain('moveNcStockForOrder(admin, orderId, allLines, "sale")');
    expect(read("src/lib/pos/void-store.ts")).toContain('moveNcStockForOrder(admin, orderId, allLines, "void")');
  });
  it("COGS reads the catalog cost; register menu serves the catalog", () => {
    expect(read("src/lib/accounting/sale-posting-service.ts")).toContain("readNcUnitCosts");
    expect(read("src/app/api/pos/menu/route.ts")).toContain("readNcCatalogForRegister");
  });
  it("CCRS never sees Other Inventory", () => {
    expect(read("src/lib/compliance/ccrs-sales.ts")).toContain("nonCannabisLines++");
    expect(read("src/lib/compliance/ccrs-batch.ts")).toContain('=== "NonCannabis"');
  });
  it("returns route Other Inventory to its own RPC", () => {
    expect(read("src/lib/pos/returns-store.ts")).toContain("createNonCannabisReturn");
  });
  it("G-30A: merch Remove is owner and admin only", () => {
    expect(can("owner", "merch.remove")).toBe(true);
    expect(can("admin", "merch.remove")).toBe(true);
    expect(can("manager", "merch.remove")).toBe(false);
    expect(read("src/app/admin/inventory/merch/actions.ts")).toContain('requirePermission("merch.remove")');
  });
});

describe("Phase 4 — pure core", () => {
  it("self-tests pass", () => {
    expect(__runNcPosCatalogTests()).toBeGreaterThanOrEqual(40);
  });
  it("keys, direction, price and average cost", () => {
    expect(isNonCannabisProductId(ncProductKey("3f2b6c1e-8a4d-4f7e-9b1a-2c3d4e5f6a7b"))).toBe(true);
    expect(isNonCannabisProductId("abc")).toBe(false);
    expect(signedDeltaForReason("theft", 2, "add")).toEqual({ ok: true, delta: -2 });
    expect(signedDeltaForReason("other", 2, null).ok).toBe(false);
    expect(validatePriceCostChange({ field: "price", oldMinor: 500, newMinor: 0, reason: "typo fix" }).ok).toBe(false);
    expect(weightedAverageCost(10, 100, 10, 200)).toBe(150);
    expect(weightedAverageCost(5, 0, 3, 250)).toBe(250);
  });
});
