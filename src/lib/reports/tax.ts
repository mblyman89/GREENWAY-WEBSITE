/**
 * src/lib/reports/tax.ts
 *
 * The Washington / Port Orchard tax engine for Greenway.
 *
 * Rules (confirmed by owner + WSLCB Cannabis Tax Reporting Guide + CCRS guide):
 *   - Cannabis EXCISE tax = 37% on CANNABIS products only (not accessories/merch).
 *     CCRS calls this "OtherTax" / CannabisExciseTax and requires it to equal 37%
 *     of the unit price (× quantity) for retail, except medical which is exempt.
 *   - Combined SALES tax = state 6.5% + local (Port Orchard) 2.8% = 9.3%. Applies
 *     to BOTH cannabis and non-cannabis goods. CCRS calls this "SalesTax".
 *   - The sales-tax BASE is the pre-tax price (it does NOT include the excise tax).
 *   - MEDICAL sales (valid card + med endorsement + medically-compliant product)
 *     are EXEMPT from BOTH taxes. The exemption is NOT a discount.
 *
 * All money is in MINOR UNITS (cents). Rates are in basis points (3700 = 37%).
 * The compute functions here are PURE so they are fully unit-testable; the DB
 * loader is a thin wrapper. NOTE: this module is server-only.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * How the stored line price relates to tax.
 *
 *  • "pre_tax"        — stored price is the pre-tax, post-discount base (today's
 *                       behavior). Tax is ADDED on top.
 *  • "tax_inclusive"  — stored price already INCLUDES sales (and, for cannabis,
 *                       excise) tax. We must BACK OUT the tax to recover the base.
 *  • "auto"           — detect per-order from the stored header figures
 *                       (subtotal vs total vs estimated_tax). Falls back to
 *                       "pre_tax" if it can't tell. This is the robustness the
 *                       owner asked for: if the website/POS ever starts storing
 *                       tax-inclusive prices, the reports self-correct instead
 *                       of silently double-counting or under-counting tax.
 */
export type TaxBaseMode = "pre_tax" | "tax_inclusive" | "auto";

export type TaxSettings = {
  exciseRateBps: number; // 3700 = 37%
  stateSalesRateBps: number; // 650 = 6.5%
  localSalesRateBps: number; // 280 = 2.8%
  medicalEndorsement: boolean;
  /** How stored line prices relate to tax. Default "pre_tax". */
  taxBaseMode: TaxBaseMode;
};

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  exciseRateBps: 3700,
  stateSalesRateBps: 650,
  localSalesRateBps: 280,
  medicalEndorsement: false,
  taxBaseMode: "pre_tax",
};

/** Combined sales-tax rate in basis points (state + local). */
export function combinedSalesRateBps(s: TaxSettings): number {
  return s.stateSalesRateBps + s.localSalesRateBps;
}

/** Apply a basis-point rate to a minor-unit amount, rounded to the nearest cent. */
export function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

/**
 * The effective "all-in" tax rate (bps) that would have been applied on top of a
 * pre-tax base for a given line type. Sales tax always applies; excise adds for
 * cannabis. Medical-exempt lines have a 0 effective rate.
 */
export function effectiveTaxRateBps(
  settings: TaxSettings,
  opts: { isCannabis: boolean; medical?: boolean },
): number {
  if (opts.medical && settings.medicalEndorsement) return 0;
  const sales = combinedSalesRateBps(settings);
  const excise = opts.isCannabis ? settings.exciseRateBps : 0;
  return sales + excise;
}

/**
 * Back out the pre-tax base from a TAX-INCLUSIVE gross amount.
 *
 *   gross = base + base * (rate/10000)  =>  base = gross * 10000 / (10000 + rate)
 *
 * Returns the integer minor-unit base (rounded). If rate is 0 (e.g. medical
 * exempt), the gross IS the base.
 */
export function backOutTaxInclusive(grossMinor: number, effectiveRateBps: number): number {
  if (effectiveRateBps <= 0) return Math.max(0, Math.round(grossMinor));
  return Math.max(0, Math.round((grossMinor * 10000) / (10000 + effectiveRateBps)));
}

