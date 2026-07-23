"use client";

/**
 * CounterReturnDesk (POS Slice B16) — receipt-first counter returns.
 *
 * Foolproof flow, in the order the counter conversation actually happens:
 *  1. Type the receipt number off the customer's ORIGINAL receipt (store
 *     policy — no receipt, no return). The server verifies every policy gate
 *     at once: loyalty member attached (B14), completed sale, 15-day window.
 *  2. Pick the exact line + quantity. Refund is computed from the stored
 *     paid price — staff never type a refund amount, so it can't be wrong.
 *  3. Check the physical product (WAC 314-55-079(12) attestations), pick
 *     restock vs destroy, submit.
 *  4. Print the refund receipt (same 576px builder family as the register).
 *
 * The server re-verifies everything; this UI is advisory. Loyalty points are
 * clawed back proportionally and shown in the result panel.
 */
import { useRef, useState, useTransition } from "react";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { CUSTOMER_RETURN_REASONS } from "@/lib/inventory/disposition-core";
import type { CounterReturnSale } from "@/lib/pos/returns-store";
import { lookupReceiptAction, processReturnAction } from "@/app/admin/registers/returns/actions";

const REASON_LABELS: Record<string, string> = {
  defective: "Defective product",
  wrong_item: "Wrong item sold",
  adverse_reaction: "Adverse reaction",
  quality: "Quality complaint",
  mislabeled: "Mislabeled",
  other: "Other (describe below)",
};

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

type DoneState = {
  refundMinor: number;
  pointsClawed: number;
  correctionOperation: "Delete" | "Update";
  receiptHtml: string;
};

