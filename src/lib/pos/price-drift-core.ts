/**
 * src/lib/pos/price-drift-core.ts  (POS AN-5)
 *
 * PURE price-drift detection for synced register sales. No React, no DB,
 * no server-only — unit-testable with tsx.
 *
 * THE GAP (verified in code): sync trusts device-stored prices, which is
 * CORRECT for offline integrity (the customer paid what the register
 * displayed), but nothing ever cross-checks those prices against the menu
 * of record at sync time. A register running a stale cached bundle keeps
 * charging yesterday's prices silently.
 *
 * THE COMPARISON (override-aware by construction): every sale line carries
 * `regularPriceMinor` — the PRE-discount, tax-inclusive unit price copied
 * from the device's menu bundle (`variant.priceMinorUnits`). Manager
 * overrides, promo discounts, and loyalty reductions only ever change
 * `unitPriceMinor`; `regularPriceMinor` stays the menu snapshot. So
 * comparing regularPriceMinor against the CURRENT published variant price
 * detects exactly one thing — the menu of record moved after the device
 * downloaded its bundle — with zero false positives from discounts.
 *
 * NEVER BLOCKS: drift is a NOTICE, not an exception. The sale already
 * happened at the drawer (possibly offline, possibly hours ago); refusing
 * to complete it would strip its money from the X/Z day report (only
 * PROCESSED sales are summed) and flood the manager queue for what is
 * usually a benign reprice. The caller completes the sale normally and
 * records a durable `register.price_drift` audit row for manager review.
 *
 * Money is MINOR UNITS (cents).
 */

// ---------------------------------------------------------------------------
// Menu price index
// ---------------------------------------------------------------------------

/** One published-menu variant price row, as the caller queried it. */
export type MenuPriceRow = {
  /** menu_items.source_item_id — the stable POS product key. */
  productId: string;
  /** menu_variants.source_variant_id. */
  variantId: string;
  /** menu_variants.price_minor_units (tax-inclusive, cents). */
  priceMinor: number;
};

export type MenuPriceIndex = {
  /** `${productId}\u0000${variantId}` → current price (cents). */
  variantPrices: Map<string, number>;
  /** Every productId present on the published menu (delisting detection). */
  productIds: Set<string>;
};

const KEY_SEP = "\u0000";

