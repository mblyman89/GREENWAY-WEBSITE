/**
 * SLICE E — TRIM WHAT THE GRID SHIPS.
 *
 * The /menu page hands EVERY product to `<InteractiveMenuBrowser items={…}>`,
 * and that array is serialized into the response for every shopper.
 *
 * HONESTY ABOUT HOW MUCH THIS BUYS
 * ────────────────────────────────
 * This is NOT the fix for the shop page. The cache fix in
 * `menu-cache-codec-core.ts` is. This is the cheap, safe secondary.
 *
 * The first measurement of this idea used a synthetic fixture where every
 * product shared the same description, and it showed ZERO compressed savings —
 * because gzip collapses identical strings to nothing. That result was
 * misleading. Re-measured with UNIQUE per-product descriptions, which is what a
 * real catalog has:
 *
 *     with descriptions ....  gzip 77 KB
 *     without ..............  gzip 21 KB
 *     saved ................  56 KB compressed, on every shop page load
 *
 * Plus the browser no longer parses or retains ~0.8 MB of strings across 4,500
 * objects. Modest, real, and free.
 *
 * WHY BLANK INSTEAD OF DELETE
 * ───────────────────────────
 * `description` is a REQUIRED field on `GreenwayMenuItem`, and the card
 * components (`ProductCard`, `ProductCardVisual`, `ProductCardPriceSelector`)
 * are all typed against the full item. Returning `Omit<…, "description">` would
 * force a type change through every one of those components and their callers —
 * a wide refactor to save bytes the shopper never sees.
 *
 * Blanking the string keeps the type contract exactly as it is, changes no
 * downstream signature, and removes the same bytes from the wire. `hiddenReason`
 * is optional, so that one is genuinely dropped.
 *
 * WHY THIS IS SAFE
 * ────────────────
 * `description` is read by NOTHING in the menu client tree. Verified field by
 * field across `InteractiveMenuBrowser`, `ProductCard`, `ProductCardVisual`,
 * and `ProductCardPriceSelector`. The single `.description` reference inside
 * `InteractiveMenuBrowser` belongs to `AccessoryCard`, a STATIC accessory tile
 * with its own hardcoded copy — not a `GreenwayMenuItem`.
 *
 * The product detail page is unaffected: it loads its own item through
 * `getLiveMenuItemByIdCached(id)` (menu/products/[id]/page.tsx:109) rather than
 * receiving it from the grid, so the full description is still rendered there.
 *
 * `hiddenReason` is dropped because hidden items are filtered out before the
 * grid ever sees them (`loadLiveMenuItemsCached`), so it is dead weight on
 * every surviving row.
 *
 * WHAT IS DELIBERATELY KEPT
 * ─────────────────────────
 * `variants` (21.8% of the payload) and `compounds` (8.6%) are the two largest
 * fields and both STAY. `cardCannabinoids()` reads them via `ProductCardVisual`
 * to render the potency line and the weight/price selector. Dropping them to
 * chase bytes would break the cards.
 *
 * This module is PURE so the projection is provable in tests.
 */

import type { GreenwayMenuItem } from "@/lib/leafly/types";

/**
 * Fields emptied or removed before items are handed to the client grid.
 * Every entry has been verified unread by the menu client tree.
 */
export const GRID_TRIMMED_FIELDS = ["description", "hiddenReason", "identityKey"] as const;

/**
 * USAGE-7e (2026-11-24): OPTIONAL package/dose/classification facts that are
 * DROPPED FROM THE ROW WHEN NULL. On the live catalog most rows carry these as
 * explicit nulls (e.g. dohCategory null on 2,712 of 2,712, unitsPerPackage
 * 2,712/2,712, unitThcMg 2,710/2,712): ~580 KB of `"key":null` per shop page,
 * 17% of the grid JSON, in every response and every ISR write.
 *
 * SAFE because every field here is typed `?: T | null` (absent and null are
 * the same "unknown" state) and every reader in the card / filter / cart /
 * sales-limit tree collapses them: `?? null`, `typeof x === "number"`,
 * `x != null`, `x === true`, or `x === undefined || x === null`
 * (sales-limits-core.ts:894). A non-null value, including `false` and `0`, is
 * always kept (an explicit `otherwiseTaken: false` is a human answer).
 */
