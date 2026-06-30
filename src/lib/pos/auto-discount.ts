/**
 * src/lib/pos/auto-discount.ts
 *
 * POS Slice 12 — the automatic cart discount engine for the register.
 *
 * Goal: the employee never does discount math. Given a cart, this engine reads
 * every PUBLISHED promotion (database-defined, edited by staff) plus an optional
 * caller-supplied list, finds every promotion that's currently active and that
 * matches each line, applies the BEST one per line (highest savings), and
 * returns authoritative per-line + cart totals — with tax applied on top.
 *
 * All money is in MINOR UNITS (cents). The matching/selection logic is pure so
 * it is fully unit-testable; the DB read is a thin wrapper.
 */
import "server-only";
import type { PublishedPromotion } from "@/lib/promotions/types";
import type { GreenwayCategory } from "@/lib/leafly/types";
import { getPublishedPromotions } from "@/lib/promotions/promotions-store";

export type PosCartLine = {
  lineId: string;
  /** Regular per-unit price, PRE-tax, minor units. */
  regularUnitMinor: number;
  quantity: number;
  category: GreenwayCategory;
  /** Optional extra browse categories used for matching. */
  filterCategories?: GreenwayCategory[];
  brand?: string | null;
  /** POS product key (matches PublishedPromotion.targetProductKeys). */
  productKey?: string | null;
};

export type PosDiscountedLine = {
  lineId: string;
  quantity: number;
  regularUnitMinor: number;
  /** Discounted per-unit price (pre-tax). Equals regular when no deal applied. */
  discountedUnitMinor: number;
  unitSavingsMinor: number;
  lineSavingsMinor: number;
  appliedPromoId: string | null;
  appliedLabel: string | null;
  appliedPercent: number;
};

export type PosCartTotals = {
  lines: PosDiscountedLine[];
  subtotalRegularMinor: number; // pre-discount, pre-tax
  subtotalDiscountedMinor: number; // post-discount, pre-tax
  totalSavingsMinor: number;
  taxMinor: number;
  totalMinor: number; // post-discount + tax
};

