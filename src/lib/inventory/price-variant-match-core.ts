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
 *   0. R74 S30: if the LOT is linked to a size (inventory_lots.
 *      menu_source_variant_id, migration 0294) and that size is one of the
 *      card's variants → edit it ("linked"). The link is per lot, so this is
 *      what lets one size of a multi-size Cultivera card be priced without
 *      onboarding. A link whose size is not on the card (stale after a price
 *      change in Cultivera, or the lot was re-linked to another product) is
 *      ignored and the rules below apply.
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
  | { kind: "linked" | "onboarded" | "single-card"; variantId: string }
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
  linkedSourceVariantId?: string | null,
): LotVariantDecision {
  const k = (key ?? "").trim();
  if (!k) return { kind: "none" };

  // 0) R74 S30: the lot's own size, only when it is on the lot's card.
  const linked = (linkedSourceVariantId ?? "").trim();
  if (linked) {
    const hits = (Array.isArray(cardVariants) ? cardVariants : []).filter((v) => v && v.source_variant_id === linked);
    if (hits.length === 1) return { kind: "linked", variantId: hits[0].id };
    // 2+ rows with one source id on one card would be a data fault: fall
    // through to the card rules (which call it ambiguous) rather than pick.
  }

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

  // 8) R74 S30: the linked size wins on a multi-size card.
  const multi = [
    { id: "v-1g", source_variant_id: `${key}-aaaa` },
    { id: "v-3g", source_variant_id: `${key}-bbbb` },
  ];
  const d8 = resolveLotVariant(key, [], multi, `${key}-bbbb`);
  ok(d8.kind === "linked" && d8.variantId === "v-3g", "linked size picks its own variant on a multi-size card");
  // 9) The linked size beats an -onboarded variant on the card key.
  const d9 = resolveLotVariant(key, [{ id: "v-onb", source_variant_id: `${key}-onboarded` }], multi, `${key}-aaaa`);
  ok(d9.kind === "linked" && d9.variantId === "v-1g", "linked size beats the card-wide -onboarded id");
  // 10) A stale link (size not on the card) falls back to the old rules.
  ok(resolveLotVariant(key, [], multi, `${key}-zzzz`).kind === "ambiguous", "stale link on a multi-size card stays ambiguous");
  const d10b = resolveLotVariant(key, [], [multi[0]], `${key}-zzzz`);
  ok(d10b.kind === "single-card" && d10b.variantId === "v-1g", "stale link on a one-size card uses the one size");
  // 11) A link that only exists on ANOTHER card is never used.
  ok(resolveLotVariant(key, [], multi, "pos-other-aaaa").kind === "ambiguous", "a size on another card is ignored");
  // 12) Blank/whitespace link = no link.
  ok(resolveLotVariant(key, [], multi, "   ").kind === "ambiguous", "blank link is no link");
  // 13) Duplicate source ids on one card: refuse to pick.
  ok(
    resolveLotVariant(key, [], [...multi, { id: "v-3g-dup", source_variant_id: `${key}-bbbb` }], `${key}-bbbb`).kind === "ambiguous",
    "duplicate linked rows fall through to ambiguous",
  );

  console.log(`price-variant-match-core: ${passed} assertions passed`);
}
