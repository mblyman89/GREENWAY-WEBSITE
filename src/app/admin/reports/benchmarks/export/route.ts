/**
 * GET /admin/reports/benchmarks/export?dataset=<id>&sheet=<name>&format=csv|xlsx
 *
 * Export for the "Benchmarks" reporting tab. Emits a styled multi-sheet workbook
 * (or clean multi-section CSV) of the local competitor & area intelligence:
 *   - areas       : per-area medians (retail, $/g, wholesale).
 *   - port_orchard: Greenway vs each direct Port Orchard competitor.
 *   - competitors : every roster store with activity in this dataset.
 *   - sourcing    : per-competitor top vendors by wholesale spend.
 *   - roster      : the verified WSLCB license roster (public data).
 *
 * When `sheet` is omitted, ALL sheets are exported together (the "full" workbook).
 * Staff-gated (reports.view). Money is emitted as real currency cells (minor units
 * fed to the workbook helper, which divides by 100). Nothing is fabricated: figures
 * come only from transactions present in the uploaded CCRS extract.
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isDiscoveryEnabled } from "@/lib/discovery/store";
import { listDatasets } from "@/lib/discovery/ingest";
import {
  computeCompetitorProfiles,
  rollUpAreas,
  listCompetitors,
  areaLabel,
} from "@/lib/discovery/competitors";
import type { CompetitorProfile, AreaBenchmark } from "@/lib/discovery/types";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type TableSheet,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AREA_COLUMNS: TableColumn[] = [
  { key: "area", header: "Area", type: "text" },
  { key: "storeCount", header: "Stores", type: "integer" },
  { key: "retailMedianMinor", header: "Median retail", type: "currency" },
  { key: "retailAvgMinor", header: "Avg retail", type: "currency" },
  { key: "retailPerGramMedianMinor", header: "Median $/g", type: "currency" },
  { key: "wholesaleMedianMinor", header: "Median wholesale", type: "currency" },
  { key: "retailSales", header: "Retail lines", type: "integer" },
];

const COMPETITOR_COLUMNS: TableColumn[] = [
  { key: "tradename", header: "Store", type: "text" },
  { key: "license_number", header: "License", type: "text" },
  { key: "area", header: "Area", type: "text" },
  { key: "isSelf", header: "Greenway?", type: "text" },
  { key: "retailMedianMinor", header: "Median retail", type: "currency" },
  { key: "retailAvgMinor", header: "Avg retail", type: "currency" },
  { key: "retailPerGramMedianMinor", header: "Median $/g", type: "currency" },
  { key: "retailSales", header: "Retail lines", type: "integer" },
  { key: "wholesaleMedianMinor", header: "Median wholesale", type: "currency" },
  { key: "wholesaleSpendMinor", header: "Wholesale spend", type: "currency" },
  { key: "wholesaleBuys", header: "Wholesale buys", type: "integer" },
];

const SOURCING_COLUMNS: TableColumn[] = [
  { key: "competitor", header: "Competitor", type: "text" },
  { key: "competitorLicense", header: "Competitor license", type: "text" },
  { key: "area", header: "Area", type: "text" },
  { key: "vendor", header: "Vendor", type: "text" },
  { key: "vendorLicense", header: "Vendor license", type: "text" },
  { key: "spendMinor", header: "Wholesale spend", type: "currency" },
  { key: "units", header: "Units", type: "integer" },
];

const ROSTER_COLUMNS: TableColumn[] = [
  { key: "area", header: "Area", type: "text" },
  { key: "tradename", header: "Store", type: "text" },
  { key: "license_number", header: "License", type: "text" },
  { key: "city", header: "City", type: "text" },
  { key: "isSelf", header: "Greenway?", type: "text" },
];

function areaRows(areas: AreaBenchmark[]): TableRow[] {
  return areas.map((a) => ({
    area: areaLabel(a.area),
    storeCount: a.storeCount,
    retailMedianMinor: a.retailMedianMinor,
    retailAvgMinor: a.retailAvgMinor,
    retailPerGramMedianMinor: a.retailPerGramMedianMinor,
    wholesaleMedianMinor: a.wholesaleMedianMinor,
    retailSales: a.retailSales,
  }));
}

function competitorRows(profiles: CompetitorProfile[]): TableRow[] {
  return profiles.map((p) => ({
    tradename: p.tradename,
    license_number: p.license_number,
    area: areaLabel(p.area),
    isSelf: p.is_self ? "Yes" : "",
    retailMedianMinor: p.retailMedianMinor,
    retailAvgMinor: p.retailAvgMinor,
    retailPerGramMedianMinor: p.retailPerGramMedianMinor,
    retailSales: p.retailSales,
    wholesaleMedianMinor: p.wholesaleMedianMinor,
    wholesaleSpendMinor: p.wholesaleSpendMinor,
    wholesaleBuys: p.wholesaleBuys,
  }));
}

function sourcingRows(profiles: CompetitorProfile[]): TableRow[] {
  const rows: TableRow[] = [];
  for (const p of profiles) {
    for (const v of p.topVendors) {
      rows.push({
        competitor: p.tradename,
        competitorLicense: p.license_number,
        area: areaLabel(p.area),
        vendor: v.name ?? `License ${v.license_number}`,
        vendorLicense: v.license_number,
        spendMinor: v.spendMinor,
        units: v.units,
      });
    }
  }
  return rows;
}

function rosterRows(
  roster: Awaited<ReturnType<typeof listCompetitors>>,
): TableRow[] {
  return roster.map((c) => ({
    area: areaLabel(c.area),
    tradename: c.tradename,
    license_number: c.license_number,
    city: c.city ?? "",
    isSelf: c.is_self ? "Yes" : "",
  }));
}

export async function GET(request: Request) {
  await requirePermission("reports.view");
  const url = new URL(request.url);
  const format = parseFormat(url.searchParams.get("format"));
  const datasetId = url.searchParams.get("dataset") ?? undefined;
  const sheet = (url.searchParams.get("sheet") ?? "").trim().toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);

  if (!isSupabaseServiceConfigured || !(await isDiscoveryEnabled())) {
    // Nothing to export — return an empty, honest workbook rather than erroring.
    const spec: WorkbookSpec = {
      filename: `greenway-benchmarks-${stamp}`,
      title: "Greenway — Local competitor benchmarks",
      sheets: [
        {
          name: "Unavailable",
          caption: "Product Discovery is off or the database isn't configured.",
          columns: [{ key: "note", header: "Note", type: "text" }],
          rows: [{ note: "No data available." }],
        },
      ],
    };
    return exportResponse(spec, format);
  }

  const roster = await listCompetitors();
  const datasets = await listDatasets();
  const computed = datasets.filter((d) => d.status === "ready" && d.benchmarks_computed_at);
  const active =
    (datasetId && datasets.find((d) => d.id === datasetId)) || computed[0] || datasets[0] || null;

  // Roster-only export is possible even without a dataset.
  if (!active) {
    const spec: WorkbookSpec = {
      filename: `greenway-benchmarks-roster-${stamp}`,
      title: "Greenway — Verified competitor roster",
      sheets: [
        {
          name: "Roster",
          caption: "Source: WSLCB Cannabis License Applicants (public licensing data).",
          columns: ROSTER_COLUMNS,
          rows: rosterRows(roster),
        },
      ],
    };
    return exportResponse(spec, format);
  }

  const profiles = await computeCompetitorProfiles(active.id);
  const areas = rollUpAreas(profiles);
  const portOrchard = profiles.filter((p) => p.area === "port_orchard");
  const withData = profiles.filter((p) => p.retailSales > 0 || p.wholesaleBuys > 0);
  const withVendors = withData.filter((p) => p.topVendors.length > 0);

  const allSheets: Record<string, TableSheet> = {
    areas: {
      name: "Area benchmarks",
      caption: `Dataset: ${active.label}. Area medians are the median of each store's median.`,
      columns: AREA_COLUMNS,
      rows: areaRows(areas),
    },
    port_orchard: {
      name: "Port Orchard head-to-head",
      caption: `Dataset: ${active.label}. Greenway vs each direct Port Orchard competitor.`,
      columns: COMPETITOR_COLUMNS,
      rows: competitorRows(portOrchard),
    },
    competitors: {
      name: "All competitors",
      caption: `Dataset: ${active.label}. Every roster store with activity in this dataset.`,
      columns: COMPETITOR_COLUMNS,
      rows: competitorRows(withData),
    },
    sourcing: {
      name: "Sourcing (who they buy from)",
      caption: `Dataset: ${active.label}. Top vendors by wholesale spend per competitor.`,
      columns: SOURCING_COLUMNS,
      rows: sourcingRows(withVendors),
    },
    roster: {
      name: "Roster",
      caption: "Source: WSLCB Cannabis License Applicants (public licensing data).",
      columns: ROSTER_COLUMNS,
      rows: rosterRows(roster),
    },
  };

  const sheets: TableSheet[] =
    sheet && allSheets[sheet] ? [allSheets[sheet]] : Object.values(allSheets);

  const suffix = sheet && allSheets[sheet] ? `-${sheet}` : "";
  const spec: WorkbookSpec = {
    filename: `greenway-benchmarks${suffix}-${stamp}`,
    title: "Greenway — Local competitor & area benchmarks",
    sheets,
  };

  return exportResponse(spec, format);
}
