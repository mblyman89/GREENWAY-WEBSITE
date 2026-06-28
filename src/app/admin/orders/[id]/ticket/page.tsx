import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { getOrder } from "@/lib/orders/orders-store";
import { ORDER_STATUS_LABELS } from "@/lib/orders/types";
import { PrintButton } from "@/components/admin/orders/PrintButton";

export const dynamic = "force-dynamic";

export default async function OrderTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("orders.view");
  const { id } = await params;

  if (!isSupabaseServiceConfigured) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const itemCount = order.lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="ticket-print mx-auto max-w-md bg-white px-6 py-6 text-black print:max-w-none">
      {/* Header */}
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <p className="text-xl font-black uppercase tracking-tight">Greenway Marijuana</p>
          <p className="text-xs uppercase tracking-[0.18em] text-black/60">Pickup pick-ticket</p>
        </div>
        <PrintButton />
      </div>

      {/* Big order number + status */}
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-black/50">Order</p>
          <p className="text-5xl font-black leading-none tracking-tight">#{order.order_number}</p>
        </div>
        <div className="text-right">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-black/50">Status</p>
          <p className="text-base font-black uppercase">{ORDER_STATUS_LABELS[order.status]}</p>
          <p className="mt-1 text-xs font-bold">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* Customer */}
      <div className="mt-3 rounded border-2 border-black/15 px-3 py-2">
        <p className="text-base font-black">
          {order.customer_first_name}
          {order.customer_last_name ? ` ${order.customer_last_name}` : ""}
        </p>
        {order.customer_phone ? (
          <p className="text-sm font-bold">{order.customer_phone}</p>
        ) : null}
        <p className="text-xs text-black/60">Placed {new Date(order.placed_at).toLocaleString()}</p>
      </div>

      {/* Items — large, scannable */}
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/40 text-left">
            <th className="py-1 pr-2 font-black">Qty</th>
            <th className="py-1 pr-2 font-black">Item</th>
            <th className="py-1 text-right font-black">Price</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id} className="border-b border-black/15 align-top">
              <td className="py-2 pr-2 text-lg font-black">{line.quantity}×</td>
              <td className="py-2 pr-2">
                <span className="text-[0.95rem] font-bold leading-tight">{line.product_name}</span>
                <span className="block text-xs text-black/60">
                  {line.brand ?? ""}
                  {line.variant_label ? ` · ${line.variant_label}` : ""}
                </span>
              </td>
              <td className="py-2 text-right font-bold">
                {formatMinorCurrency(line.price_minor_units * line.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-3 space-y-1 border-t-2 border-black pt-3 text-sm">
        <Row label="Subtotal" value={formatMinorCurrency(order.subtotal_minor_units)} />
        <Row label="Taxes (est.)" value={formatMinorCurrency(order.estimated_tax_minor_units)} />
        {order.savings_minor_units > 0 ? (
          <Row label="Savings" value={`-${formatMinorCurrency(order.savings_minor_units)}`} />
        ) : null}
        <div className="flex items-center justify-between border-t border-black/40 pt-1 text-xl font-black">
          <span>Total</span>
          <span>{formatMinorCurrency(order.total_minor_units)}</span>
        </div>
      </div>

      {/* Customer note — boxed + emphasized so staff don't miss it */}
      {order.customer_note ? (
        <div className="mt-3 border-2 border-black p-2">
          <p className="text-[0.6rem] font-black uppercase tracking-[0.2em]">Customer note</p>
          <p className="text-sm font-bold">“{order.customer_note}”</p>
        </div>
      ) : null}

      {/* Compliance footer */}
      <p className="mt-4 text-[0.65rem] leading-4 text-black/60">
        Pickup reservation only — no payment collected online. Verify a valid 21+ ID. Final price,
        tax, and purchase limits confirmed in store.
      </p>

      {/* Print-only "cut here" line */}
      <div className="ticket-cut-line mt-5 hidden border-t-2 border-dashed border-black/50 pt-1 text-center text-[0.6rem] uppercase tracking-[0.3em] text-black/50">
        ✂ cut here
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-black/60">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
