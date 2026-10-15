"use client";

/**
 * R41 S9: pick or paste a file, see every check in words. The result lives in
 * this browser tab only; nothing is saved.
 */
import { useActionState } from "react";
import type { CheckerState } from "./actions";

type Check = (prev: CheckerState, fd: FormData) => Promise<CheckerState>;
type Practice = (prev: CheckerState) => Promise<CheckerState>;

const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50";
const btnGhost = "rounded-[var(--admin-radius)] border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.06] disabled:opacity-50";

function usd(c: number): string {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Result({ state }: { state: CheckerState }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
        {state.error}
      </p>
    );
  }
  const r = state.result;
  const f = r.facts;
  return (
    <div data-checker-result={r.ok ? "pass" : "fail"} className="space-y-3">
      {r.ok ? (
        <p className="rounded-[var(--admin-radius)] border border-emerald-500/40 bg-emerald-500/[0.10] px-4 py-3 text-base font-semibold text-emerald-300">
          {state.practice ? "\u2713 The practice file passes every check. (Never upload it: it is not a released file.)" : "\u2713 This file passes every check. You can upload it to Timberland."}
        </p>
      ) : (
        <p role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-base font-semibold text-red-300">
          Do NOT upload this file. {r.problems.length} problem{r.problems.length === 1 ? "" : "s"} found.
        </p>
      )}
      <p className="text-xs text-white/40">Checked: {state.source}.</p>
      {r.problems.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-red-200">
          {r.problems.map((p, i) => <li key={`${p.rule}-${i}`} data-rule={p.rule}>{p.message}</li>)}
        </ul>
      ) : null}
      {r.warnings.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">
          {r.warnings.map((w, i) => <li key={`${w.rule}-${i}`} data-rule={w.rule}>{w.message}</li>)}
        </ul>
      ) : null}
      {r.passed.length ? (
        <ul className="space-y-1 text-sm text-emerald-300/80">
          {r.passed.map((p, i) => <li key={i}>{"\u2713"} {p}</li>)}
        </ul>
      ) : null}
      <p className="text-xs text-white/50">
        {f.records} records, {f.batches} batch{f.batches === 1 ? "" : "es"}, {f.entries} entr{f.entries === 1 ? "y" : "ies"}, {usd(f.totalCreditCents)} in credits
        {f.effectiveDate ? `, effective ${f.effectiveDate}` : ""}
        {f.kind ? `, ${f.kind.replace("_", " ")}` : ""}
        {f.ledgerFile ? `. Ledger: ${f.ledgerFile.filename} (${f.ledgerFile.status.replace("_", " ")}).` : "."}
      </p>
    </div>
  );
}

export function CheckerForm({ check, practice }: { check: Check; practice: Practice }) {
  const [state, action, pending] = useActionState<CheckerState, FormData>(check, null);
  const [pState, pAction, pPending] = useActionState<CheckerState>(practice, null);
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-3">
        <label className="block text-sm text-white/80">
          The file you downloaded from ACH operations
          <input type="file" name="file" accept=".ach,.txt,text/plain" className="mt-1 block text-sm text-white/70" />
        </label>
        <details className="text-sm text-white/60">
          <summary className="cursor-pointer">Or paste the file&apos;s text</summary>
          <textarea name="text" rows={8} spellCheck={false} autoComplete="off" className="mt-2 w-full rounded-[var(--admin-radius)] border border-white/15 bg-black/30 p-2 font-mono text-xs text-white/80" />
        </details>
        <button className={btnPrimary} disabled={pending}>{pending ? "Checking\u2026" : "Check this file"}</button>
      </form>
      <Result state={state} />
      <form action={pAction} className="border-t border-white/10 pt-4">
        <p className="mb-2 text-sm text-white/60">Practice run: build a $0 file from your real company settings and check it, so you see what a passing file looks like. Nothing is saved or sent.</p>
        <button className={btnGhost} disabled={pPending}>{pPending ? "Building\u2026" : "Practice run"}</button>
      </form>
      <Result state={pState} />
    </div>
  );
}
