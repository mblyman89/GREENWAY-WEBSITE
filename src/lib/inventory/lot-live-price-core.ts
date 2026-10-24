/**
 * src/lib/inventory/lot-live-price-core.ts  (R74 S24, owner round 11)
 *
 * "On the inventory page, the table does not show all of the data in the
 * columns even though it exists in the detail. I am referring to the price
 * column." The lot page shows the LIVE published price of the lot's own menu
 * variant (price-write-store getLotAfterTaxPrice -> resolveLotVariant). The
 * table showed only the price approved at Product Onboarding, which a
 * Cultivera-imported lot never has, so its Price, Margin and Ext. retail were
 * blank while the lot page showed a real price.
 *
 * This core makes the table read the SAME price, decided by the SAME rule:
 *   1. the intake variant `${key}-onboarded` when one exists;
 *   2. else the single variant of the card whose source_item_id === key;
 *   3. a multi-variant card with no -onboarded id is "ambiguous": no price
 *      (the lot page refuses it too; never guess a price).
 * The live price wins over the onboarding price (a later price correction
 * changes the menu, not the old draft). With no live price, the onboarding
 * price is the fallback, labelled as such.
 *
 * Pure: no DB, no env. The loader is lot-live-price-server.ts.
 */
import { resolveLotVariant, ONBOARDED_VARIANT_SUFFIX, type VariantCandidate } from "@/lib/inventory/price-variant-match-core";
import { lotMarginPct } from "@/lib/inventory/lot-onboarding-core";
import { afterTaxFloorMinor, baseFromAfterTax } from "@/lib/inventory/price-correction-core";

/** A published-menu card (menu_items row) reduced to what the rule needs. */
export type PriceCard = { id: string; source_item_id: string | null };
/** A published-menu variant (menu_variants row) reduced to what the rule needs. */
export type PriceVariant = { id: string; menu_item_id: string; source_variant_id: string | null; price_minor_units: number | null };

export type LivePrice =
  | { kind: "linked" | "onboarded" | "single-card"; priceMinor: number }
  | { kind: "ambiguous"; variantCount: number };

/**
 * R74 S30: a lot as the price index sees it: its card key plus, when the lot
 * is linked to a size (inventory_lots.menu_source_variant_id, 0294), that
 * size. A bare string is a key with no link (the pre-S30 shape).
 */
export type LotPriceRef = string | null | undefined | { key: string | null | undefined; linked?: string | null };

/**
 * The index entry for one lot. An unlinked lot's entry is its key, exactly as
 * before S30 (so every existing reader keeps working); a linked lot's entry
 * also names its size, so two sizes of one card get two prices.
 */
export function livePriceIndexKey(key: string | null | undefined, linked?: string | null): string {
  const k = (key ?? "").trim();
  const l = (linked ?? "").trim();
  return l ? `${k}\u0000${l}` : k;
}

function refParts(ref: LotPriceRef): { key: string; linked: string } {
  if (ref && typeof ref === "object") return { key: (ref.key ?? "").trim(), linked: (ref.linked ?? "").trim() };
  return { key: (ref ?? "").trim(), linked: "" };
}

/**
 * Resolve the live price for every lot ref at once. Refs with no card and no
 * -onboarded variant are simply absent (not on the published menu).
 * A variant with no usable price (null, NaN, <= 0) yields no price.
 */
export function buildLivePriceIndex(
  keys: ReadonlyArray<LotPriceRef>,
  cards: readonly PriceCard[],
  variants: readonly PriceVariant[],
): Map<string, LivePrice> {
  const out = new Map<string, LivePrice>();
  const cardsByKey = new Map<string, string[]>();
  for (const c of cards) {
    const k = (c.source_item_id ?? "").trim();
    if (!k) continue;
    const list = cardsByKey.get(k) ?? [];
    list.push(c.id);
    cardsByKey.set(k, list);
  }
  const variantsByItem = new Map<string, PriceVariant[]>();
  const variantsBySourceId = new Map<string, PriceVariant[]>();
  const byId = new Map<string, PriceVariant>();
  for (const v of variants) {
    byId.set(v.id, v);
    const li = variantsByItem.get(v.menu_item_id) ?? [];
    li.push(v);
    variantsByItem.set(v.menu_item_id, li);
    const sid = (v.source_variant_id ?? "").trim();
    if (sid) {
      const ls = variantsBySourceId.get(sid) ?? [];
      ls.push(v);
      variantsBySourceId.set(sid, ls);
    }
  }
  const seen = new Set<string>();
  for (const raw of keys) {
    const { key, linked } = refParts(raw);
    const entry = livePriceIndexKey(key, linked);
    if (!key || seen.has(entry)) continue;
    seen.add(entry);
    const onboarded: VariantCandidate[] = variantsBySourceId.get(`${key}${ONBOARDED_VARIANT_SUFFIX}`) ?? [];
    const cardVariants: VariantCandidate[] = (cardsByKey.get(key) ?? []).flatMap((id) => variantsByItem.get(id) ?? []);
    const decision = resolveLotVariant(key, onboarded, cardVariants, linked || null);
    if (decision.kind === "ambiguous") {
      out.set(entry, { kind: "ambiguous", variantCount: decision.variantCount });
      continue;
    }
    if (decision.kind === "none") continue;
    const price = byId.get(decision.variantId)?.price_minor_units;
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    out.set(entry, { kind: decision.kind, priceMinor: price });
  }
  return out;
}

