"use client";

/**
 * InvoiceCreditForm — Fix 3.4. Add (or void) a credit / discount on a delivery
 * invoice BEFORE paying it.
 *
 * Owner (verbatim): "if the system isnt able to work out if there is a credit
 * or discount, i need a way to add a credit or discount to the invoice before
 * paying for it in the vendor payments page."
 *
 * The amount is typed positive in dollars ("299.70") and stored negative
 * cents. A credit can never exceed what is still owed. Credits are never
 * deleted — voiding keeps the entry with who / when / why.
 */
import { useActionState, useEffect, useState } from "react";
import { Button, Field, Input, Select } from "@/components/admin/ui";
import {
  addInvoiceCreditAction,
  listInvoiceCreditsAction,
  loadPayableOptionsAction,
  voidInvoiceCreditAction,
  type InvoiceCreditResult,
  type InvoiceCreditView,
  type PayableOption,
} from "./actions";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function InvoiceCreditForm() {
  const [payables, setPayables] = useState<PayableOption[] | null>(null);
  const [key, setKey] = useState("");
  const [credits, setCredits] = useState<InvoiceCreditView[]>([]);
  const [addState, addAction, adding] = useActionState<InvoiceCreditResult | null, FormData>(addInvoiceCreditAction, null);
  const [voidState, voidAction, voiding] = useActionState<InvoiceCreditResult | null, FormData>(voidInvoiceCreditAction, null);

  const refresh = (k: string) => {
    loadPayableOptionsAction()
      .then((rows) => setPayables(rows.filter((r) => r.source === "manifest")))
      .catch(() => setPayables([]));
    if (k) listInvoiceCreditsAction(k).then(setCredits).catch(() => setCredits([]));
    else setCredits([]);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload the server lists after each add / void (async fetch)
    refresh(key);
  }, [key, addState?.message, voidState?.message]);

  const selected = (payables ?? []).find((p) => p.key === key);
  const result = addState ?? voidState;

  return (
    <div className="space-y-4" data-testid="invoice-credit-form">
      <form action={addAction} className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-5">
          <Field label="Invoice (delivery manifest)" required>
            <Select name="payableKey" value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="">Select an invoice…</option>
              {(payables ?? []).map((p) => (
                <option key={p.key} value={p.key}>
                  Manifest #{p.manifestNumber} · {p.vendorName} · owe {usd(p.remainingMinorUnits)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Type">
            <Select name="kind" defaultValue="credit">
              <option value="credit">Credit</option>
              <option value="discount">Discount</option>
              <option value="price_reduction">Price reduction</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Amount ($)" required>
            <Input name="amountDollars" inputMode="decimal" placeholder="299.70" />
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field label="Why" required>
            <Input name="reason" placeholder='e.g. "Discount: Credit 1" on the invoice' />
          </Field>
        </div>
        <div className="sm:col-span-12 flex items-center gap-3">
          <Button type="submit" disabled={adding || !key}>
            {adding ? "Saving…" : "Add credit to this invoice"}
          </Button>
          {selected && (
            <span className="text-xs text-[var(--admin-text-muted)]">
              Still owed after credits already on it: {usd(selected.remainingMinorUnits)}
            </span>
          )}
        </div>
      </form>

      {result && (
        <div
          className={`rounded-[var(--admin-radius)] border px-4 py-3 text-sm ${
            result.ok
              ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
              : "border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
          }`}
          role="status"
        >
          {result.ok ? result.message : result.error}
        </div>
      )}

      {key && credits.length > 0 && (
        <ul className="divide-y divide-[var(--admin-border)] rounded-[var(--admin-radius)] border border-[var(--admin-border)] text-sm">
          {credits.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className={c.voided ? "text-[var(--admin-text-faint)] line-through" : "text-[var(--admin-text)]"}>
                {usd(c.amountMinor)} {c.kind.replace("_", " ")} — {c.reason}
                <span className="ml-2 text-xs text-[var(--admin-text-faint)]">{c.at.slice(0, 10)}</span>
                {c.voided && c.voidReason ? <span className="ml-2 text-xs">(voided: {c.voidReason})</span> : null}
              </span>
              {!c.voided && (
                <form action={voidAction} className="flex items-center gap-2">
                  <input type="hidden" name="payableKey" value={key} />
                  <input type="hidden" name="entryId" value={c.id} />
                  <Input name="voidReason" placeholder="Why void it" className="h-8 w-40" />
                  <Button type="submit" variant="neutral" size="sm" disabled={voiding}>
                    Void
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
