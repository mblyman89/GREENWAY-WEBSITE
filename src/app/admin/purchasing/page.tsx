import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  listPurchaseOrders,
  formatMoneyMinor,
  type PurchaseOrderStatus,
} from "@/lib/purchasing/po-store";

export const dynamic = "force-dynamic";

function statusTone(s: PurchaseOrderStatus): "green" | "gold" | "orange" | "neutral" | "danger" {
  if (s === "received") return "green";
  if (s === "sent") return "gold";
  if (s === "partial") return "orange";
  if (s === "cancelled") return "danger";
  return "neutral";
}

export default async function PurchasingPage() {
  await requirePermission("inventory.manage");
  const pos = await listPurchaseOrders();

  const open = pos.filter((p) => ["draft", "submitted", "sent", "partial"].includes(p.status));
  const openValue = open.reduce((s, p) => s + p.subtotal_minor_units, 0);
  const awaiting = pos.filter((p) => ["sent", "partial"].includes(p.status)).length;

  return (
    <div>
      <AdminPageHeader
        title="Purchasing"
        subtitle="AI-assisted purchase orders — reorder suggestions, send to vendors, receive against POs"
        breadcrumbs={<Breadcrumbs items={[{ label: "Purchasing" }]} />}
        action={
          <Link href="/admin/purchasing/new">
            <Button variant="save" size="sm">+ New purchase order</Button>
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="purchasing-help"
          title="How the purchase order builder works"
          steps={[
            "Click ‘New purchase order’. The builder suggests what to reorder using your on-hand stock and recent sales velocity (reorder point = avg daily sales × lead time + safety stock).",
            "Use the include/exclude filters (vendor, brand, category, product) or describe what you want in plain English and let AI draft the plan — you always review before saving.",
            "Adjust quantities, save the PO as a draft, then send it to the vendor by email (or export/print).",
            "When the shipment arrives, receive against each line; the PO moves to Partial then Received.",
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Open POs" value={String(open.length)} accent={open.length > 0 ? "gold" : "muted"} />
          <StatCard label="Open PO value" value={formatMoneyMinor(openValue)} accent="green" />
          <StatCard label="Awaiting delivery" value={String(awaiting)} accent={awaiting > 0 ? "orange" : "muted"} />
        </div>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">Purchase orders</h2>
          {pos.length === 0 ? (
            <EmptyState
              title="No purchase orders yet"
              description="Create your first PO — the builder will suggest what to reorder based on stock and sales."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                    <th className="px-2 py-1">PO</th>
                    <th className="px-2 py-1">Vendor</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Lines</th>
                    <th className="px-2 py-1">Subtotal</th>
                    <th className="px-2 py-1">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((p) => (
                    <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50">
                      <td className="px-2 py-2">
                        <Link href={`/admin/purchasing/${p.id}`} className="font-medium text-emerald-800 hover:underline">
                          {p.po_number ?? "—"}
                        </Link>
                        {p.origin === "ai_suggested" && <Badge tone="gold">AI</Badge>}
                      </td>
                      <td className="px-2 py-2 text-stone-700">{p.vendor_name ?? "—"}</td>
                      <td className="px-2 py-2"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                      <td className="px-2 py-2 text-stone-600">{p.line_count}</td>
                      <td className="px-2 py-2 text-stone-700">{formatMoneyMinor(p.subtotal_minor_units)}</td>
                      <td className="px-2 py-2 text-stone-500">{new Date(p.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
