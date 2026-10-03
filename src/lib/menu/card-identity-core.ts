/**
 * SLICE 66 — card identity (brand/vendor label) pure core.
 *
 * Fixes three verified customer-facing label problems (owner screenshots,
 * D1/D2/D3 in the intake-intelligence audit):
 *
 *  D2 — a brand linked in Product Enrichment (product_enrichments.brand_id)
 *       was stored but NEVER displayed: the public site renders through
 *       live-menu's menuRowToGreenwayItem, which copies the menu row's
 *       brand_name verbatim (and the orphaned mergeForDisplay helper also
 *       ignored brand_id). `applyCardIdentity` overlays the PUBLISHED
 *       enrichment brand display name onto the item so the card label
 *       (brand-else-vendor, card-brand-core) finally sees it.
 *
 *  D1 — vendors auto-created from a manifest header kept the label verbatim,
 *       so cards read "CERES - 435011". `stripLicenseSuffix` removes a
 *       trailing WA license number (5+ digits, separated or parenthesized)
 *       while refusing to touch names that ARE digits (brand "2727") or that
 *       end in short numbers ("Cloud 9", "Farm 2020" — 4 digits kept).
 *
 *  D3 — vendors.dba (migration 0081) was never preferred for customer
 *       display. `vendorShortLabel` picks dba over display_name, then strips
 *       any license suffix.
 *
 * DISPLAY-ONLY by design: nothing here writes to the database, and the menu
 * row's stored brand_name/vendor_name are untouched (search, admin, carts,
 * receipts, CCRS reporting all keep the full stored values). Restock/family
 * grouping keys are also unaffected — this runs at render time in live-menu.
 *
 * NO I/O — unit-testable via __runCardIdentityCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts, mirrored in vitest).
 */
import {
  normalizeVendorKey,
  stripLicenseSuffix,
  extractLicenseFromLabel,
} from "@/lib/inventory/vendor-resolve-core";

/**
 * The customer-facing SHORT name for a vendor row: prefer a non-blank dba
 * ("doing business as" — the name the vendor actually trades under), else the
 * display_name; either way strip a trailing license number.
 */
export function vendorShortLabel(v: {
  display_name: string | null;
  dba?: string | null;
}): string {
  const dba = (v.dba ?? "").trim();
  const dn = (v.display_name ?? "").trim();
  return stripLicenseSuffix(dba || dn);
}

/** The subset of a menu item applyCardIdentity reads/rewrites. */
export type CardIdentityItem = {
  /** Stable POS source_item_id — matches product_enrichments.pos_product_key. */
  id: string;
  brand: string;
  vendor?: string;
  /**
   * S20 (R24 follow-up): the card's S03 product identity, computed by
   * live-menu from the RAW menu row. Lets a card with no brand link of its
   * own show the brand linked on its product's published enrichment.
   */
  identityKey?: string | null;
};

/** Where a card's brand link came from (for tests and logs). */
export type CardBrandVia = "own" | "identity";

/**
 * S20 follow-up (bible 19.19 "Next fixes": `loadPublishedEnrichmentBrands`
 * by identity). posKey -> brand_id, the SAME ladder S20 uses for copy and
 * images (enrichment-identity-core resolveEnrichmentForItem):
 *   1. the card's OWN published enrichment brand link wins (Q-03: what was
 *      set on a card's own key is never overridden by a sibling);
 *   2. else the product's PUBLISHED survivor (by identity_key) - only when
 *      it is not the card's own row and it carries a brand link;
 *   3. else nothing (the row's own brand text shows, exactly as before).
 * The survivors map is already published-only and survivorship-picked by
 * the shared identity read; an unknown identity ("" / null) never matches.
 */
export function resolveCardBrandIds(
  items: readonly Pick<CardIdentityItem, "id" | "identityKey">[],
  ownBrandIdByKey: ReadonlyMap<string, string>,
  survivorByIdentity: ReadonlyMap<string, { pos_product_key: string; brand_id: string | null }>,
): Map<string, { brandId: string; via: CardBrandVia }> {
  const out = new Map<string, { brandId: string; via: CardBrandVia }>();
  for (const it of items) {
    const own = (ownBrandIdByKey.get(it.id) ?? "").trim();
    if (own) {
      out.set(it.id, { brandId: own, via: "own" });
      continue;
    }
    const identity = (it.identityKey ?? "").trim();
    if (!identity) continue;
    const row = survivorByIdentity.get(identity);
    if (!row || row.pos_product_key === it.id) continue;
    const borrowed = (row.brand_id ?? "").trim();
    if (borrowed) out.set(it.id, { brandId: borrowed, via: "identity" });
  }
  return out;
}

