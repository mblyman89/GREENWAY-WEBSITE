/**
 * src/lib/purchasing/po-market-context-core.ts
 *
 * PURE market-context shaping for the PO builder + PO detail page (Task I, I6).
 * Owner's ask (verbatim intent): "the purchase order detail page, where my
 * purchase manager actually builds the p.o.'s. I need this to be a super easy
 * super clean super helpful page for my manager to build the best p.o.'s
 * possible that focus on port orchard and local competitor insights from ai."
 *
 * Crosses the lines of a purchase order (or the builder's candidate rows)
 * against the persisted monthly CCRS market signals (migrations 0106/0110)
 * and the verified WSLCB competitor roster to answer, per line:
 *
 *   "Is this exact product (or at least this brand) a PROVEN mover — locally
 *    in Port Orchard or statewide — and what retail price does it move at?"
 *
 * HONESTY (standing rules — NEVER GUESS):
 *  - Matching is CONSERVATIVE: exact product-name equality after normalizeKey
 *    (lowercase/trim/collapse-ws) first; brand-level equality as a weaker
 *    fallback; otherwise "none". No fuzzy matching — a near-miss shows as
 *    unmatched rather than being silently matched to the wrong product.
 *  - PO line unit costs are WHOLESALE; mover prices are observed RETAIL sale
 *    prices. They are DIFFERENT BASES: the context reports the retail band as
 *    demand/pricing evidence and (when both are known) the arithmetic
 *    retail÷cost multiple — a real division, clearly labeled, never a margin
 *    claim about Greenway's own future pricing.
 *  - Area emphasis is roster-driven: signals from tracked stores in the target
 *    area (default port_orchard) are counted separately from statewide
 *    evidence; the aggregator structurally excludes Greenway (is_self), so
 *    local evidence is genuinely about competitors.
 *  - p25 across multiple matches is the MINIMUM (a factual bound: at/below it
 *    undercuts ~75% of observed sales at every matched source); the median
 *    shown comes from the single highest-revenue match (labeled proxy).
 *  - Junk numbers coerce to 0/null exactly like market-leads-core — never a
 *    fabricated figure. Money in MINOR UNITS end to end.
 *  - Pure module: no I/O — covered by
 *    tests/compliance/po-market-context-core.test.ts.
 */
import type { DiscoveryCompetitorArea } from "@/lib/discovery/types";
import { normalizeKey } from "@/lib/discovery/assortment-gap-core";

// ---------------------------------------------------------------------------
// Inputs — structurally match PurchaseOrderLine / NewPoLine / SuggestionRow,
// DiscoveryMarketSignalRow, and DiscoveryCompetitor.
// ---------------------------------------------------------------------------

export type PoLineLike = {
  product_name: string;
  brand: string | null;
  category: string | null;
  order_qty: number;
  unit_cost_minor_units: number;
};

export type PoContextSignalLike = {
  kind: "statewide_mover" | "competitor_mover" | "type_mover";
  license_number: string | null;
  inventory_type: string | null;
  product_name: string | null;
  brand: string | null;
  strain_name: string | null;
  units: number;
  revenue_minor: number;
  median_unit_price_minor: number | null;
  p25_unit_price_minor: number | null;
  vendor_name?: string | null;
  vendor_license?: string | null;
};

