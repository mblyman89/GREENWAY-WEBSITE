/**
 * TransformerBenchmarks — the statewide-benchmarks body for datasets produced
 * by the monthly CCRS zip transformer (Task H, S5; ingest_kind='monthly_zip').
 *
 * Server component rendered by /admin/discovery/benchmarks when the active
 * dataset came from the drag-drop monthly zip. The transformer's rollups live
 * in `discovery_benchmarks` under the class-scoped metrics
 * (retail_/wholesale_ unit price, $/gram, units, revenue) across the scopes
 * overall / type / brand / strain — the legacy category-scope view can't show
 * them, so this view does.
 *
 * NEVER GUESS: every figure is the transformer's real aggregate; a missing
 * band renders "—". The attribution share is surfaced honestly — a monthly
 * drop is a DELTA file and only lines whose product joins resolved inside the
 * same file carry type/brand/strain detail; the rest are counted, not guessed.
 */
import { StatCard } from "@/components/admin/StatCard";
import { Card, CardHeader, Section, Badge } from "@/components/admin/ui";
import { listBenchmarks } from "@/lib/discovery/benchmarks";
import { listTransformerDatasets, listMarketSignals } from "@/lib/discovery/market-rollups";
import {
  buildTransformerHistory,
  type TransformerHistoryRow,
} from "@/lib/discovery/benchmarks-history-core";
import { groupTypeMovers, type TypeMoverGroup } from "@/lib/discovery/type-movers-core";
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

function pick(rows: DiscoveryBenchmark[], scope: string, metric: BenchmarkMetric): DiscoveryBenchmark[] {
  return rows.filter((r) => r.scope === scope && r.metric === metric);
}