/** The cards that need the identity read: an identity, and no own brand link. */
export function identityKeysNeedingBrand(
  items: readonly Pick<CardIdentityItem, "id" | "identityKey">[],
  ownBrandIdByKey: ReadonlyMap<string, string>,
): string[] {
  const keys = new Set<string>();
  for (const it of items) {
    if ((ownBrandIdByKey.get(it.id) ?? "").trim()) continue;
    const identity = (it.identityKey ?? "").trim();
    if (identity) keys.add(identity);
  }
  return [...keys];
}

/**
 * Overlay display identity onto rendered menu items (pure; the server caller
 * batches the two lookup maps):
 *  - `brandByKey`  — pos_product_key → PUBLISHED enrichment brand display
 *    name. When present (non-blank), it REPLACES the row's brand so the card
 *    label logic (brand-else-vendor) finally honors the enrichment link (D2).
 *  - `vendorShortByKey` — normalizeVendorKey(vendors.display_name) →
 *    vendorShortLabel(row). When the item's vendor matches, the short/dba
 *    label is shown (D3); otherwise the raw vendor still gets its trailing
 *    license number stripped (D1) so "CERES - 435011" reads "CERES" even for
 *    vendors that predate the auto-create fix.
 * Items without changes are returned by reference (cheap no-op).
 */
export function applyCardIdentity<T extends CardIdentityItem>(
  items: readonly T[],
  brandByKey: ReadonlyMap<string, string>,
  vendorShortByKey: ReadonlyMap<string, string>,
): T[] {
  return items.map((it) => {
    const enrichedBrand = (brandByKey.get(it.id) ?? "").trim();
    const brand = enrichedBrand || it.brand;

    const rawVendor = (it.vendor ?? "").trim();
    let vendor = it.vendor;
    if (rawVendor) {
      const short = (vendorShortByKey.get(normalizeVendorKey(rawVendor)) ?? "").trim();
      vendor = short || stripLicenseSuffix(rawVendor);
    }

    if (brand === it.brand && vendor === it.vendor) return it;
    return { ...it, brand, vendor };
  });
}

