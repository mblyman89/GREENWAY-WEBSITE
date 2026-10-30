/**
 * src/lib/inventory/lot-size-link-core.ts  (R74 S30, owner round 13)
 *
 * "Build the enhancement ... matching the size to the price ... I need full
 * control of Cultivera's products while I am onboarding them."
 *
 * A Cultivera card can carry several sizes, and one size (one menu_variants
 * row) is ONE price shared by every lot that sells as that size. Once a lot
 * is linked to its size (inventory_lots.menu_source_variant_id, migration
 * 0294) the lot page can read and set that size's price without onboarding.
 * This core holds the rules that make that safe:
 *
 *   1. sharedSizeFloor: a size price is shared, so the legal floor (cost +
 *      tax, RCW 69.50.357 / WAC 314-55-155) is the HIGHEST floor among the
 *      active lots that sell as that size, not just the lot being viewed.
 *      Otherwise pricing from a $5 lot could put an $8 lot of the same size
 *      below cost.
 *   2. checkOwnerSizePick: the owner may link a lot to a size only when the
 *      size is one of the lot's own card's sizes (never a size of another
 *      product, never a typed id).
 *   3. priceScopeNote: the owner is told exactly what a save changes.
 *
 * Pure: no DB, no env. Self-tests: __runLotSizeLinkCoreTests().
 */
import { afterTaxFloorMinor, fmtUsd } from "@/lib/inventory/price-correction-core";

export type SizeLot = {
  id: string;
  lot_code?: string | null;
  product_name?: string | null;
  unit_cost_minor_units?: number | null;
};

export type SharedFloor = {
  /** The highest cost + tax floor among the lots (null when no lot has a cost). */
  floorMinor: number | null;
  /** The lot that sets it (for the owner's message). */
  lotId: string | null;
  lotLabel: string | null;
  /** How many lots share the size. */
  lotCount: number;
  /** Lots with no usable cost (the floor cannot cover them). */
  costUnknown: number;
};

/** The legal floor for a price shared by `lots` (category = the card's website category). */
export function sharedSizeFloor(lots: readonly SizeLot[], category: string | null | undefined): SharedFloor {
  let best: { floor: number; lot: SizeLot } | null = null;
  let costUnknown = 0;
  const seen = new Set<string>();
  for (const lot of lots) {
    if (!lot || !lot.id || seen.has(lot.id)) continue;
    seen.add(lot.id);
    const floor = afterTaxFloorMinor(lot.unit_cost_minor_units ?? null, category);
    if (floor == null) {
      costUnknown += 1;
      continue;
    }
    if (!best || floor > best.floor) best = { floor, lot };
  }
  return {
    floorMinor: best ? best.floor : null,
    lotId: best ? best.lot.id : null,
    lotLabel: best ? (best.lot.lot_code?.trim() || best.lot.product_name?.trim() || best.lot.id) : null,
    lotCount: seen.size,
    costUnknown,
  };
}

/**
 * Refuse a price below the shared floor. The single-lot floor check already
 * ran in parsePriceCorrection; this adds the sibling lots. Null = allowed.
 */
export function sharedFloorRefusal(afterTaxMinor: number, floor: SharedFloor, sizeLabel: string): string | null {
  // Phase 4b (G-32 item 9, owner D49: "blocked until the manifest cost is
  // entered."): a lot that shares this price with no cost on file could be
  // sold below cost, so the shared price is refused until its cost is entered.
  if (floor.costUnknown > 0) {
    return (
      `Blocked: ${floor.costUnknown} lot(s) that share the ${sizeLabel} price have no cost on file, so the legal minimum can't be checked for them. ` +
      `Enter their cost from the vendor's CCRS manifest first, then set the price.`
    );
  }
  if (floor.floorMinor == null || afterTaxMinor >= floor.floorMinor) return null;
  return (
    `Blocked: ${fmtUsd(afterTaxMinor)} is below the legal minimum of ${fmtUsd(floor.floorMinor)} for the ${sizeLabel} size. ` +
    `This price is shared by ${floor.lotCount} lot(s), and lot ${floor.lotLabel ?? "?"} costs more, so its cost + tax sets the floor ` +
    `(Washington law forbids selling below acquisition cost). Enter ${fmtUsd(floor.floorMinor)} or higher.`
  );
}

export type CardSizeOption = { sourceVariantId: string; label: string; priceMinor: number; medical: boolean };

export type OwnerSizePick =
  | { ok: true; sourceVariantId: string; option: CardSizeOption }
  | { ok: false; error: string };

/** The owner's size pick must be one of THIS lot's card's sizes, exactly once. */
export function checkOwnerSizePick(raw: string | null | undefined, options: readonly CardSizeOption[]): OwnerSizePick {
  const id = (raw ?? "").trim();
  if (!id) return { ok: false, error: "Pick the size this lot sells as." };
  const hits = options.filter((o) => o.sourceVariantId === id);
  if (hits.length === 0) {
    return { ok: false, error: "That size is not on this product's menu card any more. Reload the page and pick again." };
  }
  if (hits.length > 1) {
    return { ok: false, error: "This menu card lists that size twice, so the pick is ambiguous. Fix the card's sizes first." };
  }
  return { ok: true, sourceVariantId: id, option: hits[0] };
}

/** One size as the owner reads it: "3.5g · $30.00" (+ " · medical"). */
export function sizeOptionLabel(o: CardSizeOption): string {
  const parts = [o.label && o.label !== "each" ? o.label : "each", o.priceMinor > 0 ? fmtUsd(o.priceMinor) : "no price yet"];
  if (o.medical) parts.push("medical");
  return parts.join(" · ");
}

