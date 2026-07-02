"use client";

/**
 * VendorAchForm (E9 + B6) — client form for paying ACCEPTED manifests via ACH.
 *
 * B6: each row now selects an ACCEPTED inbound manifest (the "invoice"). We show
 * its owed / already-paid / remaining totals (CCRS cost basis) and default the
 * amount to the remaining balance. The server guardrails BLOCK overpayment and
 * WARN on partial payment. Bank routing/account/type are entered per row.
 *
 * Amounts entered in dollars; the action converts to cents. The generated NACHA
 * file is offered as a client-side download. Nothing is transmitted.
 */
import { useActionState, useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Select } from "@/components/admin/ui";
import {
  buildVendorAchAction,
  loadPayableOptionsAction,
  type PayableOption,
  type VendorPayFormResult,
} from "./actions";

type Row = { id: number; manifestId: string; amount: string };

function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function VendorAchForm({
  settingsComplete,
  companyName,
}: {
  settingsComplete: boolean;
  companyName: string;
}) {
  const [payables, setPayables] = useState<PayableOption[] | null>(null);
  const [rows, setRows] = useState<Row[]>([{ id: 1, manifestId: "", amount: "" }]);
  const [nextId, setNextId] = useState(2);
  const [state, formAction, pending] = useActionState<VendorPayFormResult | null, FormData>(
    buildVendorAchAction,
    null,
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
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
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, PayableOption>();
    (payables ?? []).forEach((p) => m.set(p.manifestId, p));
    return m;
  }, [payables]);

  // Manifest ids already chosen on other rows (so we don't double-select).
  const chosen = useMemo(() => new Set(rows.map((r) => r.manifestId).filter(Boolean)), [rows]);

  const addRow = () => {
    setRows((r) => [...r, { id: nextId, manifestId: "", amount: "" }]);
    setNextId((n) => n + 1);
  };
  const removeRow = (id: number) =>
    setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));

  const setManifest = (id: number, manifestId: string) =>
    setRows((r) =>
      r.map((row) => {
        if (row.id !== id) return row;
        const p = manifestId ? byId.get(manifestId) : undefined;
        // Default the amount to the remaining balance when a manifest is picked.
        const amount = p ? dollars(p.remainingMinorUnits) : "";
        return { ...row, manifestId, amount };
      }),
    );
  const setAmount = (id: number, amount: string) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, amount } : row)));

  const download = () => {
    if (!state?.file || !state.filename) return;
    const blob = new Blob([state.file], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const problemFor = (index: number) => state?.problems?.filter((p) => p.index === index) ?? [];
  const warningFor = (index: number) => state?.warnings?.filter((w) => w.index === index) ?? [];

  const noPayables = payables !== null && payables.length === 0;

  return (
    <form action={formAction} className="space-y-5">
      {/* Effective date + originator */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Effective date" help="When funds should settle">
          <Input type="date" name="effectiveDate" defaultValue={today} />
        </Field>
        <div className="sm:col-span-2 flex items-end text-xs text-[var(--admin-text-faint)]">
          Originator: {companyName || "(set on Payroll page)"}
        </div>
      </div>

      {noPayables && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          No accepted manifests with an outstanding balance. A vendor payment must be married to an
          accepted manifest (the invoice); accept an inbound manifest first.
        </div>
      )}

      {/* Rows */}
      <div className="space-y-3">
        {rows.map((row, i) => {
          const probs = problemFor(i + 1);
          const warns = warningFor(i + 1);
          const p = row.manifestId ? byId.get(row.manifestId) : undefined;
          return (
            <div
              key={row.id}
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3"
            >
              <div className="grid gap-3 sm:grid-cols-12">
                {/* Manifest (invoice) picker */}
                <div className="sm:col-span-5">
                  <Field label={`Invoice ${i + 1} (accepted manifest)`} required>
                    <Select
                      name="manifestId"
                      value={row.manifestId}
                      onChange={(e) => setManifest(row.id, e.target.value)}
                    >
                      <option value="">Select an accepted manifest…</option>
                      {(payables ?? []).map((opt) => {
                        const remaining = opt.remainingMinorUnits;
                        const disabled = chosen.has(opt.manifestId) && opt.manifestId !== row.manifestId;
                        return (
                          <option key={opt.manifestId} value={opt.manifestId} disabled={disabled}>
                            #{opt.manifestNumber} · {opt.vendorName} · owe {centsToUsd(remaining)}
                          </option>
                        );
                      })}
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Routing #">
                    <Input name="routing" inputMode="numeric" placeholder="9-digit ABA" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Account #">
                    <Input name="accountNumber" placeholder="≤ 17 chars" />
                  </Field>
                </div>
                <div className="sm:col-span-1">
                  <Field label="Type">
                    <Select name="accountType" defaultValue="checking">
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </Select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Amount ($)" help={p ? `Owe ${centsToUsd(p.remainingMinorUnits)}` : undefined}>
                    <Input
                      name="amountDollars"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={(e) => setAmount(row.id, e.target.value)}
                    />
                  </Field>
                </div>
              </div>

              {/* Payable summary (cost-basis owed / paid / remaining) */}
              {p && (
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--admin-text-muted)]">
                  <span>
                    Owed (cost basis): <strong className="text-[var(--admin-text)]">{centsToUsd(p.owedMinorUnits)}</strong>
                  </span>
                  <span>
                    Already paid: <strong className="text-[var(--admin-text)]">{centsToUsd(p.paidMinorUnits)}</strong>
                  </span>
                  <span>
                    Remaining: <strong className="text-[var(--admin-accent)]">{centsToUsd(p.remainingMinorUnits)}</strong>
                  </span>
                  <span>{p.lotCount} lot(s)</span>
                </div>
              )}

              {warns.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[var(--admin-gold)]">
                  {warns.map((w, k) => (
                    <li key={k}>⚠ {w.message}</li>
                  ))}
                </ul>
              )}
              {probs.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[var(--admin-danger)]">
                  {probs.map((pr, k) => (
                    <li key={k}>• {pr.message}</li>
                  ))}
                </ul>
              )}

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="text-xs text-[var(--admin-text-faint)] hover:text-[var(--admin-danger)]"
                >
                  Remove row
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="neutral" size="sm" onClick={addRow} disabled={noPayables}>
          + Add invoice
        </Button>
        <Button type="submit" variant="primary" disabled={pending || !settingsComplete || noPayables}>
          {pending ? "Generating…" : "Generate ACH file"}
        </Button>
      </div>

      {/* File-level problems */}
      {state?.problems?.some((p) => p.index === null) && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
          <ul className="space-y-1">
            {state.problems
              .filter((p) => p.index === null)
              .map((p, k) => (
                <li key={k}>• {p.message}</li>
              ))}
          </ul>
        </div>
      )}

      {/* Success → download */}
      {state?.file && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          <p className="font-semibold">
            ACH file ready · {state.entryCount} payment(s) ·{" "}
            {typeof state.totalCents === "number" ? centsToUsd(state.totalCents) : ""}
          </p>
          {state.warnings && state.warnings.length > 0 && (
            <p className="mt-1 text-xs text-[var(--admin-gold)]">
              {state.warnings.length} partial payment(s) included — balances remain outstanding.
            </p>
          )}
          <div className="mt-2">
            <Button type="button" variant="confirm" size="sm" onClick={download}>
              Download {state.filename}
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
            Upload this file in your bank&apos;s ACH portal. Nothing is transmitted from here.
          </p>
        </div>
      )}
    </form>
  );
}
