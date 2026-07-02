import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { OrderStatusFlow } from "@/components/admin/orders/OrderStatusFlow";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { getOrder } from "@/lib/orders/orders-store";
import {
  ORDER_STATUS_LABELS,
  ORDER_FORWARD_TRANSITIONS,
  CLOSED_ORDER_STATUSES,
  type OrderStatus,
} from "@/lib/orders/types";
import { setOrderStatusAction, updateOrderNoteAction } from "../actions";

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

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("orders.view");
  const { id } = await params;

  if (!isSupabaseServiceConfigured) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const next = ORDER_FORWARD_TRANSITIONS[order.status];
  const isClosed = CLOSED_ORDER_STATUSES.includes(order.status);

  return (
    <div>
      <AdminPageHeader
        title={`Order #${order.order_number}`}
        subtitle={`Placed ${new Date(order.placed_at).toLocaleString()}`}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/orders/${order.id}/ticket`}
              className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
            >
              Print pick-ticket
            </Link>
            <Link
              href="/admin/orders"
              className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
            >
              Back to orders
            </Link>
          </div>
        }
      />

      <div className="px-5 pt-6 sm:px-8">
        <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-white/40">Status flow</p>
          <OrderStatusFlow status={order.status} size="md" />
        </div>
      </div>

      <div className="grid gap-5 px-5 py-6 sm:px-8 lg:grid-cols-3">
        {/* Main: items + workflow */}
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">Items</h2>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] ${STATUS_STYLES[order.status]}`}
              >
                {ORDER_STATUS_LABELS[order.status]}
              </span>
            </div>
            <div className="mt-4 grid gap-2.5">
              {order.lines.map((line) => (
                <div key={line.id} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{line.product_name}</p>
                    <p className="text-[0.66rem] font-bold uppercase tracking-[0.12em] text-white/40">
                      {line.brand ?? ""} · Qty {line.quantity}
                      {line.variant_label ? ` · ${line.variant_label}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-black text-[var(--orange)]">
                    {formatMinorCurrency(line.price_minor_units * line.quantity)}
                  </p>
                </div>
              ))}
            </div>
            <dl className="mt-4 grid gap-1.5 border-t border-white/10 pt-4 text-sm">
              <Row label="Subtotal" value={formatMinorCurrency(order.subtotal_minor_units)} />
              <Row label="Taxes (est.)" value={formatMinorCurrency(order.estimated_tax_minor_units)} />
              {order.savings_minor_units > 0 ? (
                <Row label="Savings" value={`−${formatMinorCurrency(order.savings_minor_units)}`} />
              ) : null}
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <dt className="font-black uppercase tracking-[0.1em] text-white">Total</dt>
                <dd className="text-lg font-black text-[var(--orange)]">
                  {formatMinorCurrency(order.total_minor_units)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Workflow */}
          {!isClosed ? (
            <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">
                Update status
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {next ? (
                  <form action={setOrderStatusAction}>
                    <input type="hidden" name="id" value={order.id} />
                    <input type="hidden" name="status" value={next} />
                    <button
                      type="submit"
                      className="rounded-lg bg-[#7ed957] px-4 py-2.5 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:brightness-110"
                    >
                      Mark {ORDER_STATUS_LABELS[next]}
                    </button>
                  </form>
                ) : null}
                <form action={setOrderStatusAction}>
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="status" value="cancelled" />
                  <button
                    type="submit"
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-300 transition hover:bg-red-500/20"
                  >
                    Cancel
                  </button>
                </form>
                <form action={setOrderStatusAction}>
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="status" value="no_show" />
                  <button
                    type="submit"
                    className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-sm font-bold text-red-300/80 transition hover:bg-red-500/15"
                  >
                    No-show
                  </button>
                </form>
              </div>
            </div>
          ) : null}

          {/* Timeline */}
          {order.events && order.events.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">Timeline</h2>
              <ol className="mt-4 space-y-3">
                {order.events.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#7ed957]" />
                    <div>
                      <p className="text-white/80">
                        {ev.event_type === "status_changed"
                          ? `${ev.from_status ? ORDER_STATUS_LABELS[ev.from_status] : "—"} → ${
                              ev.to_status ? ORDER_STATUS_LABELS[ev.to_status] : "—"
                            }`
                          : ev.event_type === "placed"
                            ? "Order placed"
                            : ev.event_type === "note"
                              ? "Note added"
                              : ev.event_type}
                      </p>
                      {ev.note ? <p className="text-xs text-white/50">{ev.note}</p> : null}
                      <p className="text-[0.66rem] uppercase tracking-[0.1em] text-white/30">
                        {ev.actor_label ?? "system"} · {new Date(ev.created_at).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        {/* Sidebar: customer + staff note */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">Customer</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row
                label="Name"
                value={`${order.customer_first_name}${order.customer_last_name ? ` ${order.customer_last_name}` : ""}`}
              />
              {order.customer_phone ? <Row label="Phone" value={order.customer_phone} /> : null}
              {order.customer_email ? <Row label="Email" value={order.customer_email} /> : null}
              {order.customer_birthday ? <Row label="Birthday" value={order.customer_birthday} /> : null}
            </dl>
            {order.customer_note ? (
              <p className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/60">
                “{order.customer_note}”
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">
              Staff note
            </h2>
            <form action={updateOrderNoteAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={order.id} />
              <textarea
                name="note"
                defaultValue={order.staff_note ?? ""}
                rows={4}
                placeholder="Internal note (not shown to the customer)…"
                className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#7ed957]/50 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
              >
                Save note
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-white/40">{label}</dt>
      <dd className="font-bold text-white/80">{value}</dd>
    </div>
  );
}
