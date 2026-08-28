"use client";

/**
 * src/components/admin/books/RecordBankExpensesPanel.tsx
 *
 * books-88 (D-70). The control that turns a connected bank or ATM account's
 * settled charges into draft journal entries.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 *
 * It reports REFUSALS as prominently as successes, and it does not round them
 * up into a count. The classifier is measured at 54 of 60 of Michael's real
 * vendors; the other six refuse by name rather than guess an account. If this
 * panel showed "12 recorded" and quietly dropped "3 refused", the six unmapped
 * vendors would be invisible and the books would be silently incomplete - which
 * is the exact failure the bank page's own warning text is about: a
 * reconciliation that ties while an expense is missing.
 *
 * It also states, on the face of it, that nothing has been posted. Everything
 * this creates is a draft awaiting approval. A screen that says "recorded" and
 * lets the owner believe the books are updated would be lying by omission.
 */

import { useState, useTransition } from "react";

import { recordBankExpensesAction } from "@/app/admin/books/bank/actions";
import type { BankExpenseRunResult } from "@/lib/accounting/bank-expense-service";

export type BankAccountChoice = {
  readonly accountId: string;
  readonly label: string;
  /** Owner-assigned role. null means the account cannot be posted from yet. */
  readonly role: string | null;
  /** True when `role` maps to a chart account (main / atm / credit). */
  readonly postable: boolean;
};

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function RecordBankExpensesPanel({
  accounts,
}: {
  accounts: readonly BankAccountChoice[];
}) {
  const [selected, setSelected] = useState<string>(
    accounts.find((a) => a.postable)?.accountId ?? "",
  );
  const [result, setResult] = useState<BankExpenseRunResult | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = accounts.find((a) => a.accountId === selected) ?? null;

  function run() {
    setResult(null);
    startTransition(async () => {
      const r = await recordBankExpensesAction({ plaidAccountId: selected });
      setResult(r);
    });
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/60">
        No bank accounts are connected yet. Connect one on the Plaid screen and give
        it a role, and its charges can be filed here.
      </div>
    );
  }

  const refusals = (result?.outcomes ?? []).filter((o) => o.kind === "refused");
  const recorded = (result?.outcomes ?? []).filter((o) => o.kind === "recorded");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[240px] text-sm">
          <span className="mb-1 block text-white/60">Account</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-[#11161d] px-3 py-2 text-sm text-white"
          >
            <option value="">Choose an account…</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.label}
                {a.postable ? "" : " — no role assigned"}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={run}
          disabled={pending || selected === ""}
          className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {pending ? "Reading…" : "File charges as drafts"}
        </button>
      </div>

      {/* An account with no role cannot be posted from, and the reason is worth
          stating BEFORE the button is pressed rather than as a refusal after. */}
      {chosen && !chosen.postable && (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-sm text-amber-200/90">
          This account has not been told what it is yet. Open the Plaid screen and
          give it a role — Main operating, ATM, or Credit card — so the system knows
          which account on the books it stands for. Nothing will be written until
          then.
        </p>
      )}

      <p className="text-xs text-white/45">
        This reads charges that have already settled and files each one as a{" "}
        <strong className="text-white/70">draft</strong>. Nothing is posted to the
        ledger here. Drafts wait for you on the approvals screen.
      </p>

      {result && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          {result.error && (
            <p className="text-sm text-rose-300">{result.error}</p>
          )}

          <p className="text-sm text-white/75">
            Read {result.scanned} charge{result.scanned === 1 ? "" : "s"}:{" "}
            <strong className="text-emerald-300">{result.recorded} filed as drafts</strong>,{" "}
            {result.duplicates} already recorded,{" "}
            <strong className={result.refused > 0 ? "text-amber-300" : "text-white/60"}>
              {result.refused} refused
            </strong>
            .
          </p>

          {/* Refusals FIRST. They are the ones that need a human. */}
          {refusals.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                Not filed — these need you
              </h4>
              <ul className="space-y-1.5">
                {refusals.map((o) => (
                  <li
                    key={o.transactionId}
                    className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-2.5 text-sm"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium text-white/85">{o.merchant}</span>
                      <span className="text-white/60">{money(o.amountCents)}</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-200/80">
                      {"message" in o ? o.message : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recorded.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                Filed as drafts
              </h4>
              <ul className="space-y-1">
                {recorded.map((o) => (
                  <li
                    key={o.transactionId}
                    className="flex flex-wrap justify-between gap-2 text-sm text-white/70"
                  >
                    <span>{o.merchant}</span>
                    <span className="text-white/50">
                      {money(o.amountCents)}
                      {"outcome" in o && o.outcome === "duplicate"
                        ? " — already recorded"
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.recorded > 0 && (
            <a
              href="/admin/books/drafts"
              className="inline-block text-sm font-semibold text-emerald-300 hover:underline"
            >
              Review and approve them →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
