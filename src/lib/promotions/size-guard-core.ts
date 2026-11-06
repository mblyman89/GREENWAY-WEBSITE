/**
 * src/lib/promotions/size-guard-core.ts  (D195 step 1: size-true promotions)
 *
 * Owner, 2026-11-07: "help me figure out why the promotions page is not
 * working correctly. i think it is not connected properly to the inventory
 * system." Finding (D195): the publish guard, the preview, the standing audit
 * and the bad-products queue checked one row per menu CARD: the card's display
 * price (the cheapest size on 158 of 193 multi-size cards) against the average
 * cost of EVERY lot of the card. At 50% off that produced 90 false blocks and
 * missed 31 cards where one size really goes under cost.
 *
 * The register never worked that way. /api/pos/menu prices each SIZE at its
 * own price and floors it at its own cost:
 *   (variantLotKey ? costs.get(variantLotKey) : undefined)
 *     ?? costForLine(costs, item.id, variant.id) ?? cardCost
 * This module gives every back-office check the same rows, so the page says
 * exactly what the register will do.
 *
 * PURE: no I/O. Self-tested via __runSizeGuardCoreTests().
 */
import type { BelowCostFinding, GuardProduct } from "./promo-guard-core";
import { costForLine } from "./size-cost-core";
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";

/** A published menu size reduced to what the guard needs. */
export type GuardSizeInput = {
  /** menu_variants.source_variant_id (what the register calls variant.id). */
  sourceVariantId: string;
  label: string | null;
  priceMinorUnits: number;
  sortOrder?: number | null;
};

/** A published card reduced to what the guard needs. */
export type GuardCardInput = {
  key: string;
  name: string;
  brand: string;
  categories: string[];
  priceMinorUnits: number;
  /** Absent or empty = a card with no sizes (sold at the card price). */
  sizes?: readonly GuardSizeInput[] | null;
};

/**
 * The cost a size is floored at: the register's exact rule (the intake size's
 * own lot key first, then the size's linked lots, then the card average).
 */
export function costForSize(
  costs: ReadonlyMap<string, number>,
  cardKey: string,
  sourceVariantId: string | null | undefined,
): number | null {
  const lotKey = lotKeyFromVariantId(sourceVariantId ?? null);
  const own = lotKey ? costs.get(lotKey) : undefined;
  if (own != null) return own;
  return costForLine(costs, cardKey, sourceVariantId ?? null);
}

/**
 * One guard row per SIZE (key stays the card key: exclusions, the
 * never-discount list and Hide all act on the product). A card with no sizes
 * keeps one row at the card price and the card cost (no size fields), so
 * every pre-D195 caller and test sees the same numbers.
 */
export function expandCardSizes(card: GuardCardInput, costs: ReadonlyMap<string, number>): GuardProduct[] {
  const sizes = (card.sizes ?? []).filter((s) => s && String(s.sourceVariantId ?? "").trim() !== "");
  if (sizes.length === 0) {
    return [
      {
        key: card.key,
        name: card.name,
        brand: card.brand,
        categories: card.categories,
        priceMinorUnits: card.priceMinorUnits,
        costMinorUnits: costs.get(card.key) ?? null,
      },
    ];
  }
  const ordered = [...sizes].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.priceMinorUnits - b.priceMinorUnits,
  );
  const seen = new Set<string>();
  const out: GuardProduct[] = [];
  for (const s of ordered) {
    const sizeId = s.sourceVariantId.trim();
    if (seen.has(sizeId)) continue;
    seen.add(sizeId);
    out.push({
      key: card.key,
      name: card.name,
      brand: card.brand,
      categories: card.categories,
      priceMinorUnits: Number.isFinite(s.priceMinorUnits) ? s.priceMinorUnits : card.priceMinorUnits,
      costMinorUnits: costForSize(costs, card.key, sizeId),
      sizeId,
      sizeLabel: (s.label ?? "").trim() || null,
      lotKey: lotKeyFromVariantId(sizeId),
    });
  }
  return out;
}

