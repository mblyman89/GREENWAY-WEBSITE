import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button } from "@/components/admin/ui";
import { CustomerForm } from "@/components/admin/customers/CustomerForm";
import { getCustomerById, isAtLeast21 } from "@/lib/customers/store";
import { can } from "@/lib/auth/roles";
import { LoyaltyPanel } from "@/components/admin/loyalty/LoyaltyPanel";
import { MedicalPanel } from "@/components/admin/medical/MedicalPanel";
import { loadCustomerProfile } from "@/lib/customers/customer-insights-server";
import { money } from "@/lib/customers/customer-insights-core";
import { CustomerMonthlyChart, CustomerHabitCharts, SpendShareDonut } from "@/components/admin/customers/CustomerCharts";
import {
  Banner,
  Fact,
  InsightList,
  Panel,
  RankedList,
  StockBadge,
  TABLE,
  TD,
  TH,
  daysAgoText,
  fmtDate,
  fmtDateTime,
  pct,
} from "@/components/admin/customers/InsightBlocks";
import { updateCustomerAction, linkCustomerOrdersAction } from "../actions";

export const dynamic = "force-dynamic";

const BASIS_TEXT: Record<string, string> = {
  phone_and_email: "Phone + email match",
  phone: "Phone match",
  email: "Email match",
};

