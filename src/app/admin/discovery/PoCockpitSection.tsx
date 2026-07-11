/**
 * PoCockpitSection — the Leads page's local purchase-manager cockpit (Task I, I5).
 *
 * Server component. Owner's ask: "what would a professional expert level
 * purchase manager need … more displays and tables and insights related to our
 * local competitors as well as port orchard specifically. port orchard is who
 * we really need to start beating … easier time putting together purchase
 * orders with this new gold mine of information."
 *
 * Three battle-plan cards, computed by the PURE po-cockpit-core module from
 * the latest monthly CCRS drop + the verified roster + our PUBLISHED menu:
 *
 *  1. HEAD-TO-HEAD — every tracked Port Orchard competitor: real revenue,
 *     price bands, category mix, sourcing spend, and how much of their
 *     top-mover list our menu already covers.
 *  2. BUY LIST — what Port Orchard sells that we DON'T carry, deduped across
 *     stores, with the manifest-resolved vendor (I4) and the price to beat.
 *     Every row has a one-click "Start PO" that prefills the builder.
 *  3. PRICE CHECK — movers we DO carry where our menu price sits above/below
 *     their observed p25 "beat" price.
 *
 * HONESTY: the transformer structurally excludes Greenway from competitor
 * rollups, so there are no Greenway CCRS numbers here — our side of the board
 * is our REAL published menu, never an invented sales figure. Missing prices
 * and unresolved vendors render as "—". Best-effort: any failure (tables not
 * migrated, no dataset, no service key) hides the section entirely.
 */
import { Card, CardHeader, Section, Badge, Button } from "@/components/admin/ui";
import { formatMinorCurrency } from "@/lib/leafly/format";
import {
  getLatestTransformerDataset,
  listCompetitorStats,
  listMarketSignals,
} from "@/lib/discovery/market-rollups";
import { listCompetitors, areaLabel } from "@/lib/discovery/competitors";
import { loadCandidateItems } from "@/lib/products/masters-store";
import {
  buildPoCockpit,
  buildBuyRowDemandSignal,
  type PoCockpit,
  type HeadToHeadRow,
  type BuyListRow,
  type UndercutRow,
} from "@/lib/discovery/po-cockpit-core";
import { startPoFromCockpitRowAction } from "./actions";

function money(minor: number | null): string {
  return minor == null ? "—" : formatMinorCurrency(minor);
}

