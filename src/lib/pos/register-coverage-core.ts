/**
 * src/lib/pos/register-coverage-core.ts   (SLICE R-COVER, pure)
 *
 * Owner, verbatim: "i am finding several products that we are unable to find
 * on the front register, despite them being active, with quantity available
 * and such, so they should be sellable. please help me fix this so all the
 * items in my back office inventory table are sellable on the register ...
 * we need to be able to sell everything, especially if it can be found in the
 * back office inventory."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS PROVEN (code-grounded; see docs/slice-register-sell-all-back-office-stock.md)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. IMPORTER-HIDDEN CARDS. The Cultivera import hides every card whose row
 *     has no Products-workbook master (`no_product_master`, transform.ts) or
 *     no inventory (`no_inventory`). That is a WEBSITE-listing decision made by
 *     a machine, not a person, yet `/api/pos/menu` treated `hidden` as a human
 *     "do not sell" and dropped the card, its sizes AND its barcodes. Every
 *     active, stocked lot under such a card was invisible at the counter.
 *     (missing-product-master-core measured 771 such cards / 8,012 units.)
 *
 *  2. STALE "0 LEFT". A card the snapshot still called in-stock shipped each
 *     size's cached `menu_variants.inventory_level`. Cycle counts, intake
 *     adjustments and dispositions move `inventory_lots.on_hand_qty` but not
 *     that cache, so a size with real stock could ship `unitsLeft: 0` - the
 *     tile greys out and a SCAN was silently swallowed (addToCart clamps a
 *     known 0 to no line, and the scan paths showed no message).
 *
 *  3. SEARCH. The register's search only looked at the card name, brand,
 *     category and size. The back office shows the LOT's product name (the
 *     Cultivera name), so typing what is on the inventory table found nothing
 *     whenever the card was renamed / rolled up.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CORE DECIDES (and the gates it never touches)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - classifyHiddenCard: may a HIDDEN card be rung up at the register (never
 *    the website)? SUPERSEDED by register-sell-hidden-and-held-stock (owner:
 *    "its in the inventory list, it needs to scan on the registers, no
 *    exceptions"): ANY hide reason now sells when the card's category is a
 *    cannabis limit category and a size is priced. Original rule, for the
 *    record: only when the hide is the importer's own
 *    (no_product_master / no_inventory) AND the card sits on a real cannabis
 *    category (one that has a WAC 314-55-095 limit bucket) AND its Cultivera
 *    category is an explicitly mapped one (so a `needs_category` hold that an
 *    earlier importer reason masked can never slip through under the
 *    "paraphernalia" placeholder - no excise, no limit) AND it has a priced
 *    size. A PERSON's hide (owner, owner_override_hide:, reviewer_rejected),
 *    a category hold, and any reason this file does not know stay hidden.
 *    The route additionally requires live, active stock.
 *
 *  - attributeLotsToVariants / variantUnitsLeft: per-size units from LIVE
 *    lots, attributed with the same order the price + decrement paths use
 *    (lot size link -> `${key}-onboarded` size -> single-size card). If any
 *    stocked lot cannot be attributed (multi-size card, no link) the counts
 *    are UNKNOWN (null) - never a guessed number and never a stale 0.
 *
 *  - registerSearchText: the extra words a budtender may type (the lot's own
 *    product names and the strain), deduplicated and capped so the cached
 *    bundle stays small.
 *
 * Recall holds, lot status, expired hard-blocks, trade samples and held
 * (destruction) units are enforced by the caller exactly as before - this core
 * only ever ADDS sellability or replaces a cached count with a proven one.
 *
 * PURE: no I/O. Self-tests at the bottom (run-pure-selftests.ts).
 */
import { categoryToBucket } from "@/lib/compliance/sales-limits-core";
import { isNonCannabisCategory } from "@/lib/orders/order-pricing-core";
import { INVENTORY_TYPE_CATALOG } from "@/lib/pos/inventory-type-catalog";
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";

// ---------------------------------------------------------------------------
// Hidden-card classification
// ---------------------------------------------------------------------------