/**
 * Normalize a stored line price into the correct PRE-TAX taxable base, honoring
 * the configured tax-base mode. This is the single choke point every tax/COGS
 * report should call so the system is robust if pricing semantics change.
 *
 *  • "pre_tax"       — return storedBaseMinor unchanged.
 *  • "tax_inclusive" — back the tax out using the line's effective rate.
 *  • "auto"          — use the provided `resolvedInclusive` hint (computed once
 *                       per order by detectTaxInclusive); if undefined, treat as
 *                       pre-tax.
 */
export function normalizeTaxableBase(
  storedBaseMinor: number,
  settings: TaxSettings,
  opts: { isCannabis: boolean; medical?: boolean; resolvedInclusive?: boolean },
): number {
  const base = Math.max(0, Math.round(storedBaseMinor));
  const inclusive =
    settings.taxBaseMode === "tax_inclusive" ||
    (settings.taxBaseMode === "auto" && !!opts.resolvedInclusive);
  if (!inclusive) return base;
  return backOutTaxInclusive(base, effectiveTaxRateBps(settings, opts));
}

/**
 * Heuristic for "auto" mode: decide whether an order's stored line prices were
 * tax-inclusive by reconciling the header figures we already persist.
 *
 * We have, per order: subtotal_minor_units (sum of line prices × qty),
 * estimated_tax_minor_units, and total_minor_units. In a PRE-TAX world,
 * total ≈ subtotal + tax. In a TAX-INCLUSIVE world, total ≈ subtotal (tax is
 * already inside the subtotal). We compare the two interpretations and pick the
 * closer fit, with a tolerance to absorb rounding.
 *
 * Returns null when there isn't enough signal (then callers default to pre-tax).
 */
export function detectTaxInclusive(header: {
  subtotalMinor: number | null | undefined;
  estimatedTaxMinor: number | null | undefined;
  totalMinor: number | null | undefined;
}): boolean | null {
  const sub = header.subtotalMinor ?? null;
  const tax = header.estimatedTaxMinor ?? null;
  const total = header.totalMinor ?? null;
  if (sub == null || total == null) return null;

  const tol = 2; // cents of rounding slack
  // Pre-tax fit: total should equal subtotal + tax.
  const preTaxResidual = Math.abs(total - (sub + (tax ?? 0)));
  // Inclusive fit: total should equal subtotal (tax already inside).
  const inclusiveResidual = Math.abs(total - sub);

  // If tax was charged but total == subtotal, prices were inclusive.
  if ((tax ?? 0) > 0 && inclusiveResidual <= tol && preTaxResidual > tol) return true;
  // If total == subtotal + tax, prices were pre-tax.
  if (preTaxResidual <= tol && inclusiveResidual > tol) return false;
  // Ambiguous (e.g. zero tax) — no strong signal.
  return null;
}

export type LineTaxInput = {
  /** Pre-tax, post-discount taxable base for the whole line, in minor units. */
  taxableBaseMinor: number;
  /** Is this a cannabis product (subject to excise)? */
  isCannabis: boolean;
  /** Is this a tax-exempt medical sale (valid card + endorsement + compliant)? */
  medical?: boolean;
};

export type LineTax = {
  salesTaxMinor: number;
  exciseTaxMinor: number;
  totalTaxMinor: number;
};

/**
 * Compute the sales + excise tax for a single line.
 *
 * - Non-cannabis: sales tax only, no excise.
 * - Cannabis recreational: sales tax + 37% excise (excise on the same pre-tax base).
 * - Cannabis medical (with endorsement): both taxes $0.00 (exempt).
 */
export function computeLineTax(input: LineTaxInput, settings: TaxSettings): LineTax {
  const base = Math.max(0, Math.round(input.taxableBaseMinor));

  // Medical exemption only applies if the store holds the endorsement.
  const isExemptMedical = !!input.medical && settings.medicalEndorsement;
  if (isExemptMedical) {
    return { salesTaxMinor: 0, exciseTaxMinor: 0, totalTaxMinor: 0 };
  }

  const salesTaxMinor = applyBps(base, combinedSalesRateBps(settings));
  const exciseTaxMinor = input.isCannabis ? applyBps(base, settings.exciseRateBps) : 0;
  return {
    salesTaxMinor,
    exciseTaxMinor,
    totalTaxMinor: salesTaxMinor + exciseTaxMinor,
  };
}

