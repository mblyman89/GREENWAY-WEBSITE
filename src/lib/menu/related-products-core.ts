/**
 * SLICE 95 — "More from" (related products) selection: vendor-pure + honest.
 *
 * OWNER BUG (verified on the live site): the PDP's "More from 2727" rail
 * showed a CERES topical. Root cause: the old selector matched on RAW brand
 * equality (`candidate.brand === item.brand`) while the heading shows the
 * brand-ELSE-VENDOR label (SLICE 47). Intake-created items carry a blank
 * brand, so EVERY blank-brand item — regardless of vendor — matched each
 * other, leaking other vendors' products under a vendor heading.
 *
 * OWNER DIRECTIVE: the section must show "more products from that vendor in
 * an intelligent and expert way" so it "properly entices customers to add
 * more products to their cart."
 *
 * THE RULES (pure, deterministic, no I/O):
 *  1. IDENTITY mirrors the card label exactly (brand else vendor else
 *     nothing, whitespace-insensitive, case-insensitive):
 *       - item has a brand  → rail = other items of THAT brand only;
 *       - item has only a vendor → rail = other items from THAT vendor
 *         (their own sub-brands included — they ARE from that vendor);
 *       - item has neither → straight to the category fallback.
 *  2. NO MIXING: if the identity has at least one sibling, the rail contains
 *     ONLY siblings. Other vendors never pad a vendor-labeled rail.
 *  3. HONEST FALLBACK: when the identity has zero siblings, the rail falls
 *     back to the same CATEGORY and reports scope "category" so the heading
 *     can say so instead of lying with the brand/vendor name.
 *  4. INTELLIGENT ORDER (the enticement ranking):
 *       a. purchasable first — in-stock, then low-stock, then unavailable
 *          (a sold-out card can't be added to a cart);
 *       b. same category as the viewed item first (closest substitute /
 *          companion), then the rest of the identity's range for variety;
 *       c. closer price first (comparable spend is the easiest add-on);
 *       d. deterministic name/id tie-break (no render-to-render shuffle).
 *
 * NO I/O — unit-testable via __runRelatedProductsCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts).
 */

export type RelatedScope = "brand" | "vendor" | "category";

/** The minimal item shape the selector needs (GreenwayMenuItem satisfies it). */
export type RelatedCandidate = {
  id: string;
  name: string;
  brand?: string | null;
  vendor?: string | null;
  category: string;
  priceMinorUnits: number;
  inventoryStatus?: "in-stock" | "low-stock" | "unavailable" | string;
};

export type RelatedIdentity =
  | { kind: "brand" | "vendor"; key: string; label: string }
  | null;

