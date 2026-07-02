"use client";

/**
 * ManualPaymentForm — record a NON-ACH vendor payment (check / cash / wire /
 * other) against an ACCEPTED manifest so it stops hanging as an open payable.
 *
 * Owner's requirement (verbatim): "If I'm ever required for whatever reason to
 * write a check instead of ach, I need a way to tell the system that I paid via
 * another method. So I dont have hanging invoices."
 *
 * Same guardrails as the ACH flow (server-side checkManifestPayment): overpay
 * BLOCKED, partial WARNED (and allowed), non-accepted / fully-paid BLOCKED. No
 * NACHA file is generated here — this just records that a payment happened.
 * Amount is entered in dollars; the action converts to cents.
 */
import { useActionState, useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import {
  loadPayableOptionsAction,
  recordManualPaymentAction,
  type ManualPaymentResult,
  type PayableOption,
} from "./actions";

function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function ManualPaymentForm() {
  const [payables, setPayables] = useState<PayableOption[] | null>(null);
  const [manifestId, setManifestId] = useState("");
  const [method, setMethod] = useState("check");
  const [amount, setAmount] = useState("");
  const [state, formAction, pending] = useActionState<ManualPaymentResult | null, FormData>(
    recordManualPaymentAction,
    null,
  );

  const load = () => {
    let alive = true;
    loadPayableOptionsAction()
      .then((rows) => {
        if (alive) setPayables(rows);
      })
      .catch(() => {
        if (alive) setPayables([]);
      });
    return () => {
      alive = false;
    };
  };

  useEffect(load, []);

  // After a successful record, the payable list changes (revalidatePath on the
  // server) — refresh the options and reset the form fields.
  useEffect(() => {
    if (state?.ok) {
      load();
      setManifestId("");
      setAmount("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok, state?.message, state?.warning]);

  const byId = useMemo(() => {
    const m = new Map<string, PayableOption>();
    (payables ?? []).forEach((p) => m.set(p.manifestId, p));
    return m;
  }, [payables]);

  const selected = manifestId ? byId.get(manifestId) : undefined;

  const onSelectManifest = (id: string) => {
    setManifestId(id);
    const p = id ? byId.get(id) : undefined;
    // Default amount to the remaining balance (writing a check for the invoice).
    setAmount(p ? dollars(p.remainingMinorUnits) : "");
  };

  const noPayables = payables !== null && payables.length === 0;
  const refRequired = method === "check" || method === "wire";
  const refLabel =
    method === "check"
      ? "Check number"
      : method === "wire"
        ? "Wire confirmation"
        : "Reference (optional)";
  const refPlaceholder =
    method === "check"
      ? "e.g. 1234"
      : method === "wire"
        ? "e.g. FED wire ref"
        : "Optional memo/reference";

  return (
    <form action={formAction} className="space-y-4">
      {noPayables && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          No accepted manifests with an outstanding balance. Recording a payment requires an
          accepted manifest (the invoice) that still owes money.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-12">
        {/* Manifest (invoice) picker */}
        <div className="sm:col-span-5">
          <Field label="Invoice (accepted manifest)" required>
            <Select
              name="manifestId"
              value={manifestId}
              onChange={(e) => onSelectManifest(e.target.value)}
            >
              <option value="">Select an accepted manifest…</option>
              {(payables ?? []).map((opt) => (
                <option key={opt.manifestId} value={opt.manifestId}>
                  #{opt.manifestNumber} · {opt.vendorName} · owe{" "}
                  {centsToUsd(opt.remainingMinorUnits)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Payment method */}
        <div className="sm:col-span-3">
          <Field label="Paid by" required>
            <Select name="paymentMethod" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="wire">Wire</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>

        {/* Reference */}
        <div className="sm:col-span-4">
          <Field label={refLabel} required={refRequired}>
            <Input name="reference" placeholder={refPlaceholder} />
          </Field>
        </div>

        {/* Amount */}
        <div className="sm:col-span-4">
          <Field
            label="Amount ($)"
            required
            help={selected ? `Owe ${centsToUsd(selected.remainingMinorUnits)}` : undefined}
          >
            <Input
              name="amountDollars"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>

        {/* Note */}
        <div className="sm:col-span-8">
          <Field label="Note" help="Optional — anything you want on the record">
            <Textarea name="note" rows={1} placeholder="e.g. Paid at pickup, invoice signed." />
          </Field>
        </div>
      </div>

      {/* Live payable summary */}
      {selected && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--admin-text-muted)]">
          <span>
            Owed (cost basis):{" "}
            <strong className="text-[var(--admin-text)]">{centsToUsd(selected.owedMinorUnits)}</strong>
          </span>
          <span>
            Already paid:{" "}
            <strong className="text-[var(--admin-text)]">{centsToUsd(selected.paidMinorUnits)}</strong>
          </span>
          <span>
            Remaining:{" "}
            <strong className="text-[var(--admin-accent)]">
              {centsToUsd(selected.remainingMinorUnits)}
            </strong>
          </span>
          <span>{selected.lotCount} lot(s)</span>
        </div>
      )}

      <div>
        <Button type="submit" variant="confirm" disabled={pending || noPayables}>
          {pending ? "Recording…" : "Record payment"}
        </Button>
      </div>

      {/* Blocking errors */}
      {state && !state.ok && state.problems.length > 0 && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
          <ul className="space-y-1">
            {state.problems.map((p, k) => (
              <li key={k}>• {p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Partial-payment warning (recorded, balance remains) */}
      {state?.ok && state.warning && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          ⚠ {state.warning}
        </div>
      )}

      {/* Success (paid in full) */}
      {state?.ok && state.message && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          ✓ {state.message}
        </div>
      )}
    </form>
  );
}
