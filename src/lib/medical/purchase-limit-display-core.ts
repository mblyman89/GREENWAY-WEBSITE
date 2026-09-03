/**
 * src/lib/medical/purchase-limit-display-core.ts
 *
 * PURE display formatting for the medical vs recreational purchase-limit table
 * on the PUBLIC /medical page (Task T / PR 3). The figures derive from the
 * SAME constants the register enforces (`MEDICAL_PURCHASE_LIMITS` /
 * `RECREATIONAL_PURCHASE_LIMITS` in `@/lib/medical/tax.ts` — grams, with
 * ounce equivalents kept verbatim per WAC 314-55-095), so the public page can
 * never advertise limits that differ from what the store enforces.
 */
import { MEDICAL_PURCHASE_LIMITS, RECREATIONAL_PURCHASE_LIMITS } from "@/lib/medical/tax";
// SLICE 16: the low-THC beverage cap is quoted straight from the ENFORCEMENT
// constants rather than from MEDICAL_PURCHASE_LIMITS. Two reasons, both
// deliberate. (1) That object is gram-denominated by name (`*Grams`) and uses
// the DOH 28.35 g/oz convention; this figure is MILLIGRAMS OF ACTIVE DELTA-9
// THC and belongs to neither. (2) Quoting the register's own constant means
// the public page advertises the exact number the register blocks on.
import {
  RECREATIONAL_LIMITS,
  MEDICAL_LIMITS,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";
// GW-016: divide by the SAME DOH convention (28.35) the limit table multiplies
// by, so the displayed ounce figures round-trip exactly.
import { METRIC_GRAMS_PER_OUNCE as GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

function ounces(grams: number): number {
  return Math.round(grams / GRAMS_PER_OUNCE);
}

export type PurchaseLimitRow = {
  category: string;
  recreational: string;
  medical: string;
};

/**
 * One row per product form. Recreational = any adult 21+; Medical = validly
 * carded patient / designated provider in the DOH database at an endorsed
 * store (3× elevated limits, RCW 69.50.360 / WAC 314-55-095).
 */
export function purchaseLimitRows(): PurchaseLimitRow[] {
  return [
    {
      category: "Usable cannabis (flower)",
      recreational: `${ounces(RECREATIONAL_PURCHASE_LIMITS.usableGrams)} oz`,
      medical: `${ounces(MEDICAL_PURCHASE_LIMITS.usableGrams)} oz`,
    },
    {
      category: "Solid edibles",
      recreational: `${ounces(RECREATIONAL_PURCHASE_LIMITS.solidGrams)} oz`,
      medical: `${ounces(MEDICAL_PURCHASE_LIMITS.solidGrams)} oz`,
    },
    {
      category: "Cannabis-infused liquid",
      recreational: `${ounces(RECREATIONAL_PURCHASE_LIMITS.liquidGrams)} oz`,
      medical: `${ounces(MEDICAL_PURCHASE_LIMITS.liquidGrams)} oz`,
    },
    {
      category: "Concentrates",
      recreational: `${RECREATIONAL_PURCHASE_LIMITS.concentrateGrams} g`,
      medical: `${MEDICAL_PURCHASE_LIMITS.concentrateGrams} g`,
    },
    // The ONLY row where the medical figure does not triple the recreational
    // one. WAC 314-55-095(2)(d) says "and up to 200 mg" — the same 200 as
    // (1)(d)(i)(F). Presenting a tripled figure here would advertise an
    // over-sale to every patient who reads this page.
    {
      category: `Low-THC beverages (units of ${LOW_THC_UNIT_MAX_MG} mg THC or less)`,
      recreational: `${RECREATIONAL_LIMITS.low_thc_liquid} mg THC`,
      medical: `${MEDICAL_LIMITS.low_thc_liquid} mg THC`,
    },
  ];
}
