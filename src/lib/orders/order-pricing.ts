/**
 * src/lib/orders/order-pricing.ts
 *
 * SERVER-AUTHORITATIVE order pricing + sales-limit resolution (GAP H-1 / H-2).
 *
 * The storefront checkout posts client-computed prices. This module makes the
 * SERVER the source of truth at placement and again at completion:
 *
 *  1. Every line is resolved against the CURRENT PUBLISHED menu snapshot
 *     (src/lib/pos/live-menu.ts) by variantId + productId — category, variant
 *     label and the TRUE regular price come from the DB, never the client.
 *  2. Discounts are recomputed server-side with the SAME data-driven rules
 *     engine the REGISTER uses (loadActiveRules + computePromotions over the
 *     back office's PUBLISHED promotions — Task T / PR 1, Promotions Harmony).
 *     The committed daily-deal seeds remain the zero-blank fallback, so
 *     behaviour is identical to the legacy static weekday engine until staff
 *     publish an override.
 *  3. The global cannabis price floor (RCW 69.50.357) is applied to every
 *     discounted unit price — no cannabis line can ever be $0.
 *  4. Totals are recomputed with the shared pure money math
 *     (order-pricing-core.ts). The client's totals become a CROSS-CHECK only.
 *  5. Each priced line is mapped to a WAC 314-55-095 limit bucket line so the
 *     sales-limit gate can evaluate the cart.
 */
