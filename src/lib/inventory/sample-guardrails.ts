/**
 * src/lib/inventory/sample-guardrails.ts  (Run 6 / Slice 31)
 *
 * PURE guardrail logic for vendor / QA samples (Feature F). No I/O — directly
 * unit-testable with tsx.
 *
 * WSLCB rule of thumb: product flagged as a sample must never be sold at a
 * normal retail price. A licensee sets a nominal sample price (default $0.01 =
 * 1 minor unit). These helpers validate that a sale price for a sample is the
 * nominal price (when required) and surface the reasons it's blocked.
 */

export type SampleSettings = {
  /** Nominal price (minor units) samples must be sold at. Default 1 ($0.01). */
  nominalPriceMinor: number;
  /** Enforce the nominal price (block selling samples at any other price). */
  requireNominalPrice: boolean;
  /** Block selling samples to the public entirely (QA/employee only). */
  blockPublicSale: boolean;
};

export const DEFAULT_SAMPLE_SETTINGS: SampleSettings = {
  nominalPriceMinor: 1,
  requireNominalPrice: true,
  blockPublicSale: true,
};

export type SampleSaleContext = {
  /** Is the lot/product flagged as a sample? */
  isSample: boolean;
  /** Proposed unit price in minor units. */
  priceMinor: number;
  /** Is this a public/consumer sale (vs. internal QA/employee handling)? */
  isPublicSale: boolean;
};

export type SampleCheck = {
  /** True if the sale is allowed as-is. */
  allowed: boolean;
  /** The price the line SHOULD be (nominal) when a correction is needed. */
  enforcedPriceMinor: number | null;
  /** Human-readable reasons the sale is blocked / corrected. */
  reasons: string[];
};

/**
 * Validate a proposed sample sale. Non-samples always pass. Returns the
 * enforced (nominal) price when a correction is required.
 */
export function checkSampleSale(ctx: SampleSaleContext, settings: SampleSettings): SampleCheck {
  if (!ctx.isSample) {
    return { allowed: true, enforcedPriceMinor: null, reasons: [] };
  }

  const reasons: string[] = [];
  let enforced: number | null = null;
  let allowed = true;

  if (settings.blockPublicSale && ctx.isPublicSale) {
    allowed = false;
    reasons.push("Samples cannot be sold to the public — internal QA/employee use only.");
  }

  if (settings.requireNominalPrice && ctx.priceMinor !== settings.nominalPriceMinor) {
    enforced = settings.nominalPriceMinor;
    reasons.push(
      `Samples must be priced at the nominal ${formatMinor(settings.nominalPriceMinor)} (was ${formatMinor(
        ctx.priceMinor,
      )}).`,
    );
    // A price mismatch is correctable (we substitute the nominal price), so it
    // does not by itself block — but a public-sale block still stands.
  }

  return { allowed, enforcedPriceMinor: enforced, reasons };
}

/**
 * The effective price to charge for a line, applying the sample guardrail.
 * Non-samples keep their price; samples are forced to the nominal price when
 * required.
 */
export function effectiveSamplePrice(
  isSample: boolean,
  proposedMinor: number,
  settings: SampleSettings,
): number {
  if (!isSample) return proposedMinor;
  if (settings.requireNominalPrice) return settings.nominalPriceMinor;
  return proposedMinor;
}

/** Should a $0 / sample intake line be flagged as a sample? */
export function inferSampleFromIntake(priceMinor: number, explicitFlag: boolean): boolean {
  return explicitFlag || priceMinor === 0;
}

/** Minor units → "$0.01" style string. */
export function formatMinor(minor: number): string {
  return `$${(Math.max(0, minor) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE module).
// ---------------------------------------------------------------------------

export function __runSampleGuardrailTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  const S = DEFAULT_SAMPLE_SETTINGS;

  // non-sample always allowed, untouched
  const a = checkSampleSale({ isSample: false, priceMinor: 5000, isPublicSale: true }, S);
  ok(a.allowed && a.enforcedPriceMinor === null && a.reasons.length === 0, "non-sample passes");

  // sample at nominal, internal → allowed, no correction
  const b = checkSampleSale({ isSample: true, priceMinor: 1, isPublicSale: false }, S);
  ok(b.allowed && b.enforcedPriceMinor === null, "sample nominal internal ok");

  // sample at full price internal → correctable (enforce nominal), still allowed
  const c = checkSampleSale({ isSample: true, priceMinor: 4500, isPublicSale: false }, S);
  ok(c.allowed, "sample full-price internal allowed after correction");
  eq(c.enforcedPriceMinor, 1, "enforced nominal price");
  ok(c.reasons.some((r) => r.includes("nominal")), "nominal reason present");

  // sample public sale → blocked
  const d = checkSampleSale({ isSample: true, priceMinor: 1, isPublicSale: true }, S);
  ok(!d.allowed, "sample public sale blocked");
  ok(d.reasons.some((r) => r.includes("public")), "public reason present");

  // settings: don't require nominal → full price allowed, no enforcement
  const loose: SampleSettings = { nominalPriceMinor: 1, requireNominalPrice: false, blockPublicSale: false };
  const e = checkSampleSale({ isSample: true, priceMinor: 4500, isPublicSale: true }, loose);
  ok(e.allowed && e.enforcedPriceMinor === null, "loose settings allow full price");

  // effectiveSamplePrice
  eq(effectiveSamplePrice(false, 5000, S), 5000, "non-sample keeps price");
  eq(effectiveSamplePrice(true, 5000, S), 1, "sample forced to nominal");
  eq(effectiveSamplePrice(true, 5000, loose), 5000, "loose: sample keeps price");

  // custom nominal (e.g. $0.05)
  const five: SampleSettings = { nominalPriceMinor: 5, requireNominalPrice: true, blockPublicSale: true };
  eq(effectiveSamplePrice(true, 5000, five), 5, "custom nominal $0.05");

  // inferSampleFromIntake
  ok(inferSampleFromIntake(0, false), "$0 intake → sample");
  ok(inferSampleFromIntake(5000, true), "explicit flag → sample");
  ok(!inferSampleFromIntake(5000, false), "priced non-flagged → not sample");

  // formatMinor
  eq(formatMinor(1), "$0.01", "format 1 minor");
  eq(formatMinor(4500), "$45.00", "format 4500 minor");

  console.log(`sample-guardrails: ${pass} assertions passed`);
}
