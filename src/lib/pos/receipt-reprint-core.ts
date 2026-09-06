/**
 * src/lib/pos/receipt-reprint-core.ts   (SLICE 20)
 *
 * Rebuild a PAST sale's receipt from the envelope the register actually stored.
 *
 * Owner: "will you tell me how I can reprint past order receipts in our
 * register? I see I can reprint the last transactions receipt, but not any
 * others. is that what you are saying about above, that it is not wise to give
 * that ability, or is that feature of ours just not connected yet?"
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ANSWER: not unwise. Not connected.
 *
 * Reprinting an old receipt is ordinary retail practice — Lightspeed X-Series
 * offers "reprint receipt" as a row action on its Sales History, and Oracle
 * Xstore has a reprint function of its own. The register already reprints, but
 * only ONE receipt: `lastReceipt` is React state persisted to localStorage
 * (RegisterShell.tsx:261, :1211), so it holds the most recent sale on that
 * device and nothing else. Close the app, ring another sale, or walk to the
 * other till, and the earlier receipt is gone.
 *
 * It was never a policy decision. It was a missing read.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS CAN BE HONEST
 *
 * `pos_sale_events.payload` is `jsonb NOT NULL` (migration 0120) and holds the
 * FULL validated envelope — `PosSalePayload` in sale-event-core.ts carries the
 * lines with their charged and regular prices, subtotal, tax, total, payment
 * method, cash tendered, change given, the medical block and the loyalty
 * block. That is receipt-grade data, already stored for every synced sale.
 *
 * So this module does NOT reconstruct, infer, or recompute a receipt. It
 * re-renders the numbers the register committed at the moment of sale. Where a
 * field was not recorded, it is OMITTED rather than invented — a reprint that
 * guesses a total is worse than no reprint at all.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE HARD RULE IT INHERITS
 *
 * `star-printer-core.ts:201-204` refuses any print job with
 * `jobKind: "reprint"` and `openDrawer: true` — "a reprint may NEVER pop the
 * till", because reprints happen with a customer at the counter and no cash is
 * moving. Every reprint built here goes out as `jobKind: "reprint"` with the
 * drawer flag false, and the suite asserts it.
 *
 * PURE: no imports, no clock, no network. Given the same stored payload it
 * always produces the same receipt.
 */

/** A stored sale line, as it sits in `pos_sale_events.payload.lines`. */
export type StoredSaleLine = {
  productName?: unknown;
  quantity?: unknown;
  unitPriceMinor?: unknown;
  regularPriceMinor?: unknown;
  medicalTaxOff?: unknown;
  // -- Slice 22b: the rich snapshot fields, all optional ------------------
  // `category` is REQUIRED on every stored sale line by the enqueue
  // validator (pos/sale-event-core: "category snapshot required"), so a
  // reprint of any sale that actually reached the queue CAN reproduce the
  // statutory excise/sales split. It is still read defensively here because
  // this function's whole contract is to distrust stored JSON.
  category?: unknown;
  brand?: unknown;
  variantLabel?: unknown;
  unitGrams?: unknown;
  unitThcMg?: unknown;
  appliedLabel?: unknown;
  salesExempt?: unknown;
  exciseExempt?: unknown;
};

/** The stored envelope, typed loosely because it comes back as raw JSON. */
export type StoredSalePayload = {
  lines?: unknown;
  subtotalMinor?: unknown;
  taxMinor?: unknown;
  totalMinor?: unknown;
  paymentMethod?: unknown;
  tenderedMinor?: unknown;
  changeMinor?: unknown;
  roundingAdjustmentMinor?: unknown;
  roundedDueMinor?: unknown;
  medical?: { medicalSavingsMinor?: unknown } | null;
  loyalty?: { memberLabel?: unknown } | null;
};

/** What the reprint needs from OUTSIDE the payload. */
export type ReprintContext = {
  saleClientUuid: string;
  soldAtIso: string;
  registerLabel: string;
  /** Employee who rang it, when known. Omitted from the slip when null. */
  servedBy?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  addressLines?: string[];
  /**
   * Slice 22b — the owner's display switches, so a reprint reproduces the
   * receipt the customer originally got (logo, item detail, return policy,
   * barcode) instead of the bare built-in defaults. Optional: a caller that
   * does not supply it gets the default-on behaviour, which is what every
   * pre-22b caller expects.
   */
  config?: ReprintDisplayConfig | null;
};

/** Just the display switches a reprint needs — a structural subset of
 *  PosReceiptConfig, declared locally so this pure core keeps its existing
 *  import surface and stays trivially testable. */
