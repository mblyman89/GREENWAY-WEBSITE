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

const GRAMS_PER_OUNCE = 28.35;

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
  ];
}