const CADENCE_TONE: Record<string, "green" | "gold" | "orange" | "danger" | "neutral"> = {
  on_track: "green",
  due_now: "gold",
  overdue: "orange",
  lapsed: "danger",
  unknown: "neutral",
};
const CADENCE_WORD: Record<string, string> = {
  on_track: "On track",
  due_now: "Due now",
  overdue: "Overdue",
  lapsed: "Lapsed",
  unknown: "Not enough visits yet",
};
const LOYALTY_WORD: Record<string, string> = {
  loyal: "Brand-loyal",
  leaning: "Leans to one brand",
  explorer: "Explorer — tries many brands",
  unknown: "Not enough data",
};
const DEAL_WORD: Record<string, string> = {
  deal_driven: "Deal-driven",
  mixed: "Mix of deals and full price",
  full_price: "Mostly full price",
  unknown: "Not enough data",
};
const TIER_WORD: Record<string, string> = {
  value: "Value shopper",
  mid: "Mid-range",
  premium: "Premium shopper",
  unknown: "Not enough data",
};

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; created?: string; error?: string; linked?: string; linkError?: string }>;
}) {
  const session = await requirePermission("customers.manage");
  const { id } = await params;
  const canManageLoyalty = can(session.profile.role, "loyalty.manage");
  const canManageMedical = can(session.profile.role, "medical.manage");
  const canLinkOrders = can(session.profile.role, "orders.manage");
  const { saved, created, error, linked, linkError } = await searchParams;

  const customer = await getCustomerById(id);
  if (!customer) notFound();

  const ageOk = isAtLeast21(customer.birthdate);
  const updateAction = updateCustomerAction.bind(null, id);
  const linkAction = linkCustomerOrdersAction.bind(null, id);

  const profile = await loadCustomerProfile(customer);
  const ins = profile?.insights ?? null;

  // Old-POS (Cultivera) lifetime spend. After 0232 it has its own column;
  // before 0232 the import wrote it into lifetime_spend_minor_units, and the
  // page computes live figures from orders instead (populationSource=computed).
  const importedSpend =
    (customer.imported_spend_minor_units ?? 0) > 0
      ? (customer.imported_spend_minor_units as number)
      : profile?.populationSource === "computed" && customer.import_source === "cultivera-export" && customer.lifetime_spend_minor_units > 0
        ? customer.lifetime_spend_minor_units
        : 0;

  const name = `${customer.first_name} ${customer.last_name ?? ""}`.trim();
  const linkedCount = linked ? Number.parseInt(linked, 10) : NaN;

  return (
    <div>
      <AdminPageHeader
        title={name}
        subtitle="Customer profile — who they are, what they buy, and what they will want next"
        breadcrumbs={<Breadcrumbs items={[{ label: "Customers", href: "/admin/customers" }, { label: customer.first_name }]} />}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {(saved || created) && <Banner tone="good">{created ? "Customer created." : "Changes saved."}</Banner>}
        {error === "name" && <Banner tone="risk">A first name is required.</Banner>}
        {Number.isFinite(linkedCount) && linkedCount > 0 && (
          <Banner tone="good">
            Connected {linkedCount} order{linkedCount === 1 ? "" : "s"} to {customer.first_name}. Their visits and spend below now include
            {linkedCount === 1 ? " it" : " them"}.
          </Banner>
        )}
        {linkError && <Banner tone="risk">{linkError.slice(0, 300)}</Banner>}
        {profile && profile.partial.length > 0 && (
          <Banner tone="warn">
            Some records could not be read completely ({profile.partial.join(", ")}). Figures below may be slightly low — refresh to try again.
          </Banner>
        )}
        {profile?.populationSource === "computed" && (
          <Banner tone="info">
            Figures are being calculated straight from orders because database migration 0232 has not been run yet. Once it runs, they are kept up to
            date automatically.
          </Banner>
        )}

        {!profile || !ins ? (
          <Banner tone="info">Purchase insights are unavailable (the database is not configured in this environment).</Banner>
        ) : (
          <>
            {/* ── Headline numbers ─────────────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Visits"
                value={ins.visits.toLocaleString("en-US")}
                hint={ins.firstVisitAt ? `Customer since ${fmtDate(ins.firstVisitAt)}` : "No linked purchases yet"}
                accent="muted"
              />
              <StatCard
                label="Net spend"
                value={money(ins.netSpendMinor)}
                hint={ins.refundsMinor > 0 ? `${money(ins.grossSpendMinor)} paid, ${money(ins.refundsMinor)} refunded` : "What they paid, less refunds"}
                accent="green"
              />
              <StatCard
                label="Average order"
                value={ins.visits > 0 ? money(ins.avgOrderMinor) : "—"}
                hint={ins.visits > 0 ? `${ins.avgUnitsPerVisit.toFixed(1)} items per visit` : undefined}
                accent="muted"
              />
              <StatCard
                label="Last visit"
                value={ins.lastVisitAt ? daysAgoText(ins.daysSinceLastVisit) : "Never"}
                hint={ins.lastVisitAt ? fmtDate(ins.lastVisitAt) : undefined}
                accent={ins.cadence.status === "overdue" || ins.cadence.status === "lapsed" ? "orange" : "muted"}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {profile.segment && profile.segment.key !== "none" && (
                <Badge tone={profile.segment.tone}>{profile.segment.label}</Badge>
              )}
              {profile.spendRankLabel && <Badge tone="gold">{profile.spendRankLabel}</Badge>}
              <Badge tone={ageOk == null ? "neutral" : ageOk ? "green" : "orange"}>
                {ageOk == null ? "No birthdate on file" : ageOk ? "21+ verified" : "Under 21"}
              </Badge>
              {customer.is_medical_patient && <Badge tone="gold">Medical patient</Badge>}
              {customer.do_not_contact ? (
                <Badge tone="danger">Do not contact</Badge>
              ) : customer.marketing_consent ? (
                <Badge tone="green">OK to market</Badge>
              ) : (
                <Badge tone="neutral">No marketing consent</Badge>
              )}
              {importedSpend > 0 && (
                <span className="text-xs text-[var(--admin-text-faint)]">
                  Old POS (Cultivera) lifetime spend: <strong className="text-[var(--admin-text-muted)]">{money(importedSpend)}</strong> — kept for
                  reference, not counted above.
                </span>
              )}
            </div>
            {profile.segment && profile.segment.key !== "none" && (
              <p className="text-sm text-[var(--admin-text-muted)]">
                {profile.segment.meaning} <span className="text-[var(--admin-text)]">{profile.segment.action}</span>
              </p>
            )}

            {/* ── What to do + what we know ────────────────────────────── */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Next best action" description="The single most useful thing to do for this customer right now.">
                <p className="text-base font-bold text-[var(--admin-accent)]">{ins.nextBestAction.title}</p>
                <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{ins.nextBestAction.detail}</p>
                {ins.nextBestAction.kind === "link_orders" && (
                  <a href="#connect-history" className="mt-2 inline-block text-sm font-semibold text-[var(--admin-accent)] underline">
                    Review the matching orders ↓
                  </a>
                )}
              </Panel>
              <Panel title="What we know" description="Plain-English observations from their purchase history.">
                <InsightList insights={ins.insights} />
              </Panel>
            </div>

            {/* ── Unlinked history ─────────────────────────────────────── */}
            {profile.unlinkedMatches.length > 0 && (
              <div id="connect-history">
                <Panel
                  title={`Connect their history (${profile.unlinkedMatches.length} possible match${profile.unlinkedMatches.length === 1 ? "" : "es"})`}
                  description="Online orders with this customer's phone or email that are not tied to any customer yet. Connecting them counts those purchases toward their visits, spend and preferences. Nothing is connected until you tick it."
                >
                  <form action={linkAction} className="space-y-3">
                    <div className="overflow-x-auto">
                      <table className={TABLE}>
                        <thead>
                          <tr className="border-b border-[var(--admin-border)]">
                            <th className={TH}>Connect</th>
                            <th className={TH}>Order</th>
                            <th className={TH}>Placed</th>
                            <th className={TH}>Name on order</th>
                            <th className={TH}>Match</th>
                            <th className={TH}>Total</th>
                            <th className={TH}>What happens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profile.unlinkedMatches.map((m) => (
                            <tr key={m.onlineOrderId} className="border-b border-[var(--admin-border)]/50 align-top">
                              <td className={TD}>
                                {m.linkOrderId ? (
                                  <input
                                    type="checkbox"
                                    name="orderId"
                                    value={m.linkOrderId}
                                    defaultChecked={m.basis === "phone_and_email"}
                                    disabled={!canLinkOrders}
                                    aria-label={`Connect order ${m.onlineOrderNumber ?? m.onlineOrderId}`}
                                  />
                                ) : (
                                  <span className="text-xs text-[var(--admin-text-faint)]">—</span>
                                )}
                              </td>
                              <td className={TD}>
                                <Link href={`/admin/orders/${m.onlineOrderId}`} className="font-semibold text-[var(--admin-accent)] underline">
                                  {m.onlineOrderNumber ?? "Order"}
                                </Link>
                                <span className="ml-1 text-xs text-[var(--admin-text-faint)]">{m.channel === "leafly" ? "Leafly" : "Website"}</span>
                              </td>
                              <td className={TD}>{fmtDate(m.placedAt)}</td>
                              <td className={TD}>{m.nameOnOrder || "—"}</td>
                              <td className={TD}>
                                <Badge tone={m.basis === "phone_and_email" ? "green" : "gold"}>{BASIS_TEXT[m.basis] ?? m.basis}</Badge>
                              </td>
                              <td className={`${TD} tabular-nums`}>{money(m.totalMinor)}</td>
                              <td className={`${TD} text-xs text-[var(--admin-text-muted)]`}>{m.linkNote}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {canLinkOrders ? (
                      <Button type="submit" variant="confirm" size="sm">
                        Connect ticked orders
                      </Button>
                    ) : (
                      <p className="text-xs text-[var(--admin-text-faint)]">Connecting orders needs the orders.manage permission.</p>
                    )}
                  </form>
                </Panel>
              </div>
            )}

            {ins.hasPurchases ? (
              <>
                {/* ── Rhythm / prediction ─────────────────────────────── */}
                <Panel title="Visit rhythm and next visit" description={ins.cadence.explanation}>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Fact label="Status" value={<Badge tone={CADENCE_TONE[ins.cadence.status]}>{CADENCE_WORD[ins.cadence.status]}</Badge>} />
                    <Fact
                      label="Usually comes back every"
                      value={ins.cadence.gapDays != null ? `${ins.cadence.gapDays} days` : "—"}
                      hint={
                        ins.cadence.basis === "personal"
                          ? `Their own rhythm (${ins.cadence.gapsObserved} gap${ins.cadence.gapsObserved === 1 ? "" : "s"}, ${ins.cadence.confidence ?? "low"} confidence)`
                          : ins.cadence.basis === "store"
                            ? "Store-wide typical gap (they have too few visits for their own)"
                            : undefined
                      }
                    />
                    <Fact
                      label="Expected next visit"
                      value={ins.cadence.expectedNextDay ? fmtDate(`${ins.cadence.expectedNextDay}T12:00:00-08:00`) : "—"}
                      hint={
                        ins.cadence.daysUntilExpected == null
                          ? undefined
                          : ins.cadence.daysUntilExpected < 0
                            ? `${Math.abs(ins.cadence.daysUntilExpected)} days late`
                            : ins.cadence.daysUntilExpected === 0
                              ? "Today"
                              : `In ${ins.cadence.daysUntilExpected} days`
                      }
                    />
                    <Fact
                      label="Spend trend"
                      value={ins.spendTrendPct == null ? "—" : `${ins.spendTrendPct > 0 ? "+" : ""}${Math.round(ins.spendTrendPct * 100)}%`}
                      hint={`Last 90 days ${money(ins.recentSpendMinor)} (${ins.recentVisits} visits) vs prior 90 ${money(ins.priorSpendMinor)} (${ins.priorVisits})`}
                    />
                  </div>
                </Panel>

                {/* ── Favourites ──────────────────────────────────────── */}
                <div className="grid gap-4 lg:grid-cols-3">
                  <Panel title="Favourite categories" description="Share of what they spend.">
                    <RankedList rows={ins.topCategories} empty="No category data yet." />
                  </Panel>
                  <Panel title="Favourite brands" description={LOYALTY_WORD[ins.brandLoyalty]}>
                    <RankedList rows={ins.topBrands} empty="No brand data yet." />
                  </Panel>
                  <Panel title="Favourite vendors" description="Who makes what they buy — useful when ordering.">
                    <RankedList rows={ins.topVendors} empty="No vendor data yet." />
                  </Panel>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Panel title="Favourite products" description={`${ins.distinctProducts} different products bought.`}>
                    <RankedList rows={ins.topProducts} empty="No product data yet." />
                  </Panel>
                  <Panel title="Strain types">
                    <RankedList rows={ins.topStrainTypes} empty="No strain-type data yet." />
                  </Panel>
                  <Panel title="Shopping style">
                    <div className="grid gap-2">
                      <Fact label="Price level" value={TIER_WORD[ins.priceTier]} hint={ins.priceIndex != null ? `Pays ${Math.round(ins.priceIndex * 100)}% of the category median price` : undefined} />
                      <Fact label="Deals" value={DEAL_WORD[ins.dealProfile]} hint={ins.dealUnitShare != null ? `${pct(ins.dealUnitShare)} of items bought on a deal` : undefined} />
                      <Fact label="Typical potency" value={ins.medianThcPct != null ? `${ins.medianThcPct.toFixed(1)}% THC (median)` : "—"} />
                      <Fact
                        label="Basket"
                        value={`${ins.avgCategoriesPerVisit.toFixed(1)} categories per visit`}
                        hint={ins.categoryPairs.length > 0 ? `Often together: ${ins.categoryPairs.slice(0, 2).map((p) => p.pair).join("; ")}` : undefined}
                      />
                      {ins.savingsMinor > 0 && <Fact label="Saved with us" value={money(ins.savingsMinor)} hint="Deals and discounts vs regular price" />}
                    </div>
                  </Panel>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SpendShareDonut title="Spend by category" rows={ins.topCategories.map((r) => ({ label: r.label, spendMinor: r.spendMinor }))} />
                  <SpendShareDonut title="Spend by brand" rows={ins.topBrands.map((r) => ({ label: r.label, spendMinor: r.spendMinor }))} />
                </div>

                {/* ── Staples + recommendations ──────────────────────── */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel title="Their staples" description="Products they buy again and again, when they are due, and whether we have them.">
                    {ins.staples.length === 0 ? (
                      <p className="text-sm text-[var(--admin-text-faint)]">No repeat products yet (a staple is something bought on 2+ different days).</p>
                    ) : (
                      <table className={TABLE}>
                        <thead>
                          <tr className="border-b border-[var(--admin-border)]">
                            <th className={TH}>Product</th>
                            <th className={TH}>Bought on</th>
                            <th className={TH}>Every</th>
                            <th className={TH}>Due</th>
                            <th className={TH}>Stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ins.staples.map((s) => (
                            <tr key={s.productKey} className="border-b border-[var(--admin-border)]/50">
                              <td className={TD}>{s.productName}</td>
                              <td className={`${TD} tabular-nums`}>{s.purchaseDays} days</td>
                              <td className={`${TD} tabular-nums`}>{s.typicalGapDays != null ? `${s.typicalGapDays}d` : "—"}</td>
                              <td className={`${TD} tabular-nums`}>
                                {s.dueInDays == null ? "—" : s.dueInDays < 0 ? `${Math.abs(s.dueInDays)}d late` : s.dueInDays === 0 ? "Today" : `in ${s.dueInDays}d`}
                              </td>
                              <td className={TD}>
                                <StockBadge status={s.stockStatus} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Panel>
                  <Panel
                    title="Suggest next"
                    description={profile.catalogFound ? "In-stock products that match what they like, with the reason." : "No published menu found, so suggestions are unavailable."}
                  >
                    {ins.recommendations.length === 0 ? (
                      <p className="text-sm text-[var(--admin-text-faint)]">No suggestions right now.</p>
                    ) : (
                      <ul className="space-y-3">
                        {ins.recommendations.map((r) => (
                          <li key={r.productKey} className="text-sm">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-[var(--admin-text)]">{r.name}</span>
                              <span className="shrink-0 tabular-nums text-[var(--admin-text-muted)]">{money(r.priceMinor)}</span>
                            </div>
                            <p className="text-xs text-[var(--admin-text-faint)]">
                              {[r.brand, r.category].filter(Boolean).join(" · ")} {r.stockStatus === "low-stock" ? "· low stock" : ""}
                            </p>
                            <p className="text-xs text-[var(--admin-text-muted)]">{r.reasons.join(" · ")}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>

                {/* ── Trends + habits ────────────────────────────────── */}
                <CustomerMonthlyChart monthly={ins.monthly.map((m) => ({ label: m.label, spendMinor: m.spendMinor, visits: m.visits }))} />
                <CustomerHabitCharts weekdays={ins.weekdayCounts} dayparts={ins.daypartCounts} />

                {/* ── Channels, online orders, returns, loyalty ──────── */}
                <div className="grid gap-4 lg:grid-cols-3">
                  <Panel title="How they buy" description={ins.onlineShare != null ? `${pct(ins.onlineShare)} of visits start online.` : undefined}>
                    <ul className="space-y-1 text-sm">
                      {ins.channelMix.map((c) => (
                        <li key={c.channel} className="flex justify-between gap-2">
                          <span className="text-[var(--admin-text)]">{c.label}</span>
                          <span className="tabular-nums text-[var(--admin-text-muted)]">
                            {c.visits} · {money(c.spendMinor)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {(["website", "leafly"] as const).map((ch) => {
                        const o = ins.onlineOrders[ch];
                        return (
                          <Fact
                            key={ch}
                            label={ch === "website" ? "Website orders" : "Leafly orders"}
                            value={`${o.placed} placed`}
                            hint={`${o.fulfilled} picked up · ${o.cancelled} cancelled · ${o.noShow} no-show${o.open ? ` · ${o.open} open` : ""}`}
                          />
                        );
                      })}
                    </div>
                  </Panel>
                  <Panel title="Returns">
                    {ins.returnsCount === 0 ? (
                      <p className="text-sm text-[var(--admin-text-faint)]">No returns.</p>
                    ) : (
                      <>
                        <p className="text-sm text-[var(--admin-text)]">
                          {ins.returnsCount} return{ins.returnsCount === 1 ? "" : "s"}, {ins.returnedUnits} unit{ins.returnedUnits === 1 ? "" : "s"}
                          — {money(ins.refundsMinor)} refunded{ins.returnRate != null ? ` (${pct(ins.returnRate, 1)} of what they paid)` : ""}.
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-[var(--admin-text-muted)]">
                          {ins.returnReasons.map((r) => (
                            <li key={r.label}>
                              {r.label}: {r.count}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Panel>
                  <Panel title="Loyalty">
                    {ins.loyalty ? (
                      <div className="grid gap-2">
                        <Fact
                          label="Points balance"
                          value={`${ins.loyalty.balancePoints.toLocaleString("en-US")} pts`}
                          hint={`Worth ${money(ins.loyalty.balanceValueMinor)}${ins.loyalty.canRedeem ? " — can redeem now" : ""}`}
                        />
                        <Fact label="Tier" value={ins.loyalty.tierName ?? "—"} hint={`${ins.loyalty.lifetimePoints.toLocaleString("en-US")} lifetime points`} />
                        <Fact
                          label="Rewards used"
                          value={`${ins.loyalty.codesRedeemed} reward${ins.loyalty.codesRedeemed === 1 ? "" : "s"}`}
                          hint={ins.loyaltyDiscountMinor > 0 ? `${money(ins.loyaltyDiscountMinor)} off at the register` : undefined}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--admin-text-faint)]">Not enrolled in loyalty.</p>
                    )}
                  </Panel>
                </div>

                {/* ── Recent purchases ───────────────────────────────── */}
                <Panel title="Recent purchases" description="Their latest completed purchases. Click one to open it.">
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr className="border-b border-[var(--admin-border)]">
                          <th className={TH}>When</th>
                          <th className={TH}>Order</th>
                          <th className={TH}>How</th>
                          <th className={TH}>Items</th>
                          <th className={TH}>Total</th>
                          <th className={TH}>Refunded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.recentPurchases.map((p) => (
                          <tr key={p.orderId} className="border-b border-[var(--admin-border)]/50">
                            <td className={TD}>{fmtDateTime(p.at)}</td>
                            <td className={TD}>
                              <Link href={`/admin/orders/${p.orderId}`} className="font-semibold text-[var(--admin-accent)] underline">
                                {p.orderNumber ?? "View"}
                              </Link>
                            </td>
                            <td className={TD}>{p.channelLabel}</td>
                            <td className={`${TD} tabular-nums`}>{p.items}</td>
                            <td className={`${TD} tabular-nums`}>{money(p.totalMinor)}</td>
                            <td className={`${TD} tabular-nums`}>{p.refundMinor > 0 ? money(p.refundMinor) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </>
            ) : (
              <Banner tone="info">
                No completed purchases are linked to {customer.first_name} yet. Attach them at the register (loyalty lookup) or connect matching
                online orders above, and this page fills in automatically.
              </Banner>
            )}

            <p className="text-xs text-[var(--admin-text-faint)]">
              How confident is this? Favourites and habits firm up after about 5 visits; the visit-rhythm prediction needs at least 3 visits of their
              own. Store-wide groups: {profile.population.buyers.toLocaleString("en-US")} buyers so far (
              {profile.population.confidence === "solid" ? "solid" : profile.population.confidence === "building" ? "still building" : "early days"}).
            </p>

            <HelpPanel id="customer-profile-help" title="Where do these numbers come from?">
              <p className="text-sm">
                Visits and spend count every completed purchase tied to this customer — register sales and picked-up online orders — less refunds.
                Voided and cancelled sales never count. Favourites weigh by what they spent. Suggestions only show items on the published menu that
                are in stock. See the <Link href="/admin/customers/insights" className="underline">customer intelligence dashboard</Link> for the
                whole customer base.
              </p>
            </HelpPanel>
          </>
        )}

        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-4 text-sm font-bold text-[var(--admin-text)]">Edit profile</h2>
          <CustomerForm customer={customer} action={updateAction} submitLabel="Save changes" />
        </div>

        <LoyaltyPanel customerId={id} canManage={canManageLoyalty} />

        <MedicalPanel customerId={id} canManage={canManageMedical} />
      </div>
    </div>
  );
}
