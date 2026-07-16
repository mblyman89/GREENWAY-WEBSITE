/**
 * src/lib/pos/variant-lot-core.ts  (Product Mastering — Slice 1)
 *
 * PURE variant → inventory-lot key resolution. Zero I/O — unit-testable with
 * tsx and registered in scripts/compliance/run-pure-selftests.ts.
 *
 * WHY THIS EXISTS (verified gap): every sold line resolves its inventory lot
 * by `order_lines.product_id` (= menu_items.source_item_id = the lot's
 * pos_product_key) ONLY. That is exactly right while one menu card = one lot
 * (the intake path today), but product mastering rolls SEVERAL lots of the
 * same product (same brand, different sizes / restocks) under ONE card — and
 * a card's source_item_id can carry only one key. The variant is the tier
 * that stays 1:1 with a lot, so the sale path must prefer the VARIANT's lot
 * key and fall back to product_id.
 *
 * THE ENCODING (already shipped, now load-bearing): draft-injection-core has
 * always minted intake variants as `source_variant_id = `${key}-onboarded``
 * where `key` is the lot's pos_product_key. Mastered cards keep the SAME
 * scheme — each size variant carries ITS OWN lot's key + "-onboarded". So
 * extracting the lot key from a variant id is: strip the trailing
 * "-onboarded". For every card built before mastering, the extracted key
 * equals the card's product_id — behaviour is IDENTICAL (verified: the
 * planner mints the single variant from the same `key` the item id uses).
 *
 * NEVER SILENTLY WRONG: variant ids that do NOT end in "-onboarded" (the
 * Cultivera bulk-import scheme `${itemId}-${hash}`, synthetic `-default`
 * variants, hand-typed ids) return null — the caller falls back to
 * product_id exactly as before this slice. We never guess a lot key out of
 * an unrecognized id.
 */

/** The suffix draft-injection-core appends to the lot key for intake variants. */
export const ONBOARDED_VARIANT_SUFFIX = "-onboarded";

/**
 * Extract the inventory lot key (pos_product_key) encoded in an intake
 * variant's source_variant_id. Null when the id does not carry one
 * (non-intake variants, blanks, bare suffix) — the caller must fall back to
 * the line's product_id.
 */
export function lotKeyFromVariantId(variantId: string | null | undefined): string | null {
  if (typeof variantId !== "string") return null;
  const trimmed = variantId.trim();
  if (!trimmed.endsWith(ONBOARDED_VARIANT_SUFFIX)) return null;
  const key = trimmed.slice(0, -ONBOARDED_VARIANT_SUFFIX.length).trim();
  return key ? key : null;
}

/**
 * The lot key a sold line's inventory consumption should aggregate under:
 * the variant's own encoded lot key when present, else the line's
 * product_id snapshot (the pre-mastering behaviour, byte for byte).
 */
export function lotKeyForSaleLine(line: {
  productId: string | null;
  variantId: string | null;
}): string | null {
  return lotKeyFromVariantId(line.variantId) ?? line.productId ?? null;
}

/**
 * Build the full set of lot keys an order's lines may consume — the union of
 * every line's product_id AND its variant-encoded lot key. The sale-path
 * wrappers use this as the `.in("pos_product_key", …)` filter so multi-lot
 * cards load ALL their lots, while single-lot cards load exactly what they
 * always did (the two keys coincide).
 */
export function lotKeysForLines(
  lines: { productId: string | null; variantId: string | null }[],
): string[] {
  const keys = new Set<string>();
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line) continue;
    const product = typeof line.productId === "string" ? line.productId.trim() : "";
    if (product) keys.add(product);
    const fromVariant = lotKeyFromVariantId(line.variantId);
    if (fromVariant) keys.add(fromVariant);
  }
  return [...keys];
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runVariantLotCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };

  // lotKeyFromVariantId — the encoding contract.
  ok(lotKeyFromVariantId("SKU-123-onboarded") === "SKU-123", "extracts lot key from intake variant id");
  ok(lotKeyFromVariantId("LOT ABC 9-onboarded") === "LOT ABC 9", "keys with spaces survive intact");
  ok(lotKeyFromVariantId("  SKU-1-onboarded  ") === "SKU-1", "surrounding whitespace trimmed");
  ok(lotKeyFromVariantId("-onboarded") === null, "bare suffix has no key");
  ok(lotKeyFromVariantId("   -onboarded") === null, "whitespace-only key is null");
  ok(lotKeyFromVariantId("pos-abc123-def456") === null, "Cultivera bulk-import variant ids never match");
  ok(lotKeyFromVariantId("pos-abc123-default") === null, "synthetic -default variants never match");
  ok(lotKeyFromVariantId("SKU-1-ONBOARDED") === null, "suffix match is case-sensitive (exact scheme only)");
  ok(lotKeyFromVariantId("") === null, "empty string is null");
  ok(lotKeyFromVariantId(null) === null, "null is null");
  ok(lotKeyFromVariantId(undefined) === null, "undefined is null");
  // A key that itself ends in "-onboarded" strips ONE suffix only.
  ok(
    lotKeyFromVariantId("X-onboarded-onboarded") === "X-onboarded",
    "only the trailing suffix is stripped",
  );

  // lotKeyForSaleLine — variant first, product_id fallback.
  ok(
    lotKeyForSaleLine({ productId: "card-key", variantId: "lot-key-onboarded" }) === "lot-key",
    "variant-encoded key wins over product_id",
  );
  ok(
    lotKeyForSaleLine({ productId: "card-key", variantId: "pos-abc-hash" }) === "card-key",
    "non-intake variant falls back to product_id",
  );
  ok(
    lotKeyForSaleLine({ productId: "card-key", variantId: null }) === "card-key",
    "missing variant falls back to product_id",
  );
  ok(lotKeyForSaleLine({ productId: null, variantId: null }) === null, "nothing to resolve is null");
  ok(
    lotKeyForSaleLine({ productId: null, variantId: "k-onboarded" }) === "k",
    "variant key resolves even without a product_id snapshot",
  );

  // lotKeysForLines — union, deduped, blanks skipped.
  const keys = lotKeysForLines([
    { productId: "A", variantId: "A-onboarded" }, // single-lot card: both keys coincide
    { productId: "CARD", variantId: "LOT-2-onboarded" }, // mastered card: two distinct keys
    { productId: "B", variantId: "pos-x-y" }, // bulk-import variant: product only
    { productId: null, variantId: null }, // custom keypad line: nothing
    { productId: "  ", variantId: "" }, // garbage: nothing
    { productId: "A", variantId: null }, // dup product key
  ]);
  ok(keys.length === 4, `union has exactly 4 keys (got ${keys.length}: ${keys.join(",")})`);
  ok(keys.includes("A") && keys.includes("CARD") && keys.includes("LOT-2") && keys.includes("B"), "union contents exact");
  ok(lotKeysForLines([]).length === 0, "empty input is empty");

  console.log(`variant-lot-core: all ${passed} tests passed`);
}
