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
import { checkEffectiveDateForTimberland } from "@/lib/payments/timberland-deadline-core";
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
  viewerIsOwner,
  earliestEffective,
  nowIso,
}: {
  settingsComplete: boolean;
  companyName: string;
  /** R41 S0 / D-4: Michael builds the file; Stephen's batch is sent to Michael for approval. */
  viewerIsOwner: boolean;
  /** R41 S5: the earliest effective date Timberland's deadline still allows (computed on the server). */
  earliestEffective: string;
  /** R41 S5: the server clock for the first render (the browser clock after). */
  nowIso: string;
}) {
  const [payables, setPayables] = useState<PayableOption[] | null>(null);
  const [rows, setRows] = useState<Row[]>([{ id: 1, manifestId: "", amount: "" }]);
  const [nextId, setNextId] = useState(2);
  const [state, formAction, pending] = useActionState<VendorPayFormResult | null, FormData>(
    buildVendorAchAction,
    null,
  );

  // R41 S5: default to the earliest workable date (never "today", which is
  // always too late for Timberland), and show the deadline as the date
  // changes. The server checks again when the file is released.
  const [effective, setEffective] = useState(earliestEffective);
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const effectiveCheck = useMemo(() => (effective ? checkEffectiveDateForTimberland(effective, now) : null), [effective, now]);

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

  // Task N: options are keyed by the opaque payable key ("manifest:<id>" /
  // "ncinv:<id>") so a row can pay a manifest OR a merch paper invoice.
  const byId = useMemo(() => {
    const m = new Map<string, PayableOption>();
    (payables ?? []).forEach((p) => m.set(p.key, p));
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
        <Field label="Effective date" help="The day the vendor is paid. Timberland needs the file 2 banking days before, by 4:00 pm Pacific." required>
          <Input type="date" name="effectiveDate" required min={earliestEffective} value={effective} onChange={(e) => setEffective(e.target.value)} />
          {effectiveCheck ? (
            <span
              data-testid="vendor-effective-deadline"
              className={`mt-1 block text-xs ${effectiveCheck.ok ? (effectiveCheck.warning ? "text-[var(--admin-gold)]" : "text-[var(--admin-text-muted)]") : "text-[var(--admin-danger)]"}`}
            >
              {effectiveCheck.ok ? effectiveCheck.warning ?? `Upload and approve at Timberland by ${effectiveCheck.deadline.text}.` : effectiveCheck.error}
            </span>
          ) : null}
        </Field>
        <div className="sm:col-span-2 flex items-end text-xs text-[var(--admin-text-faint)]">
          Originator: {companyName || "(set on Payroll page)"}
        </div>
      </div>

      {noPayables && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          Nothing to pay: no accepted manifests or merch invoices with an outstanding balance.
          Accept an inbound manifest, or enter a vendor invoice on the non-cannabis inventory page.
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
                  <Field label={`Invoice ${i + 1} (manifest or merch invoice)`} required>
                    <Select
                      name="manifestId"
                      value={row.manifestId}
                      onChange={(e) => setManifest(row.id, e.target.value)}
                    >
                      <option value="">Select an invoice…</option>
                      {(payables ?? []).map((opt) => {
                        const remaining = opt.remainingMinorUnits;
                        const disabled = chosen.has(opt.key) && opt.key !== row.manifestId;
                        const tag = opt.source === "noncannabis_invoice" ? "Merch" : "Manifest";
                        return (
                          <option key={opt.key} value={opt.key} disabled={disabled}>
                            {tag} #{opt.manifestNumber} · {opt.vendorName} · owe {centsToUsd(remaining)}
                          </option>
                        );
                      })}
                    </Select>
                  </Field>
                </div>
                {/* SLICE 80: vault-aware banking. When the vault (migration
                    0143) is live, banking is pulled server-side from Settings →
                    the Banking vault — shown masked here, never editable. Pre-0143
                    the legacy manual fields render unchanged. */}
                {p?.vaultReady ? (
                  <div className="sm:col-span-5">
                    <Field label="Bank details (from vault)">
                      {p.vaultBank ? (
                        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-raised,rgba(255,255,255,0.03))] px-3 py-2 text-xs">
                          <span className="font-semibold">{p.vaultBank.bankName || "Bank"}</span>{" "}
                          · routing <span className="font-mono">{p.vaultBank.routingTail}</span>{" "}
                          · acct <span className="font-mono">{p.vaultBank.accountTail}</span>{" "}
                          · {p.vaultBank.accountType}
                          {/* R39 S3: label + payable come from the server's
                              canPayWithVaultRecord gate (vaultPayDisplay), so
                              revoked / archived / unknown never look payable. */}
                          <span
                            className={`ml-2 ${p.vaultBank.payable && p.vaultBank.verified ? "text-[var(--admin-accent)]" : "font-semibold text-[var(--admin-gold)]"}`}
                          >
                            {p.vaultBank.statusLabel}
                          </span>
                          {p.vaultBank.blockedReason ? (
                            <span className="mt-1 block text-[var(--admin-gold)]">{p.vaultBank.blockedReason}</span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-3 py-2 text-xs text-[var(--admin-gold)]">
                          No banking on file — an admin must add it in Admin → Banking before this
                          invoice can be paid by ACH.
                        </div>
                      )}
                    </Field>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
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
                  <span>
                    {p.lotCount} {p.source === "noncannabis_invoice" ? "line(s)" : "lot(s)"}
                    {p.unpricedLotCount > 0 ? (
                      /* D-72: this total is INCOMPLETE. Say so where the money
                         is about to move, not only in the bill engine. */
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
                        {p.unpricedLotCount} lot(s) have no cost yet &mdash; total incomplete
                      </span>
                    ) : null}
                  </span>
                </div>
              )}

              {/* W8: invoice vs linked-PO cross-check (read-only suggestion). */}
              {p?.poComparison.hasPo && (
                <div
                  className={
                    p.poComparison.verdict === "invoice_higher"
                      ? "mt-2 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-3 py-2 text-xs text-[var(--admin-danger)]"
                      : p.poComparison.verdict === "invoice_lower"
                        ? "mt-2 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-3 py-2 text-xs text-[var(--admin-gold)]"
                        : "mt-2 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-3 py-2 text-xs text-[var(--admin-accent)]"
                  }
                >
                  {p.poComparison.verdict === "match" ? "✓ " : "⚠ "}
                  {p.poComparison.message}
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
          {pending ? (viewerIsOwner ? "Generating…" : "Sending…") : viewerIsOwner ? "Generate ACH file" : "Send to Michael for approval"}
        </Button>
      </div>

      {!viewerIsOwner && (
        <div className="space-y-1">
          <label htmlFor="request_note" className="text-xs font-semibold text-[var(--admin-text-muted)]">
            Note for Michael (optional)
          </label>
          <textarea
            id="request_note"
            name="request_note"
            maxLength={1000}
            rows={2}
            className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm"
          />
          <p className="text-xs text-[var(--admin-text-faint)]">
            Only Michael (the owner) builds vendor ACH files. This batch is sent to him; nothing is recorded as paid until he approves it.
          </p>
        </div>
      )}

      {state?.notice && (
        <div role="status" className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
          {state.notice}
        </div>
      )}

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
          {state.uploadBy ? (
            <p className="mt-1 text-xs text-[var(--admin-text)]">Upload and approve at Timberland by {state.uploadBy}.</p>
          ) : null}
          {state.deadlineWarning ? <p className="mt-1 text-xs font-semibold text-[var(--admin-gold)]">{state.deadlineWarning}</p> : null}
          {state.limitWarnings?.map((m, k) => (
            <p key={k} className="mt-1 text-xs text-[var(--admin-gold)]">
              {m}
            </p>
          ))}
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