/** A stable id for one guard row (card + size). */
export function guardRowId(r: { key: string; sizeId?: string | null }): string {
  return r.sizeId ? `${r.key}::${r.sizeId}` : r.key;
}

/** "Brand · Name · 3.5g" style label pieces (size only when the row is a size). */
export function guardRowLabel(r: { name: string; sizeLabel?: string | null }): string {
  return r.sizeLabel ? `${r.name} (${r.sizeLabel})` : r.name;
}

/** How many distinct PRODUCTS (cards) a list of rows/findings covers. */
export function distinctCards(rows: readonly { key: string }[]): number {
  return new Set(rows.map((r) => r.key)).size;
}

/**
 * One finding per card for card-level actions (hide / leave out / never
 * discount): the size with the least room (lowest worst case minus floor).
 * Order of first appearance is kept.
 */
export function worstFindingPerCard(findings: readonly BelowCostFinding[]): BelowCostFinding[] {
  const best = new Map<string, BelowCostFinding>();
  const order: string[] = [];
  for (const f of findings) {
    const cur = best.get(f.key);
    if (!cur) {
      best.set(f.key, f);
      order.push(f.key);
      continue;
    }
    if (f.worstCasePriceMinorUnits - f.floorMinorUnits < cur.worstCasePriceMinorUnits - cur.floorMinorUnits) {
      best.set(f.key, f);
    }
  }
  return order.map((k) => best.get(k)!);
}

// ---------------------------------------------------------------------------
// The exact inventory lot behind a size (D195 step 3: links go to inventory)
// ---------------------------------------------------------------------------

export type SizeLotRef = {
  id: string;
  posProductKey: string;
  status: string;
  createdAt: string;
  /** inventory_lots.menu_source_variant_id (0294), null when not linked. */
  sizeId?: string | null;
};

