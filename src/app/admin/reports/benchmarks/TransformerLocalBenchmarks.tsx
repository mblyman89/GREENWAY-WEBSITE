/**
 * TransformerLocalBenchmarks — the Reports → Benchmarks body for datasets
 * produced by the monthly CCRS zip transformer (ingest_kind='monthly_zip').
 *
 * SERVER COMPONENT. Its whole job is to LOAD and SHAPE; every number is
 * computed by the pure layer in `local-market-core.ts` and every pixel is
 * drawn by `LocalCommandCenter`.
 *
 * Why the split: the screen, the CSV export and the AI advisor must never be
 * able to disagree about what "median price" means. When each surface does its
 * own arithmetic inline they drift silently — and a wrong number delivered
 * confidently is worse than no number at all. One semantic layer, three
 * consumers.
 *
 * WHAT THIS RENDERS (everything the previous ten stacked sections showed, now
 * reachable by choosing a lens instead of scrolling past nine things you did
 * not ask for):
 *
 *   Stores lens         Area benchmarks context, Port Orchard head-to-head and
 *                       all tracked competitors — one filterable table, with
 *                       each store's top products AND its wholesale suppliers
 *                       behind a click.
 *   Areas lens          Median competitor retail price by area.
 *   Vendors lens        Who competitors buy from, shared/priority vendor leads,
 *                       and the statewide supplier benchmarks.
 *   Opportunities lens  Assortment gaps, new suppliers, supplier switching.
 *
 * NEVER GUESS. Missing price bands render "—" and export as an empty cell. The
 * transformer's stats are competitor-only by construction: the aggregator
 * structurally excludes the owner's license, because the POS owns Greenway's
 * own numbers. Suppliers a header could not name stay uncounted rather than
 * invented.
 */
import type {
  DiscoveryCompetitor,
  DiscoveryDataset,
  DiscoverySupplierStatRow,
} from "@/lib/discovery/types";
import {
  listCompetitorStats,
  listMarketSignals,
  listSupplierStats,
  listTransformerDatasets,
} from "@/lib/discovery/market-rollups";
import { areaLabel, AREA_ORDER } from "@/lib/discovery/competitors";
import { loadCandidateItems } from "@/lib/products/masters-store";
import {
  buildAssortmentGapReport,
  type AssortmentGapReport,
} from "@/lib/discovery/assortment-gap-core";
import {
  buildSupplierHistoryReport,
  type SupplierHistoryReport,
} from "@/lib/discovery/supplier-history-core";
import { buildLocalBenchmarks } from "@/lib/discovery/local-benchmarks-core";
import {
  buildSupplierSwitchReport,
  type SupplierSwitchReport,
} from "@/lib/discovery/supplier-switching-core";
import {
  buildLocalAreaRows,
  buildLocalHeadline,
  buildLocalStoreRows,
  buildLocalVendorRows,
} from "@/lib/discovery/local-market-core";
import {
  LocalCommandCenter,
  type GapRowLike,
  type NewSupplierRowLike,
  type StatewideSupplierRowLike,
  type SwitchRowLike,
} from "./LocalCommandCenter";

/** The owner's own area — the median that actually sets his shelf price. */
const HOME_AREA = "port_orchard";

/** Human wording for a carry status. The raw enum never reaches the screen. */
function gapStatusLabel(status: string): string {
  switch (status) {
    case "carried":
      return "On our menu";
    case "brand_carried":
      return "Brand carried";
    case "not_carried":
      return "Not carried";
    default:
      return status;
  }
}

