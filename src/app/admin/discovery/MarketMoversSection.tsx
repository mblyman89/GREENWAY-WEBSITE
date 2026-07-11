/**
 * MarketMoversSection — the Leads page's market-intelligence surface (Task H, S4).
 *
 * Server component. Reads the latest READY monthly-transformer dataset
 * (ingest_kind = 'monthly_zip', migration 0106) and renders two lead-shaped
 * tables straight from the persisted CCRS aggregates:
 *
 *  - STATEWIDE TOP MOVERS — the state's best-selling retail products.
 *  - COMPETITOR TOP MOVERS — what the tracked local competitors sold most of.
 *  - SHARED SUPPLIERS (S7) — vendors that sold wholesale to 2+ tracked
 *    competitors this month: proven local demand, the priority outreach list.
 *
 * Each row shows the REAL market price bands from the transformer: the median
 * unit price and the p25 "price to beat" (selling at/below it undercuts ~75%
 * of observed sales). Nothing is fabricated — a thin price sample renders as
 * "—". Read-only; adding a product lead from a mover stays a human decision.
 */
import { Card, CardHeader, Section, Badge } from "@/components/admin/ui";
import { formatMinorCurrency } from "@/lib/leafly/format";
import {
  getLatestTransformerDataset,
  listCompetitorStats,
  listMarketSignals,
} from "@/lib/discovery/market-rollups";
import { listCompetitors } from "@/lib/discovery/competitors";
import {
  buildMarketMoverLeads,
  buildSupplierLeads,
  type MarketMoverLead,
  type SupplierLead,
} from "@/lib/discovery/market-leads-core";

function money(minor: number | null): string {
  return minor == null ? "—" : formatMinorCurrency(minor);
}

