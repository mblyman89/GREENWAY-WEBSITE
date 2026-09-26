/**
 * /admin/customers/insights — Customer intelligence dashboard (Slice 3).
 *
 * The whole customer base at a glance: how much of the business we can see
 * (identification rate), who the best customers are (RFM segments), who is
 * due back this week, who is slipping away (win-back), what to keep on the
 * shelf for the regulars (stock watch), and what the best customers buy more
 * of than everyone else (preference lift).
 *
 * All numbers come from loadIntelligenceDashboard() → the pure cores.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge } from "@/components/admin/ui";
import { loadIntelligenceDashboard, type NamedCustomer } from "@/lib/customers/customer-insights-server";
import { CONFIDENCE_NOTE, identificationAdvice, type PreferenceLiftRow } from "@/lib/customers/customer-segments-core";
import { money } from "@/lib/customers/customer-insights-core";
import { SegmentCharts } from "@/components/admin/customers/CustomerCharts";
import { Banner, Panel, StockBadge, TABLE, TD, TH, fmtDate, pct } from "@/components/admin/customers/InsightBlocks";

export const dynamic = "force-dynamic";

const URGENCY_TONE = { reorder_now: "danger", watch: "gold", ok: "green" } as const;
const URGENCY_WORD = { reorder_now: "Reorder now", watch: "Watch", ok: "OK" } as const;

function CustomerCell({ c }: { c: NamedCustomer }) {
  return (
    <div>
      <Link href={`/admin/customers/${c.customerId}`} className="font-semibold text-[var(--admin-accent)] underline">
        {c.name}
      </Link>
      <div className="text-xs text-[var(--admin-text-faint)]">{c.contact ?? "No contact on file"}</div>
    </div>
  );
}

function ContactCell({ c }: { c: NamedCustomer }) {
  if (c.doNotContact) return <Badge tone="danger">Do not contact</Badge>;
  if (!c.contact) return <Badge tone="neutral">No contact</Badge>;
  if (c.marketingConsent) return <Badge tone="green">OK to market</Badge>;
  return <Badge tone="neutral">Service messages only</Badge>;
}

function LiftTable({ rows, noun }: { rows: PreferenceLiftRow[]; noun: string }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--admin-text-faint)]">No {noun} data for linked sales yet.</p>;
  return (
    <table className={TABLE}>
      <thead>
        <tr className="border-b border-[var(--admin-border)]">
          <th className={TH}>{noun}</th>
          <th className={TH}>Best customers</th>
          <th className={TH}>Everyone</th>
          <th className={TH}>Lift</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-[var(--admin-border)]/50">
            <td className={TD}>
              {r.label}
              <div className="text-xs text-[var(--admin-text-faint)]">
                {r.groupCustomers} best customer{r.groupCustomers === 1 ? "" : "s"} buy it
              </div>
            </td>
            <td className={`${TD} tabular-nums`}>{pct(r.groupShare)}</td>
            <td className={`${TD} tabular-nums`}>{pct(r.allShare)}</td>
            <td className={TD}>
              {r.lift == null ? (
                "—"
              ) : r.lift >= 1.2 ? (
                <Badge tone="green">{r.lift.toFixed(1)}× more</Badge>
              ) : r.lift <= 0.8 ? (
                <Badge tone="neutral">{r.lift.toFixed(1)}× less</Badge>
              ) : (
                <span className="text-xs text-[var(--admin-text-muted)]">About the same</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function CustomerInsightsPage() {
  await requirePermission("customers.manage");
  const d = await loadIntelligenceDashboard();

  const header = (
    <AdminPageHeader
      title="Customer insights"
      subtitle="Know your customers: who they are, what they love, who is due back, and what to keep in stock for them."
      breadcrumbs={<Breadcrumbs items={[{ label: "Customers", href: "/admin/customers" }, { label: "Insights" }]} />}
    />
  );

  if (!d) {
    return (
      <div>
        {header}
        <div className="px-5 py-6 sm:px-8">
          <Banner tone="info">Customer insights are unavailable (the database is not configured in this environment).</Banner>
        </div>
      </div>
    );
  }

  const p = d.population;
  const segRows = p.segments.filter((s) => s.customers > 0);

  return (
    <div>
      {header}
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {d.partial.length > 0 && (
          <Banner tone="warn">Some records could not be read completely ({d.partial.join(", ")}). Figures may be slightly low — refresh to try again.</Banner>
        )}
        {d.populationSource === "computed" && (
          <Banner tone="info">
            Figures are calculated straight from orders because database migration 0232 has not been run yet. Once it runs they are kept up to date
            automatically.
          </Banner>
        )}

        {/* ── How much can we see? ─────────────────────────────────── */}
        <Panel
          title="How much of your business can we see?"
          description={`Completed sales in the last ${d.identification.windowDays} days that were tied to a customer. Insights only cover linked sales.`}
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="text-3xl font-bold text-[var(--admin-accent)]">{pct(d.identification.rate)}</p>
            <p className="text-sm text-[var(--admin-text-muted)]">
              {d.identification.linked.toLocaleString("en-US")} of {d.identification.all.toLocaleString("en-US")} sales linked
            </p>
          </div>
          <p className="mt-2 text-sm text-[var(--admin-text)]">{identificationAdvice(d.identification.rate)}</p>
        </Panel>

        {/* ── Population KPIs ─────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Customers who buy" value={p.buyers.toLocaleString("en-US")} hint={`of ${p.totalCustomers.toLocaleString("en-US")} customer records`} accent="muted" />
          <StatCard
            label="Come back again"
            value={pct(p.repeatRate)}
            hint={`${p.repeatBuyers.toLocaleString("en-US")} buyers with 2+ visits`}
            accent="green"
          />
          <StatCard label="Active (last 90 days)" value={p.activeBuyers.toLocaleString("en-US")} hint={`${pct(p.buyers > 0 ? p.activeBuyers / p.buyers : null)} of buyers`} accent="muted" />
          <StatCard
            label="Typical time between visits"
            value={p.typicalGapDays != null ? `${p.typicalGapDays} days` : "—"}
            hint="Median across repeat customers"
            accent="muted"
          />
          <StatCard label="Spend per customer" value={money(p.avgSpendPerBuyerMinor)} hint={`${p.avgVisitsPerBuyer.toFixed(1)} visits on average`} accent="gold" />
          <StatCard label="Linked net spend" value={money(p.netSpendMinor)} hint="All linked purchases, less refunds" accent="green" />
          <StatCard
            label="Top 20% of customers"
            value={pct(p.top20SpendShare)}
            hint="Share of spend from your top fifth — the people to protect"
            accent="orange"
          />
          <StatCard label="Data confidence" value={p.confidence === "solid" ? "Solid" : p.confidence === "building" ? "Building" : "Early"} accent="muted" />
        </div>
        <p className="text-xs text-[var(--admin-text-faint)]">{CONFIDENCE_NOTE[p.confidence]}</p>

        {/* ── Segments ────────────────────────────────────────────── */}
        {segRows.length > 0 && (
          <>
            <SegmentCharts segments={segRows.map((s) => ({ label: s.label, customers: s.customers, netSpendMinor: s.netSpendMinor, tone: s.tone }))} />
            <Panel
              title="Customer groups"
              description="Every buyer is scored on how recently, how often and how much they buy (RFM — the method loyalty platforms use) and placed in one group. Click a group to see who is in it."
            >
              <div className="space-y-2">
                {segRows.map((s) => {
                  const members = d.segmentMembers[s.key] ?? [];
                  return (
                    <details key={s.key} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                        <Badge tone={s.tone}>{s.label}</Badge>
                        <span className="text-sm text-[var(--admin-text)]">
                          {s.customers.toLocaleString("en-US")} customer{s.customers === 1 ? "" : "s"} · {money(s.netSpendMinor)} ({pct(s.spendShare)} of spend) ·{" "}
                          {s.avgVisits.toFixed(1)} visits avg
                        </span>
                      </summary>
                      <p className="mt-2 text-sm text-[var(--admin-text-muted)]">{s.meaning}</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--admin-text)]">What to do: {s.action}</p>
                      {members.length > 0 && (
                        <div className="mt-3 overflow-x-auto">
                          <table className={TABLE}>
                            <thead>
                              <tr className="border-b border-[var(--admin-border)]">
                                <th className={TH}>Customer</th>
                                <th className={TH}>Visits</th>
                                <th className={TH}>Net spend</th>
                                <th className={TH}>Last visit</th>
                                <th className={TH}>Contact</th>
                              </tr>
                            </thead>
                            <tbody>
                              {members.map((m) => (
                                <tr key={m.customerId} className="border-b border-[var(--admin-border)]/50">
                                  <td className={TD}>
                                    <CustomerCell c={m} />
                                  </td>
                                  <td className={`${TD} tabular-nums`}>{m.visits}</td>
                                  <td className={`${TD} tabular-nums`}>{money(m.netSpendMinor)}</td>
                                  <td className={TD}>{fmtDate(m.lastVisitAt)}</td>
                                  <td className={TD}>
                                    <ContactCell c={m} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {s.customers > members.length && (
                            <p className="mt-1 text-xs text-[var(--admin-text-faint)]">Showing the top {members.length} by spend.</p>
                          )}
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            </Panel>
          </>
        )}

        {/* ── Who to talk to this week ─────────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={`Due back this week (${d.dueSoon.length})`} description="Repeat customers whose own rhythm says they are about to visit. A good moment to make sure their favourites are on the shelf.">
            {d.dueSoon.length === 0 ? (
              <p className="text-sm text-[var(--admin-text-faint)]">Nobody is due in the next 7 days (needs customers with 2+ visits).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr className="border-b border-[var(--admin-border)]">
                      <th className={TH}>Customer</th>
                      <th className={TH}>Usually every</th>
                      <th className={TH}>Due</th>
                      <th className={TH}>Group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.dueSoon.map((c) => (
                      <tr key={c.customerId} className="border-b border-[var(--admin-border)]/50">
                        <td className={TD}>
                          <CustomerCell c={c} />
                        </td>
                        <td className={`${TD} tabular-nums`}>{c.gapDays} days</td>
                        <td className={`${TD} tabular-nums`}>{c.dueInDays <= 0 ? "Today" : `in ${c.dueInDays}d`}</td>
                        <td className={TD}>
                          <Badge tone={c.segment.tone}>{c.segment.label}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel
            title={`Win-back list (${d.overdue.length})`}
            description="Regulars who are clearly late compared with their own rhythm but not yet gone — the window where a nudge works best. Only reach out to those marked OK to market."
          >
            {d.overdue.length === 0 ? (
              <p className="text-sm text-[var(--admin-text-faint)]">No one is overdue right now.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr className="border-b border-[var(--admin-border)]">
                      <th className={TH}>Customer</th>
                      <th className={TH}>Late by</th>
                      <th className={TH}>Spend</th>
                      <th className={TH}>Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.overdue.map((c) => (
                      <tr key={c.customerId} className="border-b border-[var(--admin-border)]/50">
                        <td className={TD}>
                          <CustomerCell c={c} />
                          <div className="text-xs text-[var(--admin-text-faint)]">
                            Usually every {c.gapDays} days · last {fmtDate(c.lastVisitAt)}
                          </div>
                        </td>
                        <td className={`${TD} tabular-nums`}>{Math.abs(c.dueInDays)} days</td>
                        <td className={`${TD} tabular-nums`}>{money(c.netSpendMinor)}</td>
                        <td className={TD}>
                          <ContactCell c={c} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* ── Stock watch ─────────────────────────────────────────── */}
        <Panel
          title="Stock watch — keep the regulars' favourites on the shelf"
          description={
            d.catalogFound
              ? `Products that repeat customers buy again and again (last ${d.historyDays} days), how many of them are due to want it soon, and whether it is in stock.`
              : "No published menu was found, so stock status cannot be checked."
          }
        >
          {d.stockWatch.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-faint)]">No repeat-purchase products yet (a staple is something one customer bought on 2+ different days).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr className="border-b border-[var(--admin-border)]">
                    <th className={TH}>Product</th>
                    <th className={TH}>Priority</th>
                    <th className={TH}>Regulars</th>
                    <th className={TH}>Best customers</th>
                    <th className={TH}>Due in 14 days</th>
                    <th className={TH}>Bought every</th>
                    <th className={TH}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {d.stockWatch.map((r) => (
                    <tr key={r.productKey} className="border-b border-[var(--admin-border)]/50 align-top">
                      <td className={TD}>
                        {r.productName}
                        <div className="text-xs text-[var(--admin-text-faint)]">{r.reason}</div>
                      </td>
                      <td className={TD}>
                        <Badge tone={URGENCY_TONE[r.urgency]}>{URGENCY_WORD[r.urgency]}</Badge>
                      </td>
                      <td className={`${TD} tabular-nums`}>{r.regulars}</td>
                      <td className={`${TD} tabular-nums`}>{r.valuableRegulars}</td>
                      <td className={`${TD} tabular-nums`}>{r.dueSoon}</td>
                      <td className={`${TD} tabular-nums`}>{r.typicalGapDays != null ? `${r.typicalGapDays}d` : "—"}</td>
                      <td className={TD}>
                        <StockBadge status={r.stockStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ── What best customers buy ─────────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title="Brands your best customers love"
            description={`What your ${d.bestGroupSize.toLocaleString("en-US")} best customers spend on, vs everyone. "More" means they over-index — protect that brand's shelf space.`}
          >
            <LiftTable rows={d.bestBrands} noun="Brand" />
          </Panel>
          <Panel title="Categories your best customers love" description="Same comparison by category.">
            <LiftTable rows={d.bestCategories} noun="Category" />
          </Panel>
        </div>

        {/* ── Top customers ───────────────────────────────────────── */}
        <Panel title="Top customers by spend" description="Your most valuable relationships. Recognise them by name.">
          {d.topCustomers.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-faint)]">No linked purchases yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr className="border-b border-[var(--admin-border)]">
                    <th className={TH}>#</th>
                    <th className={TH}>Customer</th>
                    <th className={TH}>Group</th>
                    <th className={TH}>Visits</th>
                    <th className={TH}>Net spend</th>
                    <th className={TH}>Last visit</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topCustomers.map((c, n) => (
                    <tr key={c.customerId} className="border-b border-[var(--admin-border)]/50">
                      <td className={`${TD} text-[var(--admin-text-faint)]`}>{n + 1}</td>
                      <td className={TD}>
                        <CustomerCell c={c} />
                      </td>
                      <td className={TD}>
                        <Badge tone={c.segment.tone}>{c.segment.label}</Badge>
                      </td>
                      <td className={`${TD} tabular-nums`}>{c.visits}</td>
                      <td className={`${TD} tabular-nums`}>{money(c.netSpendMinor)}</td>
                      <td className={TD}>{fmtDate(c.lastVisitAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <HelpPanel id="customer-insights-help" title="How these insights work">
          <div className="space-y-2 text-sm">
            <p>
              <strong>Only linked sales count.</strong> A sale counts toward a customer when a member is attached at the register, or when an online
              order is placed by a known customer. Raise the &ldquo;how much can we see&rdquo; number and every insight on this page gets sharper.
            </p>
            <p>
              <strong>Groups (RFM).</strong> Each buyer gets a 1–5 score for how recently they visited, how often they come and how much they spend,
              relative to your other customers. The scores decide the group. This is the same method used by major cannabis loyalty platforms.
            </p>
            <p>
              <strong>Due back / win-back.</strong> Based on each person&apos;s own average gap between visits. Win-back shows people who are more than
              25% later than usual but not yet 2.5× their usual gap (and under 180 days) — past that they are treated as lapsed and handled through the customer groups above (often &ldquo;At risk&rdquo;, &ldquo;Can&apos;t lose&rdquo; or &ldquo;Lost&rdquo;).
            </p>
            <p>
              <strong>Stock watch.</strong> A staple is a product one customer bought on two or more different days. Products that your best
              customers rely on and that are low or sold out are flagged first.
            </p>
          </div>
        </HelpPanel>
      </div>
    </div>
  );
}