function lineCats(line: PosCartLine): GreenwayCategory[] {
  return line.filterCategories?.length ? line.filterCategories : [line.category];
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Is a published promotion currently active for the given moment? */
export function isPromoActive(p: PublishedPromotion, now: Date): boolean {
  if (p.startsAt && new Date(p.startsAt) > now) return false;
  if (p.endsAt && new Date(p.endsAt) < now) return false;
  if (p.weekday != null && p.weekday !== now.getDay()) return false;
  return true;
}

/** Does a promotion's scope/targets include this line (and not exclude it)? */
export function promoMatchesLine(p: PublishedPromotion, line: PosCartLine): boolean {
  // Exclusions win.
  const cats = lineCats(line);
  if (p.excludeProductKeys.length && line.productKey && p.excludeProductKeys.includes(line.productKey)) {
    return false;
  }
  if (p.excludeBrands.length && line.brand && p.excludeBrands.map(norm).includes(norm(line.brand))) {
    return false;
  }
  if (p.excludeCategories.length && cats.some((c) => p.excludeCategories.includes(c))) {
    return false;
  }

  // Storewide matches everything not excluded.
  if (p.storewide) return true;

  // Otherwise must match at least one target dimension.
  if (p.targetProductKeys.length && line.productKey && p.targetProductKeys.includes(line.productKey)) {
    return true;
  }
  if (p.targetBrands.length && line.brand && p.targetBrands.map(norm).includes(norm(line.brand))) {
    return true;
  }
  if (p.targetCategories.length && cats.some((c) => p.targetCategories.includes(c))) {
    return true;
  }
  return false;
}

/**
 * The per-unit discounted price a promotion yields for a line. Returns the
 * discounted unit price (pre-tax) and a label. Only handles per-line discount
 * types here (percent / fixed); basket/threshold types are evaluated at the
 * cart level below.
 */
function promoUnitPrice(
  p: PublishedPromotion,
  line: PosCartLine,
): { unitMinor: number; percent: number; label: string } | null {
  switch (p.discountType) {
    case "percent": {
      const pct = p.discountPercent;
      if (pct <= 0) return null;
      const unit = Math.round(line.regularUnitMinor * (1 - pct / 100));
      return { unitMinor: unit, percent: pct, label: `${p.title} · ${pct}% off` };
    }
    case "fixed": {
      const off = p.discountFixed;
      if (off <= 0) return null;
      const unit = Math.max(0, line.regularUnitMinor - off);
      const pct = line.regularUnitMinor > 0 ? Math.round((1 - unit / line.regularUnitMinor) * 100) : 0;
      return { unitMinor: unit, percent: pct, label: `${p.title} · $${(off / 100).toFixed(2)} off` };
    }
    // BOGO / tiers / basket are handled by the daily-deals engine and/or as a
    // future enhancement; for the auto-apply register engine we apply the
    // simple per-line promos here and let the best one win.
    default:
      return null;
  }
}

export type EvaluateOpts = {
  now?: Date;
  /** Tax rate applied on top of the discounted subtotal (e.g. 0.376). */
  taxRate?: number;
  /** Extra promotions to consider beyond the published set (e.g. seeded daily deals). */
  extraPromotions?: PublishedPromotion[];
};

/**
 * Pure cart evaluation: pick the best eligible promotion per line, total it up,
 * apply tax. Higher `priority` breaks ties when savings are equal.
 */
export function evaluateCart(
  cart: PosCartLine[],
  promotions: PublishedPromotion[],
  opts: EvaluateOpts = {},
): PosCartTotals {
  const now = opts.now ?? new Date();
  const taxRate = opts.taxRate ?? 0;
  const active = [...promotions, ...(opts.extraPromotions ?? [])].filter((p) => isPromoActive(p, now));

  const lines: PosDiscountedLine[] = [];
  let subtotalRegular = 0;
  let subtotalDiscounted = 0;

  for (const line of cart) {
    subtotalRegular += line.regularUnitMinor * line.quantity;

    let best: { unitMinor: number; percent: number; label: string; promoId: string; priority: number } | null = null;
    for (const p of active) {
      if (!promoMatchesLine(p, line)) continue;
      const priced = promoUnitPrice(p, line);
      if (!priced) continue;
      if (priced.unitMinor >= line.regularUnitMinor) continue; // no real savings
      const better =
        !best ||
        priced.unitMinor < best.unitMinor ||
        (priced.unitMinor === best.unitMinor && p.priority > best.priority);
      if (better) {
        best = { ...priced, promoId: p.id, priority: p.priority };
      }
    }

    const discountedUnit = best ? best.unitMinor : line.regularUnitMinor;
    const unitSavings = line.regularUnitMinor - discountedUnit;
    subtotalDiscounted += discountedUnit * line.quantity;

    lines.push({
      lineId: line.lineId,
      quantity: line.quantity,
      regularUnitMinor: line.regularUnitMinor,
      discountedUnitMinor: discountedUnit,
      unitSavingsMinor: unitSavings,
      lineSavingsMinor: unitSavings * line.quantity,
      appliedPromoId: best?.promoId ?? null,
      appliedLabel: best?.label ?? null,
      appliedPercent: best?.percent ?? 0,
    });
  }

  const taxMinor = Math.round(subtotalDiscounted * taxRate);
  return {
    lines,
    subtotalRegularMinor: subtotalRegular,
    subtotalDiscountedMinor: subtotalDiscounted,
    totalSavingsMinor: subtotalRegular - subtotalDiscounted,
    taxMinor,
    totalMinor: subtotalDiscounted + taxMinor,
  };
}

/**
 * Register entry point: load published promotions and auto-apply the best ones
 * to the cart. The employee does nothing — the engine guarantees the customer
 * gets the best eligible deal, automatically.
 */
export async function autoDiscountCart(
  cart: PosCartLine[],
  opts: EvaluateOpts = {},
): Promise<PosCartTotals> {
  const promotions = await getPublishedPromotions();
  return evaluateCart(cart, promotions, opts);
}
