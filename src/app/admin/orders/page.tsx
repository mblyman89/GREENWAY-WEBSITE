import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Card } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { listOrdersPaged, getOrderStatusCounts } from "@/lib/orders/orders-store";
import { listWindow, parsePageParam, DEFAULT_PAGE_SIZE } from "@/lib/admin/list-window-core";
import {
  ORDER_SORTS,
  endOfDayIso,
  parseDollarsToMinor,
  parseIsoDate,
  resolveSort,
} from "@/lib/admin/list-filter-core";
import { ListPager } from "@/components/admin/ux/ListPager";
import {
  ORDER_STATUS_LABELS,
  ORDER_FORWARD_TRANSITIONS,
  type OrderStatus,
} from "@/lib/orders/types";
import { setOrderStatusAction } from "./actions";
import { OrderStatusFlow } from "@/components/admin/orders/OrderStatusFlow";
import { NewOrderAlert } from "@/components/admin/orders/NewOrderAlert";
import { withBackParam } from "@/lib/admin/back-link-core";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<OrderStatus, string> = {
  new: "border-[var(--admin-orange)]/50 bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]",
  acknowledged:
    "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  preparing:
    "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  ready:
    "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]",
  completed: "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]",
  cancelled:
    "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  no_show:
    "border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
};