function newestFirst(a: SizeLotRef, b: SizeLotRef): number {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

function pickLot(lots: SizeLotRef[]): string | null {
  if (lots.length === 0) return null;
  const active = lots.filter((l) => l.status === "active").sort(newestFirst);
  return (active[0] ?? [...lots].sort(newestFirst)[0]).id;
}

/**
 * The lot to open for a row: the lot that sells as THIS size.
 *  1. an intake size: the lot under its own lot key;
 *  2. a lot linked to the size (menu_source_variant_id);
 *  3. a card with one size (or no sizes): any lot of the card;
 *  else null (a multi-size card whose lots are not linked to sizes: the
 *  caller links to the inventory search for the card, never a wrong lot).
 * Active newest first, then newest.
 */
export function lotForSize(
  lots: readonly SizeLotRef[],
  row: { key: string; sizeId?: string | null; lotKey?: string | null },
  sizeCount: number,
): string | null {
  if (row.lotKey) {
    const own = pickLot(lots.filter((l) => l.posProductKey === row.lotKey));
    if (own) return own;
  }
  const mine = lots.filter((l) => l.posProductKey === row.key);
  if (row.sizeId) {
    const linked = pickLot(mine.filter((l) => (l.sizeId ?? "") === row.sizeId));
    if (linked) return linked;
  }
  if (sizeCount <= 1) return pickLot(mine);
  return null;
}

/** Where a product link in Promotions goes: the exact lot, else the inventory search. */
export function inventoryHrefFor(lotId: string | null, key: string, anchor?: string): string {
  if (lotId) return `/admin/inventory/${encodeURIComponent(lotId)}${anchor ? `#${anchor}` : ""}`;
  return `/admin/inventory?q=${encodeURIComponent(key)}`;
}

/** How many sizes each card has among some rows (for lotForSize). */
export function sizeCountByCard(rows: readonly { key: string; sizeId?: string | null }[]): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = sets.get(r.key) ?? new Set<string>();
    if (r.sizeId) set.add(r.sizeId);
    sets.set(r.key, set);
  }
  return new Map([...sets].map(([k, v]) => [k, v.size]));
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runSizeGuardCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`size-guard-core self-test failed: ${m}`);
    }
  };
  const SEP = "\u0000size:";
  // FDG Chem Trailz, the D195 example: card $7 (the 1g), average cost $5.27.
  const costs = new Map<string, number>([
    ["chem", 527],
    [`chem${SEP}chem-1g`, 225],
    [`chem${SEP}chem-35`, 1189],
    [`chem${SEP}chem-7g`, 2310],
    ["plain", 400],
    ["INTAKE1", 300],
  ]);
  const chem: GuardCardInput = {
    key: "chem",
    name: "Chem Trailz",
    brand: "FDG",
    categories: ["flower"],
    priceMinorUnits: 700,
    sizes: [
      { sourceVariantId: "chem-7g", label: "7g", priceMinorUnits: 9000, sortOrder: 3 },
      { sourceVariantId: "chem-1g", label: "1g", priceMinorUnits: 700, sortOrder: 1 },
      { sourceVariantId: "chem-35", label: "3.5g", priceMinorUnits: 4500, sortOrder: 2 },
      { sourceVariantId: "chem-14", label: "14g", priceMinorUnits: 16000, sortOrder: 4 },
    ],
  };
  const rows = expandCardSizes(chem, costs);
  ok(rows.length === 4, "one row per size");
  ok(rows.map((r) => r.sizeLabel).join() === "1g,3.5g,7g,14g", "sizes in menu order");
  ok(rows.every((r) => r.key === "chem"), "key stays the card key (exclusions act on the product)");
  ok(rows[0].priceMinorUnits === 700 && rows[0].costMinorUnits === 225, "1g at its own price and its own cost");
  ok(rows[1].priceMinorUnits === 4500 && rows[1].costMinorUnits === 1189, "3.5g at its own price and cost");
  ok(rows[3].costMinorUnits === 527, "a size with no linked lot falls back to the card average (register rule)");
  ok(rows.every((r) => r.lotKey === null), "Cultivera sizes carry no lot key");

  const noSizes = expandCardSizes({ key: "plain", name: "P", brand: "", categories: ["flower"], priceMinorUnits: 1000 }, costs);
  ok(noSizes.length === 1 && noSizes[0].costMinorUnits === 400 && noSizes[0].priceMinorUnits === 1000, "no sizes: card price + card cost");
  ok(!("sizeId" in noSizes[0]), "no sizes: no size fields (pre-D195 rows unchanged)");
  const emptySizes = expandCardSizes({ key: "plain", name: "P", brand: "", categories: [], priceMinorUnits: 1000, sizes: [] }, costs);
  ok(emptySizes.length === 1 && emptySizes[0].costMinorUnits === 400, "empty sizes behave like no sizes");
  const unknown = expandCardSizes({ key: "nope", name: "N", brand: "", categories: [], priceMinorUnits: 1000 }, costs);
  ok(unknown[0].costMinorUnits === null, "no cost on file stays null (never 0)");

  const intake = expandCardSizes(
    { key: "card9", name: "I", brand: "", categories: ["flower"], priceMinorUnits: 1500, sizes: [{ sourceVariantId: "INTAKE1-onboarded", label: "1g", priceMinorUnits: 1500 }] },
    costs,
  );
  ok(intake[0].lotKey === "INTAKE1" && intake[0].costMinorUnits === 300, "intake size floors at its own lot key cost");
  ok(costForSize(costs, "chem", "chem-35") === 1189, "costForSize = size cost");
  ok(costForSize(costs, "chem", null) === 527, "costForSize with no size = card average");
  ok(costForSize(costs, "zzz", "zzz-1") === null, "costForSize unknown = null");

  const dupe = expandCardSizes(
    { key: "chem", name: "C", brand: "", categories: [], priceMinorUnits: 700, sizes: [
      { sourceVariantId: "chem-1g", label: "1g", priceMinorUnits: 700 },
      { sourceVariantId: "chem-1g", label: "1g", priceMinorUnits: 700 },
      { sourceVariantId: " ", label: "x", priceMinorUnits: 1 },
    ] },
    costs,
  );
  ok(dupe.length === 1, "duplicate and blank size ids are dropped");

  ok(guardRowId({ key: "a", sizeId: "s" }) === "a::s" && guardRowId({ key: "a" }) === "a", "row id");
  ok(guardRowLabel({ name: "N", sizeLabel: "3.5g" }) === "N (3.5g)" && guardRowLabel({ name: "N" }) === "N", "row label");
  ok(distinctCards([{ key: "a" }, { key: "a" }, { key: "b" }]) === 2, "distinct cards");

  const f = (key: string, worst: number, floor: number, sizeId: string): BelowCostFinding => ({
    key, name: key, brand: "", priceMinorUnits: 0, costMinorUnits: 1, floorMinorUnits: floor,
    worstCasePriceMinorUnits: worst, reason: "below_cost", sizeId, sizeLabel: sizeId, lotKey: null,
  });
  const worst = worstFindingPerCard([f("a", 90, 100, "a1"), f("b", 50, 60, "b1"), f("a", 50, 100, "a2")]);
  ok(worst.length === 2 && worst[0].key === "a" && worst[0].sizeId === "a2", "worst size per card (least room)");
  ok(worst[1].key === "b", "first-appearance order kept");

  const lots: SizeLotRef[] = [
    { id: "L-old", posProductKey: "chem", status: "active", createdAt: "2026-01-01", sizeId: "chem-35" },
    { id: "L-new", posProductKey: "chem", status: "active", createdAt: "2026-02-01", sizeId: "chem-35" },
    { id: "L-1g", posProductKey: "chem", status: "active", createdAt: "2026-03-01", sizeId: "chem-1g" },
    { id: "L-sold", posProductKey: "chem", status: "sold_out", createdAt: "2026-04-01", sizeId: "chem-7g" },
    { id: "L-int", posProductKey: "INTAKE1", status: "active", createdAt: "2026-01-01" },
    { id: "L-one", posProductKey: "single", status: "active", createdAt: "2026-01-01" },
  ];
  ok(lotForSize(lots, { key: "chem", sizeId: "chem-35" }, 4) === "L-new", "the size's own lot (active newest)");
  ok(lotForSize(lots, { key: "chem", sizeId: "chem-1g" }, 4) === "L-1g", "never the other size's lot");
  ok(lotForSize(lots, { key: "chem", sizeId: "chem-7g" }, 4) === "L-sold", "an inactive linked lot beats nothing");
  ok(lotForSize(lots, { key: "chem", sizeId: "chem-14" }, 4) === null, "unlinked size on a multi-size card: null (no wrong lot)");
  ok(lotForSize(lots, { key: "card9", sizeId: "INTAKE1-onboarded", lotKey: "INTAKE1" }, 1) === "L-int", "intake size: its lot key");
  ok(lotForSize(lots, { key: "single", sizeId: "single-1" }, 1) === "L-one", "one-size card: any lot of the card");
  ok(lotForSize(lots, { key: "single" }, 0) === "L-one", "no-size card: any lot of the card");
  ok(lotForSize(lots, { key: "none" }, 0) === null, "no lot: null");
  ok(inventoryHrefFor("L1", "k", "after_tax_price") === "/admin/inventory/L1#after_tax_price", "lot link with anchor");
  ok(inventoryHrefFor(null, "pos-a b") === "/admin/inventory?q=pos-a%20b", "no lot: inventory search for the card");
  const counts = sizeCountByCard(rows.concat(noSizes));
  ok(counts.get("chem") === 4 && counts.get("plain") === 0, "size count per card");
  return { passed, failed };
}
