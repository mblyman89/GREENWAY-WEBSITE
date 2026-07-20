/**
 * src/lib/pos/medical-pos-core.ts  (POS Slice B7)
 *
 * PURE medical-sale logic for the REGISTER. Makes selling to a recognition-
 * card holder as easy as a recreational sale while keeping every statutory
 * rule intact. No React, no DB, no server-only.
 *
 * Grounded in (verified 2026-07, official sources):
 *   - RCW 82.08.9998(1)(a)-(c) — SALES-tax (9.3%) exemption: 246-70 compliant
 *     products sold by an ENDORSED retailer to a carded patient/DP; high-CBD
 *     compliant products to anyone.
 *   - DOH policy MMJ 21-01 — "compliant product" = any cannabis product
 *     purchased by a qualifying patient possessing a recognition card, BUT the
 *     repo's conservative CLAIM POLICY (docs/MEDICAL_CANNABIS_COMPLIANCE.md §5a)
 *     only claims lines whose product is in the durable DOH registry — we
 *     over-remit rather than ever under-document. THIS MODULE REUSES that
 *     exact policy via decideLineExemption — zero drift with the completion gate.
 *   - WAC 314-55-090(1)/(6) — EXCISE (37%) exemption: endorsed + carded (in
 *     MCR) + compliant; sunsets 2029-06-30 (HB 1453 / DOH 608-050).
 *   - WAC 314-55-090(2) — records per exempt sale: date, UPID, card effective
 *     + expiration dates, SKU, sales price. The register CAPTURES the card
 *     facts; the SERVER resolves the stored patient_authorizations row and
 *     writes the ledger inside the shared completion gate (B1) — the device
 *     never self-certifies an exemption.
 *   - Chapter 246-70 WAC — high_thc products sell ONLY to carded patients
 *     (statutory hard gate, no override) — enforced on-device AND server-side.
 *   - WAC 314-55-095(2)(d) — carded patients get 3× purchase limits (already
 *     in sales-limits-core MEDICAL_LIMITS; judgeLimits takes "medical").
 *
 * MONEY MODEL (the key design decision):
 *   Register card prices are TAX-INCLUSIVE. For an exempt line the patient
 *   must NOT pay the exempted tax — the exemption is passed through by
 *   REPRICING the line's unit price to base + (still-due tax) using the SAME
 *   per-line base math (lineBaseMinor) and bps math (applyBps) the completion
 *   gate's exemption plan uses. The repriced lines then flow through the
 *   normal computeOrderTotals — so the server's money recompute gate sees a
 *   self-consistent order. Where taxes are still due, totals are unchanged.
 */
