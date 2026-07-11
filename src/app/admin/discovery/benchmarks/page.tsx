import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card, CardHeader, Section, Badge } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { getDiscoverySnapshot } from "@/lib/discovery/store";
import { listDatasets } from "@/lib/discovery/ingest";
import { listBenchmarks, listTopLicensees, getBenchmarkFor } from "@/lib/discovery/benchmarks";
import { compareOwnVsBenchmarks, type CompareRow, type CompareFlag } from "@/lib/discovery/compare";
import type { DiscoveryBenchmark, BenchmarkScope, BenchmarkMetric, DiscoveryDataset } from "@/lib/discovery/types";
import { TransformerBenchmarks } from "./TransformerBenchmarks";
import { AskAnalystPanel } from "../AskAnalystPanel";
import { isAiConfigured } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

function money(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}
function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** A price-benchmark table: rows keyed by scope_key, one metric = price distribution. */
function PriceTable({ title, subtitle, rows }: { title: string; subtitle: string; rows: DiscoveryBenchmark[] }) {
  const sorted = [...rows].sort((a, b) => (b.median_minor ?? 0) - (a.median_minor ?? 0));
  return (
    <Card padding="md">
      <CardHeader title={title} subtitle={subtitle} />
      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No data for this breakdown.</p>
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
                  <td className="py-2 pr-3 font-medium text-[var(--admin-text)]">{r.scope_key}</td>
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

/** A value table: rows show a numeric value (units, revenue, potency). */
function ValueTable({
  title,
  subtitle,
  rows,
  fmt,
}: {
  title: string;
  subtitle: string;
  rows: DiscoveryBenchmark[];
  fmt: (b: DiscoveryBenchmark) => string;
}) {
  const sorted = [...rows].sort((a, b) => (b.value_num ?? b.median_minor ?? 0) - (a.value_num ?? a.median_minor ?? 0));
  return (
    <Card padding="md">
      <CardHeader title={title} subtitle={subtitle} />
      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No data for this breakdown.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pl-3 text-right">Value</th>
                <th className="py-2 pl-3 text-right">n</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-[var(--admin-border)]/50">
                  <td className="py-2 pr-3 font-medium text-[var(--admin-text)]">{r.scope_key}</td>
                  <td className="py-2 pl-3 text-right font-semibold text-[var(--admin-text)]">{fmt(r)}</td>
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

function pick(rows: DiscoveryBenchmark[], scope: BenchmarkScope, metric: BenchmarkMetric): DiscoveryBenchmark[] {
  return rows.filter((r) => r.scope === scope && r.metric === metric);
}

export default async function BenchmarksPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const snap = await getDiscoverySnapshot();

  if (!snap.configured || !snap.enabled) {
    return (
      <div>
        <AdminPageHeader
          title="Statewide Benchmarks"
          subtitle="Market insights computed from Public Records CCRS data."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Product Intake", href: "/admin/catalog" },
                { label: "Product Discovery", href: "/admin/discovery" },
                { label: "Benchmarks" },
              ]}
            />
          }
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <BackLink />
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            {!snap.configured
              ? "The database isn't fully set up yet. Apply the discovery CCRS migration first."
              : "Product Discovery is currently turned off."}
          </div>
        </div>
      </div>
    );
  }

  const datasets = await listDatasets();
  const computed = datasets.filter((d) => d.status === "ready" && d.benchmarks_computed_at);

  // Chosen dataset: query param, else latest computed, else latest.
  const wanted = one(sp, "dataset");
  const active =
    (wanted && datasets.find((d) => d.id === wanted)) ||
    computed[0] ||
    datasets[0] ||
    null;

  if (!active) {
    return (
      <div>
        <AdminPageHeader
          title="Statewide Benchmarks"
          subtitle="Market insights computed from Public Records CCRS data."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Product Intake", href: "/admin/catalog" },
                { label: "Product Discovery", href: "/admin/discovery" },
                { label: "Benchmarks" },
              ]}
            />
          }
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <BackLink />
          <Card padding="md">
            <p className="text-sm text-[var(--admin-text-muted)]">
              No datasets yet. Head to{" "}
              <Link href="/admin/discovery/ccrs" className="font-semibold text-[var(--admin-accent)] hover:underline">
                CCRS Benchmarks
              </Link>{" "}
              to request the Public Records data and upload it.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  // Task H S5: datasets produced by the monthly zip transformer store their
  // rollups under the class-scoped metrics across overall/type/brand/strain —
  // the legacy category view below can't show them, so render the dedicated
  // transformer view (with month-over-month history) instead.
  if (active.ingest_kind === "monthly_zip") {
    return (
      <div>
        <AdminPageHeader
          title="Statewide Benchmarks"
          subtitle="Statewide prices, $/gram, brand & strain premiums, velocity and month-over-month trends — from the monthly CCRS drop."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Product Intake", href: "/admin/catalog" },
                { label: "Product Discovery", href: "/admin/discovery" },
                { label: "Benchmarks" },
              ]}
            />
          }
          action={
            <Link href="/admin/discovery/ccrs">
              <Button variant="neutral" size="sm">Manage datasets</Button>
            </Link>
          }
          help={
            <HelpPanel
              id="discovery-benchmarks"
              title="Reading these benchmarks"
              steps={[
                "Wholesale price = what stores PAY vendors (your buying benchmark). Retail price = shelf price shoppers pay.",
                "Median is the typical price; p25/p75 show the normal low-to-high band. 'n' is how many transactions back the number.",
                "$/gram normalizes across pack sizes so types are comparable.",
                "Each monthly drop keeps its own rollups — the History table lines them up month over month.",
              ]}
            >
              <p className="text-xs text-[var(--admin-text-muted)]">
                Computed in your browser from the monthly WSLCB zip ({active.label}); only the rollups are stored.
              </p>
            </HelpPanel>
          }
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <BackLink />
          <DatasetSelector datasets={datasets} activeId={active.id} />
          {/* Task I (I7): free-text Q&A over this drop's persisted rollups. */}
          <AskAnalystPanel datasetId={active.id} aiEnabled={isAiConfigured} surface="statewide" />
          <TransformerBenchmarks dataset={active} />
        </div>
      </div>
    );
  }

  const rows = await listBenchmarks(active.id);
  const topVendors = await listTopLicensees(active.id, 25);
  const compare = active.benchmarks_computed_at
    ? await compareOwnVsBenchmarks(active.id, active.benchmarks_computed_at)
    : { datasetId: active.id, rows: [] as CompareRow[], computedAt: null };

  const overallRetail = await getBenchmarkFor(active.id, "overall", "all", "retail_unit_price");
  const overallWholesale = await getBenchmarkFor(active.id, "overall", "all", "wholesale_unit_price");
  // $/gram and units are computed per-category; roll up a headline from those.
  const catPpg = pick(rows, "category", "price_per_gram");
  const ppgMedians = catPpg.map((r) => r.median_minor).filter((v): v is number => v != null);
  const overallPpgMedian = ppgMedians.length
    ? Math.round(ppgMedians.reduce((a, b) => a + b, 0) / ppgMedians.length)
    : null;
  const totalUnits = pick(rows, "category", "units").reduce((a, r) => a + (r.value_num ?? 0), 0);

  const provenance = `Computed from CCRS ${
    active.period_start || active.period_end
      ? `${fmtDate(active.period_start)}–${fmtDate(active.period_end)}`
      : "extract"
  } on ${fmtDate(active.benchmarks_computed_at)}`;

  const needsCompute = !active.benchmarks_computed_at;

  return (
    <div>
      <AdminPageHeader
        title="Statewide Benchmarks"
        subtitle="Wholesale & retail prices, $/gram, potency, velocity and top vendors — from the WA source-of-truth."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Product Discovery", href: "/admin/discovery" },
              { label: "Benchmarks" },
            ]}
          />
        }
        action={
          <Link href="/admin/discovery/ccrs">
            <Button variant="neutral" size="sm">Manage datasets</Button>
          </Link>
        }
        help={
          <HelpPanel
            id="discovery-benchmarks"
            title="Reading these benchmarks"
            steps={[
              "Wholesale price = what stores PAY vendors (your buying benchmark). Retail price = shelf price shoppers pay.",
              "Median is the typical price; p25/p75 show the normal low-to-high band. 'n' is how many transactions back the number.",
              "$/gram normalizes across pack sizes so you can compare flower, concentrates, edibles fairly.",
              "Top vendors are ranked by total wholesale dollars shipped statewide — great candidates to source from.",
            ]}
          >
            <p className="text-xs text-[var(--admin-text-muted)]">{provenance}</p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BackLink />

        {/* Dataset selector */}
        <DatasetSelector datasets={datasets} activeId={active.id} />

        {/* Task I (I7): free-text Q&A over this dataset's persisted rollups. */}
        {active.benchmarks_computed_at ? (
          <AskAnalystPanel datasetId={active.id} aiEnabled={isAiConfigured} surface="statewide" />
        ) : null}

        {needsCompute ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
            Benchmarks haven&apos;t been computed for <strong>{active.label}</strong> yet. Go to{" "}
            <Link href="/admin/discovery/ccrs" className="font-semibold text-[var(--admin-orange)] hover:underline">
              CCRS Benchmarks
            </Link>{" "}
            and click <strong>Compute benchmarks</strong>.
          </div>
        ) : null}

        {/* Headline KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Median retail price" value={money(overallRetail?.median_minor)} hint={`across ${num(overallRetail?.sample_size)} sales`} />
          <StatCard label="Median wholesale price" value={money(overallWholesale?.median_minor)} hint={`across ${num(overallWholesale?.sample_size)} transfers`} />
          <StatCard label="Median $/gram (retail)" value={money(overallPpgMedian)} hint="avg of category medians" />
          <StatCard label="Total units sold" value={num(totalUnits)} hint="statewide in period" />
        </div>

        <p className="text-xs text-[var(--admin-text-muted)]">
          <Badge tone="neutral">Provenance</Badge> {provenance}. Public Records data —
          for internal buying/pricing decisions only (RCW 42.56.070(8)).
        </p>

        {/* HEADLINE: our numbers vs the market */}
        <Section
          title="Your numbers vs. the market"
          description="Your average unit cost (what you pay vendors) compared to the statewide median wholesale price, by category. Positive delta means you're paying more than the state."
        >
          <Card padding="md">
            {compare.rows.length === 0 ? (
              <p className="text-sm text-[var(--admin-text-muted)]">
                No comparison yet — this needs your own inventory lots and computed benchmarks. Once you
                have both, over/under-paying flags appear here automatically.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                      <th className="py-2 pr-3">Category</th>
                      <th className="px-3 py-2 text-right">Your avg cost</th>
                      <th className="px-3 py-2 text-right">State median (wholesale)</th>
                      <th className="px-3 py-2 text-right">Delta</th>
                      <th className="px-3 py-2 text-right">Your $/g</th>
                      <th className="px-3 py-2 text-right">State $/g</th>
                      <th className="py-2 pl-3 text-right">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compare.rows.map((r) => (
                      <tr key={r.category} className="border-b border-[var(--admin-border)]/50">
                        <td className="py-2 pr-3 font-medium text-[var(--admin-text)]">
                          {r.category}
                          <span className="ml-2 text-xs text-[var(--admin-text-muted)]">{r.lotCount} lots</span>
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--admin-text)]">{money(r.ourAvgCostMinor)}</td>
                        <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">
                          {money(r.benchWholesaleMedianMinor)}
                          {r.benchSample ? <span className="ml-1 text-[10px]">n={num(r.benchSample)}</span> : null}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${deltaColor(r.flag)}`}>
                          {r.deltaMinor == null ? "—" : `${r.deltaMinor > 0 ? "+" : ""}${money(Math.abs(r.deltaMinor) * (r.deltaMinor < 0 ? -1 : 1))}`}
                          {r.deltaPct != null ? (
                            <span className="ml-1 text-[10px]">({r.deltaPct > 0 ? "+" : ""}{r.deltaPct.toFixed(0)}%)</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(r.ourAvgCostPerGramMinor)}</td>
                        <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{money(r.benchWholesalePerGramMedianMinor)}</td>
                        <td className="py-2 pl-3 text-right"><FlagBadge flag={r.flag} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
              Cost-vs-wholesale is apples-to-apples (both are what a store pays a vendor). &ldquo;In line&rdquo; = within
              ±5% of the statewide median. Categories with no matching benchmark are marked accordingly.
            </p>
          </Card>
        </Section>

        {/* Retail vs wholesale by category */}
        <Section title="Prices by category" description="What shoppers pay (retail) and what stores pay vendors (wholesale).">
          <div className="grid gap-4 lg:grid-cols-2">
            <PriceTable
              title="Retail unit price by category"
              subtitle="Shelf price distribution"
              rows={pick(rows, "category", "retail_unit_price")}
            />
            <PriceTable
              title="Wholesale unit price by category"
              subtitle="Your buying benchmark"
              rows={pick(rows, "category", "wholesale_unit_price")}
            />
          </div>
        </Section>

        {/* $/gram by category + type */}
        <Section title="Price per gram" description="Normalized across pack sizes so categories are comparable.">
          <div className="grid gap-4 lg:grid-cols-2">
            <PriceTable
              title="$/gram by category (retail)"
              subtitle="Normalized retail price"
              rows={pick(rows, "category", "price_per_gram")}
            />
            <PriceTable
              title="$/gram by inventory type (retail)"
              subtitle="Finer breakdown"
              rows={pick(rows, "type", "price_per_gram")}
            />
          </div>
        </Section>

        {/* Brand & strain pricing */}
        <Section title="Brand & strain pricing" description="Where premiums and value plays live.">
          <div className="grid gap-4 lg:grid-cols-2">
            <PriceTable
              title="Retail price by brand"
              subtitle="Top brands by median price"
              rows={pick(rows, "brand", "retail_unit_price")}
            />
            <PriceTable
              title="Retail price by strain"
              subtitle="Top strains by median price"
              rows={pick(rows, "strain", "retail_unit_price")}
            />
          </div>
        </Section>

        {/* Velocity / mix */}
        <Section title="Velocity & category mix" description="What actually moves — units sold and revenue by category.">
          <div className="grid gap-4 lg:grid-cols-2">
            <ValueTable
              title="Units sold by category"
              subtitle="Statewide volume"
              rows={pick(rows, "category", "units")}
              fmt={(r) => num(r.value_num)}
            />
            <ValueTable
              title="Revenue by category"
              subtitle="Statewide retail dollars"
              rows={pick(rows, "category", "revenue")}
              fmt={(r) => money(r.value_num != null ? Math.round(r.value_num) : null)}
            />
          </div>
        </Section>

        {/* Potency */}
        <Section title="Potency benchmarks" description="Average lab-tested THC and CBD by test.">
          <div className="grid gap-4 lg:grid-cols-2">
            <ValueTable
              title="Average THC %"
              subtitle="By lab test name"
              rows={pick(rows, "overall", "thc_pct")}
              fmt={(r) => pct(r.value_num)}
            />
            <ValueTable
              title="Average CBD %"
              subtitle="By lab test name"
              rows={pick(rows, "overall", "cbd_pct")}
              fmt={(r) => pct(r.value_num)}
            />
          </div>
        </Section>

        {/* Top vendors */}
        <Section title="Top wholesale vendors statewide" description="Ranked by total wholesale dollars shipped — prime sourcing candidates.">
          <Card padding="md">
            {topVendors.length === 0 ? (
              <p className="text-sm text-[var(--admin-text-muted)]">No wholesale activity found in this dataset.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Vendor / license</th>
                      <th className="px-3 py-2 text-right">Units shipped</th>
                      <th className="py-2 pl-3 text-right">Wholesale $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topVendors.map((v, i) => (
                      <tr key={v.license_number} className="border-b border-[var(--admin-border)]/50">
                        <td className="py-2 pr-3 text-[var(--admin-text-muted)]">{i + 1}</td>
                        <td className="py-2 pr-3 font-medium text-[var(--admin-text)]">
                          {v.name || `License ${v.license_number}`}
                          <span className="ml-2 text-xs text-[var(--admin-text-muted)]">{v.license_number}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{num(v.wholesale_out_units)}</td>
                        <td className="py-2 pl-3 text-right font-semibold text-[var(--admin-text)]">{money(v.wholesale_out_minor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3">
              <Link href="/admin/discovery/ccrs" className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">
                Turn these into vendor leads →
              </Link>
            </div>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function DatasetSelector({ datasets, activeId }: { datasets: DiscoveryDataset[]; activeId: string }) {
  if (datasets.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-[var(--admin-text-muted)]">Dataset:</span>
      {datasets.map((d) => (
        <Link
          key={d.id}
          href={`/admin/discovery/benchmarks?dataset=${d.id}`}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            d.id === activeId
              ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
              : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
          }`}
        >
          {d.label}
        </Link>
      ))}
    </div>
  );
}

function deltaColor(flag: CompareFlag): string {
  if (flag === "over") return "text-[var(--admin-danger)]";
  if (flag === "under") return "text-[var(--admin-accent)]";
  return "text-[var(--admin-text-muted)]";
}

function FlagBadge({ flag }: { flag: CompareFlag }) {
  const map: Record<CompareFlag, { label: string; cls: string }> = {
    over: { label: "Paying more", cls: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]" },
    under: { label: "Paying less", cls: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" },
    inline: { label: "In line", cls: "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]" },
    no_benchmark: { label: "No benchmark", cls: "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]" },
  };
  const m = map[flag];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/discovery"
      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
    >
      ← Back to Product Discovery
    </Link>
  );
}
