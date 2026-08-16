/**
 * TransformerBenchmarks — the statewide-benchmarks body for datasets produced
 * by the monthly CCRS zip transformer (Task H, S5; ingest_kind='monthly_zip').
 *
 * Server component rendered by /admin/discovery/benchmarks when the active
 * dataset came from the drag-drop monthly zip. Its job is now narrow and
 * boring on purpose: LOAD the month's persisted rollups, SHAPE them through
 * the pure semantic layer (statewide-market-core), and hand them to the
 * client command center. No arithmetic happens here, so the screen, the CSV
 * export, and any future AI answer all read from one definition of each
 * metric and cannot drift apart.
 *
 * Slice 8 replaced a flat wall of seven sections and eleven tables with two
 * levels of progressive disclosure — an overview, then details-on-demand —
 * per Shneiderman's mantra and Nielsen's two-level maximum. Nothing was
 * dropped: category/brand/strain pricing became scopes of the market lens,
 * the per-type product leaderboards became its drill-down, and history keeps
 * its own section below the fold.
 *
 * NEVER GUESS: every figure is the transformer's real aggregate; anything not
 * measured renders "—", never 0. The attribution share is surfaced honestly —
 * a monthly drop is a DELTA file and only lines whose product joins resolved
 * inside the same file carry type/brand/strain detail; the rest are counted,
 * not guessed.
 */
import { Card, CardHeader, Section } from "@/components/admin/ui";
import { listBenchmarks } from "@/lib/discovery/benchmarks";
import {
  listCompetitorStats,
  listDohSellers,
  listMarketSignals,
  listProducerStats,
  listSupplierStats,
  listTransformerDatasets,
} from "@/lib/discovery/market-rollups";
import {
  buildTransformerHistory,
  type TransformerHistoryRow,
} from "@/lib/discovery/benchmarks-history-core";
import {
  buildDohSellerRows,
  buildDohVerdict,
  buildMarketRows,
  buildRetailerRows,
  buildSellInRows,
  buildSellThroughRows,
  computeConcentration,
  ratioOrNull,
  type MarketRow,
  type MixDetail,
} from "@/lib/discovery/statewide-market-core";
import { StatewideCommandCenter, type MarketScope } from "./StatewideCommandCenter";
import type {
  DiscoveryBenchmark,
  DiscoveryDataset,
  BenchmarkMetric,
  DiscoveryMarketSignalRow,
} from "@/lib/discovery/types";

