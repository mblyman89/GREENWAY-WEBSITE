/**
 * src/lib/inventory/price-variant-match-core.ts
 *
 * PURE decision logic for "which menu variant does a lot's after-tax price edit
 * target?" — extracted so the rule is deterministic and self-tested, with NO
 * database access. The DB-effectful loader in price-write-store.ts fetches the
 * candidate variants and calls resolveLotVariant() to make the choice.
 *
 * WHY (T-327 Slice 3): two variant-id schemes coexist on the menu:
 *   • INTAKE / onboarded lots →  source_variant_id = "${pos_product_key}-onboarded"
 *     (draft-injection-core.ts). Exactly one such variant per lot.
 *   • CULTIVERA MENU-IMPORT lots → source_variant_id = "${itemId}-${hash}"
 *     (transform.ts:1011). NO -onboarded id. But the lot's pos_product_key
 *     equals its card's menu_items.source_item_id (both are
 *     "pos-${stableId(identityKey)}"), so the card is still findable.
 *
 * Rule (never guess a price):
 *   1. If an -onboarded variant exists for this key → edit it ("onboarded").
 *   2. Else, among the variants of the card whose source_item_id === key:
 *        • exactly one variant → edit it ("single-card").
 *        • more than one → "ambiguous" (refuse; we can't map a size from the
 *          pos_product_key alone).
 *        • none → "none".
 */

// Re-exported from the canonical definition so there is ONE source of truth
// for the intake variant-id suffix (verified equal: variant-lot-core.ts:33).
export { ONBOARDED_VARIANT_SUFFIX } from "@/lib/pos/variant-lot-core";
import { ONBOARDED_VARIANT_SUFFIX } from "@/lib/pos/variant-lot-core";

/** Minimal shape the resolver needs from a menu_variant candidate. */
export type VariantCandidate = {
  id: string;
  source_variant_id: string | null;
};

export type LotVariantDecision =
  | { kind: "onboarded" | "single-card"; variantId: string }
  | { kind: "ambiguous"; variantCount: number }
  | { kind: "none" };

/**
 * Decide which variant a lot's price edit targets.
 *
 * @param key          the lot's pos_product_key (== its card's source_item_id)
 * @param onboarded    variants matching source_variant_id = "${key}-onboarded"
 *                     (already filtered by the caller; usually 0 or 1)
 * @param cardVariants ALL variants belonging to the card whose
 *                     source_item_id === key (used only when there's no
 *                     onboarded match)
 */
export function resolveLotVariant(
  key: string,
  onboarded: VariantCandidate[],
  cardVariants: VariantCandidate[],
): LotVariantDecision {
  const k = (key ?? "").trim();
  if (!k) return { kind: "none" };

  // 1) Intake fast path.
  const onboardedId = `${k}${ONBOARDED_VARIANT_SUFFIX}`;
  const exact = (onboarded ?? []).find((v) => v.source_variant_id === onboardedId);
  if (exact) return { kind: "onboarded", variantId: exact.id };

  // 2) Import fallback via the card's variants.
  const variants = Array.isArray(cardVariants) ? cardVariants.filter(Boolean) : [];
  if (variants.length === 0) return { kind: "none" };
  if (variants.length === 1) return { kind: "single-card", variantId: variants[0].id };
  return { kind: "ambiguous", variantCount: variants.length };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPriceVariantMatchCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };

  const key = "pos-abc123";

  // 1) Onboarded wins even if card variants also exist.
  const d1 = resolveLotVariant(
    key,
    [{ id: "v-onb", source_variant_id: `${key}-onboarded` }],
    [{ id: "v-card", source_variant_id: `${key}-hash` }],
  );
  ok(d1.kind === "onboarded" && d1.variantId === "v-onb", "onboarded variant is preferred");

  // 2) No onboarded, single card variant (Cultivera import, one size) → edit it.
  const d2 = resolveLotVariant(
    key,
    [],
    [{ id: "v-imp", source_variant_id: `${key}-9f1c` }],
  );
  ok(d2.kind === "single-card" && d2.variantId === "v-imp", "single import variant is editable");

  // 3) No onboarded, multiple card variants → ambiguous (refuse).
  const d3 = resolveLotVariant(
    key,
    [],
    [
      { id: "v-1g", source_variant_id: `${key}-aaaa` },
      { id: "v-3g", source_variant_id: `${key}-bbbb` },
    ],
  );
  ok(d3.kind === "ambiguous", "multi-variant import card is ambiguous");
  ok(d3.kind === "ambiguous" && d3.variantCount === 2, "ambiguous reports the count");

  // 4) No variants at all → none.
  ok(resolveLotVariant(key, [], []).kind === "none", "no variants → none");

  // 5) Empty/blank key → none.
  ok(resolveLotVariant("", [], [{ id: "x", source_variant_id: "x" }]).kind === "none", "blank key → none");
  ok(resolveLotVariant("   ", [], []).kind === "none", "whitespace key → none");

  // 6) Onboarded list present but not an EXACT match → fall through to card.
  const d6 = resolveLotVariant(
    key,
    [{ id: "v-wrong", source_variant_id: `${key}-onboarded-extra` }],
    [{ id: "v-only", source_variant_id: `${key}-cccc` }],
  );
  ok(d6.kind === "single-card" && d6.variantId === "v-only", "non-exact onboarded id does not match");

  // 7) Case sensitivity: -ONBOARDED is not the intake scheme.
  const d7 = resolveLotVariant(
    key,
    [{ id: "v-up", source_variant_id: `${key}-ONBOARDED` }],
    [{ id: "v-c", source_variant_id: `${key}-dddd` }],
  );
  ok(d7.kind === "single-card", "onboarded suffix is case-sensitive");

  console.log(`price-variant-match-core: ${passed} assertions passed`);
}
