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
 *  2. Discounts are recomputed server-side with the SAME pure cart engine the
 *     client uses (computeCartDiscounts + the store's Pacific weekday).
 *  3. The global cannabis price floor (RCW 69.50.357) is applied to every
 *     discounted unit price — no cannabis line can ever be $0.
 *  4. Totals are recomputed with the shared pure money math
 *     (order-pricing-core.ts). The client's totals become a CROSS-CHECK only.
 *  5. Each priced line is mapped to a WAC 314-55-095 limit bucket line so the
 *     sales-limit gate can evaluate the cart.
 */
import "server-only";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import type { GreenwayCategory } from "@/lib/leafly/types";
import { loadLiveMenuAll } from "@/lib/pos/live-menu";
import { getStoreWeekday } from "@/lib/specials/daily-deals";
import {
  computeCartDiscounts,
  costFloorForLine,
  type DiscountCartLine,
} from "@/lib/specials/cart-discount";
import { loadProductCosts } from "@/lib/promotions/discount-engine";
import type { LimitCartLine } from "@/lib/compliance/sales-limits-core";
import {
  assertCannabisLineSellable,
  clampCannabisUnitPrice,
  computeOrderTotals,
  moneyMatches,
  type OrderTotals,
} from "@/lib/orders/order-pricing-core";
import type { NewOrderLineInput, OrderLineRow } from "@/lib/orders/types";

export type PricedOrderLine = {
  productId: string | null;
  variantId: string | null;
  productName: string;
  brand: string | null;
  variantLabel: string | null;
  category: string;
  quantity: number;
  /** SERVER-computed final unit price (tax-inclusive, minor units). */
  priceMinorUnits: number;
  /** SERVER regular (pre-discount) unit price from the published menu. */
  regularPriceMinorUnits: number;
  appliedLabel?: string;
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

  // Recompute discounts server-side with the SAME pure engine + Pacific weekday.
  // CCRS COST FLOOR (Task R): attach the weighted-average acquisition cost per
  // product so no discount can price a unit below cost ("may not discount the
  // sale price below the cost of acquisition" — CCRS Upload User Guide; see
  // docs/PROMOTIONS_COMPLIANCE.md).
  const weekday = getStoreWeekday();
  const productCosts = await loadProductCosts();
  const discountInput: DiscountCartLine[] = work.map((w) => ({
    lineId: w.lineId,
    regularPriceMinorUnits: w.resolved.variant.priceMinorUnits,
    quantity: Math.round(w.raw.quantity),
    category: w.resolved.item.category as GreenwayCategory,
    filterCategories: w.resolved.item.filterCategories,
    variantLabel: w.resolved.variant.label,
    brand: w.resolved.item.brand,
    costMinorUnits: productCosts.get(w.resolved.item.id) ?? null,
  }));
  const discountInputByLine = new Map(discountInput.map((l) => [l.lineId, l]));
  const discount = computeCartDiscounts(discountInput, weekday);
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
    const costFloor = inputLine ? costFloorForLine(inputLine) : 0;
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

  const limitLines: LimitCartLine[] = priced.map((l) => ({
    category: l.category,
    quantity: l.quantity,
  }));

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

    limitLines.push({ category, quantity: line.quantity });
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
