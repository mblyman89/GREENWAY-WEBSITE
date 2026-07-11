/**
 * src/lib/discovery/market-leads-core.ts
 *
 * PURE market-mover lead logic for the Leads page and the AI leads advisor
 * (Task H, S4). Turns the persisted CCRS monthly-transformer market signals
 * (migration 0106 `discovery_market_signals`) plus the competitor roster into
 * lead-shaped rows the UI can render and the AI can reason over.
 *
 * Standing rules honored:
 *  - NEVER GUESS: every number here is passed through from the transformer's
 *    real aggregates. The "undercut target" is exactly the market's 25th
 *    percentile unit price (p25) — when the transformer had no p25 sample we
 *    surface null, never a fabricated price.
 *  - Money stays in MINOR UNITS (cents) end to end.
 *  - Pure module: no "server-only", no I/O — fully covered by the compliance
 *    test suite (tests/compliance/market-leads-core.test.ts).
 */

// ---------------------------------------------------------------------------
// Inputs — structurally match the DB rows (snake_case) so callers can pass
// `DiscoveryMarketSignalRow` / `DiscoveryCompetitor` records straight through.
// ---------------------------------------------------------------------------

export type MarketSignalLike = {
  kind: "statewide_mover" | "competitor_mover";
  license_number: string | null;
  inventory_type: string | null;
  product_name: string | null;
  brand: string | null;
  strain_name: string | null;
  units: number;
  revenue_minor: number;
  median_unit_price_minor: number | null;
  p25_unit_price_minor: number | null;
};

export type RosterNameLike = {
  license_number: string;
  tradename: string;
};

// ---------------------------------------------------------------------------
// Output — one mover, lead-shaped.
// ---------------------------------------------------------------------------

export type MarketMoverLead = {
  kind: "statewide_mover" | "competitor_mover";
  /** Roster tradename when the license is on the roster, else "lic <number>". */
  competitorName: string | null;
  licenseNumber: string | null;
  productName: string;
  brand: string | null;
  strainName: string | null;
  inventoryType: string | null;
  units: number;
  revenueMinor: number;
  medianUnitPriceMinor: number | null;
  /**
   * The price to beat: the market's 25th-percentile unit price for this mover.
   * Selling at or below this undercuts ~75% of the observed sales. Null when
   * the transformer had no price sample — we never invent one.
   */
  undercutTargetMinor: number | null;
};

export type MarketMoverLeads = {
  statewide: MarketMoverLead[];
  competitor: MarketMoverLead[];
};

/** Default row caps — bound both the UI tables and the AI prompt. */
export const DEFAULT_STATEWIDE_MOVERS = 12;
export const DEFAULT_COMPETITOR_MOVERS = 15;

// ---------------------------------------------------------------------------
// Build
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

/**
 * Turn raw market-signal rows + the competitor roster into capped, sorted,
 * lead-shaped mover lists. Deterministic: revenue desc, then units desc, then
 * product name asc, then license asc.
 */
