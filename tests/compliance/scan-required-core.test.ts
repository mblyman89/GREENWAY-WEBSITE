/**
 * POS Slice B41 — vitest mirror for the scan-required core.
 *
 * Runs the full self-test suite, then pins the compliance-relevant
 * behaviors: the cannabis split mirrors the pricing engine's
 * NON_CANNABIS_TAX_CATEGORIES exactly, blank categories are conservatively
 * cannabis (CCRS posture), and unknown config degrades to OFF so a
 * pre-B41 cached bundle never blocks a sale.
 */
import { describe, expect, it } from "vitest";

import { NON_CANNABIS_TAX_CATEGORIES } from "@/lib/orders/order-pricing-core";
import {
  DEFAULT_POS_SCAN_REQUIRED_CONFIG,
  __runScanRequiredCoreTests,
  manualAddBlocked,
  normalizePosScanRequiredConfig,
  productRequiresScan,
} from "@/lib/pos/scan-required-core";

describe("scan-required-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runScanRequiredCoreTests()).not.toThrow();
  });
});

describe("scan-required-core compliance pins", () => {
  it("cannabis split mirrors the pricing engine's NON_CANNABIS_TAX_CATEGORIES exactly", () => {
    for (const c of NON_CANNABIS_TAX_CATEGORIES) {
      expect(productRequiresScan({ category: c })).toBe(false);
    }
    for (const c of ["flower", "concentrates", "edibles", "vapes", "prerolls", "topicals"]) {
      expect(productRequiresScan({ category: c })).toBe(true);
    }
  });

  it("blank category is conservatively cannabis (matches the CCRS classifier posture)", () => {
    expect(productRequiresScan({ category: "" })).toBe(true);
    expect(productRequiresScan({ category: "   " })).toBe(true);
  });

  it("missing/garbage config never blocks (pre-B41 cached bundles keep selling)", () => {
    expect(manualAddBlocked(undefined, false, { category: "flower" })).toBe(false);
    expect(normalizePosScanRequiredConfig("garbage").enabled).toBe(false);
    expect(normalizePosScanRequiredConfig({ enabled: "true" }).enabled).toBe(false);
    expect(DEFAULT_POS_SCAN_REQUIRED_CONFIG.enabled).toBe(false);
  });

  it("manager unlock lifts the block; merch/keypad categories are never blocked", () => {
    const on = { enabled: true };
    expect(manualAddBlocked(on, false, { category: "flower" })).toBe(true);
    expect(manualAddBlocked(on, true, { category: "flower" })).toBe(false);
    expect(manualAddBlocked(on, false, { category: "merch" })).toBe(false);
    expect(manualAddBlocked(on, false, { category: "accessories" })).toBe(false);
  });
});