/**
 * The hide reasons the Cultivera importer writes on its own (transform.ts:930
 * `no_product_master`, transform.ts:993 `no_inventory`). Nothing else.
 */
export const IMPORTER_HIDE_REASONS: ReadonlySet<string> = new Set(["no_product_master", "no_inventory"]);

export type HiddenHoldCode =
  /** A person hid it: owner, owner override, reviewer rejection, or no reason. */
  | "human_hide"
  /** The importer is waiting for a person to pick the category. */
  | "needs_category"
  /** Card category is not a cannabis category with a sales-limit bucket. */
  | "non_cannabis_category"
  /** Its Cultivera category is not an explicitly mapped one (possible masked needs_category). */
  | "unmapped_category"
  /** No size has a price above $0 - nothing verified to charge. */
  | "no_price";

export type HiddenVerdict =
  | { kind: "visible" }
  | { kind: "register_eligible"; reason: string; message: string }
  | { kind: "held"; code: HiddenHoldCode; message: string };

/** Minimal card facts the classification needs. */
export type CoverageCardFacts = {
  hidden: boolean;
  hiddenReason?: string | null;
  /** The card's website category slug (menu_items.category). */
  category: string | null | undefined;
  /** The raw Cultivera category the importer saw (menu_items.pos_inventory_category). */
  posInventoryCategory?: string | null;
  /** Prices of the card's sizes, tax-inclusive cents. */
  variantPrices: readonly number[];
};

