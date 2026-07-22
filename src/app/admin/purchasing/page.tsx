import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Section } from "@/components/admin/ui";
import {
  listPurchaseOrders,
  formatMoneyMinor,
  type PurchaseOrder,
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

/** Whole days between two ISO dates (>= 0). */
function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * PO cycle time (NetSuite KPI): average days from a PO being sent to being
 * received, across received POs that carry both timestamps. Real data only —
 * returns null when there isn't enough history to be meaningful.
 */
function avgCycleDays(pos: PurchaseOrder[]): number | null {
  const done = pos.filter((p) => p.sent_at && p.received_at);
  if (done.length === 0) return null;
  const total = done.reduce((s, p) => s + daysBetween(p.sent_at!, p.received_at!), 0);
  return Math.round(total / done.length);
}

/**
 * Vendor late-PO rate (NetSuite KPI): share of received POs that arrived after
 * their expected date. Only counts POs that have both an expected and a
 * received date. Returns null when there's nothing to measure.
 */
function lateRatePct(pos: PurchaseOrder[]): number | null {
  const measurable = pos.filter((p) => p.received_at && p.expected_date);
  if (measurable.length === 0) return null;
  const late = measurable.filter(
    (p) => new Date(p.received_at!).getTime() > new Date(p.expected_date!).getTime(),
  ).length;
  return Math.round((late / measurable.length) * 100);
}

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const sp = await searchParams;
  await requirePermission("inventory.manage");
  const pos = await listPurchaseOrders();

  const open = pos.filter((p) => ["draft", "submitted", "sent", "partial"].includes(p.status));
  const openValue = open.reduce((s, p) => s + p.subtotal_minor_units, 0);
  const awaiting = pos.filter((p) => ["sent", "partial"].includes(p.status)).length;
  const cycle = avgCycleDays(pos);
  const lateRate = lateRatePct(pos);

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Open POs" value={String(open.length)} accent={open.length > 0 ? "gold" : "muted"} />
          <StatCard label="Open PO value" value={formatMoneyMinor(openValue)} hint="committed but not yet received" accent="green" />
          <StatCard label="Awaiting delivery" value={String(awaiting)} hint="sent or partially received" accent={awaiting > 0 ? "orange" : "muted"} />
          <StatCard
            label="Avg cycle time"
            value={cycle == null ? "—" : `${cycle} day${cycle === 1 ? "" : "s"}`}
            hint={
              cycle == null
                ? "not enough history yet"
                : lateRate == null
                  ? "sent → received"
                  : `${lateRate}% arrived late`
            }
            accent="muted"
          />
        </div>

        <Section title="Purchase orders" description="Every PO, newest first. Click a PO number to open it.">
          {pos.length === 0 ? (
            <EmptyState
              icon="🛒"
              title="No purchase orders yet"
              description="Create your first PO — the builder will suggest what to reorder based on stock and sales."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <tr>
                    <th className="px-4 py-3">PO</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-center">Lines</th>
                    <th className="px-4 py-3 text-right">Subtotal</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {pos.map((p) => (
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
                      <td className="px-4 py-3 text-center text-[var(--admin-text-muted)]">{p.line_count}</td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text)]">{formatMoneyMinor(p.subtotal_minor_units)}</td>
                      <td className="px-4 py-3 text-[var(--admin-text-faint)]">{new Date(p.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
