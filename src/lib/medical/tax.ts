/**
 * src/lib/medical/tax.ts
 *
 * PURE medical-cannabis tax-exemption logic, grounded in WAC 314-55-090,
 * HB 1453 (DOH 608-050), and RCW 69.51A.230. See docs/medical-doh-requirements.md.
 *
 * KEY RULE (do not conflate the two exemptions):
 *   - SALES tax (9.3%) is exempt for a registered patient/DP (in the MCR) on
 *     ANY cannabis purchased at a medically-endorsed store.
 *   - EXCISE tax (37%) is exempt ONLY when the product is also DOH-compliant
 *     (WAC 246-70-040) AND the buyer is in the MCR AND the store is endorsed.
 *
 * All money in MINOR UNITS (cents); rates in basis points (3700 = 37%).
 */

export type MedTaxSettings = {
  exciseRateBps: number; // 3700 = 37%
  stateSalesRateBps: number; // 650
  localSalesRateBps: number; // 280
  /** Store holds a valid LCB medical endorsement (RCW 69.50.375). */
  medicallyEndorsed: boolean;
};

export const DEFAULT_MED_TAX_SETTINGS: MedTaxSettings = {
  exciseRateBps: 3700,
  stateSalesRateBps: 650,
  localSalesRateBps: 280,
  medicallyEndorsed: true,
};

export function combinedSalesBps(s: MedTaxSettings): number {
  return s.stateSalesRateBps + s.localSalesRateBps;
}

export function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

/** Buyer's medical standing for a transaction. */
export type MedicalContext = {
  /** Buyer presented a recognition card that is valid + in the MCR database. */
  cardValidInDatabase: boolean;
};

/** Per-line product facts that affect exemption. */
export type MedLineInput = {
  taxableBaseMinor: number; // pre-tax, post-discount base for the line
  isCannabis: boolean; // subject to excise when not exempt
  /** Product is DOH-compliant per WAC 246-70-040 (lab-tested, DOH logo). */
  dohCompliant: boolean;
};

export type MedLineTax = {
  salesTaxMinor: number;
  exciseTaxMinor: number;
  totalTaxMinor: number;
  salesExempt: boolean;
  exciseExempt: boolean;
  /** Excise that WOULD have applied but was exempted (for recordkeeping). */
  exciseExemptedMinor: number;
};

/**
 * Compute taxes for a single line, honoring the two independent medical
 * exemptions precisely.
 */
export function computeMedLineTax(
  line: MedLineInput,
  med: MedicalContext,
  s: MedTaxSettings,
): MedLineTax {
  const base = Math.max(0, Math.round(line.taxableBaseMinor));
  const endorsed = s.medicallyEndorsed;
  const carded = endorsed && med.cardValidInDatabase;

  // Sales tax: exempt for any cannabis bought by a carded patient at an
  // endorsed store. (High-CBD-for-anyone is out of scope here.)
  const salesExempt = carded;
  const salesTaxMinor = salesExempt ? 0 : applyBps(base, combinedSalesBps(s));

  // Excise: only cannabis is ever subject. Exempt only when carded AND the
  // product is DOH-compliant.
  const exciseApplies = line.isCannabis;
  const exciseExempt = exciseApplies && carded && line.dohCompliant;
  const exciseWouldBe = exciseApplies ? applyBps(base, s.exciseRateBps) : 0;
  const exciseTaxMinor = exciseExempt ? 0 : exciseWouldBe;
  const exciseExemptedMinor = exciseExempt ? exciseWouldBe : 0;

  return {
    salesTaxMinor,
    exciseTaxMinor,
    totalTaxMinor: salesTaxMinor + exciseTaxMinor,
    salesExempt,
    exciseExempt,
    exciseExemptedMinor,
  };
}

export type MedCartTotals = {
  taxableBaseMinor: number;
  salesTaxMinor: number;
  exciseTaxMinor: number;
  totalTaxMinor: number;
  grandTotalMinor: number;
  exciseExemptedMinor: number;
  /** Lines that are excise-exempt require WAC 314-55-090(2) records. */
  exciseExemptLineCount: number;
};

