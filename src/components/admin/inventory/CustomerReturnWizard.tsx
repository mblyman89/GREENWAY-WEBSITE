"use client";

/**
 * CustomerReturnWizard (Task Q) — guided, compliant customer-return intake.
 *
 * Flow: search a COMPLETED sale (order # / customer name / phone) → pick the
 * exact sale line → attest to WAC 314-55-079(12) conditions (original
 * packaging + legible lot ID) → choose restock vs destroy → submit.
 *
 * The server then: posts a positive "return" inventory adjustment (CCRS
 * reason "Other" per the CCRS FAQ), queues the Sale correction row
 * (Delete for a full-line return, Update for a partial), and — if destroying —
 * opens a destruction event, all in one step.
 */
import { useState, useTransition } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  findReturnableLinesAction,
  createCustomerReturnAction,
} from "@/app/admin/inventory/disposition/actions";
import type { ReturnableOrderLine } from "@/lib/inventory/disposition";
import { CUSTOMER_RETURN_REASONS } from "@/lib/inventory/disposition-core";

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

export function CustomerReturnWizard() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ReturnableOrderLine[] | null>(null);
  const [selected, setSelected] = useState<ReturnableOrderLine | null>(null);
  const [pending, startTransition] = useTransition();

  function runSearch() {
    const q = search.trim();
    if (q.length < 2) {
      toast({ tone: "error", message: "Type at least 2 characters (order #, name, or phone)." });
      return;
    }
    setSelected(null);
    startTransition(async () => {
      const res = await findReturnableLinesAction(q);
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setResults(res.lines);
      if (res.lines.length === 0) {
        toast({ tone: "error", message: "No completed sales matched. Only completed orders can be returned." });
      }
    });
  }

  const remaining = selected
    ? Math.max(0, selected.quantity - selected.already_returned)
    : 0;

  return (
    <div className="space-y-4">
      {/* Step 1 — find the sale */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
          Step 1 · Find the original sale
        </p>
        <div className="flex gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Order #, customer name, or phone…"
          />
          <Button type="button" onClick={runSearch} disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-white/40">
          Only completed sales are returnable. The receipt&apos;s order number is the fastest lookup.
        </p>
      </div>

      {/* Step 2 — pick the line */}
      {results && results.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
            Step 2 · Pick the exact item being returned
          </p>
          <ul className="space-y-2">
            {results.map((l) => {
              const rem = Math.max(0, l.quantity - l.already_returned);
              const isSel = selected?.line_id === l.line_id;
              return (
                <li key={l.line_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(l)}
                    disabled={rem <= 0}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                      isSel
                        ? "border-[#7ed957]/60 bg-[#7ed957]/[0.08]"
                        : "border-white/10 bg-white/[0.02] hover:border-white/25"
                    } ${rem <= 0 ? "opacity-40" : ""}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-white/90">{l.product_name}</span>
                      <span className="font-mono text-xs text-white/45">#{l.order_number}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-white/45">
                      {l.customer_name} · qty {l.quantity} @ {money(l.price_minor_units)} ·{" "}
                      {new Date(l.completed_at ?? l.placed_at).toLocaleDateString()}
                      {l.already_returned > 0 ? ` · already returned ${l.already_returned}` : ""}
                      {rem <= 0 ? " · fully returned" : ""}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Step 3 — attest + submit */}
      {selected && remaining > 0 && (
        <form action={createCustomerReturnAction} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
            Step 3 · Verify, attest, and log the return
          </p>
          <input type="hidden" name="order_id" value={selected.order_id} />
          <input type="hidden" name="order_line_id" value={selected.line_id} />

          <div className="rounded-lg border border-[#ffd700]/25 bg-[#ffd700]/[0.05] px-3 py-2.5 text-xs text-white/75">
            <p className="font-semibold text-[#ffd700]">Check the physical product first (WAC 314-55-079(12)):</p>
            <label className="mt-2 flex items-start gap-2">
              <input type="checkbox" name="original_packaging" className="mt-0.5" required />
              <span>The product is in its <strong>original packaging</strong>.</span>
            </label>
            <label className="mt-1.5 flex items-start gap-2">
              <input type="checkbox" name="lot_id_legible" className="mt-0.5" required />
              <span>
                The <strong>lot / batch / inventory ID on the package is fully legible</strong>. If it is not, you must
                refuse the return.
              </span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Quantity" help={`Max ${remaining}`} required>
              <Input
                name="quantity"
                type="number"
                step="any"
                min="0"
                max={remaining}
                defaultValue={remaining === 1 ? "1" : ""}
                required
              />
            </Field>
            <Field label="Refund ($)" help="What you refunded">
              <Input name="refund_dollars" type="number" step="0.01" min="0" defaultValue="0.00" />
            </Field>
            <Field label="Reason" required>
              <Select name="reason" required defaultValue="defective">
                {CUSTOMER_RETURN_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {REASON_LABELS[r] ?? r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What happens to it" required>
              <Select name="disposition" required defaultValue="destroy">
                <option value="destroy">Destroy (opens hold)</option>
                <option value="restock">Restock (sellable)</option>
              </Select>
            </Field>
          </div>

          <Field label="Detail" help="Why it was returned — this goes on the CCRS adjustment record.">
            <Textarea name="detail" rows={2} placeholder="Condition, customer complaint, disposition notes…" />
          </Field>

          <p className="text-xs text-white/40">
            Logging this will add the quantity back to inventory as a CCRS &ldquo;Other&rdquo; adjustment, queue the Sale{" "}
            {remaining >= selected.quantity && selected.already_returned === 0 ? "Delete" : "correction"} for your next
            CCRS upload{" "}
            {"—"} and, if destroying, open a destruction event with the hold timer.
          </p>
          <Button type="submit">Log customer return</Button>
        </form>
      )}
    </div>
  );
}