const normKey = (value: string | null | undefined): string =>
  (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The identity the rail groups by — EXACTLY the brand-else-vendor label the
 * card shows (SLICE 47), so the heading and the contents can never disagree.
 */
export function relatedIdentityFor(item: {
  brand?: string | null;
  vendor?: string | null;
}): RelatedIdentity {
  const brand = (item.brand ?? "").trim();
  if (brand) return { kind: "brand", key: normKey(brand), label: brand };
  const vendor = (item.vendor ?? "").trim();
  if (vendor) return { kind: "vendor", key: normKey(vendor), label: vendor };
  return null;
}

/** Does `candidate` belong to `identity`? (Never matches a blank field.) */
export function matchesRelatedIdentity(
  candidate: { brand?: string | null; vendor?: string | null },
  identity: RelatedIdentity,
): boolean {
  if (!identity) return false;
  if (identity.kind === "brand") return normKey(candidate.brand) === identity.key;
  // Vendor identity: anything supplied by that vendor counts — including the
  // vendor's own sub-brands. A blank vendor NEVER matches.
  return normKey(candidate.vendor) === identity.key;
}

const STOCK_RANK: Record<string, number> = {
  "in-stock": 0,
  "low-stock": 1,
  unavailable: 2,
};

function stockRank(status: string | undefined): number {
  return STOCK_RANK[status ?? ""] ?? 1;
}

/**
 * The enticement ranking (lower sorts first). Deterministic: equal items
 * always render in the same order.
 */
export function compareRelatedCandidates(
  a: RelatedCandidate,
  b: RelatedCandidate,
  anchor: { category: string; priceMinorUnits: number },
): number {
  const stock = stockRank(a.inventoryStatus) - stockRank(b.inventoryStatus);
  if (stock !== 0) return stock;
  const aCat = a.category === anchor.category ? 0 : 1;
  const bCat = b.category === anchor.category ? 0 : 1;
  if (aCat !== bCat) return aCat - bCat;
  const aPrice = Math.abs(a.priceMinorUnits - anchor.priceMinorUnits);
  const bPrice = Math.abs(b.priceMinorUnits - anchor.priceMinorUnits);
  if (aPrice !== bPrice) return aPrice - bPrice;
  const name = a.name.localeCompare(b.name);
  if (name !== 0) return name;
  return a.id.localeCompare(b.id);
}

export type RelatedSelection<T extends RelatedCandidate> = {
  items: T[];
  /** What the rail actually contains — drives an HONEST heading. */
  scope: RelatedScope;
  /** The identity used (null when the item has neither brand nor vendor). */
  identity: RelatedIdentity;
};

/**
 * Select the "More from" rail for `item` out of `allItems`.
 *
 * Siblings of the item's brand-else-vendor identity, enticement-ranked, up to
 * `limit`. When the identity has NO siblings (or the item has no identity),
 * falls back to the same category with scope "category" so the heading can
 * tell the truth.
 */
export function selectRelatedItems<T extends RelatedCandidate>(
  item: RelatedCandidate & { id: string },
  allItems: T[],
  limit = 8,
): RelatedSelection<T> {
  const identity = relatedIdentityFor(item);
  const anchor = { category: item.category, priceMinorUnits: item.priceMinorUnits };

  if (identity) {
    const siblings = allItems
      .filter((c) => c.id !== item.id && matchesRelatedIdentity(c, identity))
      .sort((a, b) => compareRelatedCandidates(a, b, anchor));
    if (siblings.length > 0) {
      return { items: siblings.slice(0, limit), scope: identity.kind, identity };
    }
  }

  const sameCategory = allItems
    .filter((c) => c.id !== item.id && c.category === item.category)
    .sort((a, b) => compareRelatedCandidates(a, b, anchor));
  return { items: sameCategory.slice(0, limit), scope: "category", identity };
}

// ---------------------------------------------------------------------------
// Self-tests (pure, no I/O)
// ---------------------------------------------------------------------------
export function __runRelatedProductsCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`related-products-core self-test failed: ${msg}`);
    passed += 1;
  };

  const mk = (
    id: string,
    over: Partial<RelatedCandidate> = {},
  ): RelatedCandidate & { id: string } => ({
    id,
    name: `Item ${id}`,
    brand: "",
    vendor: "",
    category: "cartridge",
    priceMinorUnits: 1200,
    inventoryStatus: "in-stock",
    ...over,
  });

  // --- identity mirrors the card label ---
  ok(relatedIdentityFor({ brand: "Fairwinds", vendor: "2727" })?.kind === "brand", "brand wins over vendor");
  ok(relatedIdentityFor({ brand: "", vendor: "2727" })?.kind === "vendor", "vendor when brand blank");
  ok(relatedIdentityFor({ brand: "  ", vendor: " " }) === null, "whitespace-only = no identity");
  ok(relatedIdentityFor({ brand: "", vendor: " 2727 " })?.key === "2727", "vendor key trimmed+lowered");
  ok(relatedIdentityFor({ brand: "CERES ", vendor: "" })?.label === "CERES", "label keeps original casing");

  // --- THE OWNER'S BUG: blank brands must NOT group across vendors ---
  const gorilla = mk("g1", { brand: "", vendor: "2727", category: "preroll" });
  const ceres = mk("c1", { brand: "", vendor: "CERES", category: "topical" });
  const cart2727 = mk("v1", { brand: "", vendor: "2727", category: "cartridge" });
  const blunt2727 = mk("v2", { brand: "", vendor: "2727", category: "blunt" });
  const leak = selectRelatedItems(gorilla, [ceres, cart2727, blunt2727]);
  ok(leak.scope === "vendor", "vendor scope when vendor has siblings");
  ok(leak.items.every((i) => i.vendor === "2727"), "NO other vendor leaks into a vendor rail");
  ok(!leak.items.some((i) => i.id === "c1"), "the CERES topical is excluded");

  // --- vendor identity includes the vendor's own sub-brands ---
  const subBrand = mk("v3", { brand: "2727 Reserve", vendor: "2727" });
  const withSub = selectRelatedItems(gorilla, [subBrand, ceres]);
  ok(withSub.items.some((i) => i.id === "v3"), "vendor rail includes the vendor's sub-brands");

  // --- brand identity: brand match only ---
  const fw1 = mk("f1", { brand: "Fairwinds", vendor: "A" });
  const fw2 = mk("f2", { brand: "fairwinds ", vendor: "B" });
  const other = mk("o1", { brand: "Ceres", vendor: "A" });
  const brandSel = selectRelatedItems(fw1, [fw2, other]);
  ok(brandSel.scope === "brand", "brand scope");
  ok(brandSel.items.length === 1 && brandSel.items[0].id === "f2",
    "brand rail = same brand only (case/space-insensitive), same-vendor other brands excluded");

  // --- no mixing: siblings never padded with strangers ---
  const lonely = mk("l1", { brand: "Solo", vendor: "S" });
  const solo2 = mk("l2", { brand: "Solo", vendor: "S" });
  const strangers = [mk("s1", { brand: "X" }), mk("s2", { brand: "Y" }), mk("s3", { brand: "Z" })];
  const noMix = selectRelatedItems(lonely, [solo2, ...strangers]);
  ok(noMix.items.length === 1 && noMix.items[0].id === "l2", "one sibling → rail of exactly one, no padding");

  // --- honest category fallback when identity has zero siblings ---
  const alone = mk("a1", { brand: "OnlyBrand", vendor: "", category: "topical" });
  const catMate = mk("a2", { brand: "Other", category: "topical" });
  const offCat = mk("a3", { brand: "Other", category: "flower" });
  const fb = selectRelatedItems(alone, [catMate, offCat]);
  ok(fb.scope === "category", "zero siblings → category scope (heading tells the truth)");
  ok(fb.items.length === 1 && fb.items[0].id === "a2", "category fallback stays in-category");

  // --- no identity at all → category fallback ---
  const nameless = mk("n1", { brand: "", vendor: "", category: "flower" });
  const fbNone = selectRelatedItems(nameless, [mk("n2", { category: "flower" })]);
  ok(fbNone.scope === "category" && fbNone.identity === null, "no brand/vendor → category scope, null identity");

  // --- enticement ranking ---
  const anchor = mk("r0", { vendor: "V", category: "preroll", priceMinorUnits: 1000 });
  const soldOut = mk("r1", { vendor: "V", category: "preroll", priceMinorUnits: 1000, inventoryStatus: "unavailable" });
  const offCatV = mk("r2", { vendor: "V", category: "flower", priceMinorUnits: 1000 });
  const nearPrice = mk("r3", { vendor: "V", category: "preroll", priceMinorUnits: 1100 });
  const farPrice = mk("r4", { vendor: "V", category: "preroll", priceMinorUnits: 4000 });
  const ranked = selectRelatedItems(anchor, [soldOut, offCatV, farPrice, nearPrice]);
  ok(ranked.items[0].id === "r3", "in-stock same-category near-price ranks first");
  ok(ranked.items[1].id === "r4", "same-category far-price beats off-category");
  ok(ranked.items[2].id === "r2", "off-category (variety) beats sold-out");
  ok(ranked.items[3].id === "r1", "sold-out ranks last (can't be added to a cart)");

  // --- determinism + limit + self-exclusion ---
  const many = Array.from({ length: 12 }, (_, i) => mk(`m${i}`, { vendor: "V", priceMinorUnits: 1000 + i }));
  const capped = selectRelatedItems(mk("mx", { vendor: "V", priceMinorUnits: 1000 }), [...many]);
  ok(capped.items.length === 8, "default limit 8");
  const again = selectRelatedItems(mk("mx", { vendor: "V", priceMinorUnits: 1000 }), [...many].reverse());
  ok(capped.items.map((i) => i.id).join(",") === again.items.map((i) => i.id).join(","),
    "deterministic regardless of input order");
  ok(!capped.items.some((i) => i.id === "mx"), "the viewed item never appears in its own rail");
  const limited = selectRelatedItems(mk("mx", { vendor: "V" }), many, 3);
  ok(limited.items.length === 3, "custom limit respected");

  console.log(`related-products-core: ${passed} passed, 0 failed`);
}
