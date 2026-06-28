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

  return (
    <div className="mx-auto max-w-md bg-white px-6 py-6 text-black print:max-w-none">
      <div className="flex items-center justify-between border-b-2 border-black pb-3">
        <div>
          <p className="text-xl font-black uppercase tracking-tight">Greenway Marijuana</p>
          <p className="text-xs uppercase tracking-[0.18em] text-black/60">Pickup pick-ticket</p>
        </div>
        <PrintButton />
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-3xl font-black">#{order.order_number}</p>
        <p className="text-sm font-bold uppercase">{ORDER_STATUS_LABELS[order.status]}</p>
      </div>
      <p className="mt-1 text-sm">
        {order.customer_first_name}
        {order.customer_last_name ? ` ${order.customer_last_name}` : ""}
        {order.customer_phone ? ` · ${order.customer_phone}` : ""}
      </p>
      <p className="text-xs text-black/60">Placed {new Date(order.placed_at).toLocaleString()}</p>

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
              <td className="py-1.5 pr-2 font-bold">{line.quantity}×</td>
              <td className="py-1.5 pr-2">
                <span className="font-bold">{line.product_name}</span>
                <span className="block text-xs text-black/60">
                  {line.brand ?? ""}
                  {line.variant_label ? ` · ${line.variant_label}` : ""}
                </span>
              </td>
              <td className="py-1.5 text-right">
                {formatMinorCurrency(line.price_minor_units * line.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 border-t-2 border-black pt-3 text-sm">
        <Row label="Subtotal" value={formatMinorCurrency(order.subtotal_minor_units)} />
        <Row label="Taxes (est.)" value={formatMinorCurrency(order.estimated_tax_minor_units)} />
        {order.savings_minor_units > 0 ? (
          <Row label="Savings" value={`-${formatMinorCurrency(order.savings_minor_units)}`} />
        ) : null}
        <div className="flex items-center justify-between border-t border-black/40 pt-1 text-base font-black">
          <span>Total</span>
          <span>{formatMinorCurrency(order.total_minor_units)}</span>
        </div>
      </div>

      {order.customer_note ? (
        <p className="mt-3 border border-black/30 p-2 text-xs">Note: “{order.customer_note}”</p>
      ) : null}

      <p className="mt-4 text-[0.65rem] leading-4 text-black/60">
        Pickup reservation only — no payment collected online. Verify a valid 21+ ID. Final price,
        tax, and purchase limits confirmed in store.
      </p>
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