export type CartTaxLine = LineTaxInput & { lineId?: string };

export type CartTaxTotals = {
  taxableBaseMinor: number;
  salesTaxMinor: number;
  exciseTaxMinor: number;
  totalTaxMinor: number;
  grandTotalMinor: number; // base + taxes
};

/** Sum tax across a cart of lines. */
export function computeCartTax(lines: CartTaxLine[], settings: TaxSettings): CartTaxTotals {
  let taxableBaseMinor = 0;
  let salesTaxMinor = 0;
  let exciseTaxMinor = 0;
  for (const line of lines) {
    const t = computeLineTax(line, settings);
    taxableBaseMinor += Math.max(0, Math.round(line.taxableBaseMinor));
    salesTaxMinor += t.salesTaxMinor;
    exciseTaxMinor += t.exciseTaxMinor;
  }
  const totalTaxMinor = salesTaxMinor + exciseTaxMinor;
  return {
    taxableBaseMinor,
    salesTaxMinor,
    exciseTaxMinor,
    totalTaxMinor,
    grandTotalMinor: taxableBaseMinor + totalTaxMinor,
  };
}

// ---------------------------------------------------------------------------
// DB loaders (thin wrappers).
// ---------------------------------------------------------------------------

/** Load the singleton tax settings (falls back to defaults). */
export async function getTaxSettings(): Promise<TaxSettings> {
  try {
    const admin = createSupabaseAdminClient();
    // Select * so we tolerate the tax_base_mode column being absent until the
    // owner runs migration 0033 (keeps this non-breaking / idempotent-friendly).
    const { data } = await admin.from("tax_settings").select("*").eq("id", true).maybeSingle();
    if (!data) return DEFAULT_TAX_SETTINGS;
    const rawMode = (data as Record<string, unknown>).tax_base_mode;
    const mode: TaxBaseMode =
      rawMode === "tax_inclusive" || rawMode === "auto" || rawMode === "pre_tax"
        ? (rawMode as TaxBaseMode)
        : DEFAULT_TAX_SETTINGS.taxBaseMode;
    return {
      exciseRateBps: data.excise_rate_bps ?? DEFAULT_TAX_SETTINGS.exciseRateBps,
      stateSalesRateBps: data.state_sales_rate_bps ?? DEFAULT_TAX_SETTINGS.stateSalesRateBps,
      localSalesRateBps: data.local_sales_rate_bps ?? DEFAULT_TAX_SETTINGS.localSalesRateBps,
      medicalEndorsement: !!data.medical_endorsement,
      taxBaseMode: mode,
    };
  } catch {
    return DEFAULT_TAX_SETTINGS;
  }
}

/**
 * Load the set of category values that are cannabis (excise-eligible). Returns a
 * Set of category strings; if the table is empty/unavailable, returns null so
 * callers can fall back to a heuristic.
 */
export async function getCannabisCategorySet(): Promise<Set<string> | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("tax_category_rules")
      .select("category, is_cannabis");
    if (!data || data.length === 0) return null;
    const set = new Set<string>();
    for (const row of data) {
      if (row.is_cannabis) set.add(String(row.category));
    }
    return set;
  } catch {
    return null;
  }
}

/** Heuristic fallback: non-cannabis categories when the rules table is empty. */
const NON_CANNABIS_FALLBACK = new Set(["paraphernalia", "accessories", "merch"]);

/** Decide if a category is cannabis (excise-eligible), using DB rules or fallback. */
export function isCannabisCategory(category: string | null | undefined, rules: Set<string> | null): boolean {
  const c = (category ?? "").trim().toLowerCase();
  if (!c) return true; // unknown → treat as cannabis to be safe (excise charged)
  if (rules) return rules.has(c);
  return !NON_CANNABIS_FALLBACK.has(c);
}