export type ShelfPriceSource = "menu" | "onboarding";

export type ShelfPrice = {
  priceMinor: number | null;
  source: ShelfPriceSource | null;
  /** True when the card has several sizes and no lot-specific variant. */
  ambiguous: boolean;
};

/** Live menu price first (what the lot page shows), else the onboarding price. */
export function effectiveShelfPrice(onboardingPriceMinor: number | null | undefined, live: LivePrice | null | undefined): ShelfPrice {
  const ambiguous = live?.kind === "ambiguous";
  if (live && live.kind !== "ambiguous") return { priceMinor: live.priceMinor, source: "menu", ambiguous: false };
  if (onboardingPriceMinor != null && Number.isFinite(onboardingPriceMinor) && onboardingPriceMinor > 0) {
    return { priceMinor: onboardingPriceMinor, source: "onboarding", ambiguous };
  }
  return { priceMinor: null, source: null, ambiguous };
}

/** The sub-line under the Price cell (and the export's Price source). */
export function shelfPriceSourceLabel(p: Pick<ShelfPrice, "source" | "ambiguous">): string | null {
  if (p.source === "menu") return "live menu";
  if (p.source === "onboarding") return p.ambiguous ? "onboarding (menu card has several sizes)" : "onboarding";
  if (p.ambiguous) return "menu card has several sizes";
  return null;
}

export type LotShelfPriceFields = {
  /** The price the table shows: the lot page's live price, else onboarding. */
  shelf_price_minor: number | null;
  shelf_price_source: ShelfPriceSource | null;
  shelf_price_ambiguous: boolean;
  /** Pre-tax margin on shelf_price_minor (same math as onboarding's). */
  shelf_margin_pct: number | null;
  /** Pre-tax base and legal cost+tax floor, as the lot page shows them. */
  shelf_pre_tax_minor: number | null;
  shelf_floor_minor: number | null;
};

type PriceableLot = {
  pos_product_key?: string | null;
  /** R74 S30 (0294): the lot's own menu size, when linked. */
  menu_source_variant_id?: string | null;
  onboarding_price_minor?: number | null;
  unit_cost_minor_units?: number | null;
  category?: string | null;
  website_category_value?: string | null;
};

/**
 * Attach the effective price to every lot (pure; input never mutated). The
 * tax category is the website category the lot page uses for its floor,
 * falling back to the lot's raw category.
 */
export function attachLotShelfPrice<L extends PriceableLot>(
  lots: readonly L[],
  index: ReadonlyMap<string, LivePrice>,
): Array<L & LotShelfPriceFields> {
  return lots.map((lot) => {
    const key = (lot.pos_product_key ?? "").trim();
    const p = effectiveShelfPrice(lot.onboarding_price_minor ?? null, key ? index.get(livePriceIndexKey(key, lot.menu_source_variant_id)) ?? null : null);
    const taxCategory = lot.website_category_value ?? lot.category ?? null;
    return {
      ...lot,
      shelf_price_minor: p.priceMinor,
      shelf_price_source: p.source,
      shelf_price_ambiguous: p.ambiguous,
      shelf_margin_pct: lotMarginPct(p.priceMinor, lot.unit_cost_minor_units ?? null, taxCategory),
      shelf_pre_tax_minor: p.priceMinor != null ? baseFromAfterTax(p.priceMinor, taxCategory) : null,
      shelf_floor_minor: afterTaxFloorMinor(lot.unit_cost_minor_units ?? null, taxCategory),
    };
  });
}

