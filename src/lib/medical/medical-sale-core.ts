/**
 * src/lib/medical/medical-sale-core.ts
 *
 * PURE medical-sale decision engine for Task O — the missing SELLING half of
 * the medical pipeline. No React, no DB, no server-only. Grounded in:
 *
 *   - RCW 82.08.9998  — SALES-tax exemption: 246-70 COMPLIANT products sold by
 *     an endorsed retailer to a recognition-card holder ((1)(a)); ≤0.3%-THC
 *     products to cardholders ((1)(b)); High-CBD compliant products to ANYONE
 *     ((1)(c)). A card alone does NOT exempt sales tax on non-compliant
 *     product — that was the bug this module corrects.
 *   - WAC 314-55-090(1) — EXCISE (37%) exemption: endorsed store AND carded
 *     patient/DP in the MCR AND 246-70 compliant product. Sunset 2029-06-30
 *     (WAC 314-55-090(6)).
 *   - WAC 314-55-090(2)-(3) — every excise-exempt sale needs the 5-year record
 *     (date, UPID, card effective/expiration, SKU, sales price) or the store
 *     remits the tax + penalties.
 *   - Chapter 246-70 WAC — DOH categories: general_use / high_thc / high_cbd.
 *     HIGH-THC PRODUCTS SELL ONLY TO CARDHOLDERS — a statutory hard gate with
 *     NO manager override.
 *
 * Money in MINOR units; register prices are TAX-INCLUSIVE, so each line's
 * pre-tax base is backed out with the same category divisor the money gate
 * uses (order-pricing-core). See docs/MEDICAL_CANNABIS_COMPLIANCE.md.
 *
 * CLAIM POLICY (documented, conservative): exemptions are only CLAIMED
 * (ledger rows written, taxes zeroed in reports) on orders with a VALID
 * attached recognition card, because the WAC 314-55-090(2) row requires the
 * card's UPID + dates. High-CBD is statutorily sales-tax-free for anyone, but
 * an uncarded claim has no ledger context — we over-remit rather than ever
 * under-document. Never a compliance violation to not claim an exemption.
 */