export const GRID_NULL_DROPPED_FIELDS = [
  "lowThcLiquid",
  "unitThcMg",
  "otherwiseTaken",
  "unitsPerPackage",
  "netWeightGrams",
  "netVolumeMl",
  "ratioLabel",
  "servingsPerPack",
  "mgPerServing",
  "packageThcMg",
  "packageCbdMg",
  "dohCategory",
] as const;

/**
 * Project the published menu down to what the grid actually renders.
 *
 * The item TYPE is unchanged (`GreenwayMenuItem`), so no card component needs
 * to know this happened. Order is preserved exactly — the menu is an ordered
 * list and the grid renders it in order. Every field other than the two
 * documented above is passed through untouched, so a new field added to
 * `GreenwayMenuItem` reaches the grid automatically.
 */
export function toMenuGridItems(items: readonly GreenwayMenuItem[]): GreenwayMenuItem[] {
  return items.map((item) => {
    // `hiddenReason` is optional, so it can be removed outright. `description`
    // is required by the type, so it is blanked rather than deleted — same
    // bytes saved, no signature change anywhere downstream.
    //
    // Built by copy-then-delete rather than destructuring-to-omit so there is
    // no unused binding for the linter to flag. The source item is never
    // touched; `next` is already a fresh object.
    const next: GreenwayMenuItem = { ...item, description: "" };
    delete next.hiddenReason;
    // S20: the product identity feeds the server-side enrichment ladder only;
    // no card reads it, so it never ships to the browser.
    delete next.identityKey;
    // USAGE-7e: a null optional fact is the same as an absent one; drop it.
    const rec = next as unknown as Record<string, unknown>;
    for (const field of GRID_NULL_DROPPED_FIELDS) {
      if (rec[field] === null) delete rec[field];
    }
    return next;
  });
}

// ── Self-test ───────────────────────────────────────────────────────────────
/**
 * The module proves its own invariants. Called by the compliance test AND
 * runnable directly, so a projection that strips a field the cards need cannot
 * reach main.
 */
