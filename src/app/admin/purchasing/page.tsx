import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Input, Section, Select } from "@/components/admin/ui";
import {
  listPurchaseOrders,
  formatMoneyMinor,
  type PurchaseOrderStatus,
} from "@/lib/purchasing/po-store";
import { poCodename } from "@/lib/purchasing/po-document-core";
import {
  PO_LIST_STATUSES,
  buildPoListHref,
  computePoKpis,
  describeSpendDelta,
  filterPoRows,
  paginatePoRows,
  parsePoListState,
  poTraceDots,
  receivedUnpaidExceptions,
  topVendorsByOpenValue,
  type PoListRow,
  type PoTraceDotState,
} from "@/lib/purchasing/po-list-insights-core";

export const dynamic = "force-dynamic";

function statusTone(s: PurchaseOrderStatus): "green" | "gold" | "orange" | "neutral" | "danger" {
  if (s === "received") return "green";
  if (s === "sent") return "gold";
  if (s === "partial") return "orange";
  if (s === "cancelled") return "danger";
  return "neutral";
}

/** Colored dot per procure-to-pay step — same palette as the PO detail trail. */
function traceDotClass(state: PoTraceDotState): string {
  if (state === "done") return "bg-emerald-500";
  if (state === "partial") return "bg-amber-400";
  return "border border-[var(--admin-border)] bg-transparent";
}

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; status?: string; vendor?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  await requirePermission("inventory.manage");
  const pos = (await listPurchaseOrders()) as PoListRow[];

  // --- Command-center brains (pure, unit-tested) --------------------------
  const state = parsePoListState(sp);
  const kpis = computePoKpis(pos, new Date().toISOString());
  const topVendors = topVendorsByOpenValue(pos, 5);
  const exceptions = receivedUnpaidExceptions(pos);
  const filtered = filterPoRows(pos, state);
  const { pageRows, totalCount, totalPages, safePage } = paginatePoRows(filtered, state.page);
  const filtersActive = Boolean(state.status || state.vendor || state.q);

  // Vendor dropdown options come from the POs that actually exist.
  const vendorOptions = [...new Set(pos.map((p) => (p.vendor_name ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div>
      <AdminPageHeader
        title="Purchasing"
        subtitle="AI-assisted purchase orders — reorder suggestions, send to vendors, receive against POs"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Purchasing" },
            ]}
          />
        }
        action={
          <div className="flex items-center gap-2">
            <Link href="/admin/purchasing/menus">
              <Button variant="neutral" size="sm">Vendor menus</Button>
            </Link>
            <Link href="/admin/purchasing/new">
              <Button variant="save" size="sm">+ New purchase order</Button>
            </Link>
          </div>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <BackLink
            fallback="/admin/catalog"
            back={sp.back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </BackLink>
        </div>

        <HelpPanel
          id="purchasing-help"
          title="How the purchase order builder works"
          steps={[
            "Click ‘New purchase order’. The builder suggests what to reorder using your on-hand stock and recent sales velocity (reorder point = avg daily sales × lead time + safety stock).",
            "Use the include/exclude filters (vendor, brand, category, product) or describe what you want in plain English and let AI draft the plan — you always review before saving.",
            "Adjust quantities, save the PO as a draft, then send it to the vendor by email (or export/print).",
            "When the shipment arrives, receive it against each line in Receiving; the PO moves to Partial then Received. Then pay it in Accounts Payable.",
          ]}
        >
          <p>
            Purchasing is step one of the product journey. Ordered goods flow into{" "}
            <Link href="/admin/inventory/intake" className="text-[var(--admin-accent)] hover:underline">Receiving</Link>,
            new SKUs onto the menu via{" "}
            <Link href="/admin/inventory/drafts" className="text-[var(--admin-accent)] hover:underline">Product Onboarding</Link>,
            and the bill is settled in{" "}
            <Link href="/admin/vendor-payments" className="text-[var(--admin-accent)] hover:underline">Accounts Payable</Link>.
          </p>
          <SopSheetLink slug="order" />
        </HelpPanel>

        {/* KPIs — every value is computed from real PO data. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Open POs" value={String(kpis.openCount)} accent={kpis.openCount > 0 ? "gold" : "muted"} />
          <StatCard
            label="Open PO value"
            value={formatMoneyMinor(kpis.openValueMinor)}
            hint="committed but not yet received"
            accent="green"
          />
          <StatCard
            label="Awaiting delivery"
            value={String(kpis.awaitingCount)}
            hint="sent or partially received"
            accent={kpis.awaitingCount > 0 ? "orange" : "muted"}
          />
          <StatCard
            label="Avg cycle time"
            value={kpis.avgCycleDays == null ? "—" : `${kpis.avgCycleDays} day${kpis.avgCycleDays === 1 ? "" : "s"}`}
            hint={
              kpis.avgCycleDays == null
                ? "not enough history yet"
                : kpis.lateRatePct == null
                  ? "sent → received"
                  : `${kpis.lateRatePct}% arrived late`
            }
            accent="muted"
          />
          <StatCard
            label="Ordered this month"
            value={formatMoneyMinor(kpis.spendThisMonthMinor)}
            hint={describeSpendDelta(kpis)}
            accent={kpis.spendThisMonthMinor > 0 ? "gold" : "muted"}
          />
        </div>

        {/* Insights row — vendor concentration + three-way-match exceptions. */}
        {(topVendors.length > 0 || exceptions.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {topVendors.length > 0 && (
              <Section
                title="Top vendors by open value"
                description="Where your committed purchasing dollars are concentrated right now."
              >
                <ul className="divide-y divide-[var(--admin-border)] text-sm">
                  {topVendors.map((v) => (
                    <li key={v.vendorName} className="flex items-center justify-between gap-3 py-2">
                      <span className="truncate text-[var(--admin-text)]">{v.vendorName}</span>
                      <span className="shrink-0 text-[var(--admin-text-muted)]">
                        {formatMoneyMinor(v.openValueMinor)}
                        <span className="ml-2 text-xs text-[var(--admin-text-faint)]">
                          {v.openCount} open PO{v.openCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {exceptions.length > 0 && (
              <Section
                title="Received but not paid"
                description="Goods arrived, bill still open — the classic three-way-match exception. Settle these in Accounts Payable."
              >
                <ul className="divide-y divide-[var(--admin-border)] text-sm">
                  {exceptions.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <Link
                        href={`/admin/purchasing/${p.id}`}
                        className="truncate font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                      >
                        {p.po_number ?? "PO"} · {p.vendor_name ?? "Vendor"}
                      </Link>
                      <span className="shrink-0 text-[var(--admin-text-muted)]">{formatMoneyMinor(p.subtotal_minor_units)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs">
                  <Link href="/admin/vendor-payments" className="text-[var(--admin-accent)] hover:underline">
                    Open Vendor payments →
                  </Link>
                </div>
              </Section>
            )}
          </div>
        )}

        <Section
          title="Purchase orders"
          description="Every PO, newest first. Filter, search (try a PO number, vendor, or codename), and click a PO to open it."
        >
          {/* Filters — GET form keeps the URL shareable/bookmarkable. */}
          {pos.length > 0 && (
            <form className="mb-4 flex flex-wrap items-center gap-3" method="get">
              <div className="min-w-48 flex-1">
                <Input name="q" defaultValue={state.q} placeholder="Search PO number, vendor, or codename…" />
              </div>
              <Select name="status" defaultValue={state.status} aria-label="Status">
                <option value="">All statuses</option>
                {PO_LIST_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
              {vendorOptions.length > 0 && (
                <Select name="vendor" defaultValue={state.vendor} aria-label="Vendor">
                  <option value="">All vendors</option>
                  {vendorOptions.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              )}
              <Button type="submit" variant="neutral">Filter</Button>
              {filtersActive && (
                <Link href="/admin/purchasing" className="text-xs text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]">
                  Clear filters
                </Link>
              )}
            </form>
          )}

          {pos.length === 0 ? (
            <EmptyState
              icon="🛒"
              title="No purchase orders yet"
              description="Create your first PO — the builder will suggest what to reorder based on stock and sales."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="No purchase orders match those filters"
              description="Try a different status, vendor, or search term — or clear the filters to see everything."
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                    <tr>
                      <th className="px-4 py-3">PO</th>
                      <th className="px-4 py-3">Vendor</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Trail</th>
                      <th className="px-4 py-3 text-center">Lines</th>
                      <th className="px-4 py-3 text-right">Subtotal</th>
                      <th className="px-4 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--admin-border)]">
                    {pageRows.map((p) => {
                      const codename = poCodename(p.po_number);
                      const dots = poTraceDots(p);
                      return (
                        <tr key={p.id} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                          <td className="px-4 py-3">
                            <Link
                              href={`/admin/purchasing/${p.id}`}
                              className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                            >
                              {p.po_number ?? "—"}
                            </Link>
                            {p.origin === "ai_suggested" && (
                              <span className="ml-2 align-middle">
                                <Badge tone="gold">AI</Badge>
                              </span>
                            )}
                            {codename && (
                              <div className="text-xs italic text-[var(--admin-text-faint)]">{codename}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[var(--admin-text-muted)]">{p.vendor_name ?? "—"}</td>
                          <td className="px-4 py-3">
                            <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                            {/* W9: paid stamp (migration 0103) — absent pre-migration. */}
                            {p.paid_at ? (
                              <span className="ml-1 align-middle">
                                <Badge tone="green">paid</Badge>
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {/* Procure-to-pay trace dots: PO → received → paid. */}
                            <span className="flex items-center gap-1.5">
                              {dots.map((d) => (
                                <span
                                  key={d.key}
                                  title={`${d.label}: ${d.detail}`}
                                  className={`inline-block h-2.5 w-2.5 rounded-full ${traceDotClass(d.state)}`}
                                />
                              ))}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-[var(--admin-text-muted)]">{p.line_count}</td>
                          <td className="px-4 py-3 text-right text-[var(--admin-text)]">{formatMoneyMinor(p.subtotal_minor_units)}</td>
                          <td className="px-4 py-3 text-[var(--admin-text-faint)]">{new Date(p.created_at).toLocaleDateString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination — filters carried in every link. */}
              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between text-xs text-[var(--admin-text-muted)]">
                  <span>
                    Showing {pageRows.length} of {totalCount} PO{totalCount === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-2">
                    {safePage > 1 ? (
                      <Link href={buildPoListHref(state, safePage - 1)} className="rounded border border-[var(--admin-border)] px-2 py-1 hover:bg-[var(--admin-surface-hover)]">
                        ← Prev
                      </Link>
                    ) : (
                      <span className="opacity-40">← Prev</span>
                    )}
                    <span>Page {safePage} / {totalPages}</span>
                    {safePage < totalPages ? (
                      <Link href={buildPoListHref(state, safePage + 1)} className="rounded border border-[var(--admin-border)] px-2 py-1 hover:bg-[var(--admin-surface-hover)]">
                        Next →
                      </Link>
                    ) : (
                      <span className="opacity-40">Next →</span>
                    )}
                  </span>
                </div>
              )}
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