export async function TransformerLocalBenchmarks({
  dataset,
  roster,
}: {
  dataset: DiscoveryDataset;
  roster: DiscoveryCompetitor[];
}) {
  const stats = await listCompetitorStats(dataset.id);
  const { competitors, areas } = buildLocalBenchmarks(stats, roster);

  // S10: statewide supplier benchmarks (migration 0109). Best-effort — a
  // pre-0109 database or a pre-S10 dataset simply has no rows.
  let supplierStats: DiscoverySupplierStatRow[] = [];
  try {
    supplierStats = await listSupplierStats(dataset.id);
  } catch {
    supplierStats = [];
  }

  // S12: assortment gaps — statewide movers vs the published menu. Best-effort
  // on BOTH sides: a dataset without market signals or a store without a
  // published menu simply yields an honest empty state.
  let gapReport: AssortmentGapReport | null = null;
  try {
    const [movers, menuItems] = await Promise.all([
      listMarketSignals(dataset.id, "statewide_mover"),
      loadCandidateItems(),
    ]);
    if (movers.length > 0) {
      gapReport = buildAssortmentGapReport(
        movers,
        menuItems.map((i) => ({ name: i.name, brand: i.brand })),
      );
    }
  } catch {
    gapReport = null; // nothing is guessed
  }

  // S9: previous READY transformer dataset (by period, falling back to list
  // order) → supplier-switching report. Best-effort: one month = no changes.
  // S13: the SAME dataset list feeds new-vendor detection — this dataset's
  // supplier stats vs every OLDER uploaded month's. Prior months without
  // supplier rows (pre-0109 uploads) are excluded inside the pure core
  // (missing data ≠ absence) and surfaced as a re-upload prompt.
  let switchReport: SupplierSwitchReport | null = null;
  let prevLabel: string | null = null;
  let historyReport: SupplierHistoryReport | null = null;
  try {
    const all = await listTransformerDatasets(); // newest period first
    const idx = all.findIndex((d) => d.id === dataset.id);
    const prev = idx >= 0 ? (all[idx + 1] ?? null) : null;
    if (prev) {
      const prevStats = await listCompetitorStats(prev.id);
      switchReport = buildSupplierSwitchReport(stats, prevStats, roster);
      prevLabel = prev.label;
    }
    const older = idx >= 0 ? all.slice(idx + 1) : [];
    if (supplierStats.length > 0 && older.length > 0) {
      const priorDatasets = await Promise.all(
        older.map(async (d) => ({
          label: d.label,
          suppliers: await listSupplierStats(d.id),
        })),
      );
      const report = buildSupplierHistoryReport(supplierStats, priorDatasets);
      historyReport = report.detectable ? report : null;
    }
  } catch {
    switchReport = null;
    historyReport = null;
  }

  if (competitors.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
        This monthly drop (&ldquo;{dataset.label}&rdquo;) has no retail activity for the tracked competitor
        licenses. The transformer only stores rollups for stores it actually saw in the month&apos;s file.
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Shape. All arithmetic lives in the pure core.
  // ---------------------------------------------------------------------
  const areaRows = buildLocalAreaRows(areas);
  const storeRows = buildLocalStoreRows(competitors, areas);
  const vendorRows = buildLocalVendorRows(storeRows);
  const headline = buildLocalHeadline({
    stores: storeRows,
    areas: areaRows,
    vendors: vendorRows,
    homeArea: HOME_AREA,
  });

  const areaLabels: Record<string, string> = {};
  for (const a of AREA_ORDER) areaLabels[a] = areaLabel(a);
  // Any area present in the data but absent from the canonical order still
  // needs a label — fall back to the raw key rather than dropping the row.
  for (const r of areaRows) if (!areaLabels[r.area]) areaLabels[r.area] = r.area;

  const statewideSuppliers: StatewideSupplierRowLike[] = supplierStats.slice(0, 40).map((s) => ({
    displayName: s.dba ?? s.name ?? `Licensee ${s.licensee_id}`,
    licenseNumber: s.license_number,
    revenueMinor: s.revenue_minor,
    lineCount: s.line_count,
    p25Minor: s.price_p25_minor,
    medianMinor: s.price_median_minor,
    p75Minor: s.price_p75_minor,
    distinctBuyers: s.distinct_buyers,
    trackedBuyers: s.tracked_buyers,
  }));

  const gaps: GapRowLike[] = (gapReport?.rows ?? []).map((g) => ({
    productName: g.productName,
    inventoryType: g.inventoryType,
    brand: g.brand,
    units: g.units,
    revenueMinor: g.revenueMinor,
    medianUnitPriceMinor: g.medianUnitPriceMinor,
    p25UnitPriceMinor: g.p25UnitPriceMinor,
    status: g.status,
    statusLabel: gapStatusLabel(g.status),
  }));

  const gapSummary = gapReport
    ? {
        carried: gapReport.carriedCount,
        brandCarried: gapReport.brandCarriedCount,
        notCarried: gapReport.notCarriedCount,
        menuItems: gapReport.menuItemCount,
      }
    : null;

  const newSuppliers: NewSupplierRowLike[] = (historyReport?.newSuppliers ?? []).map((s) => ({
    displayName: s.displayName,
    licenseNumber: s.licenseNumber,
    lineCount: s.lineCount,
    revenueMinor: s.revenueMinor,
    distinctBuyers: s.distinctBuyers,
    trackedBuyers: s.trackedBuyers,
  }));

  const newSupplierNote =
    historyReport && historyReport.priorWithoutSupplierData.length > 0
      ? `Compared against ${historyReport.priorWithSupplierData.length} earlier month(s) that carry supplier data. ${historyReport.priorWithoutSupplierData.length} earlier upload(s) predate sourcing capture and were excluded rather than treated as empty — re-upload those zips to widen the comparison.`
      : historyReport
        ? `First appearance measured against ${historyReport.priorWithSupplierData.length} earlier month(s) of supplier data.`
        : null;

  // Flatten per-competitor entered/exited into one sortable list. "Continued"
  // vendors are deliberately omitted: this table answers "what CHANGED?".
  const switches: SwitchRowLike[] = [];
  for (const c of switchReport?.competitors ?? []) {
    for (const e of c.entered) {
      switches.push({
        competitor: c.competitorName,
        supplier: e.displayName,
        direction: "gained",
        spendMinor: e.currSpendMinor,
        prevSpendMinor: e.prevSpendMinor,
      });
    }
    for (const e of c.exited) {
      switches.push({
        competitor: c.competitorName,
        supplier: e.displayName,
        direction: "lost",
        spendMinor: e.currSpendMinor,
        prevSpendMinor: e.prevSpendMinor,
      });
    }
  }

  const switchNoteParts: string[] = [];
  if (prevLabel) switchNoteParts.push(`Compared against ${prevLabel}.`);
  if (switchReport && switchReport.missingPrevData.length > 0) {
    switchNoteParts.push(
      `No previous-month sourcing data for ${switchReport.missingPrevData.slice(0, 8).join(", ")}${
        switchReport.missingPrevData.length > 8 ? "…" : ""
      } — those stores are excluded, never guessed (uploads predating sourcing capture need a re-upload).`,
    );
  }
  const switchNote = switchNoteParts.length > 0 ? switchNoteParts.join(" ") : null;

  return (
    <div className="space-y-5">
      <LocalCommandCenter
        headline={headline}
        stores={storeRows}
        areas={areaRows}
        vendors={vendorRows}
        statewideSuppliers={statewideSuppliers}
        gaps={gaps}
        gapSummary={gapSummary}
        newSuppliers={newSuppliers}
        newSupplierNote={newSupplierNote}
        switches={switches}
        switchNote={switchNote}
        homeAreaLabel={areaLabel(HOME_AREA)}
        monthLabel={dataset.label}
        areaLabels={areaLabels}
      />

      <p className="text-xs text-white/30">
        Derived from the monthly CCRS drop &ldquo;{dataset.label}&rdquo; — computed in your browser at
        upload; only rollups are stored. Product-level detail covers lines whose joins resolved inside
        the same monthly file (a monthly drop is a delta); totals count every line, and nothing is
        guessed to fill gaps. Supplier attribution comes straight from each wholesale transfer&apos;s
        seller and buyer licensees, which the monthly file carries in full — but it reflects only this
        month&apos;s reported wholesale activity, not a competitor&apos;s all-time vendor list. Public
        Records data is for internal buying/pricing decisions only (RCW 42.56.070(8)).
      </p>
    </div>
  );
}
