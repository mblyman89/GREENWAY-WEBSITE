/**
 * src/app/admin/reports/benchmarks/page.tsx
 *
 * The "Benchmarks" reporting tab — the local competitor & area intelligence
 * suite. All the "juicy" market data lives here (NOT on the leads page):
 *   - Area benchmarks (Port Orchard, Bremerton, Silverdale, Key Peninsula/Gig
 *     Harbor, Kitsap, Tacoma): median retail price, $/g, wholesale cost.
 *   - Port Orchard head-to-head: Greenway vs each direct competitor.
 *   - Per-competitor drill-down: what they sell for, what they pay, who they buy
 *     from, and their top categories.
 *
 * Everything is DERIVED from the uploaded CCRS extract sliced by the verified
 * WSLCB competitor roster (discovery_competitors). When a dataset hasn't been
 * uploaded/computed, or a store has no rows, the page says so — never fabricates.
 * Every table has CSV + Excel export.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { BarList } from "@/components/admin/reports/Charts";
import { ReportTable, type ReportColumn } from "@/components/admin/reports/ReportTable";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { StatCard } from "@/components/admin/StatCard";
import { isDiscoveryEnabled } from "@/lib/discovery/store";
import { listDatasets } from "@/lib/discovery/ingest";
import {
  computeCompetitorProfiles,
  rollUpAreas,
  listCompetitors,
  areaLabel,
} from "@/lib/discovery/competitors";
import type { CompetitorProfile, AreaBenchmark, DiscoveryDataset } from "@/lib/discovery/types";
import { TransformerLocalBenchmarks } from "./TransformerLocalBenchmarks";
import { AskAnalystPanel } from "@/app/admin/discovery/AskAnalystPanel";
import { isAiConfigured } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

function money(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return formatMinorCurrency(minor);
}
function num(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString();
}

function Section({
  title,
  subtitle,
  exportHref,
  children,
}: {
  title: string;
  subtitle?: string;
  exportHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-white/40">{subtitle}</p> : null}
        </div>
        {exportHref ? <ExportButtons baseHref={exportHref} /> : null}
      </div>
      {children}
    </section>
  );
}

export default async function BenchmarksReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("reports.view");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return <NotReady message="The database isn't configured yet." />;
  }
  if (!(await isDiscoveryEnabled())) {
    return (
      <NotReady message="Product Discovery is turned off. Turn it on in Product Discovery to build competitor benchmarks." />
    );
  }

  const roster = await listCompetitors();
  const datasets = await listDatasets();
  const computed = datasets.filter((d) => d.status === "ready" && d.benchmarks_computed_at);

  const wanted = one(sp, "dataset");
  const active =
    (wanted && datasets.find((d) => d.id === wanted)) || computed[0] || datasets[0] || null;

  // Always show the roster (verified public data) even before any upload.
  const rosterByArea = groupByArea(roster);

  if (!active) {
    return (
      <div className="space-y-5">
        <Intro rosterCount={roster.length} />
        <RosterCard rosterByArea={rosterByArea} />
        <NotReady
          message="No CCRS dataset uploaded yet. Upload a WA Public Records CCRS extract in Product Discovery → CCRS Benchmarks, then return here to see competitor prices and sourcing."
          inline
        />
      </div>
    );
  }

  // Task H S6: monthly transformer drops persist their competitor rollups in
  // discovery_competitor_stats (0106) — render the dedicated view. The legacy
  // path below reads discovery_ccrs_sales, which is empty for these datasets.
  if (active.ingest_kind === "monthly_zip") {
    return (
      <div className="space-y-5">
        <Intro rosterCount={roster.length} datasetLabel={active.label} />
        <DatasetSwitcher datasets={datasets} activeId={active.id} />
        {/* Task I (I7): free-text Q&A over this drop's local competitor rollups. */}
        <AskAnalystPanel datasetId={active.id} aiEnabled={isAiConfigured} surface="local" />
        <TransformerLocalBenchmarks dataset={active} roster={roster} />
        <Section
          title="Verified competitor roster"
          subtitle="Source: WSLCB Cannabis License Applicants (public licensing data). This is the key used to slice CCRS by store."
        >
          <RosterCard rosterByArea={rosterByArea} />
        </Section>
      </div>
    );
  }

  const profiles = await computeCompetitorProfiles(active.id);
  const areas = rollUpAreas(profiles);
  const self = profiles.find((p) => p.is_self) ?? null;
  const portOrchard = profiles.filter((p) => p.area === "port_orchard");
  const withData = profiles.filter((p) => p.retailSales > 0 || p.wholesaleBuys > 0);

  const base = `/admin/reports/benchmarks/export?dataset=${active.id}`;

  return (
    <div className="space-y-5">
      <Intro rosterCount={roster.length} datasetLabel={active.label} />

      {/* Dataset switcher */}
      <DatasetSwitcher datasets={datasets} activeId={active.id} />

      {withData.length === 0 ? (
        <NotReady
          message={`This dataset ("${active.label}") has no transactions matching the local competitor licenses. If it's a statewide extract this is unexpected — otherwise upload a fuller CCRS extract. The roster below is still shown for reference.`}
          inline
        />
      ) : null}

      {/* Headline: Greenway vs Port Orchard market */}
      {self ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Our median retail price" value={money(self.retailMedianMinor)} hint={`${num(self.retailSales)} retail lines`} accent="green" />
          <StatCard
            label="Port Orchard market median"
            value={money(areas.find((a) => a.area === "port_orchard")?.retailMedianMinor)}
            hint="competitors only"
            accent="gold"
          />
          <StatCard label="Our median $/gram" value={money(self.retailPerGramMedianMinor)} hint="pack-size normalized" accent="muted" />
          <StatCard label="Our wholesale spend (dataset)" value={money(self.wholesaleSpendMinor)} hint={`${num(self.wholesaleBuys)} buys`} accent="muted" />
        </div>
      ) : null}

      {/* Area benchmarks */}
      <Section
        title="Area benchmarks"
        subtitle="Median competitor retail price, $/g, and wholesale cost by area. Area medians are the median of each store's median (labeled proxy)."
        exportHref={`${base}&sheet=areas`}
      >
        <AreaTable areas={areas} />
      </Section>

      {/* Port Orchard head-to-head */}
      <Section
        title="Port Orchard head-to-head"
        subtitle="Greenway vs each direct Port Orchard competitor. Retail = what they sell for; wholesale = what they pay vendors."
        exportHref={`${base}&sheet=port_orchard`}
      >
        <CompetitorTable profiles={portOrchard} />
      </Section>

      {/* Full competitor table (all areas) */}
      <Section
        title="All local competitors"
        subtitle="Every roster store with activity in this dataset, across all areas."
        exportHref={`${base}&sheet=competitors`}
      >
        <CompetitorTable profiles={withData} showArea />
      </Section>

      {/* Per-competitor sourcing drill-down */}
      <Section
        title="Who competitors buy from"
        subtitle="Top vendors by wholesale spend for each competitor that has wholesale rows in this dataset."
        exportHref={`${base}&sheet=sourcing`}
      >
        <SourcingBlocks profiles={withData.filter((p) => p.topVendors.length > 0)} />
      </Section>

      {/* Roster reference */}
      <Section
        title="Verified competitor roster"
        subtitle="Source: WSLCB Cannabis License Applicants (public licensing data). This is the key used to slice CCRS by store."
        exportHref={`${base}&sheet=roster`}
      >
        <RosterCard rosterByArea={rosterByArea} />
      </Section>

      <p className="text-xs text-white/30">
        Derived from CCRS dataset “{active.label}”. Retail/wholesale figures come only from
        transactions present in the uploaded extract. Public Records transaction data is for
        internal buying/pricing decisions only (RCW 42.56.070(8)).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function DatasetSwitcher({ datasets, activeId }: { datasets: DiscoveryDataset[]; activeId: string }) {
  if (datasets.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold uppercase tracking-wide text-white/40">Dataset:</span>
      {datasets.map((d) => (
        <Link
          key={d.id}
          href={`/admin/reports/benchmarks?dataset=${d.id}`}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
            d.id === activeId
              ? "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
              : "text-white/55 hover:bg-white/5 hover:text-white"
          }`}
        >
          {d.label}
        </Link>
      ))}
    </div>
  );
}

function Intro({ rosterCount, datasetLabel }: { rosterCount: number; datasetLabel?: string }) {
  return (
    <section className="rounded-2xl border border-[var(--admin-accent)]/20 bg-[var(--admin-accent)]/[0.04] p-5">
      <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-accent)]">
        Local competitor & area benchmarks
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-white/70">
        Know exactly how you stack up against every licensed store in Port Orchard, Bremerton,
        Silverdale, the Key Peninsula/Gig Harbor, and Tacoma — what they sell products for, what
        they pay vendors, and who they source from. Built from the uploaded CCRS Public Records
        extract, sliced by the verified WSLCB license roster ({rosterCount} stores).
        {datasetLabel ? ` Currently showing: ${datasetLabel}.` : ""}
      </p>
      <p className="mt-3 text-xs text-white/40">
        Upload / refresh the CCRS dataset in{" "}
        <Link href="/admin/discovery/ccrs" className="text-[var(--admin-accent)] underline underline-offset-2">
          Product Discovery → CCRS data intake
        </Link>
        . The statewide potency/velocity deep-dive lives under Product Discovery for staff with intake
        access.
      </p>
    </section>
  );
}

function AreaTable({ areas }: { areas: AreaBenchmark[] }) {
  const columns: ReportColumn<AreaBenchmark & Record<string, unknown>>[] = [
    { key: "area", header: "Area", emphasis: true, render: (r) => areaLabel(r.area) },
    { key: "storeCount", header: "Stores", align: "right", render: (r) => r.storeCount.toLocaleString() },
    { key: "retailMedianMinor", header: "Median retail", align: "right", emphasis: true, render: (r) => money(r.retailMedianMinor) },
    { key: "retailAvgMinor", header: "Avg retail", align: "right", render: (r) => money(r.retailAvgMinor) },
    { key: "retailPerGramMedianMinor", header: "Median $/g", align: "right", render: (r) => money(r.retailPerGramMedianMinor) },
    { key: "wholesaleMedianMinor", header: "Median wholesale", align: "right", render: (r) => money(r.wholesaleMedianMinor) },
    { key: "retailSales", header: "Retail lines", align: "right", render: (r) => num(r.retailSales) },
  ];
  return <ReportTable columns={columns} rows={areas as Array<AreaBenchmark & Record<string, unknown>>} emptyLabel="No competitor activity in this dataset." />;
}

function CompetitorTable({ profiles, showArea }: { profiles: CompetitorProfile[]; showArea?: boolean }) {
  const columns: ReportColumn<CompetitorProfile & Record<string, unknown>>[] = [
    {
      key: "tradename",
      header: "Store",
      emphasis: true,
      render: (r) => (
        <span>
          {r.is_self ? "⭐ " : ""}
          {r.tradename}
          <span className="ml-1 text-white/30">{r.license_number}</span>
        </span>
      ),
    },
    ...(showArea ? [{ key: "area", header: "Area", render: (r: CompetitorProfile) => areaLabel(r.area) } as ReportColumn<CompetitorProfile & Record<string, unknown>>] : []),
    { key: "retailMedianMinor", header: "Median retail", align: "right", emphasis: true, render: (r) => money(r.retailMedianMinor) },
    { key: "retailPerGramMedianMinor", header: "Median $/g", align: "right", render: (r) => money(r.retailPerGramMedianMinor) },
    { key: "retailSales", header: "Retail lines", align: "right", render: (r) => num(r.retailSales) },
    { key: "wholesaleMedianMinor", header: "Median wholesale", align: "right", render: (r) => money(r.wholesaleMedianMinor) },
    { key: "wholesaleSpendMinor", header: "Wholesale spend", align: "right", render: (r) => money(r.wholesaleSpendMinor) },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={profiles as Array<CompetitorProfile & Record<string, unknown>>}
      emptyLabel="No competitor activity in this dataset."
    />
  );
}

function SourcingBlocks({ profiles }: { profiles: CompetitorProfile[] }) {
  if (profiles.length === 0) {
    return <p className="text-sm text-white/40">No wholesale (buy) rows for these competitors in this dataset.</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {profiles.map((p) => (
        <div key={p.license_number} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-white/90">
              {p.is_self ? "⭐ " : ""}
              {p.tradename}
            </span>
            <span className="text-xs text-white/40">{areaLabel(p.area)}</span>
          </div>
          <BarList
            data={p.topVendors.map((v) => ({
              label: v.name ? `${v.name} (${v.license_number})` : `License ${v.license_number}`,
              value: Math.round(v.spendMinor / 100),
            }))}
            valueFormatter={(v) => `$${v.toLocaleString()}`}
            emptyLabel="No wholesale rows."
          />
        </div>
      ))}
    </div>
  );
}

function RosterCard({ rosterByArea }: { rosterByArea: Map<string, { license_number: string; tradename: string; city: string | null; is_self: boolean }[]> }) {
  const areasInOrder = ["port_orchard", "bremerton", "silverdale", "key_peninsula", "kitsap_other", "tacoma"];
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {areasInOrder
        .filter((a) => rosterByArea.has(a))
        .map((a) => (
          <div key={a} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-white/60">
              {areaLabel(a as never)}
            </div>
            <ul className="space-y-1 text-sm">
              {rosterByArea.get(a)!.map((s) => (
                <li key={s.license_number} className="flex items-center justify-between gap-2">
                  <span className={s.is_self ? "font-bold text-[var(--admin-accent)]" : "text-white/80"}>
                    {s.is_self ? "⭐ " : ""}
                    {s.tradename}
                  </span>
                  <span className="text-white/30">{s.license_number}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

function groupByArea(
  roster: Awaited<ReturnType<typeof listCompetitors>>,
): Map<string, { license_number: string; tradename: string; city: string | null; is_self: boolean }[]> {
  const m = new Map<string, { license_number: string; tradename: string; city: string | null; is_self: boolean }[]>();
  for (const c of roster) {
    const arr = m.get(c.area) ?? [];
    arr.push({ license_number: c.license_number, tradename: c.tradename, city: c.city, is_self: c.is_self });
    m.set(c.area, arr);
  }
  return m;
}

function NotReady({ message, inline }: { message: string; inline?: boolean }) {
  const box = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/60">
      {message}
    </div>
  );
  if (inline) return box;
  return <div className="space-y-5">{box}</div>;
}