// ---------------------------------------------------------------------------
// Self-tests (pure, no I/O)
// ---------------------------------------------------------------------------
export function __runCardIdentityCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`card-identity-core self-test failed: ${msg}`);
    passed += 1;
  };

  // --- stripLicenseSuffix (D1, pinned on the owner's real CERES card) ---
  ok(stripLicenseSuffix("CERES - 435011") === "CERES", "dash-separated license stripped (real data)");
  ok(stripLicenseSuffix("CERES (435011)") === "CERES", "parenthesized license stripped");
  ok(stripLicenseSuffix("CERES 435011") === "CERES", "space-separated license stripped");
  ok(stripLicenseSuffix("Seattles Private Reserve — 417068") === "Seattles Private Reserve", "em-dash license stripped");
  ok(stripLicenseSuffix("2727") === "2727", "all-digit brand kept (never emptied)");
  ok(stripLicenseSuffix("Cloud 9") === "Cloud 9", "short trailing number kept");
  ok(stripLicenseSuffix("Farm 2020") === "Farm 2020", "4-digit year kept (5+ digit floor)");
  ok(stripLicenseSuffix("435011 Farms") === "435011 Farms", "leading digits kept (suffix only)");
  ok(stripLicenseSuffix("  CERES - 435011  ") === "CERES", "whitespace trimmed");
  ok(stripLicenseSuffix("") === "", "blank stays blank");
  ok(stripLicenseSuffix(null) === "", "null -> empty");
  ok(stripLicenseSuffix("CERES") === "CERES", "no license -> untouched");

  // --- extractLicenseFromLabel ---
  ok(extractLicenseFromLabel("CERES - 435011") === "435011", "license extracted");
  ok(extractLicenseFromLabel("CERES") === null, "no license -> null");
  ok(extractLicenseFromLabel("2727") === null, "all-digit label -> null (not a suffix)");
  ok(extractLicenseFromLabel("Farm 2020") === null, "4-digit year -> null");
  ok(extractLicenseFromLabel(null) === null, "null -> null");

  // --- vendorShortLabel (D3) ---
  ok(vendorShortLabel({ display_name: "Ceres Holdings LLC - 435011", dba: "CERES" }) === "CERES", "dba preferred");
  ok(vendorShortLabel({ display_name: "CERES - 435011", dba: null }) === "CERES", "display_name license-stripped");
  ok(vendorShortLabel({ display_name: "Fairwinds Manufacturing", dba: "  " }) === "Fairwinds Manufacturing", "blank dba falls to display_name");
  ok(vendorShortLabel({ display_name: null, dba: null }) === "", "nothing -> empty");

  // --- applyCardIdentity (D1+D2+D3 integration) ---
  const items = [
    { id: "POS-1", brand: "", vendor: "CERES - 435011", name: "Healing Balm" },
    { id: "POS-2", brand: "Row Brand", vendor: "Fairwinds Manufacturing", name: "Tincture" },
    { id: "POS-3", brand: "", vendor: undefined as string | undefined, name: "Mystery" },
  ];
  const brandByKey = new Map([["POS-2", "Fairwinds"]]);
  const vendorShort = new Map([[normalizeVendorKey("Fairwinds Manufacturing"), "Fairwinds"]]);
  const out = applyCardIdentity(items, brandByKey, vendorShort);
  ok(out[0].brand === "" && out[0].vendor === "CERES", "unmatched vendor still license-stripped (D1)");
  ok(out[1].brand === "Fairwinds", "published enrichment brand replaces row brand (D2)");
  ok(out[1].vendor === "Fairwinds", "matched vendor uses short label (D3)");
  ok(out[2] === items[2], "untouched item returned by reference");
  ok(out[0].name === "Healing Balm", "other fields preserved");
  const noop = applyCardIdentity([items[2]], new Map(), new Map());
  ok(noop[0] === items[2], "empty maps -> no-op");

  // --- resolveCardBrandIds (S20 follow-up: the brand label follows the product) ---
  const ID = "grow-op-farms|flower|blue-dream";
  const surv = new Map([[ID, { pos_product_key: "CARD-A", brand_id: "brand-a" }]]);
  const r1 = resolveCardBrandIds([{ id: "LOT-7", identityKey: ID }], new Map(), surv);
  ok(r1.get("LOT-7")?.brandId === "brand-a" && r1.get("LOT-7")?.via === "identity", "no own link -> borrows the product's published brand");
  const r2 = resolveCardBrandIds([{ id: "LOT-7", identityKey: ID }], new Map([["LOT-7", "brand-own"]]), surv);
  ok(r2.get("LOT-7")?.brandId === "brand-own" && r2.get("LOT-7")?.via === "own", "own link wins over the identity (Q-03)");
  const r3 = resolveCardBrandIds([{ id: "CARD-A", identityKey: ID }], new Map(), surv);
  ok(!r3.has("CARD-A"), "a card never borrows from itself");
  const r4 = resolveCardBrandIds([{ id: "LOT-7", identityKey: "" }, { id: "LOT-8", identityKey: null }, { id: "LOT-9" }], new Map(), new Map([["", { pos_product_key: "X", brand_id: "b" }]]));
  ok(r4.size === 0, "unknown identity is never a wildcard");
  const r5 = resolveCardBrandIds([{ id: "LOT-7", identityKey: ID }], new Map(), new Map([[ID, { pos_product_key: "CARD-A", brand_id: "  " }]]));
  ok(r5.size === 0, "a survivor without a brand link lends nothing");
  const r6 = resolveCardBrandIds([{ id: "LOT-7", identityKey: `  ${ID} ` }], new Map([["LOT-7", "  "]]), surv);
  ok(r6.get("LOT-7")?.via === "identity", "blank own link does not block; identity trimmed");
  const need = identityKeysNeedingBrand(
    [{ id: "A", identityKey: ID }, { id: "B", identityKey: ID }, { id: "C", identityKey: "x|y|z" }, { id: "D", identityKey: "" }],
    new Map([["C", "brand-c"]]),
  );
  ok(need.length === 1 && need[0] === ID, "only cards without an own link ask; de-duplicated; blank skipped");

  console.log(`card-identity-core: ${passed} assertions passed`);
  return { passed, failed: 0 };
}