export function buildMarketMoverLeads(
  signals: MarketSignalLike[],
  roster: RosterNameLike[],
  opts?: { maxStatewide?: number; maxCompetitor?: number },
): MarketMoverLeads {
  const maxStatewide = opts?.maxStatewide ?? DEFAULT_STATEWIDE_MOVERS;
  const maxCompetitor = opts?.maxCompetitor ?? DEFAULT_COMPETITOR_MOVERS;

  const names = new Map<string, string>();
  for (const r of roster) {
    const lic = cleanStr(r.license_number);
    const name = cleanStr(r.tradename);
    if (lic && name) names.set(lic, name);
  }

  const statewide: MarketMoverLead[] = [];
  const competitor: MarketMoverLead[] = [];

  for (const s of signals) {
    if (s.kind !== "statewide_mover" && s.kind !== "competitor_mover") continue;
    const productName = cleanStr(s.product_name);
    if (!productName) continue; // a mover without a product is not actionable
    const licenseNumber = cleanStr(s.license_number);
    const lead: MarketMoverLead = {
      kind: s.kind,
      licenseNumber,
      competitorName: licenseNumber ? (names.get(licenseNumber) ?? `lic ${licenseNumber}`) : null,
      productName,
      brand: cleanStr(s.brand),
      strainName: cleanStr(s.strain_name),
      inventoryType: cleanStr(s.inventory_type),
      units: toFiniteNonNegative(s.units),
      revenueMinor: Math.round(toFiniteNonNegative(s.revenue_minor)),
      medianUnitPriceMinor: minorOrNull(s.median_unit_price_minor),
      undercutTargetMinor: minorOrNull(s.p25_unit_price_minor),
    };
    if (s.kind === "statewide_mover") statewide.push(lead);
    else competitor.push(lead);
  }

  const cmp = (a: MarketMoverLead, b: MarketMoverLead): number =>
    b.revenueMinor - a.revenueMinor ||
    b.units - a.units ||
    a.productName.localeCompare(b.productName) ||
    (a.licenseNumber ?? "").localeCompare(b.licenseNumber ?? "");

  statewide.sort(cmp);
  competitor.sort(cmp);

  return {
    statewide: statewide.slice(0, Math.max(0, maxStatewide)),
    competitor: competitor.slice(0, Math.max(0, maxCompetitor)),
  };
}

// ---------------------------------------------------------------------------
// AI digest — compact, grounded fact block appended to the leads-advisor
// prompt. Money rendered in dollars FOR THE MODEL'S BENEFIT only; every figure
// comes straight from the minor-unit fields above.
// ---------------------------------------------------------------------------

function digestMoney(minor: number | null): string {
  if (minor == null) return "n/a";
  return `$${(minor / 100).toFixed(2)}`;
}

/** One compact prompt line per mover. Exported for direct testability. */
export function formatMoverDigestLine(lead: MarketMoverLead): string {
  const bits = [
    lead.kind === "competitor_mover" && lead.competitorName ? `store="${lead.competitorName}"` : null,
    `product="${lead.productName.slice(0, 80)}"`,
    lead.brand ? `brand="${lead.brand.slice(0, 40)}"` : null,
    lead.strainName ? `strain="${lead.strainName.slice(0, 40)}"` : null,
    lead.inventoryType ? `type=${lead.inventoryType}` : null,
    `units=${Math.round(lead.units)}`,
    `revenue=${digestMoney(lead.revenueMinor)}`,
    `median_price=${digestMoney(lead.medianUnitPriceMinor)}`,
    `undercut_at_or_below=${digestMoney(lead.undercutTargetMinor)}`,
  ].filter(Boolean);
  return `- ${bits.join(", ")}`;
}

/**
 * The full market-movers digest block for the AI prompt, or null when there
 * are no movers to report. The undercut framing is explicit so the model
 * anchors its price recommendations to the REAL p25 band, never invention.
 */
export function formatMarketMoversDigest(movers: MarketMoverLeads): string | null {
  const parts: string[] = [];

  if (movers.statewide.length > 0) {
    parts.push(
      `STATEWIDE TOP MOVERS (from the latest monthly CCRS drop — the state's best-selling retail products; ` +
        `"undercut_at_or_below" is the REAL 25th-percentile unit price observed statewide, i.e. pricing at or ` +
        `below it beats ~75% of the market):\n${movers.statewide.map(formatMoverDigestLine).join("\n")}`,
    );
  }

  if (movers.competitor.length > 0) {
    parts.push(
      `COMPETITOR TOP MOVERS (what tracked local competitors sold the most of, from the same CCRS drop; ` +
        `"undercut_at_or_below" is that product's REAL 25th-percentile unit price — a concrete price to beat them at):\n` +
        movers.competitor.map(formatMoverDigestLine).join("\n"),
    );
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
