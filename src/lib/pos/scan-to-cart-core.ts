/**
 * src/lib/pos/scan-to-cart-core.ts  (POS Slice B23)
 *
 * PURE barcode → cart resolution for the register's sale screen. Zero I/O —
 * unit-testable with tsx.
 *
 * In WA I-502, the barcode printed on a product package is (almost always)
 * the traceability LOT CODE (the same fact cycle-count-scan-core is built
 * on). The menu bundle therefore ships an optional `barcodes` index built
 * server-side from active inventory lots: normalized code → the stable POS
 * product key (= PosMenuProduct.productId = order_lines.product_id).
 *
 * Keyboard-wedge discipline: scanners type the code into the focused input
 * and press Enter. The sale screen's search box treats Enter as "try this
 * as a scan first": a hit adds to cart (or prompts a size pick when the
 * product has several variants); a miss simply stays as a search query —
 * scanning never blocks typing and typing never blocks scanning.
 *
 * NEVER SILENTLY WRONG: a code that resolves to a product with MULTIPLE
 * sellable variants is a "pick" — the cashier chooses the size; we never
 * guess which variant left the shelf.
 */

import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";
import { normalizeScan } from "@/lib/inventory/cycle-count-scan-core";
// Mastering Slice 1: intake variants encode their own lot key in the variant
// id (`${lotKey}-onboarded`), so a lot-code scan can resolve the EXACT size.
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";

// ---------------------------------------------------------------------------
// Index building (server-side at bundle time; pure so it is testable)
// ---------------------------------------------------------------------------

/** Minimal lot shape the index builder needs (from inventory_lots). */
export type LotBarcodeSource = {
  lotCode: string | null;
  posProductKey: string | null;
  /** Canonical CCRS external id when derivable (some labels print this). */
  ccrsExternalId: string | null;
};

/** Normalize a code for index keys: scanner cleanup + lowercase. */
export function normalizeBarcode(raw: string): string {
  return normalizeScan(raw).toLowerCase();
}

/**
 * Build the bundle's barcode index: normalized code → POS product key.
 * Only lots whose product key is actually SELLABLE (present in
 * `sellableKeys`) contribute — a lot for a delisted product must not make
 * the register beep "added". On collision (same code, DIFFERENT products)
 * the code is dropped entirely: an ambiguous barcode must fall through to
 * search, never silently pick a product.
 */
