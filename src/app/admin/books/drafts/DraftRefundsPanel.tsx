"use client";

/**
 * src/app/admin/books/drafts/DraftRefundsPanel.tsx  (Fix Phase 2.8 · G-48 · F-15-14)
 *
 * THE BUTTON for census row revenue_and_tax_collected.refund_or_return.
 *
 * G-48, verbatim: "a daily draft journal for customer refunds (debit 50910
 * Returns & Refunds and the tax liabilities as applicable, credit cash)
 * awaiting owner approval".
 *
 * Pressing "Draft refunds" writes a DRAFT only. It then appears in the list
 * below like every other draft and only the owner's Post makes it history.
 * Pressing it twice for the same day writes nothing the second time.
 */
import { useState, useTransition } from "react";

import { draftRefundsAction } from "./actions";
import type { RefundDraftOutcome } from "@/lib/accounting/refund-posting-service";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function DraftRefundsPanel({ defaultDay }: { defaultDay: string }) {
  const [day, setDay] = useState(defaultDay);
  const [outcome, setOutcome] = useState<RefundDraftOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setOutcome(await draftRefundsAction(day));
    });
  }

  return (
    <section
      className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
      aria-label="Draft the refunds for a day"
    >
      <h2 className="text-sm font-semibold text-white">Refunds for a day</h2>
      <p className="max-w-3xl text-xs text-white/50">
        Writes one draft for every void and customer return of a finished business day: debit
        50910 Returns &amp; Refunds and the excise and sales tax that came back, credit the
        drawer or the safe the cash left from. A second draft puts the cost of every unit that
        went back on the shelf back into inventory (debit 2xxxx, credit 6xxxx COGS): a void
        reverses the sale&apos;s own cost entry, a return uses its lot&apos;s unit cost. Destroyed
        returns keep their cost in COGS. Both are drafts — they wait in the list below for your
        Post. Pressing it again for the same day writes nothing.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Business day
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={pending || day === ""}
          className="rounded-lg bg-[var(--admin-green,#3a7)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {pending ? "Drafting…" : "Draft refunds"}
        </button>
      </div>
      {outcome ? (
        <div
          role="status"
          className={
            outcome.kind === "drafted"
              ? "rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/75"
              : "rounded-xl border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-3 text-xs text-white/80"
          }
        >
          <p>{outcome.message}</p>
          {outcome.kind === "drafted" ? (
            <ul className="mt-2 grid gap-1 sm:grid-cols-3">
              <li>Refunded: {money(outcome.totals.refundCents)}</li>
              <li>Returns &amp; Refunds (50910): {money(outcome.totals.revenueCents)}</li>
              <li>Excise back (32000): {money(outcome.totals.exciseCents)}</li>
              <li>Sales tax back (32100): {money(outcome.totals.salesTaxCents)}</li>
              <li>From the drawer (10110): {money(outcome.totals.fromDrawerCents)}</li>
              <li>From the safe (10100): {money(outcome.totals.fromSafeCents)}</li>
              <li>
                {outcome.totals.returnCount} return(s), {outcome.totals.voidCount} void(s)
              </li>
            </ul>
          ) : (
            <p className="mt-1 text-white/45">Code: {outcome.code}. Nothing was written.</p>
          )}
          {outcome.cogs ? (
            <div className="mt-3 border-t border-white/10 pt-2" aria-label="Cost of returned units">
              <p className="font-semibold text-white/80">Cost of returned units</p>
              <p>{outcome.cogs.message}</p>
              {outcome.cogs.kind === "drafted" || outcome.cogs.kind === "nothing" ? (
                <p className="mt-1 text-white/55">
                  Back to inventory: {money(outcome.cogs.totals.costCents)} · {outcome.cogs.totals.restockedCount} restocked ·{" "}
                  {outcome.cogs.totals.destroyedCount} destroyed (cost stays in COGS) · {outcome.cogs.totals.noCostCount} with no
                  cost booked
                </p>
              ) : (
                <p className="mt-1 text-white/45">Code: {outcome.cogs.code}. The cost entry was not written.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