export type PoContextRosterEntryLike = {
  license_number: string;
  tradename: string;
  area: DiscoveryCompetitorArea;
  is_self: boolean;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type PoLineMatchType = "exact" | "brand" | "none";

export type PoLineMarketContext = {
  /** The PO line's own fields, echoed for rendering. */
  productName: string;
  brand: string | null;
  category: string | null;
  orderQty: number;
  unitCostMinor: number;
  /** exact = same normalized product name; brand = same normalized brand only. */
  matchType: PoLineMatchType;
  /** True when at least one matching signal came from a tracked AREA store. */
  areaMatch: boolean;
  /** Tracked-area store tradenames with a matching signal (evidence, deduped). */
  areaStores: string[];
  /** True when a statewide/type mover matched (state-level demand evidence). */
  statewideMatch: boolean;
  /** Summed over matching signals (this drop only). */
  totalUnits: number;
  totalRevenueMinor: number;
  /** Observed retail median from the single highest-revenue match (proxy). */
  medianUnitPriceMinor: number | null;
  /** MIN observed retail p25 across matches — the local "price to beat". */
  p25UnitPriceMinor: number | null;
  /**
   * p25 retail ÷ wholesale unit cost, 1 decimal — plain arithmetic shown only
   * when BOTH are known and cost > 0. Retail and cost are different bases;
   * this is a sanity multiple, not a margin claim.
   */
  retailCostMultiple: number | null;
};

export type PoCategoryMixRow = {
  /** The line's own category string (or "(uncategorized)"). */
  category: string;
  lineCount: number;
  orderQty: number;
  spendMinor: number;
  /** Share of the order's total spend (0 when the total is 0). */
  spendShare: number;
};

export type PoMarketContext = {
  area: DiscoveryCompetitorArea;
  lines: PoLineMarketContext[];
  /** Lines with any market evidence (exact or brand). */
  matchedCount: number;
  exactCount: number;
  /** Order mix by the lines' own categories, spend desc. */
  mix: PoCategoryMixRow[];
  totalSpendMinor: number;
};

// ---------------------------------------------------------------------------
// Coercion helpers (market-leads-core discipline: junk → 0/null).
// ---------------------------------------------------------------------------

function toFiniteNonNegative(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

function minorOrNull(n: unknown): number | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function cleanStr(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildPoMarketContext(
  lines: PoLineLike[],
  signals: PoContextSignalLike[],
  roster: PoContextRosterEntryLike[],
  opts?: { area?: DiscoveryCompetitorArea },
): PoMarketContext {
  const area: DiscoveryCompetitorArea = opts?.area ?? "port_orchard";
  const areaNameByLicense = new Map(
    roster.filter((r) => r.area === area && !r.is_self).map((r) => [r.license_number, r.tradename]),
  );

  // Index signals by normalized name and by normalized brand ONCE.
  type Indexed = { signal: PoContextSignalLike; areaStore: string | null; statewide: boolean };
  const byName = new Map<string, Indexed[]>();
  const byBrand = new Map<string, Indexed[]>();
  for (const s of signals) {
    const nameKey = normalizeKey(s.product_name);
    if (!nameKey) continue;
    let areaStore: string | null = null;
    let statewide = false;
    if (s.kind === "competitor_mover") {
      const lic = cleanStr(s.license_number);
      areaStore = lic ? (areaNameByLicense.get(lic) ?? null) : null;
      // A competitor mover from an untracked/out-of-area store is neither area
      // evidence nor statewide evidence — skip it (never mislabel provenance).
      if (!areaStore) continue;
    } else {
      statewide = true;
    }
    const entry: Indexed = { signal: s, areaStore, statewide };
    const nameList = byName.get(nameKey);
    if (nameList) nameList.push(entry);
    else byName.set(nameKey, [entry]);
    const brandKey = normalizeKey(s.brand);
    if (brandKey) {
      const brandList = byBrand.get(brandKey);
      if (brandList) brandList.push(entry);
      else byBrand.set(brandKey, [entry]);
    }
  }

  const out: PoLineMarketContext[] = [];
  const mixMap = new Map<string, { lineCount: number; orderQty: number; spendMinor: number }>();
  let totalSpendMinor = 0;
  let matchedCount = 0;
  let exactCount = 0;

  for (const line of lines) {
    const productName = cleanStr(line.product_name);
    if (!productName) continue;
    const orderQty = toFiniteNonNegative(line.order_qty);
    const unitCostMinor = toFiniteNonNegative(line.unit_cost_minor_units);
    const spend = Math.round(orderQty * unitCostMinor);
    totalSpendMinor += spend;

    // Mix accumulation on the line's OWN category (never inferred).
    const category = cleanStr(line.category) ?? "(uncategorized)";
    const mixAcc = mixMap.get(category) ?? { lineCount: 0, orderQty: 0, spendMinor: 0 };
    mixAcc.lineCount += 1;
    mixAcc.orderQty += orderQty;
    mixAcc.spendMinor += spend;
    mixMap.set(category, mixAcc);

    // Conservative matching: exact name first, brand fallback.
    const nameKey = normalizeKey(productName);
    const brandKey = normalizeKey(line.brand);
    let matchType: PoLineMatchType = "none";
    let matches: Indexed[] = [];
    const exact = byName.get(nameKey);
    if (exact && exact.length > 0) {
      matchType = "exact";
      matches = exact;
    } else if (brandKey) {
      const brandMatches = byBrand.get(brandKey);
      if (brandMatches && brandMatches.length > 0) {
        matchType = "brand";
        matches = brandMatches;
      }
    }
    if (matchType !== "none") matchedCount += 1;
    if (matchType === "exact") exactCount += 1;

    // Aggregate the evidence.
    let totalUnits = 0;
    let totalRevenueMinor = 0;
    let minP25: number | null = null;
    let topRevenue = -1;
    let topMedian: number | null = null;
    const areaStores = new Set<string>();
    let statewideMatch = false;
    for (const m of matches) {
      const revenue = toFiniteNonNegative(m.signal.revenue_minor);
      totalUnits += toFiniteNonNegative(m.signal.units);
      totalRevenueMinor += revenue;
      const p25 = minorOrNull(m.signal.p25_unit_price_minor);
      if (p25 != null && (minP25 == null || p25 < minP25)) minP25 = p25;
      if (revenue > topRevenue) {
        topRevenue = revenue;
        topMedian = minorOrNull(m.signal.median_unit_price_minor);
      }
      if (m.areaStore) areaStores.add(m.areaStore);
      if (m.statewide) statewideMatch = true;
    }

    const retailCostMultiple =
      minP25 != null && unitCostMinor > 0
        ? Math.round((minP25 / unitCostMinor) * 10) / 10
        : null;

    out.push({
      productName,
      brand: cleanStr(line.brand),
      category: cleanStr(line.category),
      orderQty,
      unitCostMinor,
      matchType,
      areaMatch: areaStores.size > 0,
      areaStores: [...areaStores].sort((a, b) => a.localeCompare(b)),
      statewideMatch,
      totalUnits,
      totalRevenueMinor,
      medianUnitPriceMinor: matchType === "none" ? null : topMedian,
      p25UnitPriceMinor: matchType === "none" ? null : minP25,
      retailCostMultiple: matchType === "none" ? null : retailCostMultiple,
    });
  }

  const mix: PoCategoryMixRow[] = [...mixMap.entries()]
    .map(([category, acc]) => ({
      category,
      lineCount: acc.lineCount,
      orderQty: acc.orderQty,
      spendMinor: acc.spendMinor,
      spendShare: totalSpendMinor > 0 ? acc.spendMinor / totalSpendMinor : 0,
    }))
    .sort((a, b) => b.spendMinor - a.spendMinor || a.category.localeCompare(b.category));

  return { area, lines: out, matchedCount, exactCount, mix, totalSpendMinor };
}

// ---------------------------------------------------------------------------
// AI digest — the grounded fact block the PO reviewer reasons over. Money is
// shown in dollars for the model's benefit but comes from real minor-unit
// fields; nothing is fabricated. Kept PURE so it's compliance-testable.
// ---------------------------------------------------------------------------

function dollars(minor: number | null | undefined): string {
  if (minor == null) return "n/a";
  return `$${(minor / 100).toFixed(2)}`;
}

export function formatPoReviewDigest(
  po: {
    poNumber: string | null;
    vendorName: string | null;
    subtotalMinor: number;
    status: string;
  },
  context: PoMarketContext,
  areaLabel: string,
): string {
  const parts: string[] = [];
  parts.push(
    `PURCHASE ORDER: ${po.poNumber ?? "(unnumbered)"} · vendor=${po.vendorName ?? "not set"} · status=${po.status} · subtotal=${dollars(po.subtotalMinor)} · ${context.lines.length} line(s), ${context.matchedCount} with market evidence (${context.exactCount} exact matches).`,
  );

  if (context.lines.length > 0) {
    const rows = context.lines.map((l) => {
      const bits = [
        `name="${l.productName}"`,
        l.brand ? `brand=${l.brand}` : "brand=missing",
        l.category ? `category=${l.category}` : "category=missing",
        `qty=${l.orderQty}`,
        `unit_cost=${dollars(l.unitCostMinor)} (WHOLESALE)`,
        `match=${l.matchType}`,
      ];
      if (l.matchType !== "none") {
        bits.push(
          l.areaMatch
            ? `${areaLabel.toUpperCase()}_EVIDENCE=yes (${l.areaStores.join(", ")})`
            : `${areaLabel.toUpperCase()}_EVIDENCE=no`,
        );
        if (l.statewideMatch) bits.push("statewide_evidence=yes");
        bits.push(`observed_units=${Math.round(l.totalUnits)}`);
        bits.push(`observed_revenue=${dollars(l.totalRevenueMinor)}`);
        bits.push(`observed_retail_median=${dollars(l.medianUnitPriceMinor)}`);
        bits.push(`retail_price_to_beat_p25=${dollars(l.p25UnitPriceMinor)}`);
        if (l.retailCostMultiple != null) bits.push(`p25_retail_over_cost=${l.retailCostMultiple}x`);
      }
      return `- ${bits.join(", ")}`;
    });
    parts.push(`LINES:\n${rows.join("\n")}`);
  }

  if (context.mix.length > 0) {
    const rows = context.mix.map(
      (m) =>
        `- ${m.category}: ${m.lineCount} line(s), qty=${m.orderQty}, spend=${dollars(m.spendMinor)} (${Math.round(m.spendShare * 100)}% of order)`,
    );
    parts.push(`ORDER MIX (by the lines' own categories):\n${rows.join("\n")}`);
  }

  return parts.join("\n\n");
}