export function CounterReturnDesk() {
  const { toast } = useToast();
  const [receipt, setReceipt] = useState("");
  const [errors, setErrors] = useState<string[] | null>(null);
  const [sale, setSale] = useState<CounterReturnSale | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<string>("defective");
  const [detail, setDetail] = useState("");
  const [disposition, setDisposition] = useState<"restock" | "destroy">("destroy");
  const [originalPackaging, setOriginalPackaging] = useState(false);
  const [lotIdLegible, setLotIdLegible] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);
  const [pending, startTransition] = useTransition();
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);

  const selectedLine = sale?.lines.find((l) => l.lineId === lineId) ?? null;
  const refundPreview = selectedLine ? selectedLine.priceMinorUnits * quantity : 0;

  function reset() {
    setReceipt("");
    setErrors(null);
    setSale(null);
    setLineId(null);
    setQuantity(1);
    setReason("defective");
    setDetail("");
    setDisposition("destroy");
    setOriginalPackaging(false);
    setLotIdLegible(false);
    setDone(null);
  }

  function runLookup() {
    const q = receipt.trim();
    if (!q) {
      toast({ tone: "error", message: "Type the receipt number first — it's on the customer's original receipt." });
      return;
    }
    setSale(null);
    setLineId(null);
    setDone(null);
    startTransition(async () => {
      const res = await lookupReceiptAction(q);
      if (!res.ok) {
        setErrors(res.errors);
        return;
      }
      setErrors(null);
      setSale(res.sale);
      if (res.sale.lines.length === 1 && res.sale.lines[0].remainingReturnable > 0) {
        setLineId(res.sale.lines[0].lineId);
        setQuantity(1);
      }
    });
  }

  function submit() {
    if (!sale || !selectedLine) return;
    if (!originalPackaging || !lotIdLegible) {
      toast({
        tone: "error",
        message: "Both WAC 314-55-079(12) checks are required — original packaging AND a fully legible lot ID. If either fails, refuse the return.",
      });
      return;
    }
    startTransition(async () => {
      const res = await processReturnAction({
        receiptNumber: sale.receiptNumber,
        orderLineId: selectedLine.lineId,
        quantity,
        reason,
        detail,
        disposition,
        originalPackaging,
        lotIdLegible,
      });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setDone({
        refundMinor: res.refundMinor,
        pointsClawed: res.pointsClawed,
        correctionOperation: res.correctionOperation,
        receiptHtml: res.receiptHtml,
      });
      toast({ tone: "success", message: `Return logged. Refund ${money(res.refundMinor)} in cash.` });
    });
  }

  function printRefundReceipt() {
    const frame = printFrameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  // ── Result panel ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.07] p-4">
          <p className="text-sm font-semibold text-[var(--admin-accent)]">Return logged — hand the customer their refund.</p>
          <ul className="mt-2 space-y-1 text-sm text-white/80">
            <li>
              Cash to refund: <strong>{money(done.refundMinor)}</strong>
            </li>
            <li>
              Loyalty points adjusted: <strong>{done.pointsClawed > 0 ? `-${done.pointsClawed}` : "none"}</strong>
            </li>
            <li>
              CCRS Sale correction queued: <strong>{done.correctionOperation}</strong> (export it from Inventory →
              Returns &amp; Destruction with the next CCRS upload)
            </li>
          </ul>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={printRefundReceipt}>
            Print refund receipt
          </Button>
          <Button type="button" variant="neutral" onClick={reset}>
            Start another return
          </Button>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white">
          <iframe
            ref={printFrameRef}
            title="Refund receipt"
            srcDoc={done.receiptHtml}
            style={{ width: "100%", height: 520, border: 0, background: "#fff" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Step 1 — receipt lookup */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
          Step 1 · Enter the receipt number (original receipt required)
        </p>
        <div className="flex gap-2">
          <Input
            value={receipt}
            onChange={(e) => setReceipt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runLookup();
              }
            }}
            placeholder="8-character code under the store name, e.g. 14174000"
            maxLength={16}
          />
          <Button type="button" onClick={runLookup} disabled={pending}>
            {pending && !sale ? "Looking up…" : "Look up"}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-white/40">
          Store policy: loyalty members only, original receipt in hand, within 15 days of purchase.
        </p>
      </div>

      {errors && (
        <div className="rounded-xl border border-[#ff6b6b]/40 bg-[#ff6b6b]/[0.06] p-4">
          <p className="text-sm font-semibold text-[#ff6b6b]">This sale can&apos;t be returned:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-white/80">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {sale && (
        <>
          {/* The verified sale */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">Eligible</Badge>
              <span className="font-mono text-sm text-white/70">Receipt {sale.receiptNumber}</span>
              <span className="text-sm text-white/45">· Order #{sale.orderNumber}</span>
            </div>
            <p className="mt-1.5 text-sm text-white/70">
              Member: <strong className="text-white/90">{sale.memberLabel}</strong> · purchased{" "}
              {new Date(sale.purchasedAtIso).toLocaleDateString()} ({sale.daysSincePurchase} day
              {sale.daysSincePurchase === 1 ? "" : "s"} ago,{" "}
              {sale.daysRemaining} day{sale.daysRemaining === 1 ? "" : "s"} left in the window)
            </p>
          </div>

          {/* Step 2 — pick the line */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
              Step 2 · Pick the item being returned
            </p>
            <ul className="space-y-2">
              {sale.lines.map((l) => {
                const isSel = lineId === l.lineId;
                const out = l.remainingReturnable <= 0;
                return (
                  <li key={l.lineId}>
                    <button
                      type="button"
                      disabled={out}
                      onClick={() => {
                        setLineId(l.lineId);
                        setQuantity(1);
                      }}
                      className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                        isSel
                          ? "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/[0.08]"
                          : "border-white/10 bg-white/[0.02] hover:border-white/25"
                      } ${out ? "opacity-40" : ""}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-white/90">{l.productName}</span>
                        <span className="text-white/60">{money(l.priceMinorUnits)} each</span>
                      </div>
                      <div className="mt-0.5 text-xs text-white/45">
                        bought {l.quantity}
                        {l.alreadyReturned > 0 ? ` · already returned ${l.alreadyReturned}` : ""}
                        {out ? " · fully returned" : ` · up to ${l.remainingReturnable} returnable`}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Step 3 — verify, attest, submit */}
          {selectedLine && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
                Step 3 · Check the product, then log the return
              </p>

              <div className="rounded-lg border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/[0.05] px-3 py-2.5 text-xs text-white/75">
                <p className="font-semibold text-[var(--admin-gold)]">Check the physical product first (WAC 314-55-079(12)):</p>
                <label className="mt-2 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={originalPackaging}
                    onChange={(e) => setOriginalPackaging(e.target.checked)}
                  />
                  <span>
                    The product is in its <strong>original packaging</strong>.
                  </span>
                </label>
                <label className="mt-1.5 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={lotIdLegible}
                    onChange={(e) => setLotIdLegible(e.target.checked)}
                  />
                  <span>
                    The <strong>lot / batch / inventory ID on the package is fully legible</strong>. If it is not, you
                    must refuse the return.
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Quantity" help={`Max ${selectedLine.remainingReturnable}`} required>
                  <Select
                    value={String(quantity)}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  >
                    {Array.from({ length: selectedLine.remainingReturnable }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Refund (auto)" help="Exactly what they paid">
                  <Input value={money(refundPreview)} readOnly />
                </Field>
                <Field label="Reason" required>
                  <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                    {CUSTOMER_RETURN_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {REASON_LABELS[r] ?? r}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="What happens to it" required>
                  <Select
                    value={disposition}
                    onChange={(e) => setDisposition(e.target.value === "restock" ? "restock" : "destroy")}
                  >
                    <option value="destroy">Destroy (opens hold)</option>
                    <option value="restock">Restock (sellable)</option>
                  </Select>
                </Field>
              </div>

              <Field label="Detail" help="Why it was returned — this goes on the CCRS adjustment record.">
                <Textarea
                  rows={2}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Condition, customer complaint, disposition notes…"
                />
              </Field>

              <p className="text-xs text-white/40">
                Logging this refunds <strong className="text-white/70">{money(refundPreview)}</strong> in cash, adds the
                quantity back to inventory (CCRS adjustment), queues the Sale correction for your next CCRS upload,
                claws back the proportional loyalty points, and prints a refund receipt.
              </p>
              <Button type="button" onClick={submit} disabled={pending}>
                {pending ? "Processing…" : "Log return & refund"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
