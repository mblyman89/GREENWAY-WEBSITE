import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Card } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { Input } from "@/components/admin/ui/Field";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { listOrders, getOrderStatusCounts } from "@/lib/orders/orders-store";
import {
  ORDER_STATUS_LABELS,
  ORDER_FORWARD_TRANSITIONS,
  type OrderStatus,
} from "@/lib/orders/types";
import { setOrderStatusAction } from "./actions";
import { OrderStatusFlow } from "@/components/admin/orders/OrderStatusFlow";
import { NewOrderAlert } from "@/components/admin/orders/NewOrderAlert";

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
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requirePermission("orders.view");
  const sp = await searchParams;
  const status = (sp.status as OrderStatus | "active" | "all" | undefined) ?? "active";
  const search = sp.q ?? "";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Orders"
          subtitle="Live pickup orders — acknowledge, prepare, and complete from any device."
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            Supabase is not configured yet. Once the database is connected and migration{" "}
            <code>0007_slice7_orders.sql</code> is applied, live orders will appear here. Until
            then the storefront confirms orders locally.
          </div>
        </div>
      </div>
    );
  }

  const [orders, counts] = await Promise.all([
    listOrders({ status, search }),
    getOrderStatusCounts(),
  ]);

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

        {/* Filters + search */}
        <form method="get" className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/admin/orders?status=${f.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
                className={`admin-focus rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                  status === f.key
                    ? "border-[var(--admin-accent)]/60 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                    : "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <Input
              name="q"
              defaultValue={search}
              placeholder="Search name, phone, order #"
              className="w-56"
            />
            <Button type="submit" variant="subtle">
              Search
            </Button>
          </div>
        </form>

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
                          href={`/admin/orders/${order.id}`}
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
                      <Button href={`/admin/orders/${order.id}`} variant="subtle" size="sm">
                        Details
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