export function __runMenuGridProjectionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-grid-projection] FAIL: ${label}`);
    }
  };

  const item = {
    id: "abc",
    name: "Test Product",
    brand: "Test Brand",
    vendor: "Test Vendor",
    category: "flower",
    strainType: "hybrid",
    strainName: "Test Strain",
    terpenes: ["myrcene"],
    thc: "24.5",
    cbd: "0.1",
    totalThc: { name: "THC", value: 24.5, unit: "%" },
    totalCbd: { name: "CBD", value: 0.1, unit: "%" },
    compounds: [{ name: "THC", value: 24.5, unit: "%" }],
    description: "Should not reach the grid.",
    hiddenReason: "should not reach the grid either",
    identityKey: "vendor|flower|test-product",
    priceLabel: "$45.00",
    priceMinorUnits: 4500,
    inventoryStatus: "in-stock",
    variants: [{ id: "v1", label: "1g", priceMinorUnits: 1500, inventoryLevel: 4, medical: false }],
    imageUrl: "https://example.test/a.webp",
    imageIsFallback: false,
    dohCompliant: true,
  } as unknown as GreenwayMenuItem;

  const [projected] = toMenuGridItems([item]);
  const asRecord = projected as unknown as Record<string, unknown>;

  // ── The trimmed fields carry no payload ───────────────────────────────────
  check("description is blanked", asRecord.description === "");
  check("hiddenReason is removed", !("hiddenReason" in asRecord));
  check("identityKey is removed (S20: server-side only)", !("identityKey" in asRecord));

  // ── The type contract is intact (description still PRESENT, just empty) ────
  // This matters: the card components are typed against the full item, so the
  // key must exist even though its content is gone.
  check("description key still exists (type contract)", "description" in asRecord);

  // ── Everything the cards need survives ────────────────────────────────────
  // Verified in use by InteractiveMenuBrowser, ProductCardVisual,
  // ProductCardPriceSelector, and the promotion rules.
  const REQUIRED = [
    "id", "name", "brand", "vendor", "category", "strainType", "strainName",
    "terpenes", "thc", "cbd", "totalThc", "totalCbd", "compounds",
    "priceLabel", "priceMinorUnits", "inventoryStatus", "variants",
    "imageUrl", "imageIsFallback", "dohCompliant",
  ];
  for (const field of REQUIRED) {
    check(`grid keeps ${field}`, field in asRecord);
  }

  // ── The two biggest fields are explicitly NOT dropped ─────────────────────
  check("variants survive (cardCannabinoids needs them)", Array.isArray(asRecord.variants));
  check("compounds survive (cardCannabinoids needs them)", Array.isArray(asRecord.compounds));
  check("variants are not emptied", (asRecord.variants as unknown[]).length === 1);
  check("compounds are not emptied", (asRecord.compounds as unknown[]).length === 1);

  // ── Values are passed through unchanged ───────────────────────────────────
  check("id is unchanged", asRecord.id === "abc");
  check("price is unchanged", asRecord.priceMinorUnits === 4500);
  check("price label is unchanged", asRecord.priceLabel === "$45.00");
  check("name is unchanged", asRecord.name === "Test Product");

  // ── Order and length are preserved ────────────────────────────────────────
  const many = Array.from(
    { length: 100 },
    (_, i) => ({ ...item, id: `id-${i}` }) as GreenwayMenuItem,
  );
  const projectedMany = toMenuGridItems(many);
  check("length is preserved", projectedMany.length === 100);
  check(
    "order is preserved",
    projectedMany.every((row, i) => (row as unknown as Record<string, unknown>).id === `id-${i}`),
  );

  // ── Degenerate input ──────────────────────────────────────────────────────
  check("empty input yields empty output", toMenuGridItems([]).length === 0);

  // ── The source item is not mutated ────────────────────────────────────────
  check(
    "input item still has its description (no mutation)",
    (item as unknown as Record<string, unknown>).description === "Should not reach the grid.",
  );

  // ── It actually removes bytes ─────────────────────────────────────────────
  const before = JSON.stringify(many).length;
  const after = JSON.stringify(projectedMany).length;
  check("projection reduces serialized size", after < before);

  // ── USAGE-7e: null optional facts are dropped, real values kept ──────────
  const facts = {
    ...item,
    lowThcLiquid: null,
    unitThcMg: null,
    otherwiseTaken: false,
    unitsPerPackage: 0,
    netWeightGrams: 3.5,
    dohCategory: null,
    ratioLabel: "1:1 CBD:THC",
  } as unknown as GreenwayMenuItem;
  const pf = toMenuGridItems([facts])[0] as unknown as Record<string, unknown>;
  check("null lowThcLiquid dropped", !("lowThcLiquid" in pf));
  check("null unitThcMg dropped", !("unitThcMg" in pf));
  check("null dohCategory dropped", !("dohCategory" in pf));
  check("explicit false otherwiseTaken kept (a human answer)", pf.otherwiseTaken === false);
  check("zero unitsPerPackage kept (not nullish)", pf.unitsPerPackage === 0);
  check("real netWeightGrams kept", pf.netWeightGrams === 3.5);
  check("real ratioLabel kept", pf.ratioLabel === "1:1 CBD:THC");
  check("dropped null reads back as nullish (same meaning)", (pf.dohCategory ?? null) === null);
  check("source facts not mutated", (facts as unknown as Record<string, unknown>).lowThcLiquid === null);
  check("only optional fields are null-dropped", !GRID_NULL_DROPPED_FIELDS.some((f) => (REQUIRED as readonly string[]).includes(f)));

  return { passed, failed };
}
