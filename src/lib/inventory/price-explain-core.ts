/**
 * src/lib/inventory/price-explain-core.ts
 *
 * R32 (T-328) — EXPLAINABLE ONBOARDING PRICE ("price waterfall").
 *
 * WHY THIS EXISTS
 *   The onboarding "AI suggests" fine print used to be a frozen sentence
 *   ("New product, no sales history yet — starting at the 2× (tax-inclusive,
 *   rounded up to the next dollar) floor.") that (a) did not say what the
 *   floor actually is (2× cost PLUS tax, then rounded up to the next whole
 *   dollar), (b) never showed the numbers, and (c) said "New product" even for
 *   restocks, because sales were looked up by the per-delivery POS key.
 *
 *   Enterprise pricing tools (price waterfalls in CPQ / revenue-management
 *   systems) never show a bare number: every suggested price is shown as an
 *   ordered list of steps from cost to shelf price, each step labelled with
 *   the rule that produced it, plus the data the demand adjustment used (how
 *   many units, over what window, from which deliveries). That way, when the
 *   suggestion CHANGES because sales history changed, the text says exactly
 *   why — nobody has to guess.
 *
 * WHAT IT DOES (pure — no DB, no server-only imports; trivially testable)
 *   explainPrice({ costMinor, multiple, category, velocity, asOf })
 *     → { floorMinor, suggestedMinor, steps[], band, rationale }
 *
 *   The math is the SAME math the floor has always used (T-319):
 *       base         = cost × multiple                 (pre-tax markup)
 *       taxInclusive = base × (1 + tax rate)           (46.3% cannabis / 9.3% merch)
 *       floor        = round UP to the next whole dollar
 *       suggested    = round UP(floor × demand band), never below floor
 *   The tax constants come from order-pricing-core.ts (single source of truth
 *   shared with the cart and menu), so the explanation can never disagree
 *   with what the customer is charged.
 */
