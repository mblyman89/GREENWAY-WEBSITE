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

export type TaxSettings = {
  exciseRateBps: number; // 3700 = 37%
  stateSalesRateBps: number; // 650 = 6.5%
  localSalesRateBps: number; // 280 = 2.8%
  medicalEndorsement: boolean;
};

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  exciseRateBps: 3700,
  stateSalesRateBps: 650,
  localSalesRateBps: 280,
  medicalEndorsement: false,
};

/** Combined sales-tax rate in basis points (state + local). */
export function combinedSalesRateBps(s: TaxSettings): number {
  return s.stateSalesRateBps + s.localSalesRateBps;
}

/** Apply a basis-point rate to a minor-unit amount, rounded to the nearest cent. */
export function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
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
    const { data } = await admin
      .from("tax_settings")
      .select("excise_rate_bps, state_sales_rate_bps, local_sales_rate_bps, medical_endorsement")
      .eq("id", true)
      .maybeSingle();
    if (!data) return DEFAULT_TAX_SETTINGS;
    return {
      exciseRateBps: data.excise_rate_bps ?? DEFAULT_TAX_SETTINGS.exciseRateBps,
      stateSalesRateBps: data.state_sales_rate_bps ?? DEFAULT_TAX_SETTINGS.stateSalesRateBps,
      localSalesRateBps: data.local_sales_rate_bps ?? DEFAULT_TAX_SETTINGS.localSalesRateBps,
      medicalEndorsement: !!data.medical_endorsement,
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
