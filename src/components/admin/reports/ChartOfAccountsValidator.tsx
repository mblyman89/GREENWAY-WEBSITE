"use client";

/**
 * ChartOfAccountsValidator — Slice 73 [items 1 + 13]
 *
 * For an uploaded Sage 50 Chart of Accounts (CHART.CSV), cross-checks the
 * store's configured GL account mappings against the accounts that actually
 * exist in the CoA. Sage REQUIRES every G/L account used in an import to
 * already exist, so this catches a would-be import failure before it happens.
 *
 * Grounded — it reads the real uploaded file and the real AccountingSettings;
 * it never guesses account existence.
 */
import { useState, useTransition } from "react";
import { validateChartOfAccountsAction } from "@/app/admin/reports/accounting/sage-actions";
import type { ChartValidationOutcome } from "@/lib/accounting/sage-helper";

export function ChartOfAccountsValidator({ uploadId }: { uploadId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ChartValidationOutcome | null>(null);

  function run() {
    setResult(null);
    start(async () => {
      const r = await validateChartOfAccountsAction(uploadId);
      setResult(r);
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/20 disabled:opacity-50"
      >
        {pending ? "Checking…" : "Validate GL mappings against this CoA"}
      </button>

      {result && !result.ok && (
        <p className="mt-2 text-[11px] text-[var(--admin-orange)]">{result.error}</p>
      )}

      {result && result.ok && (
        <div className="mt-2 space-y-2 text-[11px]">
          <p className="text-white/60">
            Parsed <strong className="text-white/80">{result.accountsInCoa}</strong> accounts.{" "}
            {result.validation.allValid ? (
              <span className="text-[var(--admin-green)]">All mapped GL accounts exist and are active. ✓</span>
            ) : (
              <span className="text-[var(--admin-orange)]">Issues found — see below.</span>
            )}
          </p>

          {result.validation.missing.length > 0 && (
            <div className="rounded border border-[var(--admin-orange)]/30 bg-[var(--admin-orange)]/5 px-2 py-1.5">
              <p className="font-semibold text-[var(--admin-orange)]">Not found in this Chart of Accounts:</p>
              <ul className="mt-1 list-disc pl-4 text-white/70">
                {result.validation.missing.map((m) => (
                  <li key={m.label}>
                    {m.label}: <span className="font-mono">{m.accountId}</span> — add this account in Sage or fix the mapping.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.validation.inactive.length > 0 && (
            <div className="rounded border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 px-2 py-1.5">
              <p className="font-semibold text-[var(--admin-gold)]">Mapped but marked INACTIVE:</p>
              <ul className="mt-1 list-disc pl-4 text-white/70">
                {result.validation.inactive.map((m) => (
                  <li key={m.label}>
                    {m.label}: <span className="font-mono">{m.accountId}</span> ({m.description || "no description"})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.validation.allValid && result.validation.checks.length > 0 && (
            <ul className="list-disc pl-4 text-white/50">
              {result.validation.checks.map((c) => (
                <li key={c.label}>
                  {c.label}: <span className="font-mono text-white/70">{c.accountId}</span>{" "}
                  {c.description ? `— ${c.description}` : ""} {c.typeLabel ? `(${c.typeLabel})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