export function buildBarcodeIndex(
  lots: LotBarcodeSource[],
  sellableKeys: Set<string>,
): Record<string, string> {
  const index: Record<string, string> = {};
  const poisoned = new Set<string>();
  for (const lot of lots) {
    const key = (lot.posProductKey ?? "").trim();
    if (!key || !sellableKeys.has(key)) continue;
    for (const raw of [lot.lotCode, lot.ccrsExternalId]) {
      const code = normalizeBarcode(raw ?? "");
      if (code.length < 4) continue; // too short to be a real package barcode
      if (poisoned.has(code)) continue;
      const existing = index[code];
      if (existing && existing !== key) {
        delete index[code];
        poisoned.add(code);
        continue;
      }
      index[code] = key;
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Scan resolution (on-device)
// ---------------------------------------------------------------------------

export type ScanResolution =
  | { status: "add"; product: PosMenuProduct }
  | { status: "pick"; productId: string; candidates: PosMenuProduct[] }
  | { status: "none" };

/**
 * Resolve a raw scan/typed string against the bundle. Priority:
 *   1. exact product key (the code IS the product id — non-cannabis SKUs
 *      and hand-typed keys)
 *   2. a variant's own encoded lot key (mastered cards: hand-typed lot keys
 *      resolve straight to the size that lot IS)
 *   3. the barcode index (lot code / CCRS id → lot/product key)
 * A key that IS a specific variant's lot key → add that EXACT variant (the
 * barcode on the package identifies the size — no guessing needed). Else,
 * one sellable variant → add; several → pick (cashier chooses the size).
 * No match → none (the caller keeps the text as a search query).
 */
export function resolveScan(
  products: PosMenuProduct[],
  barcodes: Record<string, string> | null | undefined,
  raw: string,
): ScanResolution {
  const code = normalizeBarcode(raw);
  if (code.length < 4) return { status: "none" };

  let key: string | null = null;

  const direct = products.filter((p) => p.productId.toLowerCase() === code);
  if (direct.length > 0) {
    key = direct[0].productId;
  } else {
    // Hand-typed lot key that IS a specific variant on a mastered card.
    const typedVariant = products.filter(
      (p) => (lotKeyFromVariantId(p.variantId) ?? "").toLowerCase() === code,
    );
    if (typedVariant.length === 1) return { status: "add", product: typedVariant[0] };
    if (typedVariant.length > 1) {
      return { status: "pick", productId: typedVariant[0].productId, candidates: typedVariant };
    }
    if (barcodes) {
      const hit = barcodes[code];
      if (hit) key = hit;
    }
  }
  if (!key) return { status: "none" };

  // Mastering Slice 1: the resolved key names ONE variant's own lot — the
  // package in the cashier's hand IS that size. Add it directly; a "pick"
  // here would make the cashier re-answer what the barcode already said.
  const exact = products.filter((p) => lotKeyFromVariantId(p.variantId) === key);
  if (exact.length === 1) return { status: "add", product: exact[0] };
  if (exact.length > 1) {
    // Defensive: one lot key should map to one variant; if data ever
    // disagrees, let the cashier choose — never silently pick.
    return { status: "pick", productId: exact[0].productId, candidates: exact };
  }

  const candidates = products.filter((p) => p.productId === key);
  if (candidates.length === 0) return { status: "none" };
  if (candidates.length === 1) return { status: "add", product: candidates[0] };
  return { status: "pick", productId: key, candidates };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runScanToCartCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`PASS: ${msg}`);
  };

  const product = (productId: string, variantId: string, label: string | null): PosMenuProduct => ({
    productId,
    variantId,
    name: `Product ${productId}`,
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: label,
    regularPriceMinor: 1000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
  });

  // normalizeBarcode
  ok(normalizeBarcode("  WAG-123\r\n") === "wag-123", "normalizeBarcode: strips CR/LF, trims, lowercases");
  ok(normalizeBarcode("A  B\tC") === "a b c", "normalizeBarcode: collapses internal whitespace");

  // buildBarcodeIndex
  const sellable = new Set(["prod-1", "prod-2"]);
  const idx = buildBarcodeIndex(
    [
      { lotCode: "WAG-1111", posProductKey: "prod-1", ccrsExternalId: "CCRS-AAA" },
      { lotCode: "WAG-2222", posProductKey: "prod-2", ccrsExternalId: null },
      { lotCode: "WAG-3333", posProductKey: "prod-gone", ccrsExternalId: null }, // delisted
      { lotCode: "abc", posProductKey: "prod-1", ccrsExternalId: null }, // too short
      { lotCode: null, posProductKey: "prod-1", ccrsExternalId: null },
    ],
    sellable,
  );
  ok(idx["wag-1111"] === "prod-1", "index: lot code mapped to product key (normalized)");
  ok(idx["ccrs-aaa"] === "prod-1", "index: CCRS external id also mapped");
  ok(idx["wag-2222"] === "prod-2", "index: second product mapped");
  ok(!("wag-3333" in idx), "index: lot for delisted product excluded");
  ok(!("abc" in idx), "index: sub-4-char codes excluded");

  // collision poisoning
  const collided = buildBarcodeIndex(
    [
      { lotCode: "SAME-CODE", posProductKey: "prod-1", ccrsExternalId: null },
      { lotCode: "SAME-CODE", posProductKey: "prod-2", ccrsExternalId: null },
      { lotCode: "SAME-CODE", posProductKey: "prod-1", ccrsExternalId: null }, // re-add attempt after poison
    ],
    sellable,
  );
  ok(!("same-code" in collided), "index: colliding code dropped entirely — never silently picks a product");

  // same code twice for the SAME product is fine
  const dup = buildBarcodeIndex(
    [
      { lotCode: "DUP-1", posProductKey: "prod-1", ccrsExternalId: null },
      { lotCode: "DUP-1", posProductKey: "prod-1", ccrsExternalId: null },
    ],
    sellable,
  );
  ok(dup["dup-1"] === "prod-1", "index: duplicate code for the same product keeps the mapping");

  // resolveScan
  const products = [
    product("prod-1", "var-1", null), // single-variant
    product("prod-2", "var-2a", "1g"),
    product("prod-2", "var-2b", "3.5g"), // multi-variant
  ];
  const r1 = resolveScan(products, idx, "WAG-1111\n");
  ok(r1.status === "add" && r1.product.variantId === "var-1", "scan: single-variant product auto-adds");
  const r2 = resolveScan(products, idx, "wag-2222");
  ok(r2.status === "pick" && r2.candidates.length === 2, "scan: multi-variant product asks the cashier to pick");
  ok(resolveScan(products, idx, "unknown-code").status === "none", "scan: unknown code is none (falls through to search)");
  ok(resolveScan(products, idx, "abc").status === "none", "scan: too-short input never resolves");
  const r3 = resolveScan(products, null, "PROD-1");
  ok(r3.status === "add" && r3.product.productId === "prod-1", "scan: exact product key resolves even without an index");
  ok(resolveScan(products, undefined, "wag-1111").status === "none", "scan: no index + non-key code = none");

  // stale index entry pointing at a product no longer in the bundle
  const staleIdx = { "old-code": "prod-vanished" };
  ok(resolveScan(products, staleIdx, "old-code").status === "none", "scan: stale index entry resolves to none, never a ghost product");

  // ── Mastering Slice 1: variant-encoded lot keys ────────────────────────
  // A mastered card: ONE productId, one variant per size, each variant's id
  // carrying ITS OWN lot's pos_product_key + "-onboarded".
  const mastered = [
    product("card-1", "LOT-A-onboarded", "1g"),
    product("card-1", "LOT-B-onboarded", "3.5g"),
    product("solo", "solo-onboarded", "each"), // pre-mastering single-lot card
  ];
  // Barcode index maps each lot's code to the lot's OWN key (route builds it
  // from inventory_lots.pos_product_key, which for mastered cards is the
  // variant's key, kept sellable via the union in the menu route).
  const masteredIdx = {
    "code-lot-a": "LOT-A",
    "code-lot-b": "LOT-B",
    "code-solo": "solo",
  };
  const m1 = resolveScan(mastered, masteredIdx, "CODE-LOT-A");
  ok(
    m1.status === "add" && m1.product.variantId === "LOT-A-onboarded",
    "mastered: lot barcode adds the EXACT size (no pick)",
  );
  const m2 = resolveScan(mastered, masteredIdx, "code-lot-b");
  ok(
    m2.status === "add" && m2.product.variantId === "LOT-B-onboarded",
    "mastered: second lot's barcode adds ITS size",
  );
  const m3 = resolveScan(mastered, masteredIdx, "code-solo");
  ok(
    m3.status === "add" && m3.product.productId === "solo",
    "mastered: single-lot card still auto-adds (backward compatible)",
  );
  // Hand-typed lot key (no barcode index) resolves the exact variant too.
  const m4 = resolveScan(mastered, null, "LOT-B");
  ok(
    m4.status === "add" && m4.product.variantId === "LOT-B-onboarded",
    "mastered: hand-typed lot key resolves the exact size without an index",
  );
  // Typing the CARD key still shows the pick — the cashier chose the product,
  // not a package, so the size question is real.
  const m5 = resolveScan(mastered, masteredIdx, "card-1");
  ok(m5.status === "pick" && m5.candidates.length === 2, "mastered: card key still asks for the size");

  console.log("scan-to-cart-core self-tests passed");
}
