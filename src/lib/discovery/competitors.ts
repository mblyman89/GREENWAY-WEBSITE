import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isDiscoveryEnabled } from "./store";
import { percentile, summarizeMinor } from "./benchmarks-core";
import type {
  DiscoveryCompetitor,
  DiscoveryCompetitorArea,
  CompetitorProfile,
  AreaBenchmark,
} from "./types";

/**
 * Local competitor & area benchmarking (0080).
 *
 * Slices the uploaded CCRS Sale rows by the verified competitor roster
 * (discovery_competitors), which maps LicenseNumber -> tradename -> area.
 *
 * The CCRS Sale schema (verified) carries seller_license + buyer_license per
 * row, so for a given competitor's license we can derive:
 *   - what they SELL for  → their retail rows (seller_license = competitor,
 *     sale_type in retail/medical): unit-price distribution + $/g.
 *   - what they PAY & who they buy from → wholesale rows where
 *     buyer_license = competitor: spend, and the seller_license = their vendor.
 *
 * Everything is READ-ONLY and DERIVED. When a competitor's license has no rows
 * in the uploaded dataset, its profile shows zero samples — never fabricated.
 * Money in minor units (cents) throughout.
 */

const AREA_LABELS: Record<DiscoveryCompetitorArea, string> = {
  port_orchard: "Port Orchard",
  bremerton: "Bremerton",
  silverdale: "Silverdale",
  tacoma: "Tacoma",
  key_peninsula: "Key Peninsula / Gig Harbor",
  kitsap_other: "Kitsap (other)",
  other: "Other",
};

export function areaLabel(area: DiscoveryCompetitorArea): string {
  return AREA_LABELS[area] ?? area;
}

export const AREA_ORDER: DiscoveryCompetitorArea[] = [
  "port_orchard",
  "bremerton",
  "silverdale",
  "key_peninsula",
  "kitsap_other",
  "tacoma",
];

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
export async function listCompetitors(opts?: { area?: DiscoveryCompetitorArea }): Promise<DiscoveryCompetitor[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("discovery_competitors").select("*").eq("is_active", true);
  if (opts?.area) q = q.eq("area", opts.area);
  const { data } = await q.order("tradename", { ascending: true });
  return (data as DiscoveryCompetitor[] | null) ?? [];
}

export async function getSelfCompetitor(): Promise<DiscoveryCompetitor | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_competitors")
    .select("*")
    .eq("is_self", true)
    .maybeSingle();
  return (data as DiscoveryCompetitor | null) ?? null;
}

// ---------------------------------------------------------------------------
// Sale loading (scoped to the licenses we care about, paginated)
// ---------------------------------------------------------------------------
type SaleLite = {
  seller_license: string | null;
  buyer_license: string | null;
  sale_type: string;
  quantity_num: number | null;
  unit_price_minor: number | null;
  price_per_gram_minor: number | null;
  product_category: string | null;
};