/** Build the lookup index from pre-queried published-menu rows. */
export function buildMenuPriceIndex(rows: MenuPriceRow[]): MenuPriceIndex {
  const variantPrices = new Map<string, number>();
  const productIds = new Set<string>();
  for (const r of rows) {
    if (!r.productId || !r.variantId) continue;
    if (!Number.isInteger(r.priceMinor) || r.priceMinor < 0) continue;
    variantPrices.set(`${r.productId}${KEY_SEP}${r.variantId}`, r.priceMinor);
    productIds.add(r.productId);
  }
  return { variantPrices, productIds };
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

/** The minimal sale-line shape the check needs (from PosSaleLine). */
export type DriftLineInput = {
  productId: string;
  productName: string;
  /** source_variant_id — OPTIONAL (pre-B20 queues omit it → line skipped). */
  variantId?: string | null;
  /** The device's pre-discount menu-price snapshot (cents). */
  regularPriceMinor: number;
};

export type PriceDriftFinding = {
  productId: string;
  productName: string;
  variantId: string | null;
  /**
   * price           — variant found, prices differ beyond tolerance
   * delisted        — the product is no longer on the published menu
   * variant_missing — product exists but this exact variant is gone
   */
  kind: "price" | "delisted" | "variant_missing";
  devicePriceMinor: number;
  /** Current menu price (null when the variant/product is gone). */
  menuPriceMinor: number | null;
  /** device − menu (null when incomparable). Positive = device charged MORE. */
  deltaMinor: number | null;
};

/**
 * Default tolerance: 0¢. Both sides are integer cents from the SAME source
 * (menu_variants.price_minor_units → bundle → back again), so any nonzero
 * delta means the menu of record actually moved. The parameter exists so a
 * future owner setting can quiet small drifts without touching the math.
 */
export const DEFAULT_PRICE_DRIFT_TOLERANCE_MINOR = 0;

/**
 * Compare a synced sale's lines against the current published menu.
 * Returns one finding per drifted line; an empty array means no drift.
 * Defensive: lines without a variantId are SKIPPED (pre-B20 queues — we
 * cannot resolve an exact variant, and we never guess one), and malformed
 * prices are skipped rather than reported as false drift.
 */
export function checkPriceDrift(
  lines: DriftLineInput[],
  index: MenuPriceIndex,
  toleranceMinor: number = DEFAULT_PRICE_DRIFT_TOLERANCE_MINOR,
): PriceDriftFinding[] {
  const tolerance = Number.isInteger(toleranceMinor) && toleranceMinor >= 0 ? toleranceMinor : 0;
  const findings: PriceDriftFinding[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const variantId = typeof line.variantId === "string" && line.variantId.trim() ? line.variantId : null;
    if (!variantId) continue; // pre-B20 queue — no exact identity, never guess
    if (!Number.isInteger(line.regularPriceMinor) || line.regularPriceMinor < 0) continue;
    if (!index.productIds.has(line.productId)) {
      findings.push({
        productId: line.productId,
        productName: line.productName,
        variantId,
        kind: "delisted",
        devicePriceMinor: line.regularPriceMinor,
        menuPriceMinor: null,
        deltaMinor: null,
      });
      continue;
    }
    const menuPrice = index.variantPrices.get(`${line.productId}${KEY_SEP}${variantId}`);
    if (menuPrice === undefined) {
      findings.push({
        productId: line.productId,
        productName: line.productName,
        variantId,
        kind: "variant_missing",
        devicePriceMinor: line.regularPriceMinor,
        menuPriceMinor: null,
        deltaMinor: null,
      });
      continue;
    }
    const delta = line.regularPriceMinor - menuPrice;
    if (Math.abs(delta) > tolerance) {
      findings.push({
        productId: line.productId,
        productName: line.productName,
        variantId,
        kind: "price",
        devicePriceMinor: line.regularPriceMinor,
        menuPriceMinor: menuPrice,
        deltaMinor: delta,
      });
    }
  }
  return findings;
}

/** One-line human summary for the audit record / notice list. */
export function summarizePriceDrift(findings: PriceDriftFinding[]): string {
  if (findings.length === 0) return "No price drift.";
  const parts = findings.map((f) => {
    if (f.kind === "delisted") return `${f.productName}: no longer on the published menu`;
    if (f.kind === "variant_missing") return `${f.productName}: sold variant no longer on the published menu`;
    const dir = (f.deltaMinor ?? 0) > 0 ? "above" : "below";
    return `${f.productName}: device $${(f.devicePriceMinor / 100).toFixed(2)} is ${dir} menu $${((f.menuPriceMinor ?? 0) / 100).toFixed(2)}`;
  });
  return `Price drift on ${findings.length} line${findings.length === 1 ? "" : "s"}: ${parts.join("; ")}. The register likely needs a menu refresh.`;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPriceDriftCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`PASS: ${msg}`);
  };

  const index = buildMenuPriceIndex([
    { productId: "p1", variantId: "v1", priceMinor: 3500 },
    { productId: "p1", variantId: "v2", priceMinor: 6500 },
    { productId: "p2", variantId: "v3", priceMinor: 1200 },
    { productId: "", variantId: "vX", priceMinor: 100 }, // garbage — dropped
    { productId: "p3", variantId: "v4", priceMinor: -5 }, // garbage price — dropped
  ]);
  ok(index.variantPrices.size === 3, "index: valid rows only (garbage dropped)");
  ok(index.productIds.has("p1") && index.productIds.has("p2") && !index.productIds.has("p3"), "index: productIds from valid rows only");

  // No drift — exact match.
  ok(
    checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3500 }], index).length === 0,
    "exact price match → no drift",
  );

  // Price drift both directions.
  const up = checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3700 }], index);
  ok(up.length === 1 && up[0].kind === "price" && up[0].deltaMinor === 200, "device above menu → positive delta");
  const down = checkPriceDrift([{ productId: "p2", productName: "Gummy", variantId: "v3", regularPriceMinor: 1000 }], index);
  ok(down.length === 1 && down[0].deltaMinor === -200 && down[0].menuPriceMinor === 1200, "device below menu → negative delta");

  // Tolerance quiets small drift.
  ok(
    checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3600 }], index, 100).length === 0,
    "drift within tolerance → quiet",
  );
  ok(
    checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3601 }], index, 100).length === 1,
    "drift beyond tolerance → finding",
  );
  ok(
    checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3499 }], index, -7 as number).length === 1,
    "garbage tolerance collapses to 0 (never widens silently)",
  );

  // Delisted product / missing variant.
  const gone = checkPriceDrift([{ productId: "pX", productName: "Old Item", variantId: "v9", regularPriceMinor: 900 }], index);
  ok(gone.length === 1 && gone[0].kind === "delisted" && gone[0].menuPriceMinor === null, "product gone → delisted finding");
  const vmiss = checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "v9", regularPriceMinor: 900 }], index);
  ok(vmiss.length === 1 && vmiss[0].kind === "variant_missing", "variant gone → variant_missing finding");

  // Pre-B20 lines (no variantId) are skipped — never guessed.
  ok(
    checkPriceDrift([{ productId: "p1", productName: "Flower", regularPriceMinor: 9999 }], index).length === 0,
    "no variantId → skipped (pre-B20 queue, never guess a variant)",
  );
  ok(
    checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "  ", regularPriceMinor: 9999 }], index).length === 0,
    "blank variantId → skipped",
  );

  // Malformed price skipped, valid siblings still checked.
  const mixed = checkPriceDrift(
    [
      { productId: "p1", productName: "Bad", variantId: "v1", regularPriceMinor: 12.5 as unknown as number },
      { productId: "p1", productName: "Good", variantId: "v2", regularPriceMinor: 7000 },
    ],
    index,
  );
  ok(mixed.length === 1 && mixed[0].productName === "Good" && mixed[0].deltaMinor === 500, "malformed price skipped; sibling still compared");

  // Summary strings.
  ok(summarizePriceDrift([]) === "No price drift.", "empty summary");
  const s = summarizePriceDrift(up);
  ok(s.includes("Flower") && s.includes("$37.00") && s.includes("above") && s.includes("menu refresh"), "price summary names product, direction, refresh hint");
  ok(summarizePriceDrift(gone).includes("no longer on the published menu"), "delisted summary");

  console.log("price-drift-core self-tests passed");
}
