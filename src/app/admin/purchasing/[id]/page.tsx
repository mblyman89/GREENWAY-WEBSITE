import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import {
  getPurchaseOrder,
  formatMoneyMinor,
  lineTotalMinor,
  type PurchaseOrderStatus,
} from "@/lib/purchasing/po-store";
import {
  setStatusAction,
  sendPurchaseOrderAction,
  receiveLineAction,
  deletePurchaseOrderAction,
} from "../actions";

export const dynamic = "force-dynamic";

function statusTone(s: PurchaseOrderStatus): "green" | "gold" | "orange" | "neutral" | "danger" {
  if (s === "received") return "green";
  if (s === "sent") return "gold";
  if (s === "partial") return "orange";
  if (s === "cancelled") return "danger";
  return "neutral";
}

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("inventory.manage");
  const { id } = await params;
  const sp = await searchParams;
  const po = await getPurchaseOrder(id);
  if (!po) notFound();

  const sent = (Array.isArray(sp.sent) ? sp.sent[0] : sp.sent) === "1";
  const marked = (Array.isArray(sp.marked) ? sp.marked[0] : sp.marked) === "1";

  const totalReceived = po.lines.reduce((s, l) => s + l.received_qty, 0);
  const totalOrdered = po.lines.reduce((s, l) => s + l.order_qty, 0);
  const isOpen = ["draft", "submitted", "sent", "partial"].includes(po.status);
  const canSend = ["draft", "submitted"].includes(po.status);
  const canReceive = ["sent", "partial"].includes(po.status);

  return (
    <div>
      <AdminPageHeader
        title={po.po_number ?? "Purchase order"}
        subtitle={po.vendor_name ?? "Vendor not set"}
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Purchasing", href: "/admin/purchasing" },
              { label: po.po_number ?? "PO" },
            ]}
          />
        }
        action={
          <Link href="/admin/purchasing">
            <Button variant="neutral" size="sm">Back</Button>
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sent ? (
          <div className="rounded-[var(--admin-radius)] border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            Purchase order emailed to the vendor and marked as Sent.
          </div>
        ) : null}
        {marked ? (
          <div className="rounded-[var(--admin-radius)] border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            Marked as Sent. (Email was not sent — no vendor email on file or email not configured. Export/print to send manually.)
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Status" value={po.status} accent={po.status === "received" ? "green" : "gold"} />
          <StatCard label="Lines" value={String(po.line_count)} accent="muted" />
          <StatCard label="Subtotal" value={formatMoneyMinor(po.subtotal_minor_units)} accent="green" />
          <StatCard label="Received" value={`${totalReceived} / ${totalOrdered}`} accent={totalReceived > 0 ? "orange" : "muted"} />
        </div>

        {/* Actions */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={statusTone(po.status)}>{po.status}</Badge>
            {po.origin === "ai_suggested" ? <Badge tone="gold">AI drafted</Badge> : null}

            {canSend ? (
              <form action={sendPurchaseOrderAction}>
                <input type="hidden" name="po_id" value={po.id} />
                <Button type="submit" variant="save" size="sm">Send to vendor</Button>
              </form>
            ) : null}

            {po.status === "draft" ? (
              <form action={setStatusAction}>
                <input type="hidden" name="po_id" value={po.id} />
                <input type="hidden" name="status" value="submitted" />
                <Button type="submit" variant="neutral" size="sm">Mark submitted</Button>
              </form>
            ) : null}

            {isOpen ? (
              <form action={setStatusAction}>
                <input type="hidden" name="po_id" value={po.id} />
                <input type="hidden" name="status" value="cancelled" />
                <Button type="submit" variant="neutral" size="sm">Cancel PO</Button>
              </form>
            ) : null}

            <form action={deletePurchaseOrderAction} className="ml-auto">
              <input type="hidden" name="po_id" value={po.id} />
              <Button type="submit" variant="neutral" size="sm">Delete</Button>
            </form>
          </div>
          {po.vendor_email ? (
            <p className="mt-3 text-xs text-stone-500">Vendor email: {po.vendor_email}</p>
          ) : (
            <p className="mt-3 text-xs text-amber-600">
              No vendor email on file — sending will mark as Sent only. Add an email to the vendor record to enable emailing.
            </p>
          )}
          {po.note ? <p className="mt-2 text-sm text-stone-600">Note: {po.note}</p> : null}
          {po.expected_date ? (
            <p className="mt-1 text-xs text-stone-500">Expected delivery: {po.expected_date}</p>
          ) : null}
        </Card>

        {/* Lines */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">Lines</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="px-2 py-1">Product</th>
                  <th className="px-2 py-1 text-right">Order qty</th>
                  <th className="px-2 py-1 text-right">Unit cost</th>
                  <th className="px-2 py-1 text-right">Line total</th>
                  <th className="px-2 py-1 text-right">Received</th>
                  {canReceive ? <th className="px-2 py-1 text-right">Receive</th> : null}
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => {
                  const remaining = l.order_qty - l.received_qty;
                  return (
                    <tr key={l.id} className="border-t border-stone-100">
                      <td className="px-2 py-2">
                        <div className="font-medium text-stone-800">{l.product_name}</div>
                        <div className="text-xs text-stone-500">{[l.brand, l.category].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td className="px-2 py-2 text-right text-stone-700">{l.order_qty} {l.unit}</td>
                      <td className="px-2 py-2 text-right text-stone-700">{formatMoneyMinor(l.unit_cost_minor_units)}</td>
                      <td className="px-2 py-2 text-right font-medium text-stone-800">
                        {formatMoneyMinor(lineTotalMinor(l.order_qty, l.unit_cost_minor_units))}
                      </td>
                      <td className="px-2 py-2 text-right text-stone-600">
                        {l.received_qty}{remaining > 0 ? <span className="text-stone-400"> / {l.order_qty}</span> : " ✓"}
                      </td>
                      {canReceive ? (
                        <td className="px-2 py-2 text-right">
                          {remaining > 0 ? (
                            <form action={receiveLineAction} className="flex items-center justify-end gap-1">
                              <input type="hidden" name="po_id" value={po.id} />
                              <input type="hidden" name="line_id" value={l.id} />
                              <input
                                type="number"
                                name="received_qty"
                                min={1}
                                max={remaining}
                                defaultValue={remaining}
                                className="w-16 rounded border border-stone-300 px-2 py-1 text-right text-sm"
                              />
                              <Button type="submit" variant="neutral" size="sm">Receive</Button>
                            </form>
                          ) : (
                            <span className="text-xs text-emerald-700">complete</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