function units(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

// ---------------------------------------------------------------------------
// 1. Head-to-head board
// ---------------------------------------------------------------------------

function HeadToHeadTable({ rows }: { rows: HeadToHeadRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--admin-border)] text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]">
            <th className="py-2 pr-3 font-semibold">Competitor</th>
            <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
            <th className="py-2 pr-3 text-right font-semibold">Units</th>
            <th className="py-2 pr-3 text-right font-semibold">p25 / median / p75</th>
            <th className="py-2 pr-3 font-semibold">Top categories</th>
            <th className="py-2 pr-3 text-right font-semibold">Wholesale spend</th>
            <th className="py-2 text-right font-semibold">Their movers on our menu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.licenseNumber} className="border-b border-[var(--admin-border)]/50 align-top">
              <td className="py-2 pr-3">
                <div className="font-medium text-[var(--admin-text)]">{r.displayName}</div>
                <div className="text-xs text-[var(--admin-text-muted)]">
                  lic {r.licenseNumber}
                  {r.city ? ` · ${r.city}` : ""}
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-semibold text-[var(--admin-text)]">
                {money(r.retailRevenueMinor)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                {units(r.retailUnits)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap text-[var(--admin-text-muted)]">
                {money(r.priceP25Minor)} / {money(r.priceMedianMinor)} / {money(r.priceP75Minor)}
              </td>
              <td className="py-2 pr-3 max-w-[16rem]">
                <div className="text-xs text-[var(--admin-text-muted)]">
                  {r.topTypes.length > 0
                    ? r.topTypes.map((t) => `${t.inventoryType} ${pct(t.share)}`).join(" · ")
                    : "—"}
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text-muted)]">
                {r.wholesaleSpendMinor == null ? (
                  "—"
                ) : (
                  <>
                    {money(r.wholesaleSpendMinor)}
                    {r.supplierCount != null && r.supplierCount > 0 ? (
                      <span className="text-xs"> · {r.supplierCount} suppliers</span>
                    ) : null}
                  </>
                )}
              </td>
              <td className="py-2 text-right">
                {r.moversTotal > 0 ? (
                  <div className="inline-flex flex-wrap justify-end gap-1">
                    <Badge tone="green">{r.moversCarried} carried</Badge>
                    <Badge tone="gold">{r.moversBrandCarried} brand only</Badge>
                    <Badge tone={r.moversNotCarried > 0 ? "danger" : "neutral"}>
                      {r.moversNotCarried} gaps
                    </Badge>
                  </div>
                ) : (
                  <span className="text-xs text-[var(--admin-text-faint)]">no mover data</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Buy list — "they sell it, we don't"
// ---------------------------------------------------------------------------

function BuyListTable({ rows, label }: { rows: BuyListRow[]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--admin-border)] text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]">
            <th className="py-2 pr-3 font-semibold">Product</th>
            <th className="py-2 pr-3 font-semibold">Vendor</th>
            <th className="py-2 pr-3 font-semibold">Sold at</th>
            <th className="py-2 pr-3 text-right font-semibold">Units</th>
            <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
            <th className="py-2 pr-3 text-right font-semibold">Price to beat (p25)</th>
            <th className="py-2 pr-3 font-semibold">On our menu?</th>
            <th className="py-2 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.productName}-${r.brand ?? ""}-${i}`} className="border-b border-[var(--admin-border)]/50 align-top">
              <td className="py-2 pr-3 max-w-[20rem]">
                <div className="truncate font-medium text-[var(--admin-text)]" title={r.productName}>
                  {r.productName}
                </div>
                <div className="truncate text-xs text-[var(--admin-text-muted)]">
                  {[r.brand, r.strainName, r.inventoryType].filter(Boolean).join(" · ") || "—"}
                </div>
              </td>
              <td className="py-2 pr-3 max-w-[12rem]">
                {r.vendorName || r.vendorLicense ? (
                  <>
                    <div className="truncate text-[var(--admin-text)]" title={r.vendorName ?? undefined}>
                      {r.vendorName ?? "—"}
                    </div>
                    {r.vendorLicense ? (
                      <div className="text-xs text-[var(--admin-text-muted)]">lic {r.vendorLicense}</div>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[var(--admin-text-faint)]">—</span>
                )}
              </td>
              <td className="py-2 pr-3 max-w-[12rem]">
                <div className="truncate text-xs text-[var(--admin-text-muted)]" title={r.stores.join(", ")}>
                  {r.stores.join(", ")}
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text-muted)]">{units(r.totalUnits)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text)]">{money(r.totalRevenueMinor)}</td>
              <td className="py-2 pr-3 text-right tabular-nums font-semibold text-[var(--admin-accent)]">
                {money(r.priceToBeatMinor)}
              </td>
              <td className="py-2 pr-3">
                {r.menuStatus === "brand_carried" ? (
                  <Badge tone="gold">brand only</Badge>
                ) : (
                  <Badge tone="danger">not carried</Badge>
                )}
              </td>
              <td className="py-2 text-right">
                <form action={startPoFromCockpitRowAction}>
                  <input type="hidden" name="product_name" value={r.productName} />
                  {r.brand ? <input type="hidden" name="brand" value={r.brand} /> : null}
                  {r.suggestedCategory ? (
                    <input type="hidden" name="category" value={r.suggestedCategory} />
                  ) : null}
                  {r.vendorName ? <input type="hidden" name="vendor_name" value={r.vendorName} /> : null}
                  {r.vendorLicense ? (
                    <input type="hidden" name="vendor_license" value={r.vendorLicense} />
                  ) : null}
                  <input
                    type="hidden"
                    name="demand_signal"
                    value={buildBuyRowDemandSignal({
                      stores: r.stores,
                      totalUnits: r.totalUnits,
                      totalRevenueMinor: r.totalRevenueMinor,
                      priceToBeatMinor: r.priceToBeatMinor,
                      areaLabel: label,
                    })}
                  />
                  <Button type="submit" variant="primary" size="sm">
                    Start PO →
                  </Button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Undercut board — price check on movers we carry
// ---------------------------------------------------------------------------

function UndercutTable({ rows }: { rows: UndercutRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--admin-border)] text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]">
            <th className="py-2 pr-3 font-semibold">Product</th>
            <th className="py-2 pr-3 font-semibold">Sold at</th>
            <th className="py-2 pr-3 text-right font-semibold">Our menu price</th>
            <th className="py-2 pr-3 text-right font-semibold">Their p25</th>
            <th className="py-2 text-right font-semibold">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.productName}-${i}`} className="border-b border-[var(--admin-border)]/50">
              <td className="py-2 pr-3 max-w-[20rem]">
                <div className="truncate font-medium text-[var(--admin-text)]" title={r.productName}>
                  {r.productName}
                </div>
                <div className="truncate text-xs text-[var(--admin-text-muted)]">
                  {[r.brand, r.inventoryType].filter(Boolean).join(" · ") || "—"}
                </div>
              </td>
              <td className="py-2 pr-3 max-w-[12rem]">
                <div className="truncate text-xs text-[var(--admin-text-muted)]" title={r.stores.join(", ")}>
                  {r.stores.join(", ")}
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text)]">{money(r.ourPriceMinor)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text-muted)]">{money(r.theirP25Minor)}</td>
              <td className="py-2 text-right tabular-nums">
                {r.deltaMinor > 0 ? (
                  <span className="font-semibold text-[var(--admin-danger)]">+{money(r.deltaMinor)} above</span>
                ) : r.deltaMinor < 0 ? (
                  <span className="font-semibold text-[var(--admin-accent)]">
                    {money(Math.abs(r.deltaMinor))} below
                  </span>
                ) : (
                  <span className="text-[var(--admin-text-muted)]">even</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export async function PoCockpitSection() {
  // Best-effort: any failure (tables not migrated yet, no service key) simply
  // hides the section — the rest of the Leads page never breaks on this.
  let dataset: Awaited<ReturnType<typeof getLatestTransformerDataset>> = null;
  try {
    dataset = await getLatestTransformerDataset();
  } catch {
    return null;
  }
  if (!dataset) return null;

  let cockpit: PoCockpit | null = null;
  try {
    const [signals, stats, roster, menu] = await Promise.all([
      listMarketSignals(dataset.id),
      listCompetitorStats(dataset.id),
      listCompetitors(),
      loadCandidateItems(),
    ]);
    cockpit = buildPoCockpit(stats, roster, signals, menu, { area: "port_orchard" });
  } catch {
    return null;
  }
  if (!cockpit || cockpit.competitorCount === 0) return null;
  if (cockpit.board.length === 0 && cockpit.buyList.length === 0 && cockpit.undercuts.length === 0) {
    return null;
  }

  const label = areaLabel(cockpit.area);
  const period =
    dataset.period_start && dataset.period_end
      ? `${dataset.period_start} → ${dataset.period_end}`
      : null;
  const aboveCount = cockpit.undercuts.filter((r) => r.deltaMinor > 0).length;

  return (
    <Section
      title={`${label} battle plan`}
      description={`The purchase cockpit for the market we most need to win: every tracked ${label} competitor head-to-head, what they sell that we don't carry (one click from a PO), and where our menu prices sit against their observed "price to beat".`}
    >
      <div className="space-y-4">
        {period ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-faint)]">
            <Badge tone="neutral">CCRS monthly</Badge>
            <span>
              Sales observed {period}. Their numbers are real CCRS reporting; our side of the board is
              your published menu ({units(cockpit.menuItemCount)} items) — Greenway&apos;s own sales are
              never estimated from CCRS.
            </span>
          </div>
        ) : null}

        {cockpit.board.length > 0 ? (
          <Card padding="md">
            <CardHeader
              title={`Head-to-head — ${cockpit.board.length} tracked ${label} competitor${cockpit.board.length === 1 ? "" : "s"}`}
              subtitle="Their real month: revenue, unit-price bands (p25/median/p75), category mix by revenue, wholesale sourcing, and how much of their top-mover list your menu already covers."
            />
            <div className="mt-3">
              <HeadToHeadTable rows={cockpit.board} />
            </div>
          </Card>
        ) : null}

        {cockpit.buyList.length > 0 ? (
          <Card padding="md">
            <CardHeader
              title={`${label} sells it — we don't carry it`}
              subtitle="Their top movers missing from our published menu, deduped across stores (matching is conservative: exact name, then brand — never fuzzy). Vendor comes from real CCRS manifests when resolvable. “Start PO” creates a high-priority product lead and opens the builder prefilled — nothing is ordered until you save."
            />
            <div className="mt-3">
              <BuyListTable rows={cockpit.buyList} label={label} />
            </div>
          </Card>
        ) : null}

        {cockpit.undercuts.length > 0 ? (
          <Card padding="md">
            <CardHeader
              title="Price check — movers we both sell"
              subtitle={`Exact-name matches between their top movers and our menu. "Their p25" is the price that undercuts ~75% of observed sales at every listed store${aboveCount > 0 ? ` — ${aboveCount} of ours currently sit ABOVE it` : ""}.`}
            />
            <div className="mt-3">
              <UndercutTable rows={cockpit.undercuts} />
            </div>
          </Card>
        ) : null}

        <p className="text-[0.65rem] text-[var(--admin-text-faint)]">
          Every figure comes from the raw CCRS extract you dropped — nothing is estimated. A
          &ldquo;—&rdquo; means the data was too thin or conflicting to state (an unresolved vendor, a
          thin price sample, or stores disagreeing on a field). The full statewide picture lives in
          Reports &rarr; CCRS Benchmarks and Local Benchmarks.
        </p>
      </div>
    </Section>
  );
}