async function loadSalesForLicenses(
  datasetId: string,
  licenses: Set<string>,
): Promise<SaleLite[]> {
  const admin = createSupabaseAdminClient();
  const out: SaleLite[] = [];
  const pageSize = 1000;
  // We can't easily push a huge IN() through PostgREST, so we page the whole
  // dataset and filter in memory by the (small) roster set. Datasets are the
  // statewide extract; the roster is ~40 licenses.
  for (let from = 0; ; from += pageSize) {
    const { data } = await admin
      .from("discovery_ccrs_sales")
      .select(
        "seller_license, buyer_license, sale_type, quantity_num, unit_price_minor, price_per_gram_minor, product_category",
      )
      .eq("dataset_id", datasetId)
      .range(from, from + pageSize - 1);
    const rows = (data as SaleLite[] | null) ?? [];
    for (const r of rows) {
      const seller = r.seller_license ?? "";
      const buyer = r.buyer_license ?? "";
      if (licenses.has(seller) || licenses.has(buyer)) out.push(r);
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
type Acc = {
  retailPrices: number[];
  retailPpg: number[];
  retailSales: number;
  wholesalePrices: number[];
  wholesaleBuys: number;
  wholesaleSpend: number;
  vendorSpend: Map<string, { spend: number; units: number }>;
  cat: Map<string, { units: number; rev: number }>;
};

function emptyAcc(): Acc {
  return {
    retailPrices: [],
    retailPpg: [],
    retailSales: 0,
    wholesalePrices: [],
    wholesaleBuys: 0,
    wholesaleSpend: 0,
    vendorSpend: new Map(),
    cat: new Map(),
  };
}

/**
 * Compute a per-competitor profile for every roster store from a dataset.
 * `vendorNames` optionally maps vendor license -> name (from the licensee roster).
 */
export async function computeCompetitorProfiles(datasetId: string): Promise<CompetitorProfile[]> {
  if (!isSupabaseServiceConfigured) return [];
  if (!(await isDiscoveryEnabled())) return [];

  const roster = await listCompetitors();
  if (roster.length === 0) return [];
  const licenseSet = new Set(roster.map((c) => c.license_number));

  // vendor-name lookup from the CCRS licensee roster (best-effort).
  const vendorNames = await loadVendorNames(datasetId);

  const sales = await loadSalesForLicenses(datasetId, licenseSet);

  const accByLicense = new Map<string, Acc>();
  const acc = (lic: string): Acc => {
    let a = accByLicense.get(lic);
    if (!a) {
      a = emptyAcc();
      accByLicense.set(lic, a);
    }
    return a;
  };

  for (const s of sales) {
    const seller = s.seller_license ?? "";
    const buyer = s.buyer_license ?? "";
    const up = s.unit_price_minor;
    const ppg = s.price_per_gram_minor;
    const qty = s.quantity_num ?? 0;

    // Retail: the store is the SELLER on a retail/medical row.
    if ((s.sale_type === "retail" || s.sale_type === "medical") && licenseSet.has(seller)) {
      const a = acc(seller);
      a.retailSales += 1;
      if (up != null && Number.isFinite(up)) a.retailPrices.push(up);
      if (ppg != null && Number.isFinite(ppg)) a.retailPpg.push(ppg);
      const cat = (s.product_category ?? "").trim() || "Uncategorized";
      const c = a.cat.get(cat) ?? { units: 0, rev: 0 };
      c.units += qty;
      c.rev += up != null ? up * (qty || 1) : 0;
      a.cat.set(cat, c);
    }

    // Wholesale: the store is the BUYER; seller is their vendor.
    if (s.sale_type === "wholesale" && licenseSet.has(buyer)) {
      const a = acc(buyer);
      a.wholesaleBuys += 1;
      if (up != null && Number.isFinite(up)) a.wholesalePrices.push(up);
      const spend = up != null ? up * (qty || 1) : 0;
      a.wholesaleSpend += spend;
      if (seller) {
        const v = a.vendorSpend.get(seller) ?? { spend: 0, units: 0 };
        v.spend += spend;
        v.units += qty;
        a.vendorSpend.set(seller, v);
      }
    }
  }

  const profiles: CompetitorProfile[] = roster.map((c) => {
    const a = accByLicense.get(c.license_number) ?? emptyAcc();
    const retailSummary = summarizeMinor(a.retailPrices);
    const wholesaleSummary = summarizeMinor(a.wholesalePrices);
    const topVendors = [...a.vendorSpend.entries()]
      .sort((x, y) => y[1].spend - x[1].spend)
      .slice(0, 10)
      .map(([license_number, v]) => ({
        license_number,
        name: vendorNames.get(license_number) ?? null,
        spendMinor: Math.round(v.spend),
        units: v.units,
      }));
    const topCategories = [...a.cat.entries()]
      .sort((x, y) => y[1].rev - x[1].rev)
      .slice(0, 10)
      .map(([category, v]) => ({ category, units: v.units, revenueMinor: Math.round(v.rev) }));

    return {
      license_number: c.license_number,
      tradename: c.tradename,
      city: c.city,
      area: c.area,
      is_self: c.is_self,
      retailSales: a.retailSales,
      retailMedianMinor: retailSummary.median_minor,
      retailAvgMinor: retailSummary.avg_minor,
      retailPerGramMedianMinor: percentile(a.retailPpg, 50),
      wholesaleBuys: a.wholesaleBuys,
      wholesaleMedianMinor: wholesaleSummary.median_minor,
      wholesaleSpendMinor: Math.round(a.wholesaleSpend),
      topVendors,
      topCategories,
    };
  });

  // Sort: self first, then by retail sample size desc.
  profiles.sort((a, b) => {
    if (a.is_self !== b.is_self) return a.is_self ? -1 : 1;
    return b.retailSales - a.retailSales;
  });
  return profiles;
}

/** Roll competitor profiles up to area benchmarks. Excludes self from the market view. */
export function rollUpAreas(profiles: CompetitorProfile[]): AreaBenchmark[] {
  const byArea = new Map<DiscoveryCompetitorArea, CompetitorProfile[]>();
  for (const p of profiles) {
    if (p.is_self) continue; // area benchmark = the MARKET, not us
    const arr = byArea.get(p.area) ?? [];
    arr.push(p);
    byArea.set(p.area, arr);
  }
  const out: AreaBenchmark[] = [];
  for (const [area, list] of byArea.entries()) {
    // Re-derive medians from the stores' own medians (weighted by sample would
    // require raw rows; store-median-of-medians is an honest area proxy and we
    // label it as such in the UI).
    const retailMedians = list.map((p) => p.retailMedianMinor).filter((v): v is number => v != null);
    const retailAvgs = list.map((p) => p.retailAvgMinor).filter((v): v is number => v != null);
    const ppgMedians = list.map((p) => p.retailPerGramMedianMinor).filter((v): v is number => v != null);
    const wholesaleMedians = list.map((p) => p.wholesaleMedianMinor).filter((v): v is number => v != null);
    out.push({
      area,
      storeCount: list.length,
      retailSales: list.reduce((a, p) => a + p.retailSales, 0),
      retailMedianMinor: percentile(retailMedians, 50),
      retailAvgMinor: retailAvgs.length ? Math.round(retailAvgs.reduce((a, b) => a + b, 0) / retailAvgs.length) : null,
      retailPerGramMedianMinor: percentile(ppgMedians, 50),
      wholesaleMedianMinor: percentile(wholesaleMedians, 50),
    });
  }
  // Stable area ordering.
  const order = AREA_ORDER;
  out.sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  return out;
}

async function loadVendorNames(datasetId: string): Promise<Map<string, string>> {
  const admin = createSupabaseAdminClient();
  const map = new Map<string, string>();
  const { data } = await admin
    .from("discovery_ccrs_licensees")
    .select("license_number, name")
    .eq("dataset_id", datasetId);
  for (const r of (data as Array<{ license_number: string; name: string | null }> | null) ?? []) {
    if (r.name) map.set(r.license_number, r.name);
  }
  return map;
}