import {
  CANNABIS_EXCISE_TAX_RATE,
  LOCAL_SALES_TAX_RATE,
  COMBINED_INCLUSIVE_TAX_RATE,
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";

/** One whole dollar in minor units. */
export const PRICE_WHOLE_DOLLAR_MINOR = 100;

/** Round UP to the next whole dollar ($14.63 → $15.00; $15.00 stays $15.00). */
export function roundUpToWholeDollarMinor(amountMinor: number): number {
  // Guard float noise (e.g. 1500.0000000002 must stay $15, not jump to $16).
  const cleaned = Math.round(amountMinor * 1e6) / 1e6;
  return Math.ceil(cleaned / PRICE_WHOLE_DOLLAR_MINOR) * PRICE_WHOLE_DOLLAR_MINOR;
}

/** Tax-inclusive divisor for a category (cannabis 1.463 / non-cannabis 1.093). */
export function priceTaxDivisorFor(category: string | null | undefined): number {
  return isNonCannabisCategory(category) ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR : TAX_INCLUSIVE_DIVISOR;
}

function pct(rate: number): string {
  // 0.463 → "46.3%", 0.37 → "37%", 0.093 → "9.3%"
  const v = Math.round(rate * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** Human tax label for a category, e.g. "46.3% tax (37% excise + 9.3% sales)". */
export function priceTaxLabelFor(category: string | null | undefined): string {
  if (isNonCannabisCategory(category)) return `${pct(LOCAL_SALES_TAX_RATE)} sales tax`;
  return `${pct(COMBINED_INCLUSIVE_TAX_RATE)} tax (${pct(CANNABIS_EXCISE_TAX_RATE)} excise + ${pct(LOCAL_SALES_TAX_RATE)} sales)`;
}

/** Short tax label for the one-line rationale, e.g. "46.3% tax". */
export function priceTaxShortLabelFor(category: string | null | undefined): string {
  return isNonCannabisCategory(category)
    ? `${pct(LOCAL_SALES_TAX_RATE)} sales tax`
    : `${pct(COMBINED_INCLUSIVE_TAX_RATE)} tax`;
}

/** "$14.63" from 1463 minor units (display rounds to the nearest cent). */
export function fmtPriceMinor(minor: number): string {
  return `$${(Math.round(minor) / 100).toFixed(2)}`;
}

/** 2 → "2×", 2.5 → "2.5×". */
export function fmtMultiple(m: number): string {
  const v = Math.round(m * 100) / 100;
  return `${Number.isInteger(v) ? v.toFixed(0) : String(v)}×`;
}

/** The hard floor: round UP(cost × multiple × divisor). null when cost unknown. */
export function computePriceFloorMinor(
  costMinor: number | null | undefined,
  multiple: number,
  category: string | null | undefined,
): number | null {
  if (costMinor == null || !Number.isFinite(costMinor) || costMinor <= 0) return null;
  if (!Number.isFinite(multiple) || multiple <= 0) return null;
  return roundUpToWholeDollarMinor(costMinor * multiple * priceTaxDivisorFor(category));
}

/**
 * Where the sales numbers came from.
 *   "product" — every delivery of this same product (KB identity + same size).
 *   "delivery" — only this delivery's POS key (no identity to widen with).
 */
export type PriceVelocityBasis = "product" | "delivery";

export type PriceVelocityInput = {
  unitsSold: number;
  /** Real number of days the sales window covers (≥1). */
  windowDays: number;
  basis: PriceVelocityBasis;
  /** How many deliveries (POS keys) the sales were summed over. */
  deliveriesCounted: number;
};

/** Demand bands (units/day → uplift over the floor). Tunable; deliberately conservative. */
export const PRICE_DEMAND_BANDS: ReadonlyArray<{
  id: "high" | "steady" | "modest" | "slow";
  minPerDay: number;
  multiplier: number;
  label: string;
}> = [
  { id: "high", minPerDay: 3, multiplier: 1.25, label: "High demand" },
  { id: "steady", minPerDay: 1, multiplier: 1.12, label: "Steady seller" },
  { id: "modest", minPerDay: 0.25, multiplier: 1.05, label: "Modest movement" },
  { id: "slow", minPerDay: 0, multiplier: 1.0, label: "Slow mover" },
];

export type PriceBandId = "no_cost" | "no_history" | "no_sales" | "high" | "steady" | "modest" | "slow";

export type PriceStep = {
  /** Stable key (for UI + tests). */
  key: "cost" | "markup" | "tax" | "floor" | "demand" | "suggested";
  label: string;
  /** Amount after this step, minor units (null for informational steps). */
  amountMinor: number | null;
  detail: string;
};

export type PriceExplanation = {
  floorMinor: number | null;
  suggestedMinor: number | null;
  band: PriceBandId;
  multiplier: number;
  steps: PriceStep[];
  /** One accurate sentence for the fine print (always mentions "tax-inclusive" when priced). */
  rationale: string;
};

function perDayText(perDay: number): string {
  return perDay >= 1 ? perDay.toFixed(1) : perDay.toFixed(2);
}

function basisText(v: PriceVelocityInput): string {
  if (v.basis === "product") {
    return v.deliveriesCounted > 1
      ? `across all ${v.deliveriesCounted} deliveries of this product`
      : "for this product";
  }
  return "for this delivery";
}

function fmtDay(asOf: Date | null | undefined): string | null {
  if (!asOf || Number.isNaN(asOf.getTime())) return null;
  return asOf.toISOString().slice(0, 10);
}

/** Build the full, step-by-step explanation of the floor and the suggestion. */
export function explainPrice(input: {
  costMinor: number | null | undefined;
  multiple: number;
  category: string | null | undefined;
  velocity: PriceVelocityInput | null;
  asOf?: Date | null;
}): PriceExplanation {
  const { costMinor, multiple, category, velocity } = input;
  const floor = computePriceFloorMinor(costMinor, multiple, category);
  if (floor == null || costMinor == null) {
    return {
      floorMinor: null,
      suggestedMinor: null,
      band: "no_cost",
      multiplier: 1,
      steps: [],
      rationale: "No vendor cost on this product yet — add the cost to enable pricing.",
    };
  }

  const base = costMinor * multiple;
  const taxed = base * priceTaxDivisorFor(category);
  const mx = fmtMultiple(multiple);
  const taxShort = priceTaxShortLabelFor(category);
  const steps: PriceStep[] = [
    { key: "cost", label: "Vendor cost", amountMinor: costMinor, detail: `Per-unit cost from the manifest: ${fmtPriceMinor(costMinor)}.` },
    { key: "markup", label: `${mx} markup`, amountMinor: base, detail: `${fmtPriceMinor(costMinor)} × ${multiple} = ${fmtPriceMinor(base)} before tax.` },
    {
      key: "tax",
      label: `+ ${priceTaxLabelFor(category)}`,
      amountMinor: taxed,
      detail: `${fmtPriceMinor(base)} × ${priceTaxDivisorFor(category)} = ${fmtPriceMinor(taxed)} tax-inclusive (what the customer pays out the door).`,
    },
    {
      key: "floor",
      label: "Rounded up to the next dollar = floor",
      amountMinor: floor,
      detail: `${fmtPriceMinor(taxed)} → ${fmtPriceMinor(floor)}. No price can be set below this.`,
    },
  ];
  const floorPhrase = `${mx} cost (${fmtPriceMinor(costMinor)} → ${fmtPriceMinor(base)}) + ${taxShort} = ${fmtPriceMinor(taxed)} tax-inclusive, rounded up to ${fmtPriceMinor(floor)}`;
  const day = fmtDay(input.asOf ?? null);
  const checked = day ? ` (sales checked ${day})` : "";

  // No sales data at all → the suggestion IS the floor.
  if (!velocity || !Number.isFinite(velocity.windowDays) || velocity.windowDays <= 0) {
    steps.push({ key: "demand", label: "No sales history yet", amountMinor: null, detail: "Nothing to adjust for — suggestion stays at the floor." });
    steps.push({ key: "suggested", label: "Suggested price", amountMinor: floor, detail: `${fmtPriceMinor(floor)} (the floor).` });
    return {
      floorMinor: floor,
      suggestedMinor: floor,
      band: "no_history",
      multiplier: 1,
      steps,
      rationale: `No sales history for this product yet, so the suggestion is the floor: ${floorPhrase}${checked}.`,
    };
  }

  const windowDays = Math.max(1, Math.round(velocity.windowDays));
  const units = Math.max(0, velocity.unitsSold);
  const unitsText = `${units} sold in the last ${windowDays} day${windowDays === 1 ? "" : "s"}`;

  if (units === 0) {
    steps.push({ key: "demand", label: "No sales in the window", amountMinor: null, detail: `0 sold in the last ${windowDays} days ${basisText(velocity)} — held at the floor.` });
    steps.push({ key: "suggested", label: "Suggested price", amountMinor: floor, detail: `${fmtPriceMinor(floor)} (the floor).` });
    return {
      floorMinor: floor,
      suggestedMinor: floor,
      band: "no_sales",
      multiplier: 1,
      steps,
      rationale: `No sales in the last ${windowDays} days ${basisText(velocity)}, so the suggestion is held at the floor: ${floorPhrase}${checked}.`,
    };
  }

  const perDay = units / windowDays;
  const band = PRICE_DEMAND_BANDS.find((b) => perDay >= b.minPerDay) ?? PRICE_DEMAND_BANDS[PRICE_DEMAND_BANDS.length - 1];
  let suggested = roundUpToWholeDollarMinor(floor * band.multiplier);
  if (suggested < floor) suggested = floor;
  const upliftPct = Math.round((band.multiplier - 1) * 100);
  const evidence = `${unitsText} (~${perDayText(perDay)}/day) ${basisText(velocity)}`;

  if (band.multiplier <= 1) {
    steps.push({ key: "demand", label: band.label, amountMinor: null, detail: `${evidence} — held at the floor to keep it moving.` });
    steps.push({ key: "suggested", label: "Suggested price", amountMinor: suggested, detail: `${fmtPriceMinor(suggested)} (the floor).` });
    return {
      floorMinor: floor,
      suggestedMinor: suggested,
      band: band.id,
      multiplier: band.multiplier,
      steps,
      rationale: `${band.label}: ${evidence}, so the suggestion is held at the floor: ${floorPhrase}${checked}.`,
    };
  }

  steps.push({
    key: "demand",
    label: `${band.label} → +${upliftPct}%`,
    amountMinor: floor * band.multiplier,
    detail: `${evidence}. ${fmtPriceMinor(floor)} × ${band.multiplier} = ${fmtPriceMinor(floor * band.multiplier)}.`,
  });
  steps.push({ key: "suggested", label: "Suggested price (rounded up to the next dollar)", amountMinor: suggested, detail: `${fmtPriceMinor(suggested)}.` });
  return {
    floorMinor: floor,
    suggestedMinor: suggested,
    band: band.id,
    multiplier: band.multiplier,
    steps,
    rationale: `${band.label}: ${evidence}, so the suggestion is +${upliftPct}% over the floor, rounded up to ${fmtPriceMinor(suggested)}. Floor: ${floorPhrase}${checked}.`,
  };
}

// ── Identity-wide velocity planning (pure) ───────────────────────────────────
//
// THE BUG THIS FIXES: sales were looked up by the CURRENT delivery's
// pos_product_key. Without a vendor SKU that key is new on every delivery, so a
// restock of a best seller always read "no sales history". The fix is to sum
// sales over EVERY delivery of the same product: same KB identity_key (vendor
// | category | product family, S03) AND the same package size (identity
// deliberately carries no size, and a 1g and a 3.5g must not share a demand
// signal).
//
// The window is HONEST: if the product first arrived 12 days ago we divide by
// 12, not by a fake 60 (the old code always divided by the full lookback).

export type VelocityPriorLot = {
  pos_product_key: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  /** received_on (preferred) or created_at, ISO. */
  arrived_at: string | null;
};

export type VelocityPlan = {
  keys: string[];
  basis: PriceVelocityBasis;
  deliveriesCounted: number;
  windowDays: number;
};

/** Max POS keys summed in one lookup (bounded .in() lists). */
export const VELOCITY_MAX_KEYS = 60;

function sameSize(
  a: { unit_weight: number | null; unit_weight_uom: string | null },
  b: { unit_weight: number | null; unit_weight_uom: string | null },
): boolean {
  const wa = a.unit_weight == null ? null : Number(a.unit_weight);
  const wb = b.unit_weight == null ? null : Number(b.unit_weight);
  if (wa == null || wb == null) return wa == null && wb == null;
  if (Math.abs(wa - wb) > 1e-6) return false;
  return (a.unit_weight_uom ?? "").trim().toLowerCase() === (b.unit_weight_uom ?? "").trim().toLowerCase();
}

export function planVelocityKeys(input: {
  currentKey: string | null;
  current: { unit_weight: number | null; unit_weight_uom: string | null };
  priorLots: VelocityPriorLot[] | null;
  lookbackDays: number;
  now: Date;
}): VelocityPlan | null {
  const lookback = Math.max(1, Math.round(input.lookbackDays));
  const keys: string[] = [];
  const seen = new Set<string>();
  let earliest: number | null = null;
  const add = (k: string | null) => {
    const key = (k ?? "").trim();
    if (!key || seen.has(key) || keys.length >= VELOCITY_MAX_KEYS) return false;
    seen.add(key);
    keys.push(key);
    return true;
  };
  add(input.currentKey);
  const prior = (input.priorLots ?? []).filter((l) => sameSize(l, input.current));
  // Newest first so the cap keeps the most relevant deliveries.
  prior.sort((a, b) => (Date.parse(b.arrived_at ?? "") || 0) - (Date.parse(a.arrived_at ?? "") || 0));
  for (const l of prior) {
    if (add(l.pos_product_key)) {
      const t = Date.parse(l.arrived_at ?? "");
      if (Number.isFinite(t)) earliest = earliest == null ? t : Math.min(earliest, t);
    }
  }
  if (keys.length === 0) return null;
  const nowMs = input.now.getTime();
  let windowDays = lookback;
  if (earliest != null) {
    const ageDays = Math.ceil((nowMs - earliest) / 86_400_000);
    windowDays = Math.max(1, Math.min(lookback, ageDays));
  }
  const basis: PriceVelocityBasis = keys.length > 1 ? "product" : "delivery";
  return { keys, basis, deliveriesCounted: keys.length, windowDays };
}

// ── Presenting a stored draft price (pure) ───────────────────────────────────
//
// Drafts seeded BEFORE R32 carry the old frozen sentences in
// catalog_product_drafts.price_rationale (e.g. "New product, no sales history
// yet — starting at the 2× (tax-inclusive, rounded up to the next dollar)
// floor."). We never rewrite history in the DB; instead the page recognises
// those legacy sentences and shows the accurate, numbers-included wording.
// The waterfall is recomputed LIVE from the draft's cost + category + the
// current markup setting, and flags drift if the stored floor no longer
// matches (e.g. the owner changed the markup multiple since seeding).

/** Prefixes of every rationale suggestPrice produced before R32. */
export const LEGACY_PRICE_RATIONALE_PREFIXES: readonly string[] = [
  "New product, no sales history yet",
  "High demand (~",
  "Steady seller (~",
  "Modest movement (~",
  "Slow mover (~",
  "Low movement so far",
];

export function isLegacyPriceRationale(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.length > 0 && LEGACY_PRICE_RATIONALE_PREFIXES.some((p) => t.startsWith(p));
}

export type DraftPricePresentation = {
  /** The fine print to show (always accurate). */
  note: string;
  /** Waterfall rows for the "How this price was set" disclosure. */
  steps: PriceStep[];
  /** True when the stored sentence was a pre-R32 one we replaced on display. */
  legacyReplaced: boolean;
  /** True when the stored floor differs from the floor under current settings. */
  floorDrift: boolean;
  liveFloorMinor: number | null;
};

export function presentDraftPrice(input: {
  storedRationale: string | null | undefined;
  costMinor: number | null | undefined;
  category: string | null | undefined;
  multiple: number;
  storedFloorMinor: number | null | undefined;
  storedSuggestedMinor: number | null | undefined;
}): DraftPricePresentation {
  const live = explainPrice({ costMinor: input.costMinor, multiple: input.multiple, category: input.category, velocity: null });
  const liveFloor = live.floorMinor;
  const storedFloor = input.storedFloorMinor ?? null;
  const floorDrift = liveFloor != null && storedFloor != null && liveFloor !== storedFloor;
  const legacy = isLegacyPriceRationale(input.storedRationale);
  const stored = (input.storedRationale ?? "").trim();

  // Waterfall: the four floor steps are recomputed live; the demand step
  // reports what the stored suggestion did relative to the stored floor.
  const steps: PriceStep[] = live.steps.filter((s) => s.key === "cost" || s.key === "markup" || s.key === "tax" || s.key === "floor");
  const sugg = input.storedSuggestedMinor ?? null;
  if (liveFloor != null && sugg != null) {
    const base = storedFloor ?? liveFloor;
    if (sugg > base) {
      const up = Math.round(((sugg - base) / base) * 100);
      steps.push({ key: "demand", label: `Sales-history uplift (+${up}%)`, amountMinor: null, detail: `Suggested ${fmtPriceMinor(sugg)} vs. floor ${fmtPriceMinor(base)}, from sales of this product at onboarding.` });
    } else {
      steps.push({ key: "demand", label: "No sales uplift", amountMinor: null, detail: "Suggestion was held at the floor." });
    }
    steps.push({ key: "suggested", label: "Suggested price", amountMinor: sugg, detail: `${fmtPriceMinor(sugg)}.` });
  }

  let note: string;
  if (live.band === "no_cost") note = live.rationale;
  else if (!stored || legacy) {
    // Legacy or empty: rebuild an accurate sentence from the stored numbers.
    if (sugg != null && storedFloor != null && sugg > storedFloor) {
      const up = Math.round(((sugg - storedFloor) / storedFloor) * 100);
      const floorPhrase = live.rationale.replace(/^No sales history for this product yet, so the suggestion is the floor: /, "");
      note = `Sales history at onboarding raised the suggestion ${up}% over the floor, to ${fmtPriceMinor(sugg)}. Floor: ${floorPhrase}`;
    } else {
      note = live.rationale;
    }
  } else note = stored;
  if (floorDrift && liveFloor != null) {
    note = `${note} Note: under the current markup setting the floor is now ${fmtPriceMinor(liveFloor)}.`;
  }
  return { note, steps, legacyReplaced: legacy, floorDrift, liveFloorMinor: liveFloor };
}

// ── Self-tests (registered in scripts/compliance/run-pure-selftests.ts) ─────
export function __runPriceExplainCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ price-explain-core: ${name}`);
    }
  };

  // Michael's worked example: $5 cost flower → $10 → $14.63 → $15.
  const a = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: null });
  ok(a.floorMinor === 1500 && a.suggestedMinor === 1500, "worked example floors at $15");
  ok(a.band === "no_history", "null velocity is no_history");
  ok(a.rationale.includes("tax-inclusive"), "rationale says tax-inclusive");
  ok(a.rationale.includes("$5.00 → $10.00") && a.rationale.includes("$14.63") && a.rationale.includes("$15.00"), "rationale shows the math");
  ok(a.rationale.includes("2× cost") && a.rationale.includes("46.3% tax"), "rationale names markup + tax");
  ok(!a.rationale.includes("New product"), "no longer claims 'New product'");
  ok(a.steps.map((s) => s.key).join(",") === "cost,markup,tax,floor,demand,suggested", "six ordered steps");
  ok(a.steps[2].label.includes("37% excise + 9.3% sales"), "tax step itemises excise + sales");

  // Non-cannabis: 9.3% only. $5 → $10 → $10.93 → $11.
  const m = explainPrice({ costMinor: 500, multiple: 2, category: "merch", velocity: null });
  ok(m.floorMinor === 1100, "merch floors at $11");
  ok(m.rationale.includes("9.3% sales tax") && !m.rationale.includes("46.3%"), "merch rationale uses 9.3% only");

  // No cost.
  const n = explainPrice({ costMinor: null, multiple: 2, category: "flower", velocity: null });
  ok(n.floorMinor === null && n.suggestedMinor === null && n.band === "no_cost", "no cost → no price");
  ok(n.rationale.startsWith("No vendor cost"), "no cost rationale");
  ok(explainPrice({ costMinor: 0, multiple: 2, category: "flower", velocity: null }).band === "no_cost", "zero cost → no_cost");

  // 3× multiple matches the floor test: 500×3×1.463 = 2194.5 → $22.
  const t = explainPrice({ costMinor: 500, multiple: 3, category: "flower", velocity: null });
  ok(t.floorMinor === 2200 && t.rationale.includes("3× cost"), "3× floor + label");

  // Already-whole stays whole (float guard): 1000 × 1 × 1.5 is not used; use a
  // cost that lands exactly on a dollar: cost 1025, ×2 = 2050, ×1.463 = 2999.15 → $30.
  ok(computePriceFloorMinor(1025, 2, "flower") === 3000, "rounding up to $30");
  ok(roundUpToWholeDollarMinor(1500.0000000002) === 1500, "float noise does not add a dollar");
  ok(roundUpToWholeDollarMinor(1501) === 1600, "1501 → 1600");

  // Velocity bands (60-day window).
  const v = (units: number, basis: PriceVelocityBasis = "product", deliveries = 3): PriceVelocityInput => ({
    unitsSold: units,
    windowDays: 60,
    basis,
    deliveriesCounted: deliveries,
  });
  const hi = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(200) });
  ok(hi.band === "high" && hi.suggestedMinor === 1900, "high demand +25% → $18.75 → $19");
  ok(hi.rationale.includes("200 sold in the last 60 days") && hi.rationale.includes("all 3 deliveries"), "high rationale has evidence + basis");
  ok(hi.rationale.includes("+25%") && hi.rationale.includes("tax-inclusive"), "high rationale has uplift + tax-inclusive");
  const st = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(75) });
  ok(st.band === "steady" && st.suggestedMinor === 1700, "steady +12% → $16.80 → $17");
  const mo = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(20, "delivery", 1) });
  ok(mo.band === "modest" && mo.suggestedMinor === 1600 && mo.rationale.includes("for this delivery"), "modest +5% → $15.75 → $16, delivery basis");
  const sl = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(4) });
  ok(sl.band === "slow" && sl.suggestedMinor === 1500 && sl.rationale.includes("held at the floor"), "slow holds at floor");
  const zero = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(0) });
  ok(zero.band === "no_sales" && zero.suggestedMinor === 1500, "zero units → no_sales at floor");
  ok(zero.rationale.includes("No sales in the last 60 days"), "zero rationale is honest");
  const single = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(75, "product", 1) });
  ok(single.rationale.includes("for this product") && !single.rationale.includes("all 1"), "single delivery wording");

  // Boundaries: exactly 3/day is high; just under is steady.
  ok(explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(180) }).band === "high", "3.0/day is high");
  ok(explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(179) }).band === "steady", "2.98/day is steady");
  ok(explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(60) }).band === "steady", "1.0/day is steady");
  ok(explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(15) }).band === "modest", "0.25/day is modest");
  ok(explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: v(14) }).band === "slow", "0.23/day is slow");

  // Never below floor; always whole dollars.
  for (const units of [0, 1, 14, 15, 59, 60, 179, 180, 999]) {
    const e = explainPrice({ costMinor: 733, multiple: 2, category: "edible-solid", velocity: v(units) });
    ok(e.suggestedMinor! >= e.floorMinor! && e.suggestedMinor! % 100 === 0, `whole-dollar & ≥ floor @${units}`);
  }

  // asOf stamp.
  const d = explainPrice({ costMinor: 500, multiple: 2, category: "flower", velocity: null, asOf: new Date("2026-03-04T12:00:00Z") });
  ok(d.rationale.endsWith("$15.00 (sales checked 2026-03-04)."), "asOf stamp appended");
  ok(!a.rationale.includes("sales checked"), "no stamp without asOf");

  // Labels.
  ok(fmtMultiple(2.5) === "2.5×" && fmtMultiple(2) === "2×", "fmtMultiple");
  ok(priceTaxShortLabelFor("flower") === "46.3% tax", "short tax label");
  ok(priceTaxDivisorFor("accessories") === NON_CANNABIS_TAX_INCLUSIVE_DIVISOR, "accessories divisor");

  // Velocity planning.
  const now = new Date("2026-03-01T00:00:00Z");
  const sz = { unit_weight: 3.5, unit_weight_uom: "g" };
  const p1 = planVelocityKeys({
    currentKey: "K-NEW",
    current: sz,
    priorLots: [
      { pos_product_key: "K-A", unit_weight: 3.5, unit_weight_uom: "G", arrived_at: "2026-02-19T00:00:00Z" },
      { pos_product_key: "K-B", unit_weight: 3.5, unit_weight_uom: "g", arrived_at: "2026-02-25T00:00:00Z" },
      { pos_product_key: "K-1G", unit_weight: 1, unit_weight_uom: "g", arrived_at: "2025-12-01T00:00:00Z" },
      { pos_product_key: "K-NEW", unit_weight: 3.5, unit_weight_uom: "g", arrived_at: "2026-03-01T00:00:00Z" },
      { pos_product_key: "", unit_weight: 3.5, unit_weight_uom: "g", arrived_at: "2026-01-01T00:00:00Z" },
    ],
    lookbackDays: 60,
    now,
  });
  ok(p1 != null && p1.keys.join(",") === "K-NEW,K-B,K-A", "same-size prior deliveries, deduped, newest first");
  ok(p1 != null && !p1.keys.includes("K-1G"), "a different size never shares demand");
  ok(p1 != null && p1.basis === "product" && p1.deliveriesCounted === 3, "product basis over 3 deliveries");
  ok(p1 != null && p1.windowDays === 10, "honest window = days since first same-size delivery (Feb 19 → Mar 1 = 10)");
  const p2 = planVelocityKeys({ currentKey: "K-X", current: sz, priorLots: [], lookbackDays: 60, now });
  ok(p2 != null && p2.basis === "delivery" && p2.windowDays === 60 && p2.keys.length === 1, "no priors → delivery basis");
  ok(planVelocityKeys({ currentKey: null, current: sz, priorLots: null, lookbackDays: 60, now }) === null, "nothing to look up → null");
  const old = planVelocityKeys({
    currentKey: "K",
    current: sz,
    priorLots: [{ pos_product_key: "K-OLD", unit_weight: 3.5, unit_weight_uom: "g", arrived_at: "2025-01-01T00:00:00Z" }],
    lookbackDays: 60,
    now,
  });
  ok(old != null && old.windowDays === 60, "window capped at lookback");
  const many = planVelocityKeys({
    currentKey: "K",
    current: sz,
    priorLots: Array.from({ length: 100 }, (_, i) => ({ pos_product_key: `P${i}`, unit_weight: 3.5, unit_weight_uom: "g", arrived_at: null })),
    lookbackDays: 60,
    now,
  });
  ok(many != null && many.keys.length === VELOCITY_MAX_KEYS, "key list bounded");
  const nul = planVelocityKeys({
    currentKey: "K",
    current: { unit_weight: null, unit_weight_uom: null },
    priorLots: [
      { pos_product_key: "N1", unit_weight: null, unit_weight_uom: null, arrived_at: null },
      { pos_product_key: "N2", unit_weight: 1, unit_weight_uom: "g", arrived_at: null },
    ],
    lookbackDays: 60,
    now,
  });
  ok(nul != null && nul.keys.join(",") === "K,N1", "unknown size only matches unknown size");

  // Presenter — the exact sentence Michael quoted is recognised and replaced.
  const OLD = "New product, no sales history yet — starting at the 2× (tax-inclusive, rounded up to the next dollar) floor.";
  ok(isLegacyPriceRationale(OLD), "Michael's quoted sentence is legacy");
  ok(isLegacyPriceRationale("Steady seller (~1.2 sold/day) — +12% over floor."), "old band sentence is legacy");
  ok(!isLegacyPriceRationale(a.rationale) && !isLegacyPriceRationale(hi.rationale), "new sentences are not legacy");
  ok(!isLegacyPriceRationale(null) && !isLegacyPriceRationale(""), "empty is not legacy");
  const pr = presentDraftPrice({ storedRationale: OLD, costMinor: 500, category: "flower", multiple: 2, storedFloorMinor: 1500, storedSuggestedMinor: 1500 });
  ok(pr.legacyReplaced && !pr.note.includes("New product") && pr.note.includes("$14.63"), "legacy replaced with accurate math");
  ok(!pr.floorDrift && pr.liveFloorMinor === 1500, "no drift when settings unchanged");
  ok(pr.steps.map((s) => s.key).join(",") === "cost,markup,tax,floor,demand,suggested", "presenter waterfall rows");
  const pu = presentDraftPrice({ storedRationale: "Steady seller (~1.2 sold/day) — +12% over floor.", costMinor: 500, category: "flower", multiple: 2, storedFloorMinor: 1500, storedSuggestedMinor: 1700 });
  ok(pu.note.startsWith("Sales history at onboarding raised the suggestion 13% over the floor, to $17.00.") && pu.note.includes("tax-inclusive"), "legacy uplift rebuilt honestly");
  ok(pu.steps.some((s) => s.key === "demand" && s.label.includes("+13%")), "uplift waterfall row");
  const pk = presentDraftPrice({ storedRationale: hi.rationale, costMinor: 500, category: "flower", multiple: 2, storedFloorMinor: 1500, storedSuggestedMinor: 1900 });
  ok(pk.note === hi.rationale && !pk.legacyReplaced, "new stored sentence shown verbatim");
  const dr = presentDraftPrice({ storedRationale: a.rationale, costMinor: 500, category: "flower", multiple: 3, storedFloorMinor: 1500, storedSuggestedMinor: 1500 });
  ok(dr.floorDrift && dr.note.includes("floor is now $22.00"), "markup change flagged as drift");
  const nc = presentDraftPrice({ storedRationale: OLD, costMinor: null, category: "flower", multiple: 2, storedFloorMinor: null, storedSuggestedMinor: null });
  ok(nc.note.startsWith("No vendor cost") && nc.steps.length === 0, "no-cost presenter");

  return { passed, failed };
}