/* ── THCA / CBDA (the lot page's lab + Cultivera rows) ─────────────────── */

type AcidLot = {
  lab?: { thca_pct?: number | null; cbda_pct?: number | null } | null;
  pos_thca?: number | null;
  pos_cbda?: number | null;
};

const fin = (v: unknown): number | null => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * THCA and CBDA as the lot page shows them: the COA's percent first, else the
 * Cultivera export's figure. `source` says which (lab figures are always
 * percent; a POS figure uses the lot's potency unit).
 */
export function lotAcidFigures(l: AcidLot): { thca: number | null; cbda: number | null; source: "coa" | "pos" | null } {
  const labThca = fin(l.lab?.thca_pct);
  const labCbda = fin(l.lab?.cbda_pct);
  if (labThca != null || labCbda != null) return { thca: labThca, cbda: labCbda, source: "coa" };
  const posThca = fin(l.pos_thca);
  const posCbda = fin(l.pos_cbda);
  if (posThca != null || posCbda != null) return { thca: posThca, cbda: posCbda, source: "pos" };
  return { thca: null, cbda: null, source: null };
}

/* ── Compliance flags (the lot page reads the MENU row) ─────────────────── */

export type MenuFlags = {
  otherwiseTaken: boolean | null;
  unitsPerPackage: number | null;
  lowThcLiquid: boolean | null;
  unitThcMg: number | null;
};

type FlagLot = {
  pos_product_key?: string | null;
  otherwise_taken?: boolean | null;
  units_per_package?: number | null;
  low_thc_liquid?: boolean | null;
  unit_thc_mg?: number | null;
};

/**
 * The register enforces the classification on the MENU row, and the lot page
 * shows that one. A menu answer wins; a null menu value is silence, so the
 * lot's own answer shows. Pure; input never mutated.
 */
export function attachMenuComplianceFlags<L extends FlagLot>(lots: readonly L[], flags: ReadonlyMap<string, MenuFlags>): L[] {
  return lots.map((lot) => {
    const key = (lot.pos_product_key ?? "").trim();
    const f = key ? flags.get(key) : undefined;
    if (!f) return lot;
    return {
      ...lot,
      otherwise_taken: f.otherwiseTaken ?? lot.otherwise_taken ?? null,
      units_per_package: f.unitsPerPackage ?? lot.units_per_package ?? null,
      low_thc_liquid: f.lowThcLiquid ?? lot.low_thc_liquid ?? null,
      unit_thc_mg: f.unitThcMg ?? lot.unit_thc_mg ?? null,
    };
  });
}

/**
 * R74 S24: the one composition the page AND the export loader apply to the
 * website-category result, so the table, sorts, totals and spreadsheet all
 * read the same price and flags. Keeps every other field of the result.
 */
export function attachLotParity<L extends PriceableLot & FlagLot, X extends object>(
  res: X & { lots: readonly L[] },
  prices: ReadonlyMap<string, LivePrice>,
  flags: ReadonlyMap<string, MenuFlags>,
): Omit<X, "lots"> & { lots: Array<L & LotShelfPriceFields> } {
  return { ...res, lots: attachMenuComplianceFlags(attachLotShelfPrice(res.lots, prices), flags) };
}

/* ── Self-tests ─────────────────────────────────────────────────────────── */

