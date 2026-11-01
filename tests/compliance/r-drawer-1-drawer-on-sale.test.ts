/**
 * R-DRAWER-1 — open the cash drawer with or without a printed receipt.
 *
 * Owner request (verbatim): "i want to build a setting in the register
 * activity page of the back office that gives me the option of popping the
 * cash drawer with a receipt or with out the receipt printed."
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  __runDrawerOnSaleCoreTests,
  isCashSale,
  normalizePosDrawerOnSaleConfig,
  printShouldOpenDrawer,
  shouldAutoOpenDrawer,
  showOpenDrawerRetry,
} from "../../src/lib/pos/drawer-on-sale-core";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("drawer-on-sale-core self-tests", () => {
  it("all pass", () => {
    const r = __runDrawerOnSaleCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(33);
  });
});

describe("rules", () => {
  const ONLY = { mode: "drawer_only" as const };
  it("defaults to today's behaviour (with a printed receipt)", () => {
    expect(normalizePosDrawerOnSaleConfig(undefined).mode).toBe("print_receipt");
    expect(normalizePosDrawerOnSaleConfig({ mode: "junk" }).mode).toBe("print_receipt");
  });
  it("without a receipt: a cash sale opens the drawer by itself, once", () => {
    const s = { config: ONLY, cashSale: true, drawerAlreadyOpened: false, autoOpenAlreadyAttempted: false };
    expect(shouldAutoOpenDrawer(s)).toBe(true);
    expect(shouldAutoOpenDrawer({ ...s, autoOpenAlreadyAttempted: true })).toBe(false);
    expect(showOpenDrawerRetry({ ...s, autoOpenAlreadyAttempted: true })).toBe(true);
  });
  it("a reprint never opens the drawer (F-01-6)", () => {
    expect(printShouldOpenDrawer({ cashSale: true, drawerAlreadyOpened: false })).toBe(true);
    expect(printShouldOpenDrawer({ cashSale: true, drawerAlreadyOpened: true })).toBe(false);
  });
  it("an employee pay-later sale never opens the drawer", () => {
    expect(isCashSale({ tenderedMinor: 0, employeeTabMinor: 1870 })).toBe(false);
    expect(isCashSale({ tenderedMinor: 2000 })).toBe(true);
  });
});

describe("wiring", () => {
  it("Register Activity links to the setting page", () => {
    expect(read("src/app/admin/registers/page.tsx")).toContain("${BASE}/cash-drawer");
  });
  it("the page and the action need settings.manage; the save is audited", () => {
    expect(read("src/app/admin/registers/cash-drawer/page.tsx")).toContain('requirePermission("settings.manage")');
    const action = read("src/app/admin/registers/cash-drawer/actions.ts");
    expect(action).toContain('requirePermission("settings.manage")');
    expect(action).toContain('"pos.drawer_on_sale_saved"');
  });
  it("stored in site_settings and shipped in the menu bundle", () => {
    const store = read("src/lib/pos/drawer-on-sale-store.ts");
    expect(store).toContain('"pos_drawer_on_sale"');
    expect(store).toContain('from("site_settings")');
    expect(read("src/app/api/pos/menu/route.ts")).toContain("drawerOnSale,");
    expect(read("src/lib/pos/sale-flow-core.ts")).toContain("drawerOnSale?: PosDrawerOnSaleConfig;");
  });
  it("the register uses the setting and the drawer-only job", () => {
    const sf = read("src/app/(site)/pos/SaleFlow.tsx");
    expect(sf).toContain("drawerOnSale={bundle.drawerOnSale}");
    expect(sf).toContain("openCashDrawer(getPairedPrinterIdentifier())");
    expect(sf).not.toContain('{ html, openDrawer: true, jobKind: "sale" }');
  });
  it("the native app already has the drawer-only call (no Swift change)", () => {
    expect(read("ios/App/App/StarPrinterPlugin.swift")).toContain("openDrawer");
  });
});