import "server-only";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { loadLiveMenuAll } from "@/lib/pos/live-menu";
import { loadActiveRules, loadProductCosts } from "@/lib/promotions/discount-engine";
// Mastering Slice 1: intake variants encode their own lot key.
import { lotKeyFromVariantId } from "@/lib/pos/variant-lot-core";
import {
  computePromotions,
  lineCostFloor,
  type EngineCartLine,
} from "@/lib/promotions/discount-engine-core";
import type { LimitCartLine } from "@/lib/compliance/sales-limits-core";
import {
  assertCannabisLineSellable,
  clampCannabisUnitPrice,
  computeOrderTotals,
  moneyMatches,
  type OrderTotals,
} from "@/lib/orders/order-pricing-core";
import type { NewOrderLineInput, OrderLineRow } from "@/lib/orders/types";
// AN-1 — pure per-variant grams helpers (label → grams; stored numeric → grams).
import {
  gramsFromVariantLabel,
  lineGramsFromUnit,
  normalizeUnitGrams,
} from "@/lib/pos/variant-grams-core";
// SLICE L4 — pure per-variant millilitre helpers (label → ml; per-unit → line).
import { lineVolumeMl, volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";

export type PricedOrderLine = {
  productId: string | null;
  variantId: string | null;
  productName: string;
  brand: string | null;
  variantLabel: string | null;
  category: string;
  quantity: number;
  /**
   * SLICE 16 — the low-THC beverage classification resolved from the live menu
   * at placement, so it can be both evaluated now and snapshotted onto the
   * stored line for the pickup gate.
   */
  lowThcLiquid?: boolean | null;
  /** SLICE 16 — mg active delta-9 THC per sellable unit. */
  unitThcMg?: number | null;
  /**
   * SLICE 17 — the otherwise-taken classification resolved from the live menu
   * at placement, so it can be both evaluated now and snapshotted onto the
   * stored line for the pickup gate.
   */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 — individual consumable items per package. */
  unitsPerPackage?: number | null;
  /** SERVER-computed final unit price (tax-inclusive, minor units). */
  priceMinorUnits: number;
  /** SERVER regular (pre-discount) unit price from the published menu. */
  regularPriceMinorUnits: number;
  appliedLabel?: string;
  /** AN-1 — grams one unit weighs (from the variant label; null = unknown). */
  unitGrams?: number | null;
  /**
   * SLICE L4 — millilitres ONE unit contains. The liquid bucket is metered in
   * millilitres against 72 FLUID ounces (RCW/WAC liquid maximum), so a real
   * measured package volume must reach the server gate the same way unitGrams
   * does. null = unknown, and the engine falls back to the weight-carried
   * basis rather than assuming a size.
   */
  unitVolumeMl?: number | null;
};

export type RepriceSuccess = {
  ok: true;
  lines: PricedOrderLine[];
  totals: OrderTotals;
  limitLines: LimitCartLine[];
};

export type RepriceFailure = {
  ok: false;
  /** HTTP-ish status the API route should surface (409 = stale/mismatch). */
  status: 400 | 409;
  error: string;
  /** Per-line problems for the client to show. */
  problems: string[];
};

export type RepriceResult = RepriceSuccess | RepriceFailure;

type ResolvedVariant = {
  item: GreenwayMenuItem;
  variant: GreenwayMenuItem["variants"][number];
};

/** Index the published menu by variant id (and item id) for O(1) resolution. */
function indexMenu(items: GreenwayMenuItem[]): Map<string, ResolvedVariant> {
  const byVariant = new Map<string, ResolvedVariant>();
  for (const item of items) {
    if (item.hidden) continue;
    for (const variant of item.variants) {
      // First writer wins; source_variant_id is unique within a version.
      if (!byVariant.has(variant.id)) byVariant.set(variant.id, { item, variant });
    }
  }
  return byVariant;
}

/**
 * Resolve + reprice raw checkout lines against the published menu.
 *
 * Policy (S-2a): every line MUST resolve to a live published variant. A line
 * that cannot be resolved (stale menu, hidden item, unknown variant) fails the
 * placement with 409 so the customer refreshes and re-adds from the live menu.
 */
export async function repriceOrderLines(rawLines: NewOrderLineInput[]): Promise<RepriceResult> {
  if (!rawLines.length) {
    return { ok: false, status: 400, error: "The order has no items.", problems: [] };
  }

  const menu = await loadLiveMenuAll();
  if (!menu.length) {
    return {
      ok: false,
      status: 409,
      error: "The menu is being updated. Please refresh and try again.",
      problems: ["No published menu is available to price the order."],
    };
  }
  const byVariant = indexMenu(menu);

  const problems: string[] = [];
  type WorkLine = { raw: NewOrderLineInput; resolved: ResolvedVariant; lineId: string };
  const work: WorkLine[] = [];

  rawLines.forEach((raw, i) => {
    const label = `${raw.productName}${raw.variantLabel ? ` (${raw.variantLabel})` : ""}`;
    if (!raw.variantId) {
      problems.push(`${label}: missing variant reference.`);
      return;
    }
    const resolved = byVariant.get(raw.variantId);
    if (!resolved) {
      problems.push(`${label}: no longer available on the current menu.`);
      return;
    }
    // Defense-in-depth: if a productId is supplied it must match the variant's item.
    if (raw.productId && raw.productId !== resolved.item.id) {
      problems.push(`${label}: product/variant mismatch.`);
      return;
    }
    if (!Number.isFinite(raw.quantity) || raw.quantity <= 0 || raw.quantity > 500) {
      problems.push(`${label}: invalid quantity.`);
      return;
    }
    work.push({ raw, resolved, lineId: `line-${i}` });
  });

  if (problems.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "Some items changed while you were shopping. Please review your cart.",
      problems,
    };
  }

  // Recompute discounts server-side with the SAME data-driven rules engine the
  // REGISTER uses: the back office's PUBLISHED promotions active right now
  // (Pacific weekday / date window), evaluated by the pure POS engine. This is
  // what makes the back office the single source of truth for every price the
  // website charges (Task T / PR 1 — Promotions Harmony, gap G-1).
  // CCRS COST FLOOR (Task R): attach the weighted-average acquisition cost per
  // product so no discount can price a unit below cost ("may not discount the
  // sale price below the cost of acquisition" — CCRS Upload User Guide; see
  // docs/PROMOTIONS_COMPLIANCE.md).
  const [activeRules, productCosts] = await Promise.all([
    loadActiveRules(),
    loadProductCosts(),
  ]);
  const discountInput: EngineCartLine[] = work.map((w) => {
    const item = w.resolved.item;
    const cats = item.filterCategories?.length ? item.filterCategories : [item.category];
    const variantLotKey = lotKeyFromVariantId(w.resolved.variant.id);
    return {
      lineId: w.lineId,
      regularPriceMinorUnits: w.resolved.variant.priceMinorUnits,
      quantity: Math.round(w.raw.quantity),
      categories: cats.map((c) => String(c).toLowerCase()),
      brand: item.brand || null,
      productKey: item.id,
      variantLabel: w.resolved.variant.label,
      // Mastering Slice 1: the variant's own lot cost wins (each size on a
      // mastered card has its own acquisition cost); single-lot cards
      // resolve the identical key either way.
      costMinorUnits:
        (variantLotKey ? productCosts.get(variantLotKey) : undefined) ??
        productCosts.get(item.id) ??
        null,
    };
  });
  const discountInputByLine = new Map(discountInput.map((l) => [l.lineId, l]));
  const discount = computePromotions(discountInput, activeRules);
  const discountByLine = new Map(discount.lines.map((l) => [l.lineId, l]));

  const priced: PricedOrderLine[] = [];
  for (const w of work) {
    const d = discountByLine.get(w.lineId);
    const regular = w.resolved.variant.priceMinorUnits;
    const rawUnit = d ? d.unitPriceMinorUnits : regular;
    // GLOBAL CANNABIS PRICE FLOOR (S-3): no cannabis unit below the floor.
    // Plus the CCRS acquisition-cost floor as a last-resort clamp.
    const statutory = clampCannabisUnitPrice(w.resolved.item.category, rawUnit, regular);
    const inputLine = discountInputByLine.get(w.lineId);
    const costFloor = inputLine ? lineCostFloor(inputLine) : 0;
    const unit = regular > 0 ? Math.max(statutory, Math.min(costFloor, regular)) : statutory;
    const sellable = assertCannabisLineSellable({
      category: w.resolved.item.category,
      unitPriceMinorUnits: unit,
    });
    if (!sellable.ok) {
      problems.push(
        `${w.resolved.item.name}${w.resolved.variant.label ? ` (${w.resolved.variant.label})` : ""}: ${sellable.reason}`,
      );
      continue;
    }
    priced.push({
      productId: w.resolved.item.id,
      variantId: w.resolved.variant.id,
      productName: w.resolved.item.name,
      brand: w.resolved.item.brand || null,
      variantLabel: w.resolved.variant.label || null,
      category: w.resolved.item.category,
      quantity: Math.round(w.raw.quantity),
      priceMinorUnits: unit,
      regularPriceMinorUnits: regular,
      appliedLabel: d?.appliedLabel,
      // AN-1: true per-unit weight from the resolved variant's label.
      unitGrams: gramsFromVariantLabel(w.resolved.variant.label),
      // SLICE L4: true per-unit VOLUME. Prefers the L3-plumbed net_volume_ml
      // (a measured package volume carried from intake); falls back to the
      // variant label for a card staged before that plumbing existed.
      unitVolumeMl: w.resolved.item.netVolumeMl ?? volumeMlFromLabel(w.resolved.variant.label),
      // SLICE 16: the low-THC beverage classification from the resolved menu
      // item. Unclassified products resolve to null and are counted as normal
      // liquids by the engine.
      lowThcLiquid: w.resolved.item.lowThcLiquid ?? null,
      unitThcMg: w.resolved.item.unitThcMg ?? null,
      // SLICE 17: the otherwise-taken classification from the resolved menu
      // item. Unclassified products resolve to null and are counted as normal
      // liquids — which for a suppository is the PERMISSIVE direction, hence
      // the intake review queue backing this up.
      otherwiseTaken: w.resolved.item.otherwiseTaken ?? null,
      unitsPerPackage: w.resolved.item.unitsPerPackage ?? null,
    });
  }

  if (problems.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "Some items cannot be sold at the computed price.",
      problems,
    };
  }

  const totals = computeOrderTotals(
    priced.map((l) => ({
      category: l.category,
      quantity: l.quantity,
      unitPriceMinorUnits: l.priceMinorUnits,
      regularPriceMinorUnits: l.regularPriceMinorUnits,
    })),
  );

  const limitLines: LimitCartLine[] = priced.map((l) => {
    // AN-1: hand the engine the true whole-line grams when known; null keeps
    // the conservative category-default math.
    const grams = lineGramsFromUnit(l.unitGrams, l.quantity);
    // SLICE L4: and the true whole-line millilitres, which is what the liquid
    // bucket actually meters. Omitted when unknown so the engine keeps its
    // weight-carried fallback instead of reading a zero as "no volume sold".
    const volumeMl = lineVolumeMl(l.unitVolumeMl ?? null, l.quantity);
    return {
      category: l.category,
      quantity: l.quantity,
      ...(grams !== null ? { grams } : {}),
      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),
      // SLICE 16 — same routing the register and the website cart use, so all
      // three agree on an identical basket.
      lowThcLiquid: l.lowThcLiquid ?? null,
      unitThcMg: l.unitThcMg ?? null,
      // SLICE 17 — same routing the register and the website cart use, so all
      // three agree on an identical basket.
      otherwiseTaken: l.otherwiseTaken ?? null,
      unitsPerPackage: l.unitsPerPackage ?? null,
    };
  });

  return { ok: true, lines: priced, totals, limitLines };
}