export function __runLotLivePriceCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error("FAIL lot-live-price-core:", msg);
    }
  };

  // buildLivePriceIndex
  {
    const cards: PriceCard[] = [
      { id: "c1", source_item_id: "K1" },
      { id: "c2", source_item_id: "K2" },
      { id: "c3", source_item_id: "K3" },
      { id: "c5", source_item_id: "K5" },
    ];
    const variants: PriceVariant[] = [
      { id: "v1", menu_item_id: "c1", source_variant_id: "x-abc", price_minor_units: 2500 },
      { id: "v2a", menu_item_id: "c2", source_variant_id: "y-1", price_minor_units: 1000 },
      { id: "v2b", menu_item_id: "c2", source_variant_id: "y-2", price_minor_units: 1800 },
      { id: "v3a", menu_item_id: "c3", source_variant_id: "z-1", price_minor_units: 900 },
      { id: "v3b", menu_item_id: "c3", source_variant_id: "K3-onboarded", price_minor_units: 1500 },
      { id: "v4", menu_item_id: "cX", source_variant_id: "K4-onboarded", price_minor_units: 3000 },
      { id: "v5", menu_item_id: "c5", source_variant_id: "q", price_minor_units: 0 },
    ];
    const idx = buildLivePriceIndex(["K1", "K2", "K3", "K4", "K5", "K6", "", null, "K1"], cards, variants);
    const k1 = idx.get("K1");
    ok(k1?.kind === "single-card" && k1.priceMinor === 2500, "single-variant import card -> its price");
    const k2 = idx.get("K2");
    ok(k2?.kind === "ambiguous" && k2.variantCount === 2, "multi-variant card with no -onboarded -> ambiguous");
    const k3 = idx.get("K3");
    ok(k3?.kind === "onboarded" && k3.priceMinor === 1500, "-onboarded variant beats the card's other sizes");
    const k4 = idx.get("K4");
    ok(k4?.kind === "onboarded" && k4.priceMinor === 3000, "-onboarded variant on a mastered sibling's card");
    ok(!idx.has("K5"), "a zero price is not a price");
    ok(!idx.has("K6"), "not on the menu -> absent");
    ok(idx.size === 4, "blank / null / duplicate keys ignored");
    ok(buildLivePriceIndex([" K1 "], cards, variants).get("K1")?.kind === "single-card", "keys trimmed");
    ok(buildLivePriceIndex(["K1"], [], []).size === 0, "empty menu -> empty index");
  }

  // effectiveShelfPrice / label
  {
    const live: LivePrice = { kind: "single-card", priceMinor: 2500 };
    const amb: LivePrice = { kind: "ambiguous", variantCount: 3 };
    const a = effectiveShelfPrice(1500, live);
    ok(a.priceMinor === 2500 && a.source === "menu", "live price beats the onboarding price");
    const b = effectiveShelfPrice(1500, null);
    ok(b.priceMinor === 1500 && b.source === "onboarding" && !b.ambiguous, "no live price -> onboarding");
    const c = effectiveShelfPrice(null, null);
    ok(c.priceMinor === null && c.source === null, "nothing -> null, never $0");
    const d = effectiveShelfPrice(1500, amb);
    ok(d.priceMinor === 1500 && d.source === "onboarding" && d.ambiguous, "ambiguous card -> onboarding fallback, flagged");
    const e = effectiveShelfPrice(0, amb);
    ok(e.priceMinor === null && e.ambiguous, "ambiguous and no onboarding -> null, flagged");
    ok(shelfPriceSourceLabel(a) === "live menu", "label live");
    ok(shelfPriceSourceLabel(b) === "onboarding", "label onboarding");
    ok(shelfPriceSourceLabel(d)!.includes("several sizes"), "label ambiguous fallback");
    ok(shelfPriceSourceLabel(e) === "menu card has several sizes", "label ambiguous only");
    ok(shelfPriceSourceLabel(c) === null, "label none");
  }

  // attachLotShelfPrice
  {
    const idx = new Map<string, LivePrice>([["K1", { kind: "single-card", priceMinor: 2926 }]]);
    const lots = [
      { id: "a", pos_product_key: "K1", onboarding_price_minor: null, unit_cost_minor_units: 1000, category: "Flower", website_category_value: "flower" },
      { id: "b", pos_product_key: "K9", onboarding_price_minor: 1463, unit_cost_minor_units: null, category: null, website_category_value: null },
      { id: "c", pos_product_key: null, onboarding_price_minor: null, unit_cost_minor_units: 500, category: "merch", website_category_value: null },
    ];
    const out = attachLotShelfPrice(lots, idx);
    ok(out[0].shelf_price_minor === 2926 && out[0].shelf_price_source === "menu", "import lot gets the live price");
    ok(out[0].shelf_margin_pct === 50, `margin on the live price (got ${out[0].shelf_margin_pct})`);
    ok(out[0].shelf_pre_tax_minor === 2000, "pre-tax base = price / 1.463");
    ok(out[0].shelf_floor_minor === 1463, "floor = ceil(cost x 1.463)");
    ok(out[1].shelf_price_minor === 1463 && out[1].shelf_price_source === "onboarding" && out[1].shelf_margin_pct === null, "onboarding fallback; no cost -> no margin");
    ok(out[2].shelf_price_minor === null && out[2].shelf_pre_tax_minor === null && out[2].shelf_floor_minor === 547, "no price; merch floor uses 1.093");
    ok(!("shelf_price_minor" in lots[0]), "input not mutated");
  }

  // lotAcidFigures
  {
    const coa = lotAcidFigures({ lab: { thca_pct: 24.1, cbda_pct: null }, pos_thca: 20 });
    ok(coa.thca === 24.1 && coa.cbda === null && coa.source === "coa", "COA first");
    const pos = lotAcidFigures({ lab: { thca_pct: null, cbda_pct: null }, pos_thca: 20, pos_cbda: 0.5 });
    ok(pos.thca === 20 && pos.cbda === 0.5 && pos.source === "pos", "else the Cultivera export");
    ok(lotAcidFigures({}).source === null, "nothing -> null");
  }

  // attachMenuComplianceFlags
  {
    const flags = new Map<string, MenuFlags>([["K1", { otherwiseTaken: true, unitsPerPackage: null, lowThcLiquid: false, unitThcMg: 10 }]]);
    const lots = [
      { id: "a", pos_product_key: "K1", otherwise_taken: null, units_per_package: 4, low_thc_liquid: true, unit_thc_mg: null },
      { id: "b", pos_product_key: "K2", otherwise_taken: null, units_per_package: null, low_thc_liquid: null, unit_thc_mg: null },
    ];
    const out = attachMenuComplianceFlags(lots, flags);
    ok(out[0].otherwise_taken === true && out[0].unit_thc_mg === 10, "menu answer fills the lot's silence");
    ok(out[0].low_thc_liquid === false, "menu answer wins over a contradicting lot answer (the register enforces it)");
    ok(out[0].units_per_package === 4, "menu silence keeps the lot answer");
    ok(out[1] === lots[1], "no menu row -> lot untouched");
    ok(lots[0].otherwise_taken === null, "input not mutated");
  }

  // attachLotParity
  {
    const res = { lots: [{ id: "a", pos_product_key: "K1", onboarding_price_minor: null, unit_cost_minor_units: null, otherwise_taken: null }], liveKeys: new Set(["K1"]), complete: true };
    const out = attachLotParity(res, new Map([["K1", { kind: "onboarded", priceMinor: 1999 } as LivePrice]]), new Map([["K1", { otherwiseTaken: true, unitsPerPackage: null, lowThcLiquid: null, unitThcMg: null }]]));
    ok(out.lots[0].shelf_price_minor === 1999 && out.lots[0].otherwise_taken === true, "parity attaches price and flags");
    ok(out.complete === true && out.liveKeys.has("K1"), "parity keeps the rest of the result");
  }

  // R74 S30: per-lot size link on a multi-size card
  {
    const cards: PriceCard[] = [{ id: "cM", source_item_id: "KM" }];
    const variants: PriceVariant[] = [
      { id: "m1", menu_item_id: "cM", source_variant_id: "KM-1g", price_minor_units: 1200 },
      { id: "m3", menu_item_id: "cM", source_variant_id: "KM-3g", price_minor_units: 3000 },
    ];
    const idx = buildLivePriceIndex(["KM", { key: "KM", linked: "KM-1g" }, { key: "KM", linked: "KM-3g" }, { key: "KM", linked: "KM-9g" }, { key: " KM ", linked: " KM-3g " }], cards, variants);
    ok(idx.get("KM")?.kind === "ambiguous", "unlinked lot on a multi-size card stays ambiguous");
    const l1 = idx.get(livePriceIndexKey("KM", "KM-1g"));
    const l3 = idx.get(livePriceIndexKey("KM", "KM-3g"));
    ok(l1?.kind === "linked" && l1.priceMinor === 1200, "1g lot reads the 1g price");
    ok(l3?.kind === "linked" && l3.priceMinor === 3000, "3g lot reads the 3g price");
    ok(idx.get(livePriceIndexKey("KM", "KM-9g"))?.kind === "ambiguous", "stale link falls back to ambiguous");
    ok(idx.size === 4, "trimmed duplicate ref collapses onto one entry");
    ok(livePriceIndexKey("KM", null) === "KM" && livePriceIndexKey(" KM ", "  ") === "KM", "unlinked index key is the bare key");
    const lots = attachLotShelfPrice(
      [
        { pos_product_key: "KM", menu_source_variant_id: "KM-3g", unit_cost_minor_units: 500, category: "flower" },
        { pos_product_key: "KM", menu_source_variant_id: null, onboarding_price_minor: 2222, unit_cost_minor_units: 500, category: "flower" },
      ],
      idx,
    );
    ok(lots[0].shelf_price_minor === 3000 && lots[0].shelf_price_source === "menu", "table row uses the lot's own size price");
    ok(lots[1].shelf_price_minor === 2222 && lots[1].shelf_price_ambiguous === true, "unlinked row keeps the old fallback");
  }

  return { passed, failed };
}
