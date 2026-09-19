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
import { resolveOrderDisplay } from "@/lib/orders/order-name-pool-core";
import { OrderOriginBadge } from "@/components/admin/orders/OrderOriginBadge";
import { listPoolNamesStatus } from "@/lib/orders/order-name-pool-store";
import { getPrinterSettings, isPrinterOnline } from "@/lib/printing/printer-store";
import { setOrderStatusAction, testPrintFromOrdersAction } from "./actions";
import { OrderStatusFlow } from "@/components/admin/orders/OrderStatusFlow";
import { OrderNamePoolManager } from "@/components/admin/orders/OrderNamePoolManager";
import { NewOrderAlert } from "@/components/admin/orders/NewOrderAlert";
import { AnnouncerPanel } from "@/components/admin/orders/AnnouncerPanel";
import { withBackParam } from "@/lib/admin/back-link-core";
// SLICE L-6 — Leafly orders live on THIS page, with Greenway's own orders,
// because the owner asked for exactly that and because a Leafly order carries a
// 15-minute auto-cancel deadline that must not sit behind a tab.
import {
  loadLeaflyOrderBoard,
  countLeaflyOrdersAwaitingAck,
} from "@/lib/leafly/order-board-server";
// SLICE L-14 — register cancellation interrupts, shown per order on the
// board so the back office can see which tills are blocked and how each
// cancellation was answered. Non-throwing and degrade-safe by construction.
import {
  listInterruptsForOrders,
  type BoardInterrupts,
} from "@/lib/leafly/register-claim-server";
import { LeaflyOrdersPanel } from "@/components/admin/orders/LeaflyOrdersPanel";

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
    poolMsg?: string;
    poolErr?: string;
    printTest?: string;
    // SLICE L-6 — outcome of a Leafly acknowledge/status push, carried back by
    // the server action. `leaflyCode`/`leaflyFix` are the pure core's decision
    // codes, kept separate from the message so the panel can offer the RIGHT
    // next step (a link to Integrations for a credential problem, the same
    // button again for a transient one) instead of one flattened sentence.
    leaflyMsg?: string;
    leaflyWarn?: string;
    leaflyErr?: string;
    leaflyCode?: string;
    leaflyFix?: string;
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
  const [
    firstPage,
    counts,
    poolStatus,
    printerSettings,
    leaflyBoard,
    leaflyPendingAck,
  ] = await Promise.all([
    listOrdersPaged({ ...queryFilter, from: firstWin.from, to: firstWin.to }),
    getOrderStatusCounts(),
    // SLICE 113: order-NAME pool + printer heartbeat, both fallback-safe (empty
    // pool / null settings when 0147 isn't applied or the printer isn't set up).
    listPoolNamesStatus(),
    getPrinterSettings(),
    // SLICE L-6: both are non-throwing by construction and report their own
    // failures, so a Leafly or migration problem degrades the Leafly panel
    // rather than 500-ing the screen the shop runs its own orders on. They join
    // the existing Promise.all so the Leafly read costs no extra round trip.
    loadLeaflyOrderBoard(),
    countLeaflyOrdersAwaitingAck(),
  ]);
  // SLICE L-14 — cancellation interrupts for the orders the board just loaded.
  //
  // NOT part of the Promise.all above, and deliberately so: this takes the ids
  // the board ACTUALLY returned rather than re-deriving them with a second
  // query. Re-deriving would let the two disagree about which orders are on
  // screen, and a mismatch there shows one order’s cancellation on another
  // order’s card. One sequential round trip — indexed, capped, and skipped
  // entirely when the board is empty — is the cheaper side of that trade.
  //
  // No try/catch: listInterruptsForOrders never throws and reports its own
  // failure in `problem`. Wrapping it would imply a failure mode that cannot
  // happen and invite someone to swallow a real one.
  const leaflyInterrupts: BoardInterrupts =
    leaflyBoard.orders.length > 0
      ? await listInterruptsForOrders(
          leaflyBoard.orders.map((o) => o.local_order_id ?? ""),
        )
      : { byOrderId: new Map(), degraded: false, problem: "" };
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

  // SLICE 113 — printer heartbeat + auto-print status for the at-a-glance chip.
  const printerConfigured = Boolean(printerSettings?.poll_token);
  const printerOnline = isPrinterOnline(printerSettings?.last_poll_at ?? null);
  const autoPrintOn = Boolean(printerSettings?.auto_print_orders);
  const printerLabel = printerSettings?.printer_label?.trim() || "Receipt printer";
  // Only nag when it actually matters: live orders waiting AND the printer is
  // configured for auto-print but hasn't checked in.
  const printerNeedsAttention = printerConfigured && autoPrintOn && !printerOnline && activeCount > 0;
  const printTestQueued = sp.printTest === "1";

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
        <NewOrderAlert />

        {/* SLICE 30 — the Raspberry Pi speakers in the office, sales floor and
            storage. Lives here, next to the printer status, because this is the
            screen someone is already looking at when they wonder why they did
            not hear an order. */}
        <AnnouncerPanel />

        {/* Status summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="New" value={counts.new} accent="orange" hint="Awaiting acknowledgement" icon="🔔" />
          <StatCard label="Preparing" value={counts.preparing} accent="green" icon="📦" />
          <StatCard label="Ready" value={counts.ready} accent="green" hint="Waiting for pickup" icon="✅" />
          <StatCard label="Active total" value={activeCount} icon="🧾" />
        </div>

        {/* SLICE L-6 — LEAFLY ORDERS.

            Placed here deliberately: directly under the status summary and
            ABOVE Greenway's own order cards. A Leafly order is the only order
            in the building with a hard external deadline — Leafly auto-cancels
            anything not acknowledged within fifteen minutes — so it is the
            first thing on this page that can cost a real customer their order.
            Everything below it (printer status, name pool, filters) can wait;
            this cannot.

            It renders NOTHING when Leafly order handling has never been set up
            and nothing has arrived, so the page is unchanged for a shop not
            using it. It never hides a failure. */}
        <LeaflyOrdersPanel
          board={leaflyBoard}
          pendingAckCount={leaflyPendingAck}
          interrupts={leaflyInterrupts}
          // The clock is read ONCE here and injected, so every countdown on the
          // page is measured from the same instant. Reading the time inside the
          // component per order would let two rows disagree about what time it
          // is; the pure core takes `now` as a parameter precisely so this is a
          // decision made in one visible place.
          now={new Date()}
          message={sp.leaflyMsg ?? sp.leaflyWarn ?? null}
          error={sp.leaflyErr ?? null}
          errorCode={sp.leaflyFix ?? sp.leaflyCode ?? null}
        />

        {/* SLICE 113 — Receipt-printer status at a glance + one-tap test print.
            Lives here so whoever is working the orders queue can confirm the
            printer is alive without leaving the page. */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                !printerConfigured
                  ? "bg-[var(--admin-text-faint)]"
                  : printerOnline
                    ? "bg-[var(--admin-accent)]"
                    : "bg-[var(--admin-danger)]"
              }`}
              aria-hidden
            />
            <span className="text-sm font-bold text-[var(--admin-text)]">
              🖨️ {printerLabel}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] ${
                !printerConfigured
                  ? "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]"
                  : printerOnline
                    ? "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]"
                    : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
              }`}
            >
              {!printerConfigured ? "Not set up" : printerOnline ? "Connected" : "Not seen recently"}
            </span>
            {printerConfigured ? (
              <span className="text-xs text-[var(--admin-text-muted)]">
                Auto-print {autoPrintOn ? "on" : "off"}
              </span>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <form action={testPrintFromOrdersAction}>
              <Button type="submit" variant="neutral" size="sm">
                Send test print
              </Button>
            </form>
            <Link
              href="/admin/equipment?tab=printer"
              className="admin-focus rounded-lg border border-[var(--admin-border-strong)] bg-white/5 px-3 py-1.5 text-xs font-bold text-[var(--admin-text-muted)] transition hover:text-[var(--admin-text)]"
            >
              Printer settings →
            </Link>
          </div>
        </div>

        {printTestQueued ? (
          <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            ✅ Test print queued. If the printer is on and connected it should print within a few seconds.
          </div>
        ) : null}

        {printerNeedsAttention ? (
          <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            ⚠️ You have {activeCount} active order{activeCount === 1 ? "" : "s"} and auto-print is on, but
            the printer hasn’t checked in for a while. Receipts may not be printing — check that it’s
            powered on and connected, then send a test print.
          </div>
        ) : null}

        {/* SLICE 113 — Order-name pool manager (fun recycling names for online
            orders). Fallback-safe: shows a gentle "finish setup" note until
            migration 0147 is applied. */}
        <div className="mt-4">
          <OrderNamePoolManager
            names={poolStatus.names}
            migrationReady={poolStatus.migrationReady}
            message={sp.poolMsg ?? null}
            error={sp.poolErr ?? null}
          />
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
                          {resolveOrderDisplay(order.display_name, order.order_number)}
                        </Link>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] ${STATUS_STYLES[order.status]}`}
                        >
                          {ORDER_STATUS_LABELS[order.status]}
                        </span>
                        {/* SLICE L-12. `hideWebsite` because almost every row
                            here is a website order: badging all forty trains
                            the eye to skip the column, which would take the
                            Leafly badge with it. Only the exception is
                            marked, which is the whole point of marking it. */}
                        <OrderOriginBadge origin={order.origin} hideWebsite />
                      </div>
                      {order.display_name && order.display_name.trim() ? (
                        <p className="mt-0.5 font-mono text-xs text-[var(--admin-text-faint)]">
                          #{order.order_number}
                        </p>
                      ) : null}
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