/**
 * Cross-check the CLIENT's claimed totals against the server totals. A
 * mismatch beyond rounding tolerance means stale prices or tampering — the
 * placement must be refused with the fresh totals.
 */
export function clientTotalsMatch(
  client: { subtotalMinorUnits: number; estimatedTaxMinorUnits: number; totalMinorUnits: number },
  server: OrderTotals,
): boolean {
  return (
    moneyMatches(client.totalMinorUnits, server.totalMinorUnits) &&
    moneyMatches(client.subtotalMinorUnits, server.subtotalMinorUnits) &&
    moneyMatches(client.estimatedTaxMinorUnits, server.estimatedTaxMinorUnits)
  );
}

// ---------------------------------------------------------------------------
// Completion-time re-verification (S-1b / S-2b)
// ---------------------------------------------------------------------------

export type CompletionCheck = {
  ok: boolean;
  problems: string[];
  /** Sales-limit lines resolved from the STORED order lines. */
  limitLines: LimitCartLine[];
  /** Server-recomputed totals from the stored lines (for the money gate). */
  storedTotals: OrderTotals;
};

/**
 * Re-verify a STORED order before it is marked completed.
 *
 * - Money: recompute subtotal/tax/total from the stored lines (which were
 *   themselves server-priced at placement) and compare against the order
 *   header. Any drift means the rows were altered outside the priced path.
 * - Limits: use each stored line's category SNAPSHOT (persisted at placement,
 *   migration 0096); legacy lines without a snapshot are resolved from the
 *   CURRENT published menu by variant/product id, and lines that still don't
 *   resolve are treated CONSERVATIVELY as `usable` (flower-equivalent) so an
 *   unknown never slips past the statutory gate.
 */
