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
import { getPublishedPromotions, listNeverDiscountKeys } from "@/lib/promotions/promotions-store";
import { storeWeekday } from "@/lib/reports/timezone";

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
  /**
   * Acquisition cost per unit (PRE-tax, minor units) when known. Because this
   * engine's prices are also pre-tax, the CCRS cost floor here is simply the
   * cost itself: "may not discount the sale price below the cost of
   * acquisition" (CCRS Upload User Guide — see docs/PROMOTIONS_COMPLIANCE.md).
   */
  costMinorUnits?: number | null;
};

/**
 * Clamp a pre-tax discounted unit price to the line's floors: never free
 * (RCW 69.50.357 — at least 1 cent) and never below the acquisition cost
 * when known. The floor is capped at the regular price so a cost anomaly
 * can never RAISE a price.
 */
function clampPosUnit(line: PosCartLine, unitMinor: number): number {
  const statutory = line.regularUnitMinor > 0 ? 1 : 0;
  const cost =
    line.costMinorUnits != null && line.costMinorUnits > 0
      ? Math.min(line.costMinorUnits, line.regularUnitMinor)
      : 0;
  return Math.max(unitMinor, statutory, cost);
}

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
  // S-12: weekday targeting is a STORE-day concept — compare against the
  // Pacific wall-clock weekday, not the server's local weekday.
  if (p.weekday != null && p.weekday !== storeWeekday(now)) return false;
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
      const unit = clampPosUnit(line, Math.round(line.regularUnitMinor * (1 - pct / 100)));
      return { unitMinor: unit, percent: pct, label: `${p.title} · ${pct}% off` };
    }
    case "fixed": {
      const off = p.discountFixed;
      if (off <= 0) return null;
      const unit = clampPosUnit(line, Math.max(0, line.regularUnitMinor - off));
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
  /**
   * PR-P4: product keys that must NEVER be discounted by ANY promotion. Folded
   * into every active promotion's exclusions before matching, so a listed
   * product keeps its regular price at the register. Defaults to none.
   */
  neverDiscountKeys?: string[];
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
  const activeRaw = [...promotions, ...(opts.extraPromotions ?? [])].filter((p) => isPromoActive(p, now));

  // PR-P4: bake the global never-discount keys into EVERY active promotion's
  // exclusions so promoMatchesLine vetoes those products under every deal
  // ("exclusions win"). No-op when the list is empty.
  const neverKeys = Array.from(
    new Set((opts.neverDiscountKeys ?? []).map((k) => k.trim()).filter(Boolean)),
  );
  const active = neverKeys.length
    ? activeRaw.map((p) => ({
        ...p,
        excludeProductKeys: Array.from(new Set([...p.excludeProductKeys, ...neverKeys])),
      }))
    : activeRaw;

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
  const [promotions, neverDiscountKeys] = await Promise.all([
    getPublishedPromotions(),
    // Fail-safe: on any error this returns [] and deals behave as before.
    listNeverDiscountKeys(),
  ]);
  return evaluateCart(cart, promotions, { ...opts, neverDiscountKeys });
}