function squash(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

const MAPPED_CULTIVERA_CATEGORIES: ReadonlySet<string> = new Set(INVENTORY_TYPE_CATALOG.map((e) => squash(e.label)));

/**
 * Is this raw Cultivera category one the importer maps EXPLICITLY (the same
 * exact-key test as transform.ts knownCategory over CATEGORY_MAP, which
 * INVENTORY_TYPE_CATALOG mirrors)? When true the importer did NOT hold the
 * card for a category pick, so the card's category is a real mapping.
 */
export function isMappedCultiveraCategory(raw: string | null | undefined): boolean {
  const key = squash(raw);
  if (!key || isNonCannabisCategory(key)) return false;
  return MAPPED_CULTIVERA_CATEGORIES.has(key);
}

/** Does this website category carry cannabis taxes + a statutory limit bucket? */
export function isSellableCannabisCategory(category: string | null | undefined): boolean {
  const c = squash(category).toLowerCase();
  if (!c || isNonCannabisCategory(c)) return false;
  return categoryToBucket(c) !== null;
}

/**
 * May the register ring up this card? Visible cards: always (unchanged).
 * Hidden cards: only an importer hide on a safe, mapped, priced cannabis card.
 * The caller must ALSO require live active stock before serving it.
 */
export function classifyHiddenCard(card: CoverageCardFacts): HiddenVerdict {
  if (!card.hidden) return { kind: "visible" };
  const reason = squash(card.hiddenReason);
  // register-sell-hidden-and-held-stock - the owner, verbatim: "its in the
  // inventory list, it needs to scan on the registers, no exceptions."
  // A website hide (a person's, the importer's, or a category hold) no longer
  // keeps stocked product off the REGISTER. Only two facts still do, because
  // without them the sale itself would be wrong, not just unlisted:
  //   - non-cannabis category: it would ring with no excise and no purchase
  //     limit (an under-taxed cannabis sale);
  //   - no priced size: there is nothing to charge (RCW 69.50.357, never free).
  if (!isSellableCannabisCategory(card.category)) {
    return {
      kind: "held",
      code: "non_cannabis_category",
      message: "Hidden, and its category is not a cannabis category with a purchase limit, so it cannot be rung as cannabis. Pick its category.",
    };
  }
  if (!card.variantPrices.some((p) => Number.isSafeInteger(p) && p > 0)) {
    return {
      kind: "held",
      code: "no_price",
      message: "Hidden, and no size has a price, so there is nothing to charge. Set a price.",
    };
  }
  return {
    kind: "register_eligible",
    reason,
    message: IMPORTER_HIDE_REASONS.has(reason)
      ? "Sold at the register from its imported price. It stays off the website because the import hid it - fix the product so the website shows it too."
      : reason === "needs_category"
        ? "Sold at the register under its current category. It stays off the website until someone confirms its category."
        : "Sold at the register. It stays off the website because it was hidden there - un-hide it on the product page to list it online too.",
  };
}

// ---------------------------------------------------------------------------
// Live per-size units
// ---------------------------------------------------------------------------

export type CoverageLot = {
  posProductKey: string | null;
  status: string | null;
  /** Sellable units (on hand minus held), possibly a numeric string. */
  onHandQty: number | string | null;
  productName?: string | null;
  lotCode?: string | null;
  /** inventory_lots.menu_source_variant_id (migration 0294) - the size this lot sells as. */
  sizeId?: string | null;
};

export type CoverageVariant = { id: string };

export type LotAttribution = {
  /** Units per variant id from lots that resolve to exactly one size. */
  byVariant: Map<string, number>;
  /** Units in stocked lots that could not be pinned to one size. */
  ambiguousUnits: number;
  /** Distinct lot product names seen on this card's stocked lots. */
  lotNames: string[];
};

function qtyOf(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Attribute every ACTIVE, STOCKED lot under this card's keys to one size.
 * Order (lot-live-price-core / sale-decrement-core): the lot's own size link
 * when that size is on this card -> the `${lotKey}-onboarded` size -> the
 * card's only size. Anything else is ambiguous, never guessed.
 */
export function attributeLotsToVariants(
  lotKeys: readonly string[],
  variants: readonly CoverageVariant[],
  lotsByKey: ReadonlyMap<string, readonly CoverageLot[]>,
): LotAttribution {
  const byVariant = new Map<string, number>();
  let ambiguousUnits = 0;
  const names = new Map<string, string>();
  const variantIds = new Set(variants.map((v) => v.id));
  const onboardedByKey = new Map<string, string>();
  for (const v of variants) {
    const k = lotKeyFromVariantId(v.id);
    if (k) onboardedByKey.set(k, v.id);
  }
  const seenKeys = new Set<string>();
  for (const rawKey of lotKeys) {
    const key = squash(rawKey);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    for (const lot of lotsByKey.get(key) ?? []) {
      // register-sell-sold-out-stock: Sold out lots count like Active ones.
      // register-sell-everything-fix-later: so do Quarantine lots.
      const st = squash(lot.status).toLowerCase();
      if (st !== "active" && st !== "sold_out" && st !== "quarantine") continue;
      const units = qtyOf(lot.onHandQty);
      if (units <= 0) continue;
      const nm = squash(lot.productName);
      if (nm && !names.has(nm.toLowerCase())) names.set(nm.toLowerCase(), nm);
      const linked = squash(lot.sizeId);
      let target: string | null = null;
      if (linked && variantIds.has(linked)) target = linked;
      else if (onboardedByKey.has(key)) target = onboardedByKey.get(key)!;
      else if (variants.length === 1) target = variants[0].id;
      if (target) byVariant.set(target, (byVariant.get(target) ?? 0) + units);
      else ambiguousUnits += units;
    }
  }
  return { byVariant, ambiguousUnits, lotNames: [...names.values()] };
}

/**
 * The `unitsLeft` the register should show for one size.
 *  - live units proven for this size  -> that whole number;
 *  - live says 0 AND the cached level also says 0 AND nothing is ambiguous
 *    -> 0 (both counters agree it is empty);
 *  - anything else -> null (unknown). Never a stale 0, never a guess.
 */
export function variantUnitsLeft(
  attribution: LotAttribution,
  variantId: string,
  cachedLevel: number | null,
): number | null {
  if (attribution.ambiguousUnits > 0) return null;
  const live = Math.floor(attribution.byVariant.get(variantId) ?? 0);
  if (live > 0) return live;
  if (cachedLevel === 0) return 0;
  return null;
}

// ---------------------------------------------------------------------------
// Search words
// ---------------------------------------------------------------------------

/** Bundle-size guard: the extra search words per register line. */
export const SEARCH_TEXT_MAX = 160;

/**
 * Extra words the register's search should match for a card: its lot product
 * names (what the back office table shows) and its strain, minus anything the
 * card name already contains. Undefined when there is nothing to add.
 */
export function registerSearchText(
  cardName: string,
  lotNames: readonly string[],
  strainName?: string | null,
): string | undefined {
  const base = squash(cardName).toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...lotNames, strainName ?? ""]) {
    const s = squash(raw);
    const low = s.toLowerCase();
    if (!s || seen.has(low) || base.includes(low)) continue;
    seen.add(low);
    out.push(s);
  }
  if (out.length === 0) return undefined;
  const text = out.join(" | ");
  return text.length > SEARCH_TEXT_MAX ? text.slice(0, SEARCH_TEXT_MAX) : text;
}