const FILTERS: { key: string; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "new", label: "New" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no_show", label: "No-show" },
  { key: "all", label: "All" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function OrdersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    page?: string;
    sort?: string;
    from?: string;
    to?: string;
    min?: string;
    max?: string;
  }>;
}) {
  await requirePermission("orders.view");
  const sp = await searchParams;
  const status = (sp.status as OrderStatus | "active" | "all" | undefined) ?? "active";
  const search = sp.q ?? "";
  const rawPage = parsePageParam(sp.page);
  // SLICE 26: every filter knob validated by the pure grammar — garbage
  // params silently mean "filter off", never an exception.
  const sort = resolveSort(sp.sort, ORDER_SORTS);
  const placedFrom = parseIsoDate(sp.from);
  const placedToDate = parseIsoDate(sp.to);
  const placedTo = placedToDate ? endOfDayIso(placedToDate) : undefined;
  const totalMin = parseDollarsToMinor(sp.min);
  const totalMax = parseDollarsToMinor(sp.max);
  // GW-029: carry the current filters/search into detail links so BackLink
  // can restore this exact view.
  const detailHref = (id: string) => withBackParam(`/admin/orders/${id}`, sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Orders"
          subtitle="Live pickup orders — acknowledge, prepare, and complete from any device."
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn’t fully set up yet. Once your administrator finishes the one-time
            setup, live orders will appear here automatically. Until then the storefront confirms
            orders locally.
          </div>
        </div>
      </div>
    );
  }

  // GW-033: fetch the requested page window plus the exact total. If the
  // requested page is past the end (stale link), clamp and refetch the real
  // last page so the screen is never empty while rows exist.
  const queryFilter = {
    status,
    search,
    sort: sort.columns,
    placedFrom,
    placedTo,
    totalMin,
    totalMax,
  };
  const firstWin = listWindow(Number.MAX_SAFE_INTEGER, rawPage, DEFAULT_PAGE_SIZE);
  const [firstPage, counts] = await Promise.all([
    listOrdersPaged({ ...queryFilter, from: firstWin.from, to: firstWin.to }),
    getOrderStatusCounts(),
  ]);
  let { rows: orders, total } = firstPage;
  const win = listWindow(total, rawPage, DEFAULT_PAGE_SIZE);
  if (win.page !== rawPage && total > 0) {
    ({ rows: orders, total } = await listOrdersPaged({
      ...queryFilter,
      from: win.from,
      to: win.to,
    }));
  }
  /** Current filter state as URL params (page excluded — added per link). */
  const filterParams = () => {
    const params = new URLSearchParams();
    if (status !== "active") params.set("status", status);
    if (search) params.set("q", search);
    if (sort.key !== ORDER_SORTS[0].key) params.set("sort", sort.key);
    if (placedFrom) params.set("from", placedFrom);
    if (placedToDate) params.set("to", placedToDate);
    if (totalMin != null && sp.min) params.set("min", sp.min);
    if (totalMax != null && sp.max) params.set("max", sp.max);
    return params;
  };
  const pageHref = (p: number) => {
    const params = filterParams();
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };
  /** Status-chip links carry every OTHER filter and reset to page 1. */
  const statusHref = (key: string) => {
    const params = filterParams();
    params.delete("status");
    if (key !== "active") params.set("status", key);
    const qs = params.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };
  const hasExtraFilters = Boolean(
    placedFrom || placedToDate || totalMin != null || totalMax != null || sort.key !== ORDER_SORTS[0].key,
  );

  const activeCount = counts.new + counts.acknowledged + counts.preparing + counts.ready;

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        subtitle="Live pickup orders — acknowledge, prepare, and complete from any device."
        breadcrumbs={<Breadcrumbs items={[{ label: "Orders" }]} />}
        help={
          <HelpPanel
            id="orders"
            title="How to handle orders"
            steps={[
              "New online orders appear here automatically.",
              "Open an order to see the items and customer info.",
              "Move it through the stages as you prepare it.",
              "Print the ticket if you need a paper copy.",
            ]}
          >
            <p>
              The big touch-friendly cards work on a phone or tablet at the
              counter. Each order&apos;s status flow shows exactly where it is.
            </p>
          </HelpPanel>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {/* New-order watcher (polls + chimes when new orders arrive) */}
        <NewOrderAlert initialNew={counts.new} />

        {/* Status summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="New" value={counts.new} accent="orange" hint="Awaiting acknowledgement" icon="🔔" />
          <StatCard label="Preparing" value={counts.preparing} accent="green" icon="📦" />
          <StatCard label="Ready" value={counts.ready} accent="green" hint="Waiting for pickup" icon="✅" />
          <StatCard label="Active total" value={activeCount} icon="🧾" />
        </div>

        {/* Filters + search (SLICE 26: full control — status, search, date
            range, total range, and sort, all URL-driven and combinable). */}
        <form method="get" className="mt-6 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={statusHref(f.key)}
                className={`admin-focus rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                  status === f.key
                    ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
                    : "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="status" value={status} />
            <div className="min-w-52 flex-1">
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Search
              </label>
              <Input name="q" defaultValue={search} placeholder="Name, phone, order #" />
            </div>
            <div>
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Placed from
              </label>
              <Input type="date" name="from" defaultValue={placedFrom ?? ""} className="w-40" />
            </div>
            <div>
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Placed to
              </label>
              <Input type="date" name="to" defaultValue={placedToDate ?? ""} className="w-40" />
            </div>
            <div>
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Total min $
              </label>
              <Input name="min" defaultValue={sp.min ?? ""} placeholder="0.00" inputMode="decimal" className="w-24" />
            </div>
            <div>
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Total max $
              </label>
              <Input name="max" defaultValue={sp.max ?? ""} placeholder="0.00" inputMode="decimal" className="w-24" />
            </div>
            <div>
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Sort by
              </label>
              <Select name="sort" defaultValue={sort.key} aria-label="Sort orders">
                {ORDER_SORTS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="neutral">
              Apply
            </Button>
            {(search || hasExtraFilters) && (
              <Link
                href={status !== "active" ? `/admin/orders?status=${status}` : "/admin/orders"}
                className="pb-2 text-xs text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
              >
                Clear
              </Link>
            )}
          </div>
        </form>

        {/* GW-033: exact count + pager — a clipped list is never silent. */}
        <div className="mt-4">
          <ListPager window={win} total={total} noun="order" makeHref={pageHref} />
        </div>

        {/* Order cards */}
        {orders.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon="🧾"
              title="No orders match this view"
              description="When customers place pickup orders online, they'll show up here automatically — newest first."
            />
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {orders.map((order) => {
              const next = ORDER_FORWARD_TRANSITIONS[order.status];
              return (
                <Card key={order.id} padding="sm" className="sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={detailHref(order.id)}
                          className="text-lg font-black text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                        >
                          #{order.order_number}
                        </Link>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] ${STATUS_STYLES[order.status]}`}
                        >
                          {ORDER_STATUS_LABELS[order.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                        {order.customer_first_name}
                        {order.customer_last_name ? ` ${order.customer_last_name}` : ""}
                        {order.customer_phone ? ` · ${order.customer_phone}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">
                        {order.item_count} item{order.item_count === 1 ? "" : "s"} ·{" "}
                        {formatMinorCurrency(order.total_minor_units)} · placed {timeAgo(order.placed_at)}
                      </p>
                      <div className="mt-3">
                        <OrderStatusFlow status={order.status} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {next ? (
                        <form action={setOrderStatusAction}>
                          <input type="hidden" name="id" value={order.id} />
                          <input type="hidden" name="status" value={next} />
                          <Button type="submit" variant="primary" size="sm">
                            Mark {ORDER_STATUS_LABELS[next]}
                          </Button>
                        </form>
                      ) : null}
                      <Button href={detailHref(order.id)} variant="neutral" size="sm">
                        Details
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Bottom pager (long lists — save the scroll back up). */}
        {win.totalPages > 1 && (
          <div className="mt-5">
            <ListPager window={win} total={total} noun="order" makeHref={pageHref} />
          </div>
        )}
      </div>
    </div>
  );
}
