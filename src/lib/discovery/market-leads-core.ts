/**
 * src/lib/discovery/market-leads-core.ts
 *
 * PURE market-mover + supplier lead logic for the Leads page and the AI leads
 * advisor (Task H, S4 + S7). Turns the persisted CCRS monthly-transformer
 * market signals (migration 0106 `discovery_market_signals`) and competitor
 * supplier rollups (migration 0107 `discovery_competitor_stats.top_suppliers`)
 * plus the competitor roster into lead-shaped rows the UI can render and the
 * AI can reason over.
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

// ---------------------------------------------------------------------------
// S7 — competitor SUPPLIER leads. Wholesale SaleHeaders in the monthly CCRS
// extract carry both sides of the transfer (seller → SoldToLicensee buyer),
// so the transformer records who each tracked competitor bought from. Here we
// invert that into vendor leads: suppliers ranked by total spend across the
// tracked competitors, flagging vendors that supply SEVERAL competitors —
// proven local demand and the owner's priority outreach list.
// ---------------------------------------------------------------------------

/** Structurally matches DiscoveryCompetitorStatRow's S7 columns. */
export type CompetitorSupplierStatLike = {
  license_number: string;
  name: string | null;
  dba: string | null;
  top_suppliers: Array<{
    licenseeId: string;
    licenseNumber: string | null;
    name: string | null;
    dba: string | null;
    lineCount: number;
    spendMinor: number;
  }>;
};

export type SupplierLead = {
  /** CCRS surrogate LicenseeId (stable within one extract). */
  licenseeId: string;
  licenseNumber: string | null;
  /** DBA, else legal name, else "Licensee <id>" — never invented. */
  displayName: string;
  /** Distinct tracked competitors this supplier sold to this month. */
  buyerCount: number;
  /** Roster tradenames (or license fallbacks) of those competitors, spend desc. */
  buyerNames: string[];
  /** Total observed spend across tracked competitors, minor units. */
  totalSpendMinor: number;
  totalLineCount: number;
  /** True when the supplier sold to 2+ tracked competitors — priority lead. */
  suppliesMultipleCompetitors: boolean;
};

/** Default cap for the UI card and AI digest. */
export const DEFAULT_SUPPLIER_LEADS = 15;

/**
 * Rank the tracked competitors' wholesale suppliers into vendor leads.
 * Deterministic: buyer count desc (multi-competitor first), then total spend
 * desc, then display name asc. NEVER GUESS: identity fields come straight from
 * the CCRS licensee table via the transformer; missing names fall back to the
 * licensee id, never an invented tradename.
 */
