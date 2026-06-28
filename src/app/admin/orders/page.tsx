import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { listOrders, getOrderStatusCounts } from "@/lib/orders/orders-store";
import {
  ORDER_STATUS_LABELS,
  ORDER_FORWARD_TRANSITIONS,
  type OrderStatus,
} from "@/lib/orders/types";
import { setOrderStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<OrderStatus, string> = {
  new: "border-[#ff7f00]/50 bg-[#ff7f00]/10 text-[#ff7f00]",
  acknowledged: "border-[#ffd700]/40 bg-[#ffd700]/10 text-[#ffd700]",
  preparing: "border-[#7ed957]/40 bg-[#7ed957]/10 text-[#7ed957]",
  ready: "border-[#7ed957]/60 bg-[#7ed957]/20 text-[#7ed957]",
  completed: "border-white/15 bg-white/5 text-white/60",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-300",
  no_show: "border-red-500/30 bg-red-500/5 text-red-300/80",
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
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
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
      />

      <div className="px-5 py-6 sm:px-8">
        {/* Status summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="New" value={counts.new} accent="orange" hint="Awaiting acknowledgement" />
          <StatCard label="Preparing" value={counts.preparing} accent="green" />
          <StatCard label="Ready" value={counts.ready} accent="green" hint="Waiting for pickup" />
          <StatCard label="Active total" value={activeCount} />
        </div>

        {/* Filters + search */}
        <form method="get" className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/admin/orders?status=${f.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                  status === f.key
                    ? "border-[#7ed957]/60 bg-[#7ed957]/15 text-[#7ed957]"
                    : "border-white/15 bg-white/5 text-white/60 hover:text-white"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <input
              name="q"
              defaultValue={search}
              placeholder="Search name, phone, order #"
              className="w-56 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#7ed957]/50 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              Search
            </button>
          </div>
        </form>

        {/* Order cards */}
        {orders.length === 0 ? (
          <p className="mt-8 text-sm text-white/40">No orders match this view.</p>
        ) : (
          <div className="mt-5 grid gap-3">
            {orders.map((order) => {
              const next = ORDER_FORWARD_TRANSITIONS[order.status];
              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="text-lg font-black text-white hover:text-[#7ed957]"
                        >
                          #{order.order_number}
                        </Link>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] ${STATUS_STYLES[order.status]}`}
                        >
                          {ORDER_STATUS_LABELS[order.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-white/70">
                        {order.customer_first_name}
                        {order.customer_last_name ? ` ${order.customer_last_name}` : ""}
                        {order.customer_phone ? ` · ${order.customer_phone}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-white/40">
                        {order.item_count} item{order.item_count === 1 ? "" : "s"} ·{" "}
                        {formatMinorCurrency(order.total_minor_units)} · placed {timeAgo(order.placed_at)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {next ? (
                        <form action={setOrderStatusAction}>
                          <input type="hidden" name="id" value={order.id} />
                          <input type="hidden" name="status" value={next} />
                          <button
                            type="submit"
                            className="rounded-lg bg-[#7ed957] px-3.5 py-2 text-xs font-black uppercase tracking-[0.08em] text-black transition hover:bg-white"
                          >
                            Mark {ORDER_STATUS_LABELS[next]}
                          </button>
                        </form>
                      ) : null}
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