export function computeMedCart(
  lines: MedLineInput[],
  med: MedicalContext,
  s: MedTaxSettings,
): MedCartTotals {
  let taxableBaseMinor = 0;
  let salesTaxMinor = 0;
  let exciseTaxMinor = 0;
  let exciseExemptedMinor = 0;
  let exciseExemptLineCount = 0;
  for (const line of lines) {
    const t = computeMedLineTax(line, med, s);
    taxableBaseMinor += Math.max(0, Math.round(line.taxableBaseMinor));
    salesTaxMinor += t.salesTaxMinor;
    exciseTaxMinor += t.exciseTaxMinor;
    exciseExemptedMinor += t.exciseExemptedMinor;
    if (t.exciseExempt) exciseExemptLineCount += 1;
  }
  const totalTaxMinor = salesTaxMinor + exciseTaxMinor;
  return {
    taxableBaseMinor,
    salesTaxMinor,
    exciseTaxMinor,
    totalTaxMinor,
    grandTotalMinor: taxableBaseMinor + totalTaxMinor,
    exciseExemptedMinor,
    exciseExemptLineCount,
  };
}

// ---------------------------------------------------------------------------
// Recognition-card validity
// ---------------------------------------------------------------------------
export type RecognitionCard = {
  uniquePatientIdentifier: string | null;
  effectiveOn: string | null; // ISO date
  expiresOn: string | null; // ISO date
  inDohDatabase: boolean;
  status: string; // active | expired | revoked
};

export type CardValidity = {
  valid: boolean;
  reason: string | null;
};

/**
 * Is a recognition card valid for tax-exemption purposes on a given date?
 * Requires: status active, in the MCR database, a unique patient identifier,
 * and the date within [effectiveOn, expiresOn].
 */
export function cardValidity(card: RecognitionCard, onDate: Date = new Date()): CardValidity {
  if (card.status !== "active") return { valid: false, reason: `Card status is ${card.status}` };
  if (!card.inDohDatabase) return { valid: false, reason: "Not in the DOH database (MCR)" };
  if (!card.uniquePatientIdentifier) return { valid: false, reason: "Missing unique patient identifier" };
  const day = onDate.toISOString().slice(0, 10);
  if (card.effectiveOn && day < card.effectiveOn) return { valid: false, reason: "Card not yet effective" };
  if (card.expiresOn && day > card.expiresOn) return { valid: false, reason: "Card expired" };
  return { valid: true, reason: null };
}

// ---------------------------------------------------------------------------
// Authorization-form validation checklist (DOH 608-048)
// ---------------------------------------------------------------------------
export type FormChecklist = {
  formCompleteSigned: boolean;
  tamperResistantVerified: boolean;
  identityVerified: boolean;
  embossedSealVerified: boolean;
};

/** All four checks must pass before a consultant may create a card. */
export function canIssueCard(c: FormChecklist): boolean {
  return c.formCompleteSigned && c.tamperResistantVerified && c.identityVerified && c.embossedSealVerified;
}

// ---------------------------------------------------------------------------
// Elevated purchase limits (carded patient in MCR). Units kept verbatim.
// ---------------------------------------------------------------------------
export const MEDICAL_PURCHASE_LIMITS = {
  usableGrams: 3 * 28.35, // 3 oz usable cannabis
  solidGrams: 48 * 28.35, // 48 oz product eaten/swallowed (solid)
  liquidGrams: 216 * 28.35, // 216 oz infused liquid
  concentrateGrams: 21, // 21 g concentrate
} as const;

export const RECREATIONAL_PURCHASE_LIMITS = {
  usableGrams: 1 * 28.35, // 1 oz usable
  solidGrams: 16 * 28.35, // 16 oz solid
  liquidGrams: 72 * 28.35, // 72 oz liquid
  concentrateGrams: 7, // 7 g concentrate
} as const;