/** Group lots by trimmed key (blank keys dropped). */
export function lotsByProductKey<T extends { posProductKey: string | null }>(lots: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of lots) {
    const k = squash(l.posProductKey);
    if (!k) continue;
    const arr = m.get(k);
    if (arr) arr.push(l);
    else m.set(k, [l]);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runRegisterCoverageCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL register-coverage-core:", msg);
    }
  };
  const facts = (over: Partial<CoverageCardFacts> = {}): CoverageCardFacts => ({
    hidden: true,
    hiddenReason: "no_product_master",
    category: "flower",
    posInventoryCategory: "Flower",
    variantPrices: [2500],
    ...over,
  });

  // ── classification ─────────────────────────────────────────────────────
  ok(classifyHiddenCard(facts({ hidden: false })).kind === "visible", "visible card is visible");
  ok(classifyHiddenCard(facts()).kind === "register_eligible", "importer no_product_master flower is register-eligible");
  ok(classifyHiddenCard(facts({ hiddenReason: "no_inventory" })).kind === "register_eligible", "no_inventory eligible");
  ok(classifyHiddenCard(facts({ hiddenReason: "  no_product_master " })).kind === "register_eligible", "reason trimmed");
  for (const r of ["owner", "reviewer_rejected", "owner_override_hide:no_product_master", "owner_override_hide:", "", null, "something_new", "needs_category"]) {
    const v = classifyHiddenCard(facts({ hiddenReason: r }));
    ok(v.kind === "register_eligible", `reason ${String(r)}: stocked + priced cannabis sells at the register`);
  }
  for (const c of ["paraphernalia", "accessories", "merch", "accessory", "", "unknown-thing"]) {
    const v = classifyHiddenCard(facts({ category: c }));
    ok(v.kind === "held" && v.code === "non_cannabis_category", `category ${c} never rung as cannabis`);
  }
  {
    // Cultivera category no longer gates the register (owner: "no exceptions");
    // the CARD's category still decides excise + limits.
    ok(classifyHiddenCard(facts({ posInventoryCategory: "Mystery Stuff" })).kind === "register_eligible", "unmapped Cultivera category sells");
    ok(classifyHiddenCard(facts({ posInventoryCategory: "" })).kind === "register_eligible", "blank Cultivera category sells");
    ok(classifyHiddenCard(facts({ hiddenReason: "owner_override_hide:", category: "accessories" })).kind === "held", "non-cannabis card category still held");
  }
  {
    const v = classifyHiddenCard(facts({ variantPrices: [0] }));
    ok(v.kind === "held" && v.code === "no_price", "unpriced card held");
    ok(classifyHiddenCard(facts({ variantPrices: [] })).kind === "held", "no sizes held");
    ok(classifyHiddenCard(facts({ variantPrices: [0, 1500] })).kind === "register_eligible", "one priced size suffices");
  }
  for (const c of ["preroll", "concentrate", "cartridge", "edible-solid", "edible-liquid", "topical", "infused-preroll", "popcorn-bud"]) {
    ok(isSellableCannabisCategory(c), `${c} is a cannabis limit category`);
  }
  ok(isMappedCultiveraCategory("Flower") && !isMappedCultiveraCategory("flower "+"x"), "mapped category exact");

  // ── attribution ────────────────────────────────────────────────────────
  const L = (over: Partial<CoverageLot> = {}): CoverageLot => ({ posProductKey: "K", status: "active", onHandQty: 5, ...over });
  {
    const a = attributeLotsToVariants(["K"], [{ id: "K-abc" }], lotsByProductKey([L(), L({ onHandQty: "3" })]));
    ok(a.byVariant.get("K-abc") === 8 && a.ambiguousUnits === 0, "single-size card takes every lot");
    ok(variantUnitsLeft(a, "K-abc", 0) === 8, "stale cached 0 replaced by live 8");
  }
  {
    const a = attributeLotsToVariants(["K"], [{ id: "K-1g" }, { id: "K-3g" }], lotsByProductKey([L()]));
    ok(a.ambiguousUnits === 5, "multi-size unlinked lot is ambiguous");
    ok(variantUnitsLeft(a, "K-1g", 0) === null && variantUnitsLeft(a, "K-3g", 7) === null, "ambiguous -> unknown, never a guess");
  }
  {
    const a = attributeLotsToVariants(["K"], [{ id: "K-1g" }, { id: "K-3g" }], lotsByProductKey([L({ sizeId: "K-3g" }), L({ sizeId: "K-1g", onHandQty: 2 })]));
    ok(a.byVariant.get("K-3g") === 5 && a.byVariant.get("K-1g") === 2 && a.ambiguousUnits === 0, "size link attributes per size");
  }
  {
    const a = attributeLotsToVariants(["K"], [{ id: "K-1g" }, { id: "K-3g" }], lotsByProductKey([L({ sizeId: "GONE" })]));
    ok(a.ambiguousUnits === 5, "stale size link falls through to ambiguous");
  }
  {
    const a = attributeLotsToVariants(
      ["CARD", "LOT-A", "LOT-B"],
      [{ id: "LOT-A-onboarded" }, { id: "LOT-B-onboarded" }],
      lotsByProductKey([L({ posProductKey: "LOT-A", onHandQty: 4 }), L({ posProductKey: "LOT-B", onHandQty: 0 })]),
    );
    ok(a.byVariant.get("LOT-A-onboarded") === 4, "onboarded size takes its own lot");
    ok(variantUnitsLeft(a, "LOT-B-onboarded", 0) === 0, "both counters agree empty -> 0");
    ok(variantUnitsLeft(a, "LOT-B-onboarded", 6) === null, "counters disagree -> unknown");
  }
  {
    const a = attributeLotsToVariants(["K"], [{ id: "K-x" }], lotsByProductKey([L({ status: "recalled" }), L({ onHandQty: 0 }), L({ status: " Active ", onHandQty: "2.6" })]));
    ok(a.byVariant.get("K-x") === 2.6 && variantUnitsLeft(a, "K-x", null) === 2, "only sellable stocked lots count; whole units");
  }
  {
    const a = attributeLotsToVariants(["K", "K"], [{ id: "K-x" }], lotsByProductKey([L()]));
    ok(a.byVariant.get("K-x") === 5, "duplicate keys never double count");
  }

  // ── search words ───────────────────────────────────────────────────────
  {
    const a = attributeLotsToVariants(["K"], [{ id: "K-x" }], lotsByProductKey([L({ productName: "SPR - Sour Diesel 3.5g" }), L({ productName: "spr - sour diesel 3.5g" })]));
    ok(a.lotNames.length === 1, "lot names deduplicated case-insensitively");
    const t = registerSearchText("Sour Diesel", a.lotNames, "Sour Diesel");
    ok(t === "SPR - Sour Diesel 3.5g", "strain already in name dropped; lot name kept");
    ok(registerSearchText("Blue Dream", [], null) === undefined, "nothing to add -> undefined");
    ok((registerSearchText("A", ["x".repeat(400)]) ?? "").length === SEARCH_TEXT_MAX, "capped");
  }

  return { passed, failed };
}