/** What a price save on the lot page changes, in the owner's words. */
export function priceScopeNote(kind: "linked" | "onboarded" | "single-card", sizeLabel: string, lotCount: number): string {
  const size = sizeLabel && sizeLabel !== "each" ? `the ${sizeLabel} size` : "this product";
  const lots = lotCount > 1 ? ` It is one menu price, shared by all ${lotCount} lots that sell as ${size === "this product" ? "it" : sizeLabel}.` : "";
  if (kind === "linked") return `Saving changes the price of ${size} on the menu card.${lots} Other sizes keep their prices.`;
  if (kind === "single-card") return `Saving changes this product's menu price (its card has one size).${lots}`;
  return `Saving changes this product's menu price.${lots}`;
}

/* ── Self-tests ───────────────────────────────────────────────────────── */

export function __runLotSizeLinkCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error("FAIL lot-size-link-core:", msg);
    }
  };

  // sharedSizeFloor
  {
    const f = sharedSizeFloor(
      [
        { id: "a", lot_code: "GF1", unit_cost_minor_units: 500 },
        { id: "b", lot_code: "GF2", unit_cost_minor_units: 800 },
        { id: "c", lot_code: "GF3", unit_cost_minor_units: null },
        { id: "b", lot_code: "GF2", unit_cost_minor_units: 800 },
      ],
      "flower",
    );
    ok(f.floorMinor === afterTaxFloorMinor(800, "flower"), "floor is the highest lot's cost + tax");
    ok(f.lotId === "b" && f.lotLabel === "GF2", "names the lot that sets the floor");
    ok(f.lotCount === 3, "duplicate lot rows count once");
    ok(f.costUnknown === 1, "counts lots with no cost");
    const none = sharedSizeFloor([{ id: "x", unit_cost_minor_units: 0 }], "flower");
    ok(none.floorMinor === null && none.lotId === null && none.costUnknown === 1, "no usable cost -> no floor");
    ok(sharedSizeFloor([], "flower").lotCount === 0, "empty -> zero lots");
    const merch = sharedSizeFloor([{ id: "m", unit_cost_minor_units: 1000 }], "merch");
    ok(merch.floorMinor === afterTaxFloorMinor(1000, "merch"), "merch uses the merch divisor");
    const label = sharedSizeFloor([{ id: "z", product_name: " Name ", unit_cost_minor_units: 100 }], "flower");
    ok(label.lotLabel === "Name", "falls back to the product name");
  }

  // sharedFloorRefusal
  {
    const f = sharedSizeFloor([{ id: "a", lot_code: "GF1", unit_cost_minor_units: 1000 }], "flower");
    const floor = f.floorMinor!;
    ok(sharedFloorRefusal(floor, f, "3.5g") === null, "exactly the floor is allowed");
    const msg = sharedFloorRefusal(floor - 1, f, "3.5g");
    ok(msg !== null && msg.includes("3.5g") && msg.includes("GF1") && msg.includes("Blocked"), "below the floor is refused with the size and lot");
    ok(sharedFloorRefusal(1, sharedSizeFloor([], "flower"), "1g") === null, "no floor -> nothing to refuse here");
    const mixed = sharedSizeFloor([{ id: "a", unit_cost_minor_units: 1000 }, { id: "b", unit_cost_minor_units: null }], "flower");
    ok(/no cost on file/.test(sharedFloorRefusal(99999, mixed, "1g") ?? ""), "a sharing lot with no cost refuses the price (D49)");
  }

  // checkOwnerSizePick
  {
    const opts: CardSizeOption[] = [
      { sourceVariantId: "K-1g", label: "1g", priceMinor: 1200, medical: false },
      { sourceVariantId: "K-3g", label: "3.5g", priceMinor: 3000, medical: false },
    ];
    const good = checkOwnerSizePick(" K-3g ", opts);
    ok(good.ok && good.sourceVariantId === "K-3g" && good.option.label === "3.5g", "a size on the card is accepted (trimmed)");
    ok(!checkOwnerSizePick("", opts).ok, "blank pick refused");
    ok(!checkOwnerSizePick(null, opts).ok, "null pick refused");
    const other = checkOwnerSizePick("OTHER-1g", opts);
    ok(!other.ok && other.error.includes("not on this product"), "a size of another product is refused");
    const dup = checkOwnerSizePick("K-1g", [...opts, { ...opts[0] }]);
    ok(!dup.ok && dup.error.includes("twice"), "a doubled size is refused");
  }

  // labels and scope
  {
    ok(sizeOptionLabel({ sourceVariantId: "x", label: "3.5g", priceMinor: 3000, medical: false }) === "3.5g · $30.00", "size label");
    ok(sizeOptionLabel({ sourceVariantId: "x", label: "", priceMinor: 0, medical: true }) === "each · no price yet · medical", "blank label, no price, medical");
    const linked = priceScopeNote("linked", "3.5g", 4);
    ok(linked.includes("the 3.5g size") && linked.includes("all 4 lots") && linked.includes("Other sizes keep"), "linked scope names the size and shared lots");
    ok(!priceScopeNote("linked", "3.5g", 1).includes("shared"), "one lot -> no shared sentence");
    ok(priceScopeNote("single-card", "each", 2).includes("one size"), "single-card scope");
    ok(priceScopeNote("onboarded", "each", 1) === "Saving changes this product's menu price.", "onboarded scope");
  }

  return { passed, failed };
}