import {
  CANNABIS_EXCISE_TAX_BPS,
  COMBINED_SALES_TAX_BPS,
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";

// ---------------------------------------------------------------------------
// DOH product categories (chapter 246-70 WAC) — mirrors migration 0113
// ---------------------------------------------------------------------------
export const DOH_CATEGORIES = ["general_use", "high_thc", "high_cbd"] as const;
export type DohCategory = (typeof DOH_CATEGORIES)[number];

export const DOH_CATEGORY_LABELS: Record<DohCategory, string> = {
  general_use: "General Use",
  high_thc: "High THC",
  high_cbd: "High CBD",
};

export const DOH_CATEGORY_HELP: Record<DohCategory, string> = {
  general_use: "≤10 mg THC/serving, ≤100 mg/pkg. Anyone 21+; tax-free for carded patients.",
  high_thc:
    ">10–50 mg THC/serving (capsules, tablets, tinctures, patches, suppositories ONLY). Sells ONLY to recognition-card holders — no override.",
  high_cbd: "Low-THC/high-CBD ratios. Sales-tax-free for anyone by statute; excise-free for carded patients.",
};

export function isDohCategory(v: unknown): v is DohCategory {
  return typeof v === "string" && (DOH_CATEGORIES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Drafts-only category SUGGESTION (a human confirms from the physical package)
// ---------------------------------------------------------------------------
export type DohCategorySuggestion = {
  category: DohCategory;
  /** Why the heuristic suggested it — shown to the human verifier. */
  reason: string;
};

/**
 * Conservative name-based hint for the registry form. NEVER authoritative —
 * the DOH logo + category on the PHYSICAL PACKAGE is the only truth; staff
 * must confirm. Returns null when unsure (most of the time, by design).
 */
export function suggestDohCategory(productName: string | null | undefined): DohCategorySuggestion | null {
  const name = (productName ?? "").toLowerCase();
  if (!name.trim()) return null;
  if (/\bhigh[\s-]?cbd\b/.test(name) || /\bcbd\b.*\b(\d+)\s*:\s*1\b/.test(name)) {
    return { category: "high_cbd", reason: "Name mentions a High-CBD / CBD-ratio product." };
  }
  if (/\bhigh[\s-]?thc\b/.test(name)) {
    return { category: "high_thc", reason: "Name mentions High-THC (verify the form: capsule/tincture/patch/suppository only)." };
  }
  if (/\b(capsule|tablet|tincture|transdermal|patch|suppositor)/.test(name) && /\b(25|50)\s*mg\b/.test(name)) {
    return { category: "high_thc", reason: "High-dose ingestible form factor (>10 mg/serving)." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-line exemption decision (the corrected statute logic)
// ---------------------------------------------------------------------------
export type LineExemptionInput = {
  /** Cannabis product (subject to excise; sales-tax exemption applies only to cannabis products). */
  isCannabis: boolean;
  /** Verified 246-70 category from the registry, or null when unregistered. */
  dohCategory: DohCategory | null;
  /** Buyer holds a card that is VALID on the sale date AND in the MCR. */
  cardedValid: boolean;
  /** Store holds a valid LCB medical endorsement. */
  endorsed: boolean;
  /** WAC 314-55-090(6): the 37% exemption sunsets — false after 2029-06-30. */
  exciseExemptionActive: boolean;
};

export type LineExemptionDecision = {
  /** RCW 82.08.9998 sales-tax exemption applies to this line. */
  salesExempt: boolean;
  /** WAC 314-55-090(1) excise exemption applies to this line. */
  exciseExempt: boolean;
  /** 246-70 high-THC product and the buyer has NO valid card — sale is ILLEGAL. */
  highThcBlocked: boolean;
};

export function decideLineExemption(input: LineExemptionInput): LineExemptionDecision {
  const compliant = input.isCannabis && input.dohCategory !== null;

  // Statutory hard gate: high-THC sells ONLY to valid cardholders. Endorsement
  // status does not soften this — an unendorsed store may not sell it at all.
  const highThcBlocked = input.isCannabis && input.dohCategory === "high_thc" && !input.cardedValid;

  // Sales tax (RCW 82.08.9998): compliant product + endorsed + carded ((1)(a)),
  // or High-CBD compliant to anyone ((1)(c)). Never on non-cannabis lines.
  const salesExempt =
    input.endorsed &&
    compliant &&
    (input.cardedValid || input.dohCategory === "high_cbd");

  // Excise (WAC 314-55-090(1)): endorsed AND carded AND compliant AND not sunset.
  const exciseExempt =
    input.endorsed && input.cardedValid && compliant && input.exciseExemptionActive;

  return { salesExempt, exciseExempt, highThcBlocked };
}

// ---------------------------------------------------------------------------
// Order exemption plan (per stored order line → what to claim + record)
// ---------------------------------------------------------------------------
export type PlanLine = {
  /** Stable POS product key (order_lines.product_id) — the S-8 join key. */
  productId: string | null;
  productName: string;
  /** Placement-time category slug snapshot (tax divisor + cannabis-ness). */
  category: string | null;
  quantity: number;
  /** Post-discount per-unit price in minor units (TAX-INCLUSIVE register price). */
  unitPriceMinorUnits: number;
};

export type PlanOptions = {
  /** productId → verified DOH category (from medical_product_registry). */
  registry: ReadonlyMap<string, DohCategory>;
  /** Card is valid ON THE SALE DATE and in the MCR (authorizationValidityAt). */
  cardedValid: boolean;
  endorsed: boolean;
  /** ISO sale date (YYYY-MM-DD) — compared against the excise sunset. */
  saleDate: string;
  /** WAC 314-55-090(6) sunset, ISO date (config default 2029-06-30). */
  exciseExemptionUntil: string;
};

export type PlanLineResult = PlanLine & {
  dohCategory: DohCategory | null;
  isCannabis: boolean;
  /** Pre-tax base for the line (inclusive price backed out, rounded once per line). */
  baseMinor: number;
  salesExempt: boolean;
  exciseExempt: boolean;
  /** 37% that will NOT be owed because the line is excise-exempt. */
  exciseExemptedMinor: number;
  /** 9.3% that will NOT be reported/remitted because the line is sales-exempt. */
  salesTaxExemptedMinor: number;
  highThcBlocked: boolean;
};

export type OrderExemptionPlan = {
  lines: PlanLineResult[];
  /** Lines claiming at least one exemption (each needs a WAC 090(2) row). */
  claimedLineCount: number;
  exemptBaseMinor: number;
  exciseExemptedMinor: number;
  salesTaxExemptedMinor: number;
  /** Product names of high-THC lines that CANNOT be sold to this buyer. */
  highThcViolations: string[];
  /** True after the WAC 314-55-090(6) sunset — excise claims are off. */
  exciseSunsetPassed: boolean;
};

function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

/** Pre-tax base for one line: inclusive price backed out with the category divisor. */
export function lineBaseMinor(line: Pick<PlanLine, "category" | "quantity" | "unitPriceMinorUnits">): number {
  const qty = Math.max(0, Math.round(line.quantity));
  const inclusive = Math.max(0, Math.round(line.unitPriceMinorUnits)) * qty;
  const divisor = isNonCannabisCategory(line.category)
    ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
    : TAX_INCLUSIVE_DIVISOR;
  return Math.round(inclusive / divisor);
}

/**
 * Build the full exemption plan for an order's stored lines. Used by BOTH the
 * order-detail preview panel and the completion gate (same math, no drift).
 */
export function buildOrderExemptionPlan(lines: PlanLine[], opts: PlanOptions): OrderExemptionPlan {
  const exciseSunsetPassed = opts.saleDate > opts.exciseExemptionUntil;
  const out: PlanLineResult[] = [];
  const highThcViolations: string[] = [];
  let claimedLineCount = 0;
  let exemptBaseMinor = 0;
  let exciseExemptedMinor = 0;
  let salesTaxExemptedMinor = 0;

  for (const line of lines) {
    const isCannabis = !isNonCannabisCategory(line.category);
    const dohCategory = line.productId ? (opts.registry.get(line.productId) ?? null) : null;
    const decision = decideLineExemption({
      isCannabis,
      dohCategory,
      cardedValid: opts.cardedValid,
      endorsed: opts.endorsed,
      exciseExemptionActive: !exciseSunsetPassed,
    });

    const baseMinor = lineBaseMinor(line);
    const exciseAmt = decision.exciseExempt ? applyBps(baseMinor, CANNABIS_EXCISE_TAX_BPS) : 0;
    const salesAmt = decision.salesExempt ? applyBps(baseMinor, COMBINED_SALES_TAX_BPS) : 0;

    if (decision.highThcBlocked) highThcViolations.push(line.productName);
    if (decision.salesExempt || decision.exciseExempt) {
      claimedLineCount += 1;
      exemptBaseMinor += baseMinor;
    }
    exciseExemptedMinor += exciseAmt;
    salesTaxExemptedMinor += salesAmt;

    out.push({
      ...line,
      dohCategory,
      isCannabis,
      baseMinor,
      salesExempt: decision.salesExempt,
      exciseExempt: decision.exciseExempt,
      exciseExemptedMinor: exciseAmt,
      salesTaxExemptedMinor: salesAmt,
      highThcBlocked: decision.highThcBlocked,
    });
  }

  return {
    lines: out,
    claimedLineCount,
    exemptBaseMinor,
    exciseExemptedMinor,
    salesTaxExemptedMinor,
    highThcViolations,
    exciseSunsetPassed,
  };
}

// ---------------------------------------------------------------------------
// WAC 314-55-090(2) ledger rows from a plan (the completion gate writes these)
// ---------------------------------------------------------------------------
export type ExemptSaleDraft = {
  uniquePatientIdentifier: string;
  cardEffectiveOn: string | null;
  cardExpiresOn: string | null;
  /** = the order line's product_id (S-8 join key). */
  productSku: string;
  productName: string;
  /** Pre-tax base × qty for the covered line (LIQ-1295 Box 2 consistency). */
  salesPriceMinor: number;
  salesTaxExempt: boolean;
  exciseTaxExempt: boolean;
  exciseAmountExemptMinor: number;
};

export type ExemptSaleDraftsResult =
  | { ok: true; drafts: ExemptSaleDraft[] }
  | { ok: false; error: string };

/**
 * Convert the claimed plan lines into ledger-row drafts. Refuses (never
 * guesses) when a claimed line is missing its product key, or when the card
 * facts required by WAC 314-55-090(2)(b) are absent.
 */
export function buildExemptSaleDrafts(
  plan: OrderExemptionPlan,
  card: { uniquePatientIdentifier: string | null; effectiveOn: string | null; expiresOn: string | null },
): ExemptSaleDraftsResult {
  const claimed = plan.lines.filter((l) => l.salesExempt || l.exciseExempt);
  if (claimed.length === 0) return { ok: true, drafts: [] };

  if (!card.uniquePatientIdentifier) {
    return { ok: false, error: "The recognition card has no unique patient identifier — required by WAC 314-55-090(2)(b)(i)." };
  }
  if (!card.effectiveOn || !card.expiresOn) {
    return { ok: false, error: "The recognition card is missing its effective/expiration dates — required by WAC 314-55-090(2)(b)(ii)." };
  }

  const drafts: ExemptSaleDraft[] = [];
  for (const l of claimed) {
    if (!l.productId) {
      return {
        ok: false,
        error: `"${l.productName}" has no POS product key — its WAC 314-55-090(2) record could not be keyed (S-8) and the exemption cannot be claimed.`,
      };
    }
    drafts.push({
      uniquePatientIdentifier: card.uniquePatientIdentifier,
      cardEffectiveOn: card.effectiveOn,
      cardExpiresOn: card.expiresOn,
      productSku: l.productId,
      productName: l.productName,
      salesPriceMinor: l.baseMinor,
      salesTaxExempt: l.salesExempt,
      exciseTaxExempt: l.exciseExempt,
      exciseAmountExemptMinor: l.exciseExemptedMinor,
    });
  }
  return { ok: true, drafts };
}

// ---------------------------------------------------------------------------
// Inline self-tests
// ---------------------------------------------------------------------------
export function __runMedicalSaleTests(): void {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    n++;
    if (!c) throw new Error(`Test failed: ${m}`);
  };

  const base = { endorsed: true, exciseExemptionActive: true };

  // Carded + compliant (general_use): BOTH exemptions.
  const both = decideLineExemption({ ...base, isCannabis: true, dohCategory: "general_use", cardedValid: true });
  ok(both.salesExempt && both.exciseExempt && !both.highThcBlocked, "carded compliant: both exempt");

  // Carded + NON-compliant: NO exemptions (the corrected RCW 82.08.9998 rule).
  const none = decideLineExemption({ ...base, isCannabis: true, dohCategory: null, cardedValid: true });
  ok(!none.salesExempt && !none.exciseExempt, "carded non-compliant: NO sales or excise exemption");

  // Uncarded + high_cbd: sales exempt for ANYONE, excise still due.
  const cbd = decideLineExemption({ ...base, isCannabis: true, dohCategory: "high_cbd", cardedValid: false });
  ok(cbd.salesExempt && !cbd.exciseExempt && !cbd.highThcBlocked, "high-CBD uncarded: sales exempt only");

  // Uncarded + high_thc: BLOCKED (statutory, no override).
  const blocked = decideLineExemption({ ...base, isCannabis: true, dohCategory: "high_thc", cardedValid: false });
  ok(blocked.highThcBlocked, "high-THC uncarded: blocked");
  ok(!blocked.salesExempt && !blocked.exciseExempt, "blocked line claims nothing");

  // Carded + high_thc: allowed, both exempt.
  const ht = decideLineExemption({ ...base, isCannabis: true, dohCategory: "high_thc", cardedValid: true });
  ok(!ht.highThcBlocked && ht.salesExempt && ht.exciseExempt, "high-THC carded: allowed, both exempt");

  // Not endorsed: no exemptions ever; high-THC still blocked for uncarded.
  const noEnd = decideLineExemption({
    isCannabis: true, dohCategory: "general_use", cardedValid: true, endorsed: false, exciseExemptionActive: true,
  });
  ok(!noEnd.salesExempt && !noEnd.exciseExempt, "unendorsed: no exemptions");

  // Excise sunset: sales exemption survives, excise does not.
  const sunset = decideLineExemption({ ...base, exciseExemptionActive: false, isCannabis: true, dohCategory: "general_use", cardedValid: true });
  ok(sunset.salesExempt && !sunset.exciseExempt, "post-sunset: sales only");

  // Non-cannabis merch: never anything.
  const merch = decideLineExemption({ ...base, isCannabis: false, dohCategory: "general_use", cardedValid: true });
  ok(!merch.salesExempt && !merch.exciseExempt && !merch.highThcBlocked, "merch: nothing applies");

  // Line base math: $14.63 inclusive cannabis → $10.00 base; merch $10.93 → $10.00.
  ok(lineBaseMinor({ category: "flower", quantity: 1, unitPriceMinorUnits: 1463 }) === 1000, "cannabis divisor 1.463");
  ok(lineBaseMinor({ category: "merch", quantity: 1, unitPriceMinorUnits: 1093 }) === 1000, "merch divisor 1.093");

  // Full plan: carded patient, one compliant, one unregistered, one merch.
  const registry = new Map<string, DohCategory>([["sku-a", "general_use"]]);
  const plan = buildOrderExemptionPlan(
    [
      { productId: "sku-a", productName: "Compliant Gummy", category: "edibles", quantity: 2, unitPriceMinorUnits: 1463 },
      { productId: "sku-b", productName: "Regular Flower", category: "flower", quantity: 1, unitPriceMinorUnits: 1463 },
      { productId: "sku-c", productName: "T-Shirt", category: "merch", quantity: 1, unitPriceMinorUnits: 1093 },
    ],
    { registry, cardedValid: true, endorsed: true, saleDate: "2026-07-12", exciseExemptionUntil: "2029-06-30" },
  );
  ok(plan.claimedLineCount === 1, "only the compliant line claims");
  ok(plan.lines[0].baseMinor === 2000, "2×$14.63 → $20.00 base");
  ok(plan.lines[0].exciseExemptedMinor === 740, "37% of $20.00 = $7.40 exempted");
  ok(plan.lines[0].salesTaxExemptedMinor === 186, "9.3% of $20.00 = $1.86 exempted");
  ok(!plan.lines[1].salesExempt && !plan.lines[1].exciseExempt, "unregistered line: full tax");
  ok(plan.highThcViolations.length === 0, "no high-THC violations");

  // High-THC to an uncarded buyer surfaces as a violation.
  const recPlan = buildOrderExemptionPlan(
    [{ productId: "sku-h", productName: "50mg Capsules", category: "edibles", quantity: 1, unitPriceMinorUnits: 5000 }],
    {
      registry: new Map([["sku-h", "high_thc" as DohCategory]]),
      cardedValid: false, endorsed: true, saleDate: "2026-07-12", exciseExemptionUntil: "2029-06-30",
    },
  );
  ok(recPlan.highThcViolations.length === 1 && recPlan.highThcViolations[0] === "50mg Capsules", "high-THC violation listed");
  ok(recPlan.claimedLineCount === 0, "blocked plan claims nothing");

  // Sunset passed → excise off in the plan.
  const sunsetPlan = buildOrderExemptionPlan(
    [{ productId: "sku-a", productName: "Compliant Gummy", category: "edibles", quantity: 1, unitPriceMinorUnits: 1463 }],
    { registry, cardedValid: true, endorsed: true, saleDate: "2029-07-01", exciseExemptionUntil: "2029-06-30" },
  );
  ok(sunsetPlan.exciseSunsetPassed, "sunset detected");
  ok(sunsetPlan.exciseExemptedMinor === 0 && sunsetPlan.salesTaxExemptedMinor > 0, "post-sunset: sales-only claims");

  // Drafts: complete card → rows keyed by product id with base price.
  const drafts = buildExemptSaleDrafts(plan, {
    uniquePatientIdentifier: "UPID-1", effectiveOn: "2026-01-01", expiresOn: "2027-01-01",
  });
  ok(drafts.ok && drafts.drafts.length === 1, "one draft for one claimed line");
  if (drafts.ok) {
    ok(drafts.drafts[0].productSku === "sku-a", "draft keyed by product id (S-8)");
    ok(drafts.drafts[0].salesPriceMinor === 2000, "draft carries pre-tax base");
    ok(drafts.drafts[0].exciseAmountExemptMinor === 740, "draft carries exempted excise");
  }

  // Drafts refuse without card facts (WAC 090(2)(b)).
  const noUpid = buildExemptSaleDrafts(plan, { uniquePatientIdentifier: null, effectiveOn: "2026-01-01", expiresOn: "2027-01-01" });
  ok(!noUpid.ok, "no UPID → refuse drafts");
  const noDates = buildExemptSaleDrafts(plan, { uniquePatientIdentifier: "UPID-1", effectiveOn: null, expiresOn: null });
  ok(!noDates.ok, "no card dates → refuse drafts");

  // Drafts refuse a claimed line without a product key.
  const keylessPlan = buildOrderExemptionPlan(
    [{ productId: null, productName: "Mystery", category: "flower", quantity: 1, unitPriceMinorUnits: 1463 }],
    { registry: new Map(), cardedValid: true, endorsed: true, saleDate: "2026-07-12", exciseExemptionUntil: "2029-06-30" },
  );
  ok(keylessPlan.claimedLineCount === 0, "unregistered keyless line claims nothing");

  // Category suggestion heuristic: conservative.
  ok(suggestDohCategory("Fairwinds High CBD Tincture 20:1")?.category === "high_cbd", "high-CBD name suggested");
  ok(suggestDohCategory("Blue Dream Flower 3.5g") === null, "plain flower: no suggestion");
  ok(isDohCategory("high_thc") && !isDohCategory("bogus"), "category guard");

  console.log(`medical-sale-core: ${n} tests passed`);
}