export type ReprintDisplayConfig = {
  showTaxBreakdown: boolean;
  showLogo: boolean;
  logoWidth: number;
  showReturnPolicy: boolean;
  returnPolicyText: string;
  showItemDetail: boolean;
  showBarcode: boolean;
  showSaleSummary: boolean;
  showSavings: boolean;
};

/** The rebuilt receipt, shaped for `buildPosReceiptHtml`. */
export type RebuiltReceipt = {
  saleClientUuid: string;
  soldAtIso: string;
  registerLabel: string;
  lines: {
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    regularPriceMinor: number;
    medicalTaxOff?: boolean;
    category?: string | null;
    brand?: string | null;
    variantLabel?: string | null;
    unitGrams?: number | null;
    unitThcMg?: number | null;
    appliedLabel?: string | null;
    salesExempt?: boolean;
    exciseExempt?: boolean;
  }[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  savingsMinor: number;
  medicalSavingsMinor: number;
  medicalSale: boolean;
  tenderedMinor: number;
  changeMinor: number;
  roundingAdjustmentMinor?: number;
  roundedDueMinor?: number;
  headerText?: string | null;
  footerText?: string | null;
  addressLines?: string[];
  servedBy?: string | null;
  // -- Slice 22b display switches (all optional, all default-on) ----------
  hideSavings?: boolean;
  showTaxBreakdown?: boolean;
  showLogo?: boolean;
  logoWidth?: number;
  showReturnPolicy?: boolean;
  returnPolicyText?: string | null;
  showItemDetail?: boolean;
  showBarcode?: boolean;
  showSaleSummary?: boolean;
};

export type RebuildResult =
  | { ok: true; receipt: RebuiltReceipt }
  | { ok: false; error: string };

/** A finite non-negative integer, or null when the value cannot be trusted. */
function intOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * A finite POSITIVE number, or null. Used for weights and potency, where 0 and
 * negatives are meaningless and must not be printed as though measured.
 */
function positiveOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Rebuild a receipt from a stored payload.
 *
 * Refuses rather than guesses. A sale with no lines, or with totals that were
 * never recorded, produces an error the register can show — not a slip with
 * blanks or zeros that a customer might take as a record of what they paid.
 */
export function rebuildReceiptFromPayload(
  payload: StoredSalePayload | null | undefined,
  ctx: ReprintContext,
): RebuildResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "That sale has no stored receipt data to reprint." };
  }

  const rawLines = Array.isArray(payload.lines) ? (payload.lines as StoredSaleLine[]) : [];
  if (rawLines.length === 0) {
    return { ok: false, error: "That sale has no line items stored, so its receipt cannot be rebuilt." };
  }

  const lines: RebuiltReceipt["lines"] = [];
  for (const l of rawLines) {
    const name = str(l?.productName);
    const qty = intOrNull(l?.quantity);
    const unit = intOrNull(l?.unitPriceMinor);
    // A line missing its name, quantity or charged price cannot be printed
    // honestly, and printing the REST of the sale without it would misstate
    // what the customer bought.
    if (!name || qty === null || qty < 1 || unit === null) {
      return { ok: false, error: "A line on that sale is incomplete, so the receipt cannot be rebuilt." };
    }
    const regular = intOrNull(l?.regularPriceMinor);
    // Slice 22b — carry the rich fields through when the stored sale has
    // them. Each is spread in ONLY when present, so a genuinely old payload
    // simply prints less detail rather than printing "null" or, worse,
    // letting the tax split assume a category it never recorded.
    const category = str(l?.category);
    const brand = str(l?.brand);
    const variantLabel = str(l?.variantLabel);
    const appliedLabel = str(l?.appliedLabel);
    lines.push({
      productName: name,
      quantity: qty,
      unitPriceMinor: unit,
      // No stored "was" price means there was no discount to strike.
      regularPriceMinor: regular === null ? unit : regular,
      ...(l?.medicalTaxOff === true ? { medicalTaxOff: true } : {}),
      ...(category ? { category } : {}),
      ...(brand ? { brand } : {}),
      ...(variantLabel ? { variantLabel } : {}),
      ...(positiveOrNull(l?.unitGrams) !== null ? { unitGrams: positiveOrNull(l?.unitGrams) } : {}),
      ...(positiveOrNull(l?.unitThcMg) !== null ? { unitThcMg: positiveOrNull(l?.unitThcMg) } : {}),
      ...(appliedLabel ? { appliedLabel } : {}),
      ...(l?.salesExempt === true ? { salesExempt: true } : {}),
      ...(l?.exciseExempt === true ? { exciseExempt: true } : {}),
    });
  }

  const totalMinor = intOrNull(payload.totalMinor);
  const subtotalMinor = intOrNull(payload.subtotalMinor);
  const taxMinor = intOrNull(payload.taxMinor);
  if (totalMinor === null || subtotalMinor === null || taxMinor === null) {
    return { ok: false, error: "That sale's totals were not stored, so its receipt cannot be rebuilt." };
  }

  /**
   * Savings are DERIVED from the stored per-line prices, never invented: it is
   * the sum of (regular − charged) across the lines, which is exactly what the
   * original receipt displayed. If nothing was discounted this is 0 and the
   * row does not print.
   */
  const savingsMinor = lines.reduce(
    (sum, l) => sum + Math.max(0, (l.regularPriceMinor - l.unitPriceMinor) * l.quantity),
    0,
  );

  const medicalSavingsMinor = intOrNull(payload.medical?.medicalSavingsMinor) ?? 0;
  const medicalSale = !!payload.medical && typeof payload.medical === "object";

  // Cash figures print only when they were recorded. A card sale has no
  // tendered/change, and printing 0 would be a claim, not a fact.
  const tenderedMinor = intOrNull(payload.tenderedMinor) ?? 0;
  const changeMinor = intOrNull(payload.changeMinor) ?? 0;

  const rounding = intOrNull(payload.roundingAdjustmentMinor);
  const roundedDue = intOrNull(payload.roundedDueMinor);

  return {
    ok: true,
    receipt: {
      saleClientUuid: ctx.saleClientUuid,
      soldAtIso: ctx.soldAtIso,
      registerLabel: ctx.registerLabel,
      lines,
      subtotalMinor,
      taxMinor,
      totalMinor,
      savingsMinor,
      medicalSavingsMinor,
      medicalSale,
      tenderedMinor,
      changeMinor,
      ...(rounding !== null && rounding !== 0 ? { roundingAdjustmentMinor: rounding } : {}),
      ...(roundedDue !== null ? { roundedDueMinor: roundedDue } : {}),
      headerText: ctx.headerText ?? null,
      footerText: ctx.footerText ?? null,
      addressLines: ctx.addressLines ?? [],
      servedBy: ctx.servedBy ?? null,
      // Slice 22b — spread the owner's switches ONLY when a config was
      // supplied. Omitting them leaves every switch undefined, which the
      // builder reads as "on", preserving pre-22b behaviour exactly.
      ...(ctx.config
        ? {
            hideSavings: !ctx.config.showSavings,
            showTaxBreakdown: ctx.config.showTaxBreakdown,
            showLogo: ctx.config.showLogo,
            logoWidth: ctx.config.logoWidth,
            showReturnPolicy: ctx.config.showReturnPolicy,
            returnPolicyText: ctx.config.returnPolicyText,
            showItemDetail: ctx.config.showItemDetail,
            showBarcode: ctx.config.showBarcode,
            showSaleSummary: ctx.config.showSaleSummary,
          }
        : {}),
    },
  };
}