import {
  CANNABIS_EXCISE_TAX_BPS,
  COMBINED_SALES_TAX_BPS,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";
import {
  decideLineExemption,
  lineBaseMinor,
  type DohCategory,
  isDohCategory,
} from "@/lib/medical/medical-sale-core";
import { isYmd } from "./id-scan-core";
import { isUuid } from "./sale-event-core";
import type { PricedSaleLine } from "./sale-flow-core";

// ---------------------------------------------------------------------------
// Medical config shipped with the menu bundle (GET /api/pos/menu)
// ---------------------------------------------------------------------------

export type PosMedicalConfig = {
  /** Store holds a valid LCB medical endorsement (RCW 69.50.375). */
  endorsed: boolean;
  /** WAC 314-55-090(6) excise-exemption sunset date, YYYY-MM-DD. */
  exciseExemptionUntil: string;
  /** productId → verified DOH 246-70 category (durable medical_product_registry). */
  registry: Record<string, DohCategory>;
};

// ---------------------------------------------------------------------------
// Recognition-card capture at the register (RCW 69.51A.230)
// ---------------------------------------------------------------------------

export type PosCardCapture = {
  /** Unique patient identifier printed on the recognition card (MCR). */
  upid: string;
  /** Card effective date, YYYY-MM-DD. */
  effectiveOn: string;
  /** Card expiration date, YYYY-MM-DD. */
  expiresOn: string;
  /** patient | designated_provider (the DP holds an identical card). */
  holderType: "patient" | "designated_provider";
  /**
   * Budtender attests the card was verified against the DOH Medical Cannabis
   * Authorization Database (MCR) — HB 1453 FAQ: "the consultant must enter
   * the card number into the DOH Database to confirm that the card is active".
   */
  mcrVerified: boolean;
};

export type CardCaptureCheck =
  | { ok: true; card: PosCardCapture }
  | { ok: false; errors: string[] };

/**
 * Validate a card capture BEFORE the medical path opens. The register only
 * needs the WAC 314-55-090(2) card facts + the MCR attestation; the server
 * re-resolves the stored authorization and re-validates on sync.
 */
export function validateCardCapture(
  input: Partial<PosCardCapture>,
  todayYmd: string,
): CardCaptureCheck {
  const errors: string[] = [];
  const upid = (input.upid ?? "").trim();
  if (upid.length < 4 || upid.length > 64) {
    errors.push("Enter the unique patient identifier (UPID) exactly as printed on the recognition card.");
  }
  if (!isYmd(input.effectiveOn)) errors.push("Card effective date must be YYYY-MM-DD.");
  if (!isYmd(input.expiresOn)) errors.push("Card expiration date must be YYYY-MM-DD.");
  if (input.holderType !== "patient" && input.holderType !== "designated_provider") {
    errors.push("Select who is buying: the patient or their designated provider.");
  }
  if (input.mcrVerified !== true) {
    errors.push("Confirm the card was verified in the DOH database (required for every exempt sale).");
  }
  if (isYmd(input.effectiveOn) && isYmd(input.expiresOn) && isYmd(todayYmd)) {
    if (input.effectiveOn! > input.expiresOn!) errors.push("Card effective date is after its expiration date.");
    if (todayYmd < input.effectiveOn!) errors.push(`Card is not effective until ${input.effectiveOn}.`);
    if (todayYmd > input.expiresOn!) {
      errors.push(`Recognition card expired ${input.expiresOn} — an expired card grants no exemptions and no 18–20 purchase allowance.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    card: {
      upid,
      effectiveOn: input.effectiveOn!,
      expiresOn: input.expiresOn!,
      holderType: input.holderType!,
      mcrVerified: true,
    },
  };
}

/**
 * Age gate for the medical path. WAC 314-55-150 requires 21+ EXCEPT that
 * qualifying patients 18–20 who are REGISTERED (recognition card) may buy at
 * a medically endorsed store (RCW 69.51A; docs/MEDICAL_CANNABIS_COMPLIANCE.md).
 */
export function medicalAgeAllowed(age: number, cardValid: boolean): { allowed: boolean; reason?: string } {
  if (age >= 21) return { allowed: true };
  if (age >= 18 && cardValid) return { allowed: true };
  if (age >= 18) {
    return { allowed: false, reason: "Customers 18–20 may only buy with a valid recognition card at an endorsed store." };
  }
  return { allowed: false, reason: "Customer is under 18. Sale refused — no medical exception exists at retail." };
}

// ---------------------------------------------------------------------------
// Exemption pass-through pricing (patient pays LESS, not the store)
// ---------------------------------------------------------------------------

function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

export type MedicalPricedLine = PricedSaleLine & {
  dohCategory: DohCategory | null;
  salesExempt: boolean;
  exciseExempt: boolean;
  /** Tax the PATIENT does not pay on this line (unit × qty), minor units. */
  medicalSavingsMinor: number;
};

export type MedicalPricingResult = {
  lines: MedicalPricedLine[];
  /** Total tax passed through to the patient across the cart. */
  medicalSavingsMinor: number;
  /** Names of high-THC products that CANNOT be sold to this buyer. */
  highThcViolations: string[];
  /** True after the WAC 314-55-090(6) sunset (excise claims off). */
  exciseSunsetPassed: boolean;
};

/**
 * Reprice already-promotion-priced lines for a medical buyer, passing every
 * lawful exemption through to what the patient pays.
 *
 * Per line: back out the pre-tax base with the category divisor (EXACTLY
 * lineBaseMinor — the same function the completion-gate plan uses), decide
 * exemptions with decideLineExemption (same policy, zero drift), then rebuild
 * the unit price as base + still-due taxes. A fully exempt line's inclusive
 * price becomes its pre-tax base; a non-exempt line is returned UNCHANGED
 * (unit price untouched — no re-rounding of unaffected lines).
 *
 * `cardedValid=false` still runs the high-THC block (statutory for everyone)
 * and the high-CBD anyone-exemption is deliberately NOT auto-claimed —
 * the repo's documented conservative claim policy (no card ⇒ no ledger
 * context ⇒ claim nothing; over-remit rather than under-document).
 */
export function applyMedicalPricing(
  lines: PricedSaleLine[],
  cfg: PosMedicalConfig,
  opts: { cardedValid: boolean; saleDateYmd: string },
): MedicalPricingResult {
  const exciseSunsetPassed = opts.saleDateYmd > cfg.exciseExemptionUntil;
  const out: MedicalPricedLine[] = [];
  const highThcViolations: string[] = [];
  let medicalSavingsMinor = 0;

  for (const line of lines) {
    const isCannabis = !isNonCannabisCategory(line.category);
    const raw = cfg.registry[line.productId];
    const dohCategory: DohCategory | null = isDohCategory(raw) ? raw : null;
    const decision = decideLineExemption({
      isCannabis,
      dohCategory,
      cardedValid: opts.cardedValid,
      endorsed: cfg.endorsed,
      exciseExemptionActive: !exciseSunsetPassed,
    });
    if (decision.highThcBlocked) highThcViolations.push(line.productName);

    // CONSERVATIVE CLAIM POLICY (docs/MEDICAL_CANNABIS_COMPLIANCE.md §5a):
    // pass-through only with a valid card — an uncarded high-CBD claim has no
    // WAC 314-55-090(2) ledger context, so the register does not claim it
    // (decideLineExemption itself grants it; the gate's ledger write does not).
    if (!opts.cardedValid) {
      out.push({ ...line, dohCategory, salesExempt: false, exciseExempt: false, medicalSavingsMinor: 0 });
      continue;
    }

    if (!decision.salesExempt && !decision.exciseExempt) {
      out.push({ ...line, dohCategory, salesExempt: false, exciseExempt: false, medicalSavingsMinor: 0 });
      continue;
    }

    // Per-UNIT base (qty 1) so the repriced unit × qty stays exact.
    const unitBase = lineBaseMinor({ category: line.category, quantity: 1, unitPriceMinorUnits: line.unitPriceMinor });
    const exciseDue = decision.exciseExempt || !isCannabis ? 0 : applyBps(unitBase, CANNABIS_EXCISE_TAX_BPS);
    const salesDue = decision.salesExempt ? 0 : applyBps(unitBase, COMBINED_SALES_TAX_BPS);
    const newUnit = unitBase + exciseDue + salesDue;
    const savings = Math.max(0, (line.unitPriceMinor - newUnit) * line.quantity);
    medicalSavingsMinor += savings;
    out.push({
      ...line,
      unitPriceMinor: newUnit,
      dohCategory,
      salesExempt: decision.salesExempt,
      exciseExempt: decision.exciseExempt,
      medicalSavingsMinor: savings,
    });
  }

  return { lines: out, medicalSavingsMinor, highThcViolations, exciseSunsetPassed };
}

// ---------------------------------------------------------------------------
// On-screen recognition-card badge (display only — pure)
// ---------------------------------------------------------------------------

export type MedicalCardBadge = {
  /** "Patient" | "Designated provider" — who is buying. */
  holderLabel: string;
  /** Card expiration date, echoed for the budtender to eyeball. */
  expiresOn: string;
  /**
   * True when the card is expired as of `todayYmd`. An expired card grants NO
   * exemptions and NO 18–20 allowance (validateCardCapture already blocks the
   * capture, but the badge stays truthful if a card expires mid-session).
   */
  expired: boolean;
  /**
   * One-line status the badge renders next to the customer name, e.g.
   * "MEDICAL · Patient · exp 2026-03-14" or "MEDICAL · EXPIRED 2025-01-02".
   */
  text: string;
};

/**
 * Build the customer-band medical badge from a captured card + the store-local
 * day. Display only — no pricing, no side effects. Kept pure + self-tested so
 * the badge wording never drifts from the exemption rules.
 */
export function medicalCardBadge(card: PosCardCapture, todayYmd: string): MedicalCardBadge {
  const holderLabel = card.holderType === "designated_provider" ? "Designated provider" : "Patient";
  const expired = isYmd(card.expiresOn) && isYmd(todayYmd) ? todayYmd > card.expiresOn : false;
  const text = expired
    ? `MEDICAL · EXPIRED ${card.expiresOn}`
    : `MEDICAL · ${holderLabel} · exp ${card.expiresOn}`;
  return { holderLabel, expiresOn: card.expiresOn, expired, text };
}

// ---------------------------------------------------------------------------
// Medical block on the sale payload (validated before enqueue, server re-checks)
// ---------------------------------------------------------------------------

export type PosMedicalSaleBlock = {
  card: PosCardCapture;
  /** client UUID of the manual_id_verification-style card-capture audit event. */
  cardEventUuid: string;
  /** Savings the device passed through (server recomputes; must reconcile). */
  medicalSavingsMinor: number;
};

export type MedicalBlockCheck = { ok: true } | { ok: false; errors: string[] };

export function validateMedicalSaleBlock(b: Partial<PosMedicalSaleBlock>, todayYmd: string): MedicalBlockCheck {
  const errors: string[] = [];
  if (!b.card) {
    errors.push("Medical sale requires the captured recognition card.");
  } else {
    const check = validateCardCapture(b.card, todayYmd);
    if (!check.ok) errors.push(...check.errors);
  }
  if (!isUuid(b.cardEventUuid)) {
    errors.push("Medical sale must reference its card-capture audit event UUID.");
  }
  if (!Number.isInteger(b.medicalSavingsMinor) || (b.medicalSavingsMinor as number) < 0) {
    errors.push("medicalSavingsMinor must be a non-negative integer.");
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runMedicalPosCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const TODAY = "2026-07-15";
  const goodCard: PosCardCapture = {
    upid: "WA-UPID-12345",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
    holderType: "patient",
    mcrVerified: true,
  };

  // Card capture validation
  ok(validateCardCapture(goodCard, TODAY).ok, "valid card capture accepted");
  ok(!validateCardCapture({ ...goodCard, upid: "x" }, TODAY).ok, "short UPID refused");
  ok(!validateCardCapture({ ...goodCard, expiresOn: "2026-01-02", effectiveOn: "2026-06-01" }, TODAY).ok, "effective after expiry refused");
  ok(!validateCardCapture({ ...goodCard, expiresOn: "2026-07-01" }, TODAY).ok, "expired card refused");
  ok(!validateCardCapture({ ...goodCard, effectiveOn: "2026-08-01", expiresOn: "2026-12-31" }, TODAY).ok, "not-yet-effective card refused");
  ok(!validateCardCapture({ ...goodCard, mcrVerified: false }, TODAY).ok, "unverified-in-MCR capture refused");
  ok(!validateCardCapture({ ...goodCard, holderType: "friend" as never }, TODAY).ok, "bad holder type refused");

  // Age gate (18–20 registered-patient allowance)
  ok(medicalAgeAllowed(21, false).allowed, "21+ always allowed");
  ok(medicalAgeAllowed(19, true).allowed, "18–20 with valid card allowed");
  ok(!medicalAgeAllowed(19, false).allowed, "18–20 without card refused");
  ok(!medicalAgeAllowed(17, true).allowed, "under 18 always refused");

  // Pricing pass-through
  const cfg: PosMedicalConfig = {
    endorsed: true,
    exciseExemptionUntil: "2029-06-30",
    registry: { "prod-compliant": "general_use", "prod-cbd": "high_cbd", "prod-ht": "high_thc" },
  };
  const mk = (productId: string, category: string, unit: number, qty = 1): PricedSaleLine => ({
    productId,
    productName: productId,
    category,
    quantity: qty,
    unitPriceMinor: unit,
    regularPriceMinor: unit,
    brand: null,
    variantLabel: null,
  });

  // Carded + registered compliant: BOTH exemptions → patient pays the pre-tax base.
  // $14.63 inclusive → base $10.00 → both exempt → patient pays $10.00.
  const both = applyMedicalPricing([mk("prod-compliant", "edibles", 1463)], cfg, { cardedValid: true, saleDateYmd: TODAY });
  ok(both.lines[0].unitPriceMinor === 1000, "fully exempt line reprices to pre-tax base");
  ok(both.lines[0].medicalSavingsMinor === 463, "savings = exempted excise + sales tax");
  ok(both.medicalSavingsMinor === 463, "cart savings aggregate");

  // Carded + UNREGISTERED product: conservative policy — no exemption, unchanged.
  const none = applyMedicalPricing([mk("prod-unknown", "flower", 1463)], cfg, { cardedValid: true, saleDateYmd: TODAY });
  ok(none.lines[0].unitPriceMinor === 1463, "unregistered line unchanged (conservative claim policy)");
  ok(none.medicalSavingsMinor === 0, "no savings claimed on unregistered product");

  // Uncarded + high-CBD: NOT auto-claimed (documented conservative policy).
  const cbd = applyMedicalPricing([mk("prod-cbd", "edibles", 1463)], cfg, { cardedValid: false, saleDateYmd: TODAY });
  ok(cbd.lines[0].unitPriceMinor === 1463, "uncarded high-CBD not auto-claimed (over-remit, never under-document)");

  // Carded + high-CBD: both exemptions (compliant + carded).
  const cbdCarded = applyMedicalPricing([mk("prod-cbd", "edibles", 1463)], cfg, { cardedValid: true, saleDateYmd: TODAY });
  ok(cbdCarded.lines[0].salesExempt && cbdCarded.lines[0].exciseExempt, "carded high-CBD: both exemptions");

  // High-THC to an uncarded buyer: violation listed, no savings.
  const ht = applyMedicalPricing([mk("prod-ht", "edibles", 5000)], cfg, { cardedValid: false, saleDateYmd: TODAY });
  ok(ht.highThcViolations.length === 1 && ht.highThcViolations[0] === "prod-ht", "high-THC uncarded violation surfaced");
  ok(ht.lines[0].unitPriceMinor === 5000, "blocked line price unchanged");

  // High-THC to a CARDED buyer: allowed, fully exempt.
  const htCarded = applyMedicalPricing([mk("prod-ht", "edibles", 1463)], cfg, { cardedValid: true, saleDateYmd: TODAY });
  ok(htCarded.highThcViolations.length === 0, "high-THC carded: no violation");
  ok(htCarded.lines[0].unitPriceMinor === 1000, "high-THC carded: both exemptions passed through");

  // Post-sunset: sales exemption survives, excise is due again.
  // Base $10.00, excise due $3.70 → patient pays $13.70.
  const sunset = applyMedicalPricing([mk("prod-compliant", "edibles", 1463)], cfg, { cardedValid: true, saleDateYmd: "2029-07-01" });
  ok(sunset.exciseSunsetPassed, "sunset detected");
  ok(sunset.lines[0].unitPriceMinor === 1000 + 370, "post-sunset: base + excise due, sales exempt");

  // Unendorsed store: nothing exempt (high-THC still blocked for uncarded).
  const noEnd = applyMedicalPricing(
    [mk("prod-compliant", "edibles", 1463), mk("prod-ht", "edibles", 5000)],
    { ...cfg, endorsed: false },
    { cardedValid: true, saleDateYmd: TODAY },
  );
  ok(noEnd.lines[0].unitPriceMinor === 1463 && noEnd.medicalSavingsMinor === 0, "unendorsed: no exemptions");

  // Merch never exempt.
  const merch = applyMedicalPricing([mk("prod-compliant", "merch", 1093)], cfg, { cardedValid: true, saleDateYmd: TODAY });
  ok(merch.lines[0].unitPriceMinor === 1093 && !merch.lines[0].salesExempt, "merch line untouched");

  // Quantity: savings scale by qty. 2 × ($14.63 → $10.00) = $9.26 saved.
  const qty = applyMedicalPricing([mk("prod-compliant", "edibles", 1463, 2)], cfg, { cardedValid: true, saleDateYmd: TODAY });
  ok(qty.lines[0].medicalSavingsMinor === 926, "savings scale with quantity");

  // Medical sale block validation
  const U = "11111111-1111-4111-8111-111111111111";
  ok(
    validateMedicalSaleBlock({ card: goodCard, cardEventUuid: U, medicalSavingsMinor: 463 }, TODAY).ok,
    "valid medical block accepted",
  );
  ok(!validateMedicalSaleBlock({ card: goodCard, medicalSavingsMinor: 463 }, TODAY).ok, "missing card event UUID refused");
  ok(!validateMedicalSaleBlock({ cardEventUuid: U, medicalSavingsMinor: 0 }, TODAY).ok, "missing card refused");
  ok(
    !validateMedicalSaleBlock({ card: goodCard, cardEventUuid: U, medicalSavingsMinor: -1 }, TODAY).ok,
    "negative savings refused",
  );

  // Badge (display only) — wording + expiry follow the exemption rules.
  {
    const b = medicalCardBadge(goodCard, TODAY);
    ok(b.holderLabel === "Patient", "badge: patient holder label");
    ok(b.expired === false, "badge: valid card not expired");
    ok(b.text === "MEDICAL · Patient · exp 2026-12-31", "badge: valid patient text");
    const dp = medicalCardBadge({ ...goodCard, holderType: "designated_provider" }, TODAY);
    ok(dp.holderLabel === "Designated provider", "badge: DP holder label");
    ok(dp.text.includes("Designated provider"), "badge: DP text names the role");
    const exp = medicalCardBadge({ ...goodCard, expiresOn: "2026-07-14" }, TODAY);
    ok(exp.expired === true, "badge: card expired yesterday flagged");
    ok(exp.text === "MEDICAL · EXPIRED 2026-07-14", "badge: expired text");
    const onExpiry = medicalCardBadge({ ...goodCard, expiresOn: TODAY }, TODAY);
    ok(onExpiry.expired === false, "badge: valid through the expiry date itself");
  }

  console.log(`pos/medical-pos-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`medical-pos-core self-tests failed: ${fail}`);
}

