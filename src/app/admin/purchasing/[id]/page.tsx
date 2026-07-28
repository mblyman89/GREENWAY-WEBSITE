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
// SLICE 81: branded document + verified send + procure-to-pay paper trail.
import { poCodename, buildPoPaperTrail, type TrailStepState } from "@/lib/purchasing/po-document-core";
import { buildPoTrailFacts } from "@/lib/purchasing/po-document-store";
import {
  setStatusAction,
  sendPurchaseOrderAction,
  receiveLineAction,
  deletePurchaseOrderAction,
} from "../actions";
import { poWhatDoIDoHere } from "@/lib/catalog/next-action-core";
import { WhatDoIDoHere } from "@/components/admin/catalog/WhatDoIDoHere";
import { isAiConfigured } from "@/lib/ai/provider";
import { PoMarketContextCard } from "../PoMarketContextCard";
import { PoReviewPanel } from "./PoReviewPanel";

export const dynamic = "force-dynamic";

/** SLICE 81: dot styling for the paper-trail steps. */
function trailDotClass(state: TrailStepState): string {
  if (state === "done") return "bg-emerald-100 text-emerald-700";
  if (state === "partial") return "bg-amber-100 text-amber-700";
  if (state === "unavailable") return "bg-stone-200 text-stone-500";
  return "border border-stone-300 text-stone-400";
}

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

  // SLICE 81: codename + the real PO → manifest → payment → stamp chain.
  const codename = poCodename(po.po_number);
  const trailData = await buildPoTrailFacts(po);
  const trailSteps = buildPoPaperTrail(trailData.facts);

  const sent = (Array.isArray(sp.sent) ? sp.sent[0] : sp.sent) === "1";
  const marked = (Array.isArray(sp.marked) ? sp.marked[0] : sp.marked) === "1";
  const errorMessage = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const totalReceived = po.lines.reduce((s, l) => s + l.received_qty, 0);
  const totalOrdered = po.lines.reduce((s, l) => s + l.order_qty, 0);
  const isOpen = ["draft", "submitted", "sent", "partial"].includes(po.status);
  const canSend = ["draft", "submitted"].includes(po.status);
  const canReceive = ["sent", "partial"].includes(po.status);

  return (
    <div>
      <AdminPageHeader
        title={po.po_number ?? "Purchase order"}
        subtitle={[codename, po.vendor_name ?? "Vendor not set"].filter(Boolean).join(" · ")}
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
        {errorMessage ? (
          <div className="rounded-[var(--admin-radius)] border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}

        {/* W4: one plain-English next action for this PO's stage. */}
        <WhatDoIDoHere action={poWhatDoIDoHere(po.status, Boolean(po.vendor_email))} />

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
            {/* W9: paid stamp (migration 0103) — absent pre-migration. */}
            {po.paid_at ? <Badge tone="green">paid</Badge> : null}
            {po.origin === "ai_suggested" ? <Badge tone="gold">AI drafted</Badge> : null}

            <a href={`/admin/purchasing/${po.id}/document`} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="neutral" size="sm">Preview document</Button>
            </a>
            <a href={`/admin/purchasing/${po.id}/document?download=1`}>
              <Button type="button" variant="neutral" size="sm">Download</Button>
            </a>

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

            {po.status === "draft" ? (
              <form action={deletePurchaseOrderAction} className="ml-auto">
                <input type="hidden" name="po_id" value={po.id} />
                <Button type="submit" variant="neutral" size="sm">Delete draft</Button>
              </form>
            ) : null}
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
          {po.paid_at ? (
            <p className="mt-1 text-xs text-emerald-700">
              Paid {new Date(po.paid_at).toLocaleDateString()} · {po.payment_reference ?? "payment"}{" "}
              — stamped automatically when Accounts Payable settled every linked invoice.
            </p>
          ) : null}
        </Card>

        {/* SLICE 81: Verify & send — preview the branded document, confirm the
            recipient, then send. Download sits right beside it. */}
        {canSend ? (
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-stone-800">Send to vendor</h2>
            <p className="mb-3 text-xs text-stone-500">
              Step 1: press <span className="font-medium">Preview document</span> above and read it like the vendor will.
              Step 2: confirm the send-to email below. Step 3: press <span className="font-medium">Verify & send</span>.
              The email carries the Greenway-branded order; <span className="font-medium">Download</span> saves the same
              document to attach or print yourself.
            </p>
            <form action={sendPurchaseOrderAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="po_id" value={po.id} />
              <label className="flex flex-col gap-1 text-xs text-stone-600">
                Send to (verify this address)
                <input
                  type="email"
                  name="send_to"
                  defaultValue={po.vendor_email ?? ""}
                  placeholder="orders@vendor.com"
                  className="w-72 rounded border border-stone-300 px-3 py-2 text-sm"
                />
              </label>
              <Button type="submit" variant="save" size="sm">Verify & send</Button>
              <a href={`/admin/purchasing/${po.id}/document?download=1`}>
                <Button type="button" variant="neutral" size="sm">Download</Button>
              </a>
            </form>
            {!po.vendor_email ? (
              <p className="mt-2 text-xs text-amber-600">
                No vendor email on file — type one above, or add it to the vendor record so it prefills next time.
                Sending without an address only marks the PO as Sent.
              </p>
            ) : null}
          </Card>
        ) : null}

        {/* SLICE 81: paper trail — PO → manifest → payment → paid stamp with
            honest gaps. This is the full procure-to-pay audit trail
            (three-way match: PO ↔ manifest ↔ invoice). */}
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-stone-800">Paper trail (procure-to-pay)</h2>
          <p className="mb-3 text-xs text-stone-500">
            The full audit trail for this order: the PO, the delivery manifest(s) linked to it, the invoice
            payment(s) recorded against those manifests, and the automatic paid stamp.
          </p>
          <ol className="space-y-3">
            {trailSteps.map((step) => (
              <li key={step.key} className="flex items-start gap-3">
                <span className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-bold ${trailDotClass(step.state)}`}>
                  {step.state === "done" ? "✓" : step.state === "partial" ? "◑" : step.state === "unavailable" ? "!" : "○"}
                </span>
                <div>
                  <div className="text-sm font-medium text-stone-800">{step.label}</div>
                  <div className="text-xs text-stone-600">{step.note}</div>
                  {step.key === "manifest" && trailData.manifests.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {trailData.manifests.map((m) => (
                        <Link
                          key={m.id}
                          href={`/admin/inventory/intake/${m.id}`}
                          className="rounded border border-stone-200 px-2 py-0.5 text-xs text-stone-700 hover:border-stone-400"
                        >
                          {m.number ?? "Manifest"} · {m.status}
                          {m.owedMinor > 0 ? ` · ${formatMoneyMinor(m.paidMinor)} / ${formatMoneyMinor(m.owedMinor)} paid` : ""}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {step.key === "payment" && trailData.facts.linkAvailable && trailData.manifests.length > 0 ? (
                    <Link href="/admin/vendor-payments" className="mt-1 inline-block text-xs text-emerald-700 hover:underline">
                      Open Vendor payments →
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
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

        {/* Task I (I6): grounded local-market context for every line — best-effort,
            hidden when no CCRS dataset is available. */}
        <PoMarketContextCard lines={po.lines} showMix />

        {/* Task I (I6): advisory AI review — drafts-only, never edits the order. */}
        <PoReviewPanel poId={po.id} aiEnabled={isAiConfigured} />
      </div>
    </div>
  );
}