/**
 * The print job kind for every historical reprint. Named as a constant so the
 * value cannot drift away from the printer core's guard.
 */
export const REPRINT_JOB_KIND = "reprint" as const;

/** A reprint must never open the cash drawer. */
export const REPRINT_OPENS_DRAWER = false;

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReceiptReprintCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`receipt-reprint-core: ${what}`);
    passed += 1;
  };

  const ctx: ReprintContext = {
    saleClientUuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    soldAtIso: "2026-09-01T18:30:00.000Z",
    registerLabel: "Register 1",
  };

  const good: StoredSalePayload = {
    lines: [
      { productName: "Blue Dream 3.5g", quantity: 2, unitPriceMinor: 1463, regularPriceMinor: 1463 },
    ],
    subtotalMinor: 2400,
    taxMinor: 526,
    totalMinor: 2926,
    paymentMethod: "cash",
    tenderedMinor: 3000,
    changeMinor: 74,
  };

  // ── The happy path reproduces the stored numbers EXACTLY ────────────────
  const r = rebuildReceiptFromPayload(good, ctx);
  ok(r.ok, "a complete stored sale rebuilds");
  if (!r.ok) return;
  ok(r.receipt.totalMinor === 2926, "total is the STORED total, not recomputed");
  ok(r.receipt.subtotalMinor === 2400, "subtotal preserved");
  ok(r.receipt.taxMinor === 526, "tax preserved");
  ok(r.receipt.tenderedMinor === 3000, "cash tendered preserved");
  ok(r.receipt.changeMinor === 74, "change preserved");
  ok(r.receipt.lines.length === 1 && r.receipt.lines[0].quantity === 2, "lines preserved");
  ok(r.receipt.saleClientUuid === ctx.saleClientUuid, "receipt number comes from the event");
  ok(r.receipt.savingsMinor === 0, "no discount means no savings row");

  // ── Savings derive from stored prices, never invented ───────────────────
  const disc = rebuildReceiptFromPayload(
    { ...good, lines: [{ productName: "X", quantity: 2, unitPriceMinor: 900, regularPriceMinor: 1000 }] },
    ctx,
  );
  ok(disc.ok && disc.receipt.savingsMinor === 200, "savings = (was - paid) x qty");

  // A missing "was" price means no discount, not a negative saving.
  const noWas = rebuildReceiptFromPayload(
    { ...good, lines: [{ productName: "X", quantity: 1, unitPriceMinor: 500 }] },
    ctx,
  );
  ok(noWas.ok && noWas.receipt.savingsMinor === 0, "absent regular price = no saving");
  ok(noWas.ok && noWas.receipt.lines[0].regularPriceMinor === 500, "regular falls back to charged");

  // ── Numeric strings (Postgres numerics arrive as strings) ───────────────
  const asStrings = rebuildReceiptFromPayload(
    {
      lines: [{ productName: "X", quantity: "2", unitPriceMinor: "1000", regularPriceMinor: "1000" }],
      subtotalMinor: "2000",
      taxMinor: "460",
      totalMinor: "2460",
    },
    ctx,
  );
  ok(asStrings.ok, "numeric-as-string payloads rebuild");
  ok(asStrings.ok && asStrings.receipt.totalMinor === 2460, "string total coerced");
  ok(asStrings.ok && asStrings.receipt.lines[0].quantity === 2, "string quantity coerced");

  // ── It REFUSES rather than guessing ─────────────────────────────────────
  ok(!rebuildReceiptFromPayload(null, ctx).ok, "null payload refused");
  ok(!rebuildReceiptFromPayload(undefined, ctx).ok, "undefined payload refused");
  ok(!rebuildReceiptFromPayload({}, ctx).ok, "empty payload refused");
  ok(!rebuildReceiptFromPayload({ lines: [] }, ctx).ok, "no lines refused");
  ok(
    !rebuildReceiptFromPayload({ ...good, totalMinor: undefined }, ctx).ok,
    "a sale with no stored total is refused, never printed as 0",
  );
  ok(
    !rebuildReceiptFromPayload({ ...good, taxMinor: null }, ctx).ok,
    "a sale with no stored tax is refused",
  );
  ok(
    !rebuildReceiptFromPayload(
      { ...good, lines: [{ productName: "", quantity: 1, unitPriceMinor: 100 }] },
      ctx,
    ).ok,
    "a nameless line is refused",
  );
  ok(
    !rebuildReceiptFromPayload(
      { ...good, lines: [{ productName: "X", quantity: 0, unitPriceMinor: 100 }] },
      ctx,
    ).ok,
    "a zero-quantity line is refused",
  );
  ok(
    !rebuildReceiptFromPayload(
      { ...good, lines: [{ productName: "X", quantity: 1 }] },
      ctx,
    ).ok,
    "a line with no price is refused, never printed as free",
  );

  // ── Medical and loyalty carry through when stored ───────────────────────
  const med = rebuildReceiptFromPayload(
    { ...good, medical: { medicalSavingsMinor: 526 } },
    ctx,
  );
  ok(med.ok && med.receipt.medicalSale === true, "medical sale flagged from the stored block");
  ok(med.ok && med.receipt.medicalSavingsMinor === 526, "medical savings preserved");
  ok(r.receipt.medicalSale === false, "a non-medical sale is not flagged medical");

  // ── Cash rounding prints only when it happened ──────────────────────────
  const rounded = rebuildReceiptFromPayload(
    { ...good, roundingAdjustmentMinor: -1, roundedDueMinor: 2925 },
    ctx,
  );
  ok(rounded.ok && rounded.receipt.roundingAdjustmentMinor === -1, "rounding preserved");
  ok(rounded.ok && rounded.receipt.roundedDueMinor === 2925, "rounded due preserved");
  ok(
    r.receipt.roundingAdjustmentMinor === undefined,
    "an unrounded sale prints no rounding line",
  );

  // ── Context fields ──────────────────────────────────────────────────────
  const withStaff = rebuildReceiptFromPayload(good, { ...ctx, servedBy: "Sam Rivera" });
  ok(withStaff.ok && withStaff.receipt.servedBy === "Sam Rivera", "served-by carried through");
  ok(r.receipt.servedBy === null, "no staff name means no served-by line");

  // ── The drawer rule, asserted as a value ────────────────────────────────
  ok(REPRINT_JOB_KIND === "reprint", "reprints are tagged as reprints");
  ok(REPRINT_OPENS_DRAWER === false, "a reprint may NEVER open the cash drawer");

  console.log(`receipt-reprint-core: PASSED ${passed} assertions`);
}
