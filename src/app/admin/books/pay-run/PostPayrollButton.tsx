/**
 * src/app/admin/books/pay-run/PostPayrollButton.tsx   (slice books-86)
 *
 * The control that finally connects payroll to the books, and the panel that
 * explains itself when it will not.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE REFUSALS ARE THE MAIN FEATURE HERE, NOT THE BUTTON
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, verbatim:
 *
 *   "not just block, but explain why, and even better, show me a way to do it
 *    properly"
 *   "I want check lists and blockers if things are right. I want it to tell me
 *    how to do it properly if I mess it up."
 *
 * So a refusal is never a red toast that disappears. Every one is rendered with
 * what happened AND the next step, and ALL of them are shown rather than the
 * first — fixing one thing only to be told about the next is the drip-feed that
 * makes software feel like it is arguing with you.
 *
 * The button states plainly that this posts a DRAFT. Payroll is deliberately
 * never auto-posted, so nothing here is final: the entry goes to Waiting to
 * Post and is approved separately. Saying so on the button removes the fear
 * that makes people avoid the one control that keeps the books current.
 */

"use client";

import { useState, useTransition } from "react";

import { postPayrollAction } from "./actions";
import type { PayrollPostOutcome } from "@/lib/accounting/payroll-posting-service";

type Refusal = {
  readonly code: string;
  readonly message: string;
  readonly whatToDo: string;
};

export function PostPayrollButton({
  periodId,
  disabledReason,
  refusals,
  acknowledgements,
}: {
  readonly periodId: string;
  /**
   * Why posting is not available, or null when it is. Computed on the server by
   * the same pure function that decides the real thing, so this cannot promise
   * something the write would refuse.
   */
  readonly disabledReason: string | null;
  readonly refusals: readonly Refusal[];
  readonly acknowledgements: readonly string[];
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<PayrollPostOutcome | null>(null);

  function submit() {
    startTransition(async () => {
      setOutcome(await postPayrollAction(periodId));
    });
  }

  return (
    <div className="space-y-4">
      {disabledReason === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Posting…" : "Post this payroll to the books"}
          </button>
          <span className="text-xs text-[var(--admin-text-faint)]">
            This records the wages, the tax you withheld and your own payroll taxes as a
            draft entry. Nothing is final until you approve it under Waiting to Post, and
            no money moves.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-[var(--admin-radius-sm)] border border-white/15 px-4 py-2 text-sm font-semibold text-[var(--admin-text-dim)]"
          >
            Post this payroll to the books
          </button>
          <span className="text-xs text-[var(--admin-text-faint)]">{disabledReason}</span>
        </div>
      )}

      {/* WHY IT WILL NOT POST — all of them, each with its next step. */}
      {refusals.length > 0 ? (
        <div className="space-y-3">
          {refusals.map((r) => (
            <div
              key={`${r.code}-${r.message}`}
              className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] p-4"
            >
              <p className="text-sm font-semibold text-[var(--admin-orange)]">{r.message}</p>
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">{r.whatToDo}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Things that are true and worth reading before posting. */}
      {acknowledgements.length > 0 ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-gold)]">
            Worth reading before you post
          </p>
          <ul className="mt-2 space-y-1">
            {acknowledgements.map((a) => (
              <li key={a} className="text-sm text-[var(--admin-text-muted)]">
                {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* WHAT HAPPENED. Success and failure are equally explicit. */}
      {outcome !== null ? (
        <div
          className={`rounded-[var(--admin-radius-lg)] border p-4 ${
            outcome.ok
              ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]"
              : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]"
          }`}
        >
          <p
            className={`text-sm font-semibold ${
              outcome.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"
            }`}
          >
            {outcome.message}
          </p>
          {!outcome.ok && outcome.whatToDo ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">{outcome.whatToDo}</p>
          ) : null}
          {outcome.ok && outcome.journalNo !== null ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              Entry number {outcome.journalNo}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