/** Price-distribution table (p25 / median / p75 / avg / n), top rows by median. */
function PriceTable({ title, subtitle, rows, limit = 15 }: { title: string; subtitle: string; rows: DiscoveryBenchmark[]; limit?: number }) {
  const sorted = [...rows]
    .filter((r) => r.median_minor != null)
    .sort((a, b) => (b.sample_size ?? 0) - (a.sample_size ?? 0))
    .slice(0, limit);
  return (
    <Card padding="md">
      <CardHeader title={title} subtitle={subtitle} />
      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No data for this breakdown in this drop.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="py-2 pr-3">Name</th>
                <th className="px-3 py-2 text-right">Low (p25)</th>
                <th className="px-3 py-2 text-right">Median</th>
                <th className="px-3 py-2 text-right">High (p75)</th>
                <th className="px-3 py-2 text-right">Avg</th>
                <th className="py-2 pl-3 text-right">n</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-[var(--admin-border)]/50">
                  <td className="max-w-[18rem] truncate py-2 pr-3 font-medium text-[var(--admin-text)]" title={r.scope_key}>
                    {r.scope_key}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(r.p25_minor)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-[var(--admin-text)]">{money(r.median_minor)}</td>
                  <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(r.p75_minor)}</td>
                  <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(r.avg_minor)}</td>
                  <td className="py-2 pl-3 text-right text-[var(--admin-text-muted)]">{num(r.sample_size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Units + revenue table for a scope, top rows by revenue. */
function VolumeTable({
  title,
  subtitle,
  unitRows,
  revenueRows,
  limit = 15,
}: {
  title: string;
  subtitle: string;
  unitRows: DiscoveryBenchmark[];
  revenueRows: DiscoveryBenchmark[];
  limit?: number;
}) {
  const revenueByKey = new Map(revenueRows.map((r) => [r.scope_key, r.avg_minor]));
  const merged = unitRows
    .map((r) => ({ key: r.scope_key, units: r.value_num ?? 0, revenueMinor: revenueByKey.get(r.scope_key) ?? null }))
    .sort((a, b) => (b.revenueMinor ?? 0) - (a.revenueMinor ?? 0))
    .slice(0, limit);
  return (
    <Card padding="md">
      <CardHeader title={title} subtitle={subtitle} />
      {merged.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No data for this breakdown in this drop.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="py-2 pr-3">Name</th>
                <th className="px-3 py-2 text-right">Units</th>
                <th className="py-2 pl-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => (
                <tr key={r.key} className="border-b border-[var(--admin-border)]/50">
                  <td className="max-w-[18rem] truncate py-2 pr-3 font-medium text-[var(--admin-text)]" title={r.key}>
                    {r.key}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{num(r.units)}</td>
                  <td className="py-2 pl-3 text-right font-semibold text-[var(--admin-text)]">{money(r.revenueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
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
 * Task I (I4): top products for ONE inventory type, with brand · strain ·
 * vendor. Vendor comes from manifest lot joins (dominant origin) with a
 * conservative brand-bridge fallback; "—" = unresolvable, never guessed.
 */
function TypeProductsTable({ inventoryType, rows }: { inventoryType: string; rows: DiscoveryMarketSignalRow[] }) {
  return (
    <Card padding="md">
      <CardHeader
        title={`Top ${rows.length} products — ${inventoryType}`}
        subtitle="Statewide retail sell-through this month, ranked by revenue"
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
              <th className="py-2 pr-3">Product</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Strain</th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2 text-right">Units</th>
              <th className="px-3 py-2 text-right">Revenue</th>
              <th className="px-3 py-2 text-right">Median</th>
              <th className="py-2 pl-3 text-right">Low (p25)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-[var(--admin-border)]/50">
                <td className="max-w-[16rem] truncate py-2 pr-3 font-medium text-[var(--admin-text)]" title={s.product_name ?? undefined}>
                  {s.product_name ?? "—"}
                </td>
                <td className="max-w-[9rem] truncate px-3 py-2 text-[var(--admin-text-muted)]" title={s.brand ?? undefined}>
                  {s.brand ?? "—"}
                </td>
                <td className="max-w-[9rem] truncate px-3 py-2 text-[var(--admin-text-muted)]" title={s.strain_name ?? undefined}>
                  {s.strain_name ?? "—"}
                </td>
                <td
                  className="max-w-[11rem] truncate px-3 py-2 text-[var(--admin-text)]"
                  title={s.vendor_name ? `${s.vendor_name}${s.vendor_license ? ` (lic ${s.vendor_license})` : ""}` : undefined}
                >
                  {s.vendor_name ?? "—"}
                </td>
                <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{num(s.units)}</td>
                <td className="px-3 py-2 text-right font-semibold text-[var(--admin-text)]">{money(s.revenue_minor)}</td>
                <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(s.median_unit_price_minor)}</td>
                <td className="py-2 pl-3 text-right text-[var(--admin-text-muted)]">{money(s.p25_unit_price_minor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export async function TransformerBenchmarks({ dataset }: { dataset: DiscoveryDataset }) {
  const rows = await listBenchmarks(dataset.id);

  // Headline overall rollups.
  const overall = (metric: BenchmarkMetric) =>
    rows.find((r) => r.scope === "overall" && r.scope_key === "all" && r.metric === metric) ?? null;
  const retailPrice = overall("retail_unit_price");
  const wholesalePrice = overall("wholesale_unit_price");
  const retailPpg = overall("retail_price_per_gram");
  const retailUnits = overall("retail_units");
  const retailRevenue = overall("retail_revenue");

  const retailLines = dataset.retail_lines ?? null;
  const attributed = dataset.attributed_retail_lines ?? null;
  const attributedShare =
    retailLines != null && attributed != null && retailLines > 0 ? attributed / retailLines : null;

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

  // Task I (I4): per-inventory-type product leaderboards with vendor + brand.
  // Best-effort: a pre-I4 upload has no type_mover signals — the section
  // simply doesn't render until the owner re-uploads the month's zip.
  let typeGroups: TypeMoverGroup[] = [];
  try {
    typeGroups = groupTypeMovers(await listMarketSignals(dataset.id, "type_mover"));
  } catch {
    typeGroups = [];
  }

  return (
    <>
      {/* Headline KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Median retail price"
          value={money(retailPrice?.median_minor)}
          hint={`across ${num(retailPrice?.sample_size)} priced lines`}
        />
        <StatCard
          label="Median wholesale price"
          value={money(wholesalePrice?.median_minor)}
          hint={`across ${num(wholesalePrice?.sample_size)} priced lines`}
        />
        <StatCard label="Median $/gram (retail)" value={money(retailPpg?.median_minor)} hint="statewide, weight-normalized" />
        <StatCard label="Retail units sold" value={num(retailUnits?.value_num)} hint={`revenue ${money(retailRevenue?.avg_minor)}`} />
      </div>

      <p className="text-xs text-[var(--admin-text-muted)]">
        <Badge tone="neutral">Monthly drop</Badge> {dataset.label} · detail coverage {share(attributedShare)}{" "}
        of {num(retailLines)} retail lines (delta files only carry full product detail for lines whose
        joins resolve inside the same month — the rest are counted, never guessed). Public Records data —
        for internal buying/pricing decisions only (RCW 42.56.070(8)).
      </p>

      {/* Prices by inventory type */}
      <Section title="Prices by inventory type" description="What shoppers pay (retail) and what stores pay vendors (wholesale), straight from the drop.">
        <div className="grid gap-4 lg:grid-cols-2">
          <PriceTable title="Retail unit price by type" subtitle="Shelf price distribution" rows={pick(rows, "type", "retail_unit_price")} />
          <PriceTable title="Wholesale unit price by type" subtitle="Your buying benchmark" rows={pick(rows, "type", "wholesale_unit_price")} />
        </div>
      </Section>

      {/* $/gram */}
      <Section title="Price per gram" description="Normalized across pack sizes so types are comparable.">
        <div className="grid gap-4 lg:grid-cols-2">
          <PriceTable title="$/gram by type (retail)" subtitle="Normalized retail price" rows={pick(rows, "type", "retail_price_per_gram")} />
          <PriceTable title="$/gram by type (wholesale)" subtitle="Normalized buying price" rows={pick(rows, "type", "wholesale_price_per_gram")} />
        </div>
      </Section>

      {/* Brand & strain pricing */}
      <Section title="Brand & strain pricing" description="Where premiums and value plays live. Top rows by how many sales back the number.">
        <div className="grid gap-4 lg:grid-cols-2">
          <PriceTable title="Retail price by brand" subtitle="From product-name brand prefixes" rows={pick(rows, "brand", "retail_unit_price")} />
          <PriceTable title="Retail price by strain" subtitle="From the CCRS strain table" rows={pick(rows, "strain", "retail_unit_price")} />
        </div>
      </Section>

      {/* Velocity & mix */}
      <Section title="Velocity & mix" description="What actually moves — units and revenue by breakdown.">
        <div className="grid gap-4 lg:grid-cols-2">
          <VolumeTable
            title="Retail volume by type"
            subtitle="Statewide units & dollars"
            unitRows={pick(rows, "type", "retail_units")}
            revenueRows={pick(rows, "type", "retail_revenue")}
          />
          <VolumeTable
            title="Retail volume by brand"
            subtitle="Top brands by revenue"
            unitRows={pick(rows, "brand", "retail_units")}
            revenueRows={pick(rows, "brand", "retail_revenue")}
          />
        </div>
      </Section>

      {/* Task I (I4): top products per inventory type, with vendor + brand */}
      {typeGroups.length > 0 ? (
        <Section
          title="Top products by type"
          description="The state's best-selling products in every inventory type — with the brand and the vendor (producer/processor) behind each one. Vendor comes from the month's transport manifests (lot-level origin joins, with a conservative brand fallback); “—” means the vendor couldn't be verified from this delivery — never guessed."
        >
          <div className="grid gap-4">
            {typeGroups.map((g) => (
              <TypeProductsTable key={g.inventoryType} inventoryType={g.inventoryType} rows={g.rows} />
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Top products by type" description="Per-type product leaderboards with vendor + brand.">
          <Card padding="md">
            <p className="text-sm text-[var(--admin-text-muted)]">
              This drop has no per-type product signals yet &mdash; they&apos;re computed during upload. Re-upload
              this month&apos;s zip (after applying migration 0110) to populate this section.
            </p>
          </Card>
        </Section>
      )}

      {/* History */}
      {history.length > 0 ? (
        <Section title="History" description="Statewide medians and volume across every monthly drop you've processed.">
          <HistoryTable rows={history} />
        </Section>
      ) : null}
    </>
  );
}