export async function verifyStoredOrderForCompletion(order: {
  subtotal_minor_units: number;
  estimated_tax_minor_units: number;
  total_minor_units: number;
  lines: (OrderLineRow & { category?: string | null })[];
}): Promise<CompletionCheck> {
  const problems: string[] = [];

  // The live menu is only needed as a fallback for legacy lines placed before
  // the category snapshot existed.
  const needsMenu = order.lines.some((l) => !l.category);
  const menu = needsMenu ? await loadLiveMenuAll() : [];
  const byVariant = indexMenu(menu);
  const byItem = new Map(menu.map((m) => [m.id, m]));

  const limitLines: LimitCartLine[] = [];
  const totalsLines = [];

  for (const line of order.lines) {
    // Prefer the placement-time snapshot; fall back to the live menu.
    let category: string | null = line.category?.trim() || null;
    if (!category && line.variant_id) category = byVariant.get(line.variant_id)?.item.category ?? null;
    if (!category && line.product_id) category = byItem.get(line.product_id)?.category ?? null;
    if (!category) {
      // CONSERVATIVE: unknown cannabis-side lines count as useable flower.
      category = "flower";
      problems.push(
        `"${line.product_name}" could not be matched to the current menu — counted as useable cannabis for the limit check.`,
      );
    }

    // AN-1: prefer the sale-time unit_grams SNAPSHOT (migration 0122; pg
    // numeric may arrive as string — normalized either way). Legacy rows and
    // unknown-weight items stay null → category-default math, as before.
    const grams = lineGramsFromUnit(normalizeUnitGrams(line.unit_grams), line.quantity);
    // SLICE L4: read back the placement-time VOLUME snapshot (migration 0223)
    // and meter the whole line in millilitres. normalizeUnitGrams is reused
    // deliberately — it is a generic "positive numeric or null" coercion that
    // also handles PostgREST returning numeric columns as strings, and it
    // applies NO gram semantics (see its use for unit_thc_mg below). Legacy
    // rows and unknown-volume items stay null, and the engine then uses the
    // weight-carried basis, exactly as it did before L4.
    const volumeMl = lineVolumeMl(normalizeUnitGrams(line.unit_volume_ml), line.quantity);
    // SLICE 16: read back the placement-time classification snapshot
    // (migration 0216). WITHOUT THIS the gate would re-evaluate a legal
    // low-THC order as a normal liquid and wrongly block the customer at
    // pickup. Legacy rows and unclassified products are null → normal liquid,
    // which is the fail-safe direction.
    //
    // `=== true` on purpose: pg/PostgREST can hand back a string, and only a
    // real boolean true may unlock the more permissive bucket.
    const lowThc = line.low_thc_liquid === true;
    // normalizeUnitGrams is a generic "positive numeric or null" coercion that
    // also handles PostgREST returning numeric columns as strings. Reused here
    // deliberately for the mg field — it applies NO gram semantics. Named for
    // its first caller, not for a unit.
    const unitThcMg = normalizeUnitGrams(line.unit_thc_mg);
    limitLines.push({
      category,
      quantity: line.quantity,
      ...(grams !== null ? { grams } : {}),
      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),
      lowThcLiquid: lowThc,
      unitThcMg,
      // SLICE 17 — read back the placement-time classification snapshot
      // (migration 0217). `=== true` on purpose: PostgREST can hand back a
      // string, and only a real boolean true may move this line into the
      // ten-unit bucket. Legacy rows are null → normal liquid.
      otherwiseTaken: line.otherwise_taken === true,
      unitsPerPackage: normalizeUnitGrams(line.units_per_package),
    });
    totalsLines.push({
      category,
      quantity: line.quantity,
      unitPriceMinorUnits: line.price_minor_units,
      regularPriceMinorUnits: line.regular_price_minor_units ?? line.price_minor_units,
    });

    // Floor check on the stored price (defense-in-depth).
    const sellable = assertCannabisLineSellable({
      category,
      unitPriceMinorUnits: line.price_minor_units,
    });
    if (!sellable.ok) {
      problems.push(`"${line.product_name}": ${sellable.reason}`);
    }
  }

  const storedTotals = computeOrderTotals(totalsLines);

  if (!moneyMatches(order.total_minor_units, storedTotals.totalMinorUnits)) {
    problems.push(
      `Order total ${(order.total_minor_units / 100).toFixed(2)} does not match the recomputed line total ${(storedTotals.totalMinorUnits / 100).toFixed(2)}.`,
    );
  }
  if (!moneyMatches(order.subtotal_minor_units, storedTotals.subtotalMinorUnits)) {
    problems.push(
      `Order subtotal ${(order.subtotal_minor_units / 100).toFixed(2)} does not match the recomputed pre-tax subtotal ${(storedTotals.subtotalMinorUnits / 100).toFixed(2)}.`,
    );
  }
  if (!moneyMatches(order.estimated_tax_minor_units, storedTotals.estimatedTaxMinorUnits)) {
    problems.push(
      `Order tax ${(order.estimated_tax_minor_units / 100).toFixed(2)} does not match the recomputed included tax ${(storedTotals.estimatedTaxMinorUnits / 100).toFixed(2)}.`,
    );
  }

  // A "could not be matched" note alone should not fail the money gate — it
  // only affects the limit mapping. Money/floor problems DO fail.
  const hardProblems = problems.filter((p) => !p.includes("counted as useable cannabis"));
  return { ok: hardProblems.length === 0, problems, limitLines, storedTotals };
}
