/**
 * POS Slice B41 — scan-required mode (pure core).
 *
 * Dutchie ships a "require scanning" register mode: cannabis items must be
 * added by SCANNING the package barcode, not by tapping a tile — the scan
 * proves the budtender is holding the exact package that leaves the shelf,
 * killing wrong-item picks (two strains, same name, different lots) before
 * they become inventory drift.
 *
 * Design decisions (verified against this codebase, not guessed):
 *  - CANNABIS ONLY. "Cannabis" reuses the exact complement of
 *    NON_CANNABIS_TAX_CATEGORIES from order-pricing-core — the same set the
 *    pricing engine, the B39 keypad, and CCRS classification key off. Merch
 *    and accessories carry no lot identity, so tapping their tiles (and the
 *    B39 keypad) stays allowed.
 *  - OWNER SETTING, no migration: a site_settings JSON row (B33 pattern)
 *    that rides the menu bundle so OFFLINE registers keep enforcing the
 *    cached policy. Missing/garbage config degrades to OFF — the register
 *    never invents a restriction the owner didn't pick.
 *  - MANAGER UNLOCK, per sale: a manager/lead PIN (verified server-side by
 *    /api/pos/approve — same scrypt + throttle + role gate as B24 price
 *    overrides, therefore ONLINE-ONLY) lifts the restriction for the
 *    CURRENT sale only. The register locks after every sale (owner rule),
 *    so the unlock can never leak into the next customer.
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

import { NON_CANNABIS_TAX_CATEGORIES } from "@/lib/orders/order-pricing-core";
import type { PosMenuProduct } from "./sale-flow-core";

/** Owner config — one switch, stored as a site_settings JSON row. */
export type PosScanRequiredConfig = {
  /** When true, cannabis items must be scanned at the register. */
  enabled: boolean;
};

export const DEFAULT_POS_SCAN_REQUIRED_CONFIG: PosScanRequiredConfig = { enabled: false };

/**
 * Normalize an untrusted value (site_settings JSON, cached bundle, form
 * payload) into a safe config. Anything but a literal `true` degrades to
 * OFF — the register never invents a restriction the owner didn't pick.
 */
export function normalizePosScanRequiredConfig(raw: unknown): PosScanRequiredConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_POS_SCAN_REQUIRED_CONFIG };
  }
  return { enabled: (raw as Record<string, unknown>).enabled === true };
}

/**
 * Does this product need a scan when the mode is on? Cannabis = category not
 * in NON_CANNABIS_TAX_CATEGORIES (the pricing engine's own split — merch and
 * accessories are exempt; everything else, INCLUDING a blank category, is
 * conservatively cannabis, matching the CCRS classifier's posture).
 */
export function productRequiresScan(product: Pick<PosMenuProduct, "category">): boolean {
  const slug = (product.category ?? "").trim().toLowerCase();
  return !NON_CANNABIS_TAX_CATEGORIES.has(slug);
}

/**
 * The register's one guard: is MANUALLY tapping this product blocked right
 * now? (Scanning is never blocked — that is the point of the mode.)
 *
 *  - config missing (pre-B41 cached bundle) or disabled → never blocked.
 *  - manager unlocked this sale → never blocked.
 *  - otherwise → blocked exactly when the product requires a scan.
 */
export function manualAddBlocked(
  config: PosScanRequiredConfig | undefined,
  unlockedThisSale: boolean,
  product: Pick<PosMenuProduct, "category">,
): boolean {
  if (config?.enabled !== true) return false;
  if (unlockedThisSale) return false;
  return productRequiresScan(product);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runScanRequiredCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  // Config normalization — anything but literal `true` is OFF.
  ok(normalizePosScanRequiredConfig(null).enabled === false, "null -> off");
  ok(normalizePosScanRequiredConfig(undefined).enabled === false, "undefined -> off");
  ok(normalizePosScanRequiredConfig("yes").enabled === false, "string -> off");
  ok(normalizePosScanRequiredConfig([]).enabled === false, "array -> off");
  ok(normalizePosScanRequiredConfig({}).enabled === false, "empty object -> off");
  ok(normalizePosScanRequiredConfig({ enabled: "true" }).enabled === false, 'string "true" -> off (literal boolean only)');
  ok(normalizePosScanRequiredConfig({ enabled: 1 }).enabled === false, "truthy number -> off");
  ok(normalizePosScanRequiredConfig({ enabled: true }).enabled === true, "literal true -> on");
  ok(normalizePosScanRequiredConfig({ enabled: false }).enabled === false, "literal false -> off");
  ok(DEFAULT_POS_SCAN_REQUIRED_CONFIG.enabled === false, "default is off");

  // Cannabis / non-cannabis split — MUST mirror the pricing engine's set.
  ok(productRequiresScan({ category: "flower" }) === true, "flower requires scan");
  ok(productRequiresScan({ category: "Concentrates" }) === true, "concentrates (any casing) requires scan");
  ok(productRequiresScan({ category: "edibles" }) === true, "edibles requires scan");
  ok(productRequiresScan({ category: "" }) === true, "blank category conservatively requires scan (CCRS posture)");
  for (const c of NON_CANNABIS_TAX_CATEGORIES) {
    ok(productRequiresScan({ category: c }) === false, `non-cannabis "${c}" never requires scan`);
  }
  ok(productRequiresScan({ category: " MERCH " }) === false, "category is trimmed + lowercased before the check");

  // The guard.
  const on: PosScanRequiredConfig = { enabled: true };
  const off: PosScanRequiredConfig = { enabled: false };
  const flower = { category: "flower" };
  const merch = { category: "merch" };
  ok(manualAddBlocked(undefined, false, flower) === false, "pre-B41 cached bundle (no config) never blocks");
  ok(manualAddBlocked(off, false, flower) === false, "mode off never blocks");
  ok(manualAddBlocked(on, false, flower) === true, "mode on blocks manual cannabis add");
  ok(manualAddBlocked(on, false, merch) === false, "mode on never blocks merch tiles / keypad");
  ok(manualAddBlocked(on, true, flower) === false, "manager unlock lifts the block for this sale");

  console.log(`scan-required-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`scan-required-core self-tests failed: ${failures.join("; ")}`);
  }
}
