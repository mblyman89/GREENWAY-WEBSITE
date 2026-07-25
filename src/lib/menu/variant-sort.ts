/**
 * src/lib/menu/variant-sort.ts — SLICE 40
 *
 * Pure, client-safe ordering for a product card's package-size variants.
 *
 * OWNER RULE: the LOWEST size shows first on the card and the list ascends
 * from there (1g → 3.5g → 7g → 14g → 1oz). The POS transform already sorts
 * variants this way at import time (transform.ts mergeVariantDuplicates sorts
 * by package sortValue), but menu items can also be assembled by other paths
 * (mastered cards merging lots, draft injection, legacy snapshots), so the
 * storefront must NOT trust incoming order. This module re-derives the order
 * from the variant labels at render time — defense in depth.
 *
 * Size parsing mirrors parsePackageSize in src/lib/pos/transform.ts:
 *   mg ×0.001 · g ×1 · oz ×28 · ml ×0.01 · fl oz ×0.02957 · each/packs last.
 * Unparseable labels sort AFTER weighted ones; ties break by ascending price,
 * then label, so the order is deterministic (a stable total order).
 */

import type { GreenwayMenuVariant } from "@/lib/leafly/types";

/** Grams-equivalent sort weight per unit (mirrors transform.ts sortUnitWeight). */
const UNIT_WEIGHT: Record<string, number> = {
  mg: 0.001,
  g: 1,
  oz: 28,
  ml: 0.01,
  floz: 0.02957,
};

/**
 * Parse a variant label ("3.5g", "1oz", "100mg", "1 fl oz", "2pk", "each")
 * into a comparable size value, or null when the label carries no usable
 * size (each / packs / free text). Case- and whitespace-insensitive.
 */
export function variantSizeValue(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  const s = label.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(
    /^(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|floz|fluid\s*ounces?|mg|milligrams?|ml|milliliters?|g|grams?|oz|ounces?)$/,
  );
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const rawUnit = m[2].replace(/[.\s]+/g, "");
  const unit =
    rawUnit.startsWith("floz") || rawUnit.startsWith("fluidounce")
      ? "floz"
      : rawUnit.startsWith("mg") || rawUnit.startsWith("milligram")
        ? "mg"
        : rawUnit.startsWith("ml") || rawUnit.startsWith("milliliter")
          ? "ml"
          : rawUnit.startsWith("g")
            ? "g"
            : rawUnit.startsWith("oz") || rawUnit.startsWith("ounce")
              ? "oz"
              : null;
  if (!unit) return null;
  return qty * UNIT_WEIGHT[unit];
}

/**
 * Return the variants sorted lowest-size-first (ascending). Sizeless labels
 * (each / packs / free text) come after all weighted sizes, ordered by
 * ascending price so "the lowest option first" still holds for them.
 * Pure — returns a NEW array; never mutates the input.
 */
export function sortVariantsBySize<T extends Pick<GreenwayMenuVariant, "label" | "priceMinorUnits">>(
  variants: readonly T[],
): T[] {
  return [...variants].sort((a, b) => {
    const sa = variantSizeValue(a.label);
    const sb = variantSizeValue(b.label);
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    if (a.priceMinorUnits !== b.priceMinorUnits) return a.priceMinorUnits - b.priceMinorUnits;
    return (a.label ?? "").localeCompare(b.label ?? "");
  });
}

// ---------------------------------------------------------------------------
// Self-tests — run via scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runVariantSortTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const expect = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: variant-sort ${name}`);
    }
  };

  // variantSizeValue parsing
  expect("3.5g → 3.5", variantSizeValue("3.5g") === 3.5);
  expect("7g → 7", variantSizeValue("7g") === 7);
  expect("1oz → 28", variantSizeValue("1oz") === 28);
  expect("14g < 1oz", (variantSizeValue("14g") ?? 0) < (variantSizeValue("1oz") ?? 0));
  expect("100mg → 0.1", variantSizeValue("100mg") === 0.1);
  expect("30ml → 0.3", variantSizeValue("30ml") === 0.3);
  expect("1 fl oz parses", variantSizeValue("1 fl oz") === 0.02957);
  expect("case/space insensitive", variantSizeValue("  3.5 G ") === 3.5);
  expect("each → null", variantSizeValue("each") === null);
  expect("2pk → null", variantSizeValue("2pk") === null);
  expect("blank → null", variantSizeValue("") === null);
  expect("null → null", variantSizeValue(null) === null);
  expect("zero qty → null", variantSizeValue("0g") === null);

  // sortVariantsBySize ordering
  const v = (label: string, priceMinorUnits: number) => ({ label, priceMinorUnits });
  const shuffled = [v("1oz", 16000), v("3.5g", 3500), v("14g", 9000), v("1g", 1200), v("7g", 6500)];
  const sorted = sortVariantsBySize(shuffled);
  expect(
    "weights ascend 1g→3.5g→7g→14g→1oz",
    sorted.map((x) => x.label).join(",") === "1g,3.5g,7g,14g,1oz",
  );
  expect("input not mutated", shuffled[0].label === "1oz");

  // Sizeless labels come last, price ascending among themselves.
  const mixed = sortVariantsBySize([v("each", 500), v("3.5g", 3500), v("2pk", 300)]);
  expect("weighted first, sizeless after", mixed[0].label === "3.5g");
  expect("sizeless ties by price asc", mixed[1].label === "2pk" && mixed[2].label === "each");

  // All-sizeless: pure price ascending (lowest option first).
  const eaches = sortVariantsBySize([v("each", 900), v("each", 300), v("each", 600)]);
  expect(
    "all-each sorts by price asc",
    eaches.map((x) => x.priceMinorUnits).join(",") === "300,600,900",
  );

  // Same size different price: price breaks the tie.
  const tie = sortVariantsBySize([v("3.5g", 4000), v("3.5g", 2500)]);
  expect("same-size ties by price asc", tie[0].priceMinorUnits === 2500);

  console.log(`variant-sort self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