// ---------------------------------------------------------------------------
// Inline tests
// ---------------------------------------------------------------------------
export function __runMedTaxTests(): void {
  const s = DEFAULT_MED_TAX_SETTINGS;
  let n = 0;
  const ok = (c: boolean, m: string) => {
    n++;
    if (!c) throw new Error(`Test failed: ${m}`);
  };

  // Recreational: full tax. $100 cannabis -> 9.3% + 37%
  const rec = computeMedLineTax(
    { taxableBaseMinor: 10000, isCannabis: true, dohCompliant: false },
    { cardValidInDatabase: false },
    s,
  );
  ok(rec.salesTaxMinor === 930, "rec sales 9.3%");
  ok(rec.exciseTaxMinor === 3700, "rec excise 37%");
  ok(!rec.salesExempt && !rec.exciseExempt, "rec no exemptions");

  // Carded + DOH-compliant: BOTH exempt
  const both = computeMedLineTax(
    { taxableBaseMinor: 10000, isCannabis: true, dohCompliant: true },
    { cardValidInDatabase: true },
    s,
  );
  ok(both.salesTaxMinor === 0 && both.exciseTaxMinor === 0, "both exempt zero tax");
  ok(both.salesExempt && both.exciseExempt, "both exempt flags");
  ok(both.exciseExemptedMinor === 3700, "excise exempted recorded");

  // Carded + NON-DOH-compliant: sales exempt, excise STILL applies
  const partial = computeMedLineTax(
    { taxableBaseMinor: 10000, isCannabis: true, dohCompliant: false },
    { cardValidInDatabase: true },
    s,
  );
  ok(partial.salesExempt && !partial.exciseExempt, "carded non-compliant: sales exempt only");
  ok(partial.salesTaxMinor === 0 && partial.exciseTaxMinor === 3700, "excise still 37%");

  // Non-cannabis accessory for carded patient: sales exempt, no excise ever
  const acc = computeMedLineTax(
    { taxableBaseMinor: 10000, isCannabis: false, dohCompliant: false },
    { cardValidInDatabase: true },
    s,
  );
  ok(acc.salesTaxMinor === 0 && acc.exciseTaxMinor === 0, "accessory carded: no tax");
  ok(!acc.exciseExempt, "accessory never excise-exempt (no excise applies)");

  // Endorsement off → no exemptions even if carded
  const noEndorse = computeMedLineTax(
    { taxableBaseMinor: 10000, isCannabis: true, dohCompliant: true },
    { cardValidInDatabase: true },
    { ...s, medicallyEndorsed: false },
  );
  ok(noEndorse.salesTaxMinor === 930 && noEndorse.exciseTaxMinor === 3700, "no endorsement: full tax");

  // Cart aggregation
  const cart = computeMedCart(
    [
      { taxableBaseMinor: 10000, isCannabis: true, dohCompliant: true },
      { taxableBaseMinor: 5000, isCannabis: true, dohCompliant: false },
    ],
    { cardValidInDatabase: true },
    s,
  );
  ok(cart.exciseExemptLineCount === 1, "one excise-exempt line");
  ok(cart.exciseTaxMinor === applyBps(5000, 3700), "excise only on non-compliant line");
  ok(cart.salesTaxMinor === 0, "all sales exempt for carded");

  // Card validity
  const validCard: RecognitionCard = {
    uniquePatientIdentifier: "UPID-123",
    effectiveOn: "2024-01-01",
    expiresOn: "2030-01-01",
    inDohDatabase: true,
    status: "active",
  };
  ok(cardValidity(validCard, new Date("2026-06-30")).valid, "valid card");
  ok(!cardValidity({ ...validCard, expiresOn: "2024-01-01" }, new Date("2026-06-30")).valid, "expired");
  ok(!cardValidity({ ...validCard, inDohDatabase: false }).valid, "not in db");
  ok(!cardValidity({ ...validCard, status: "revoked" }).valid, "revoked");
  ok(!cardValidity({ ...validCard, uniquePatientIdentifier: null }).valid, "no upid");

  // Form checklist
  ok(
    canIssueCard({
      formCompleteSigned: true,
      tamperResistantVerified: true,
      identityVerified: true,
      embossedSealVerified: true,
    }),
    "all checks pass -> can issue",
  );
  ok(
    !canIssueCard({
      formCompleteSigned: true,
      tamperResistantVerified: false,
      identityVerified: true,
      embossedSealVerified: true,
    }),
    "missing check -> cannot issue",
  );

  console.log(`medical/tax.ts: ${n} tests passed`);
}
