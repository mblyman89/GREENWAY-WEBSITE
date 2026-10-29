"use client";

/**
 * src/components/admin/books/ClearBankDepositsPanel.tsx
 *
 * Fix Phase 2.5 (G-14, F-03-3). The owner's control for clearing a store cash
 * deposit: one row per money-in line on the Main operating account, each with
 * its own button. Pressing it says "this line is the sealed bags reaching the
 * bank", and the counted cash in 10400 Undeposited Funds moves to 10200.
 *
 * It shows refusals as plainly as postings. The most likely refusal on day one
 * is "nothing is sitting in Undeposited Funds": that means no bag has been
 * sealed in the system yet, and the sentence says so instead of failing
 * silently.
 */

import { useState, useTransition } from "react";

import { clearBankDepositAction } from "@/app/admin/books/bank/actions";

export type DepositRowView = {
  readonly transactionId: string;
  readonly date: string;
  readonly label: string;
  readonly depositMinor: number;
  readonly alreadyCleared: boolean;
};

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ClearBankDepositsPanel({
  rows,
  readError,
  lookbackDays,
}: {
  rows: readonly DepositRowView[];
  readError: string | null;
  lookbackDays: number;
}) {
  const [results, setResults] = useState<Record<string, { kind: string; sentence: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function clear(id: string) {
    setBusy(id);
    startTransition(async () => {
      const r = await clearBankDepositAction({ transactionId: id });
      setResults((prev) => ({ ...prev, [id]: { kind: r.outcome.kind, sentence: r.sentence } }));
      setBusy(null);
    });
  }

  // Rule 46: a failed read is not "no deposits".
  if (readError !== null) {
    return (
      <p className="rounded-lg border border-rose-400/30 bg-rose-400/[0.06] p-3 text-sm text-rose-200">
        {readError} That is not the same as there being no deposits, so nothing
        here should be taken as an all-clear.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-white/60">
        No money-in lines on a Main operating account in the last {lookbackDays} days.
        If you made a deposit, refresh the bank connection on the Plaid screen, and
        check that the account has the Main operating role.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
        {rows.map((r) => {
          const res = results[r.transactionId];
          const done = r.alreadyCleared || res?.kind === "posted";
          return (
            <li key={r.transactionId} className="space-y-1 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-white/60">{r.date}</span>
                <span className="flex-1 min-w-[160px] text-white/80">{r.label}</span>
                <span className="tabular-nums font-medium text-white">{money(r.depositMinor)}</span>
                {done ? (
                  <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs text-emerald-300">
                    cleared
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => clear(r.transactionId)}
                    disabled={busy !== null}
                    className="rounded-lg bg-emerald-500/90 px-3 py-1 text-xs font-semibold text-black disabled:opacity-40"
                  >
                    {busy === r.transactionId ? "Clearing…" : "Clear against bags"}
                  </button>
                )}
              </div>
              {res ? (
                <p
                  className={
                    res.kind === "posted" ? "text-xs text-emerald-300" : "text-xs text-amber-200"
                  }
                >
                  {res.sentence}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-white/45">
        Only press the button on a line that is store cash from sealed deposit bags.
        A transfer between your own accounts, an ATM settlement or money you put in
        yourself is not till cash and must not be cleared here. This posts straight
        to the ledger: 10200 Bank &mdash; Operating up, 10400 Undeposited Funds down,
        oldest business day first. Pressing twice writes nothing twice.
      </p>
    </div>
  );
}
