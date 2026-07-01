"use client";

/**
 * VendorAchForm (E9) — client form for entering vendor payment rows and
 * generating a NACHA (CCD) draft via the buildVendorAchAction server action.
 * Mirrors the payroll ACH flow. Amounts entered in dollars; the action converts
 * to cents. The generated file is offered as a client-side download.
 */
import { useActionState, useMemo, useState } from "react";
import { Button, Field, Input } from "@/components/admin/ui";
import { buildVendorAchAction, type VendorPayFormResult } from "./actions";

type Row = { id: number };

function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function VendorAchForm({
  settingsComplete,
  companyName,
}: {
  settingsComplete: boolean;
  companyName: string;
}) {
  const [rows, setRows] = useState<Row[]>([{ id: 1 }, { id: 2 }]);
  const [nextId, setNextId] = useState(3);
  const [state, formAction, pending] = useActionState<VendorPayFormResult | null, FormData>(
    buildVendorAchAction,
    null,
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const addRow = () => {
    setRows((r) => [...r, { id: nextId }]);
    setNextId((n) => n + 1);
  };
  const removeRow = (id: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));

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

  const problemFor = (index: number) =>
    state?.problems?.filter((p) => p.index === index) ?? [];

  return (
    <form action={formAction} className="space-y-5">
      {/* Effective date */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Effective date" help="When funds should settle">
          <Input type="date" name="effectiveDate" defaultValue={today} />
        </Field>
        <div className="sm:col-span-2 flex items-end text-xs text-[var(--admin-text-faint)]">
          Originator: {companyName || "(set on Payroll page)"}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-3">
        {rows.map((row, i) => {
          const probs = problemFor(i + 1);
          return (
            <div
              key={row.id}
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3"
            >
              <div className="grid gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <Field label={`Vendor ${i + 1}`}>
                    <Input name="vendorName" placeholder="Vendor legal / DBA name" />
                  </Field>
                </div>
                <div className="sm:col-span-3">
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
                    <select
                      name="accountType"
                      defaultValue="checking"
                      className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-sm text-[var(--admin-text)]"
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Amount ($)">
                    <Input name="amountDollars" inputMode="decimal" placeholder="0.00" />
                  </Field>
                </div>
              </div>
              {probs.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[var(--admin-danger)]">
                  {probs.map((p, k) => (
                    <li key={k}>• {p.message}</li>
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
        <button
          type="button"
          onClick={addRow}
          className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-sm text-[var(--admin-text-muted)] hover:bg-white/5"
        >
          + Add vendor
        </button>
        <Button type="submit" disabled={pending || !settingsComplete}>
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
          <button
            type="button"
            onClick={download}
            className="mt-2 rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-xs font-semibold text-black transition hover:brightness-110"
          >
            Download {state.filename}
          </button>
          <p className="mt-2 text-xs text-[var(--admin-text-faint)]">
            Upload this file in your bank&apos;s ACH portal. Nothing is transmitted from here.
          </p>
        </div>
      )}
    </form>
  );
}