function money(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function share(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function HistoryTable({ rows }: { rows: TransformerHistoryRow[] }) {
  return (
    <Card padding="md">
      <CardHeader
        title="Month over month"
        subtitle="Each monthly drop keeps its own rollups — trends line up here as history accumulates"
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
              <th className="py-2 pr-3">Drop</th>
              <th className="px-3 py-2 text-right">Median retail</th>
              <th className="px-3 py-2 text-right">Median $/g</th>
              <th className="px-3 py-2 text-right">Median wholesale</th>
              <th className="px-3 py-2 text-right">Retail units</th>
              <th className="px-3 py-2 text-right">Retail revenue</th>
              <th className="py-2 pl-3 text-right">Detail coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.datasetId} className="border-b border-[var(--admin-border)]/50">
                <td className="py-2 pr-3 font-medium text-[var(--admin-text)]">{r.label}</td>
                <td className="px-3 py-2 text-right text-[var(--admin-text)]">{money(r.retailMedianMinor)}</td>
                <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(r.retailPpgMedianMinor)}</td>
                <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(r.wholesaleMedianMinor)}</td>
                <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{num(r.retailUnits)}</td>
                <td className="px-3 py-2 text-right font-semibold text-[var(--admin-text)]">{money(r.retailRevenueMinor)}</td>
                <td className="py-2 pl-3 text-right text-[var(--admin-text-muted)]">{share(r.attributedShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
        &ldquo;Detail coverage&rdquo; is the share of the month&apos;s retail lines whose product detail resolved
        inside the same monthly file — a monthly drop is a delta, so lines referencing earlier months are
        counted in totals but can&apos;t carry type/brand/strain detail. Nothing is guessed to fill the gap.
      </p>
    </Card>
  );
}

/**
 * Turn the month's `type_mover` signals into the market lens's level-2
 * payload. A signal names one product inside one inventory type, with the
 * vendor behind it where the manifest could verify it.
 *
 * Brand and strain grains are derived from the SAME signals, so a product
 * shown under "Blue Dream" is literally the same row shown under "Flower" —
 * two paths to one fact, which is the point of a semantic layer.
 */
function buildMarketDetail(signals: DiscoveryMarketSignalRow[]): Record<string, MixDetail> {
  const out: Record<string, MixDetail> = {};
  const push = (scope: MarketScope, key: string | null, s: DiscoveryMarketSignalRow) => {
    const k = typeof key === "string" ? key.trim() : "";
    if (!k) return;
    const mapKey = `${scope}\u0001${k}`;
    let bucket = out[mapKey];
    if (!bucket) {
      bucket = { types: [], products: [] };
      out[mapKey] = bucket;
    }
    if (bucket.products.length >= 25) return;
    bucket.products.push({
      productName: s.product_name ?? "—",
      inventoryType: s.inventory_type,
      // Show the vendor when the manifest verified one; the brand otherwise.
      // Never blend them into a single unlabeled string.
      brand: s.vendor_name ?? s.brand ?? null,
      units: s.units,
      revenueMinor: s.revenue_minor,
      medianUnitPriceMinor: s.median_unit_price_minor,
    });
  };
  for (const s of signals) {
    push("type", s.inventory_type, s);
    push("brand", s.brand, s);
    push("strain", s.strain_name, s);
  }
  return out;
}

export async function TransformerBenchmarks({ dataset }: { dataset: DiscoveryDataset }) {
  const rows = await listBenchmarks(dataset.id);

  // Headline overall rollups.
  const overall = (metric: BenchmarkMetric): DiscoveryBenchmark | null =>
    rows.find((r) => r.scope === "overall" && r.scope_key === "all" && r.metric === metric) ?? null;
  const retailPrice = overall("retail_unit_price");
  const wholesalePrice = overall("wholesale_unit_price");
  const retailPpg = overall("retail_price_per_gram");
  const retailUnits = overall("retail_units");
  const retailRevenue = overall("retail_revenue");
  const dohPrice = overall("doh_unit_price");

  const retailLines = dataset.retail_lines ?? null;
  const attributed = dataset.attributed_retail_lines ?? null;
  const attributedShare = ratioOrNull(attributed, retailLines);

  // The market table at all three grains the state's taxonomy supports.
  const market: Record<MarketScope, MarketRow[]> = {
    type: buildMarketRows(rows, "type"),
    brand: buildMarketRows(rows, "brand"),
    strain: buildMarketRows(rows, "strain"),
  };

  // Competitor / supplier / producer / DOH surfaces. Each is best-effort:
  // a month uploaded before the relevant slice shipped simply has no rows,
  // and the lens says so instead of rendering a fabricated zero.
  const [competitors, suppliers, producers, dohSellerRows, typeMoverSignals] = await Promise.all([
    listCompetitorStats(dataset.id).catch(() => []),
    listSupplierStats(dataset.id).catch(() => []),
    listProducerStats(dataset.id).catch(() => []),
    listDohSellers(dataset.id).catch(() => []),
    listMarketSignals(dataset.id, "type_mover").catch(() => [] as DiscoveryMarketSignalRow[]),
  ]);

  const retailers = buildRetailerRows(competitors);
  const sellIn = buildSellInRows(suppliers);
  const sellThrough = buildSellThroughRows(producers);
  const dohSellers = buildDohSellerRows(dohSellerRows);

  const dohVerdict = buildDohVerdict({
    sellers: dohSellers,
    dohMedianUnitPriceMinor: dohPrice?.median_minor ?? null,
    retailMedianUnitPriceMinor: retailPrice?.median_minor ?? null,
    dohLines: dataset.doh_lines,
    retailLines: dataset.retail_lines,
    dohUnknownLines: dataset.doh_unknown_lines,
  });

  const retailMedian = retailPrice?.median_minor ?? null;
  const wholesaleMedian = wholesalePrice?.median_minor ?? null;
  const spreadMinor = retailMedian != null && wholesaleMedian != null ? retailMedian - wholesaleMedian : null;

  // Month-over-month history from every ready transformer dataset. Best-effort.
  let history: TransformerHistoryRow[] = [];
  try {
    const datasets = await listTransformerDatasets();
    const overallRows = (
      await Promise.all(datasets.map((d) => listBenchmarks(d.id, { scope: "overall" })))
    ).flat();
    history = buildTransformerHistory(datasets, overallRows);
  } catch {
    history = [];
  }

  return (
    <>
      <StatewideCommandCenter
        monthLabel={dataset.label}
        market={market}
        marketDetail={buildMarketDetail(typeMoverSignals)}
        retailers={retailers}
        sellIn={sellIn}
        sellThrough={sellThrough}
        dohSellers={dohSellers}
        dohVerdict={dohVerdict}
        retailerConcentration={computeConcentration(retailers.map((r) => r.revenueMinor))}
        sellInConcentration={computeConcentration(sellIn.map((r) => r.revenueMinor))}
        headline={{
          retailMedianMinor: retailMedian,
          wholesaleMedianMinor: wholesaleMedian,
          retailPpgMedianMinor: retailPpg?.median_minor ?? null,
          retailUnits: retailUnits?.value_num ?? null,
          retailRevenueMinor: retailRevenue?.avg_minor ?? null,
          spreadMinor,
          spreadPct: spreadMinor != null && retailMedian != null && retailMedian > 0 ? spreadMinor / retailMedian : null,
          retailLines,
          attributedShare,
          vendorSampleLines: dataset.vendor_attributed_retail_lines ?? null,
        }}
      />

      <p className="text-xs text-[var(--admin-text-muted)]">
        Public Records data — for internal buying/pricing decisions only (RCW 42.56.070(8)).
      </p>

      {history.length > 0 ? (
        <Section title="History" description="Statewide medians and volume across every monthly drop you've processed.">
          <HistoryTable rows={history} />
        </Section>
      ) : null}
    </>
  );
}