export function buildSupplierLeads(
  stats: CompetitorSupplierStatLike[],
  roster: RosterNameLike[],
  opts?: { max?: number },
): SupplierLead[] {
  const max = opts?.max ?? DEFAULT_SUPPLIER_LEADS;

  const rosterNames = new Map<string, string>();
  for (const r of roster) {
    const lic = cleanStr(r.license_number);
    const name = cleanStr(r.tradename);
    if (lic && name) rosterNames.set(lic, name);
  }

  type Acc = {
    licenseeId: string;
    licenseNumber: string | null;
    name: string | null;
    dba: string | null;
    totalSpendMinor: number;
    totalLineCount: number;
    /** buyer license → spend with this supplier (for spend-desc buyer names). */
    buyers: Map<string, { name: string; spendMinor: number }>;
  };
  const bySupplier = new Map<string, Acc>();

  for (const stat of stats) {
    const buyerLicense = cleanStr(stat.license_number);
    if (!buyerLicense) continue;
    const buyerName =
      rosterNames.get(buyerLicense) ??
      cleanStr(stat.dba) ??
      cleanStr(stat.name) ??
      `License ${buyerLicense}`;
    const suppliers = Array.isArray(stat.top_suppliers) ? stat.top_suppliers : [];
    for (const s of suppliers) {
      const licenseeId = cleanStr(s.licenseeId);
      if (!licenseeId) continue;
      const spend = Math.round(toFiniteNonNegative(s.spendMinor));
      const lines = Math.round(toFiniteNonNegative(s.lineCount));
      let acc = bySupplier.get(licenseeId);
      if (!acc) {
        acc = {
          licenseeId,
          licenseNumber: cleanStr(s.licenseNumber),
          name: cleanStr(s.name),
          dba: cleanStr(s.dba),
          totalSpendMinor: 0,
          totalLineCount: 0,
          buyers: new Map(),
        };
        bySupplier.set(licenseeId, acc);
      }
      // Fill identity gaps from later rows (same extract → same identity).
      if (!acc.licenseNumber) acc.licenseNumber = cleanStr(s.licenseNumber);
      if (!acc.name) acc.name = cleanStr(s.name);
      if (!acc.dba) acc.dba = cleanStr(s.dba);
      acc.totalSpendMinor += spend;
      acc.totalLineCount += lines;
      const buyer = acc.buyers.get(buyerLicense) ?? { name: buyerName, spendMinor: 0 };
      buyer.spendMinor += spend;
      acc.buyers.set(buyerLicense, buyer);
    }
  }

  const leads: SupplierLead[] = [...bySupplier.values()].map((acc) => {
    const buyerNames = [...acc.buyers.values()]
      .sort((a, b) => b.spendMinor - a.spendMinor || a.name.localeCompare(b.name))
      .map((b) => b.name);
    return {
      licenseeId: acc.licenseeId,
      licenseNumber: acc.licenseNumber,
      displayName: acc.dba ?? acc.name ?? `Licensee ${acc.licenseeId}`,
      buyerCount: acc.buyers.size,
      buyerNames,
      totalSpendMinor: acc.totalSpendMinor,
      totalLineCount: acc.totalLineCount,
      suppliesMultipleCompetitors: acc.buyers.size >= 2,
    };
  });

  leads.sort(
    (a, b) =>
      b.buyerCount - a.buyerCount ||
      b.totalSpendMinor - a.totalSpendMinor ||
      a.displayName.localeCompare(b.displayName),
  );

  return leads.slice(0, Math.max(0, max));
}

/** One compact prompt line per supplier lead. Exported for direct testability. */
export function formatSupplierDigestLine(lead: SupplierLead): string {
  const bits = [
    `supplier="${lead.displayName.slice(0, 80)}"`,
    lead.licenseNumber ? `license=${lead.licenseNumber}` : null,
    `supplies_competitors=${lead.buyerCount}`,
    `buyers="${lead.buyerNames.slice(0, 6).join("; ").slice(0, 200)}"`,
    `observed_spend=${digestMoney(lead.totalSpendMinor)}`,
    `lines=${lead.totalLineCount}`,
    lead.suppliesMultipleCompetitors ? "PRIORITY=multi-competitor-supplier" : null,
  ].filter(Boolean);
  return `- ${bits.join(", ")}`;
}

/**
 * The competitor-suppliers digest block for the AI prompt, or null when there
 * are no supplier leads. The multi-competitor priority framing is explicit —
 * per the owner: vendors that supply several tracked competitors are proven
 * local sellers and should be called out as priority vendor leads.
 */
export function formatSupplierLeadsDigest(leads: SupplierLead[]): string | null {
  if (leads.length === 0) return null;
  return (
    `COMPETITOR SUPPLIERS (who tracked local competitors BOUGHT from this month, from the latest ` +
    `monthly CCRS drop — real wholesale transfers, seller → buyer; "observed_spend" is what those ` +
    `competitors spent with that supplier in this drop only. Suppliers marked ` +
    `PRIORITY=multi-competitor-supplier sell to 2+ tracked competitors — proven local demand, treat ` +
    `them as PRIORITY vendor leads):\n` +
    leads.map(formatSupplierDigestLine).join("\n")
  );
}