function units(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function MoverTable({ leads, showStore }: { leads: MarketMoverLead[]; showStore: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--admin-border)] text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]">
            {showStore ? <th className="py-2 pr-3 font-semibold">Store</th> : null}
            <th className="py-2 pr-3 font-semibold">Product</th>
            <th className="py-2 pr-3 font-semibold">Type</th>
            <th className="py-2 pr-3 text-right font-semibold">Units</th>
            <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
            <th className="py-2 pr-3 text-right font-semibold">Median price</th>
            <th className="py-2 text-right font-semibold">Price to beat (p25)</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l, i) => (
            <tr key={`${l.licenseNumber ?? "sw"}-${l.productName}-${i}`} className="border-b border-[var(--admin-border)]/50">
              {showStore ? (
                <td className="py-2 pr-3 whitespace-nowrap text-[var(--admin-text)]">{l.competitorName ?? "—"}</td>
              ) : null}
              <td className="py-2 pr-3 max-w-[22rem]">
                <div className="truncate font-medium text-[var(--admin-text)]" title={l.productName}>
                  {l.productName}
                </div>
                {(l.brand || l.strainName) && (
                  <div className="truncate text-xs text-[var(--admin-text-muted)]">
                    {[l.brand, l.strainName].filter(Boolean).join(" · ")}
                  </div>
                )}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-[var(--admin-text-muted)]">{l.inventoryType ?? "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text-muted)]">{units(l.units)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text)]">{money(l.revenueMinor)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text-muted)]">{money(l.medianUnitPriceMinor)}</td>
              <td className="py-2 text-right tabular-nums font-semibold text-[var(--admin-accent)]">{money(l.undercutTargetMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SharedSupplierTable({ suppliers }: { suppliers: SupplierLead[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--admin-border)] text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]">
            <th className="py-2 pr-3 font-semibold">Supplier</th>
            <th className="py-2 pr-3 text-right font-semibold">Stores supplied</th>
            <th className="py-2 pr-3 font-semibold">Who they supply</th>
            <th className="py-2 pr-3 text-right font-semibold">Lines</th>
            <th className="py-2 text-right font-semibold">Observed spend</th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((s) => (
            <tr key={s.licenseeId} className="border-b border-[var(--admin-border)]/50">
              <td className="py-2 pr-3 max-w-[18rem]">
                <div className="truncate font-medium text-[var(--admin-text)]" title={s.displayName}>
                  {s.displayName}
                </div>
                {s.licenseNumber ? (
                  <div className="text-xs text-[var(--admin-text-muted)]">lic {s.licenseNumber}</div>
                ) : null}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-semibold text-[var(--admin-accent)]">
                {s.buyerCount}
              </td>
              <td className="py-2 pr-3 max-w-[20rem]">
                <div className="truncate text-[var(--admin-text-muted)]" title={s.buyerNames.join(", ")}>
                  {s.buyerNames.slice(0, 4).join(", ")}
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                {units(s.totalLineCount)}
              </td>
              <td className="py-2 text-right tabular-nums text-[var(--admin-text)]">{money(s.totalSpendMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function MarketMoversSection() {
  // Best-effort: any failure (tables not migrated yet, no service key) simply
  // hides the section — the rest of the Leads page never breaks on this.
  let dataset: Awaited<ReturnType<typeof getLatestTransformerDataset>> = null;
  try {
    dataset = await getLatestTransformerDataset();
  } catch {
    return null;
  }
  if (!dataset) return null;

  let statewide: MarketMoverLead[] = [];
  let competitor: MarketMoverLead[] = [];
  let sharedSuppliers: SupplierLead[] = [];
  try {
    const [signals, stats, roster] = await Promise.all([
      listMarketSignals(dataset.id),
      listCompetitorStats(dataset.id),
      listCompetitors(),
    ]);
    const movers = buildMarketMoverLeads(signals, roster);
    statewide = movers.statewide;
    competitor = movers.competitor;
    // S7: only the multi-competitor suppliers make the Leads page card — the
    // full per-store supplier breakdown lives on Reports → Local Benchmarks.
    sharedSuppliers = buildSupplierLeads(stats, roster).filter(
      (s) => s.suppliesMultipleCompetitors,
    );
  } catch {
    return null;
  }
  if (statewide.length === 0 && competitor.length === 0 && sharedSuppliers.length === 0) {
    return null;
  }

  const period =
    dataset.period_start && dataset.period_end
      ? `${dataset.period_start} → ${dataset.period_end}`
      : null;

  return (
    <Section
      title="Market movers"
      description="Lead ideas straight from the latest monthly CCRS drop — the state's best-selling products and what your tracked competitors moved most. “Price to beat” is the real 25th-percentile unit price: sell at or below it and you undercut ~75% of the observed market."
    >
      <div className="space-y-4">
        {period ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-faint)]">
            <Badge tone="neutral">CCRS monthly</Badge>
            <span>Sales observed {period}. A monthly drop only contains that month&apos;s reported activity.</span>
          </div>
        ) : null}
        {statewide.length > 0 ? (
          <Card padding="md">
            <CardHeader
              title="Statewide top movers"
              subtitle="Best-selling retail products across all of Washington in this drop"
            />
            <div className="mt-3">
              <MoverTable leads={statewide} showStore={false} />
            </div>
          </Card>
        ) : null}
        {competitor.length > 0 ? (
          <Card padding="md">
            <CardHeader
              title="Competitor top movers"
              subtitle="What your tracked competitors sold the most of — with the price to beat them at"
            />
            <div className="mt-3">
              <MoverTable leads={competitor} showStore={true} />
            </div>
          </Card>
        ) : null}
        {sharedSuppliers.length > 0 ? (
          <Card padding="md">
            <CardHeader
              title="Shared suppliers — priority vendor leads"
              subtitle="Vendors that sold wholesale to two or more of your tracked competitors this month. Proven local demand — call these first."
            />
            <div className="mt-3">
              <SharedSupplierTable suppliers={sharedSuppliers} />
            </div>
          </Card>
        ) : null}
        <p className="text-[0.65rem] text-[var(--admin-text-faint)]">
          Every figure is computed from the raw CCRS extract you dropped — nothing is estimated. A
          &ldquo;—&rdquo; price means the sample was too thin to state a band. The AI leads advisor
          above weighs these movers automatically when you run it.
        </p>
      </div>
    </Section>
  );
}
