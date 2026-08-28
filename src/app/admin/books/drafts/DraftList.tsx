/**
 * src/app/admin/books/drafts/DraftList.tsx   (slice books-85, closes D-67)
 *
 * THE REVIEW SCREEN. Every draft, every line, and one button.
 *
 * Michael is a visual learner and asked to see what he is approving before he
 * approves it, so every line of every entry is on the page from the start —
 * there is no "expand to see what you are signing". You cannot review what you
 * cannot see, and a screen that hides the lines behind a click is a screen that
 * trains its user to click without looking.
 *
 * WHAT THE BUTTON SAYS IS WHAT WILL HAPPEN. The label is driven by the plan
 * computed server-side in approval-core.ts: "Post" when the entry needs no
 * signature, "Approve and post" when it does. Where the plan is a refusal there
 * is NO button at all, and the reason is printed instead — a disabled button
 * with no explanation is just a locked door.
 *
 * DEBIT AND CREDIT. Amounts are stored as signed integer cents: positive is a
 * debit, negative is a credit. They are shown in two columns the way an
 * accountant expects, never as a signed number, because "-4,000" in a single
 * column is exactly the presentation that makes people post things backwards.
 */

"use client";

import { useState, useTransition } from "react";

import type { DraftJournal } from "@/lib/accounting/approval-service";
import { postDraftAction } from "./actions";

/** Integer cents to "1,234.56". No floats: the split is done on the integer. */
function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const part = abs % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}.${part.toString().padStart(2, "0")}`;
}

type Outcome = { ok: boolean; message: string } | null;

function DraftCard({ draft }: { draft: DraftJournal }) {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, startTransition] = useTransition();

  const needsApproval = draft.plan.ok && draft.plan.action === "approve_then_post";
  const canAct = draft.plan.ok;

  function onPost() {
    setOutcome(null);
    startTransition(async () => {
      const r = await postDraftAction(draft.journalId);
      setOutcome({ ok: r.ok, message: r.message });
    });
  }

  const debits = draft.lines.filter((l) => l.amountCents > 0);
  const credits = draft.lines.filter((l) => l.amountCents < 0);
  const balanced =
    debits.reduce((s, l) => s + l.amountCents, 0) +
      credits.reduce((s, l) => s + l.amountCents, 0) ===
    0;

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{draft.memo}</h3>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
              {draft.sourceKind.replace(/_/g, " ")}
            </span>
            {draft.approvedBy && (
              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200/80">
                approved
              </span>
            )}
          </div>
          <p className="text-xs text-white/45">
            {draft.journalDate} · {draft.entityName || draft.entityCode}
            {draft.sourceRef ? ` · ref ${draft.sourceRef}` : ""}
          </p>
        </div>
        <p className="text-sm tabular-nums text-white/70">{money(draft.totalCents)}</p>
      </header>

      {draft.assumptionNote && (
        <p className="mt-3 rounded-lg border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] p-3 text-xs text-white/70">
          <strong className="text-white/85">Assumption recorded:</strong>{" "}
          {draft.assumptionNote}
        </p>
      )}

      <table className="mt-4 w-full text-xs">
        <thead>
          <tr className="text-white/40">
            <th className="pb-1 text-left font-normal">Account</th>
            <th className="pb-1 text-left font-normal">280E</th>
            <th className="pb-1 text-right font-normal">Debit</th>
            <th className="pb-1 text-right font-normal">Credit</th>
          </tr>
        </thead>
        <tbody className="text-white/70">
          {draft.lines.map((l, i) => (
            <tr key={`${l.accountCode}-${i}`} className="border-t border-white/5">
              <td className="py-1 pr-2">
                <span className="tabular-nums text-white/50">{l.accountCode}</span>{" "}
                {l.accountName}
                {l.description ? (
                  <span className="block text-white/35">{l.description}</span>
                ) : null}
              </td>
              <td className="py-1 pr-2 text-white/45">
                {l.costClass && l.costClass !== "none" ? l.costClass : "—"}
              </td>
              <td className="py-1 text-right tabular-nums">
                {l.amountCents > 0 ? money(l.amountCents) : ""}
              </td>
              <td className="py-1 text-right tabular-nums">
                {l.amountCents < 0 ? money(-l.amountCents) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!balanced && (
        <p className="mt-3 rounded-lg border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] p-3 text-xs text-white/80">
          The debits and credits on this entry are not equal. It cannot post as it stands,
          and the database will refuse it. Nothing here is wrong with your books yet — the
          draft simply needs fixing or reversing.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canAct ? (
          <button
            type="button"
            onClick={onPost}
            disabled={pending}
            className="rounded-lg bg-[var(--admin-gold)] px-4 py-2 text-xs font-semibold text-black disabled:opacity-50"
          >
            {pending ? "Posting…" : needsApproval ? "Approve and post" : "Post to the ledger"}
          </button>
        ) : null}
        <p className="max-w-2xl text-xs text-white/50">
          {draft.plan.ok ? draft.plan.reason : draft.plan.message}
        </p>
      </div>

      {outcome && (
        <p
          className={
            "mt-3 rounded-lg p-3 text-xs " +
            (outcome.ok
              ? "border border-emerald-400/40 bg-emerald-400/[0.07] text-emerald-100/90"
              : "border border-[var(--admin-orange)]/45 bg-[var(--admin-orange)]/[0.08] text-white/80")
          }
        >
          {outcome.message}
        </p>
      )}
    </article>
  );
}

export function DraftList({ drafts }: { drafts: readonly DraftJournal[] }) {
  if (drafts.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-white/55">
        Nothing is waiting to be posted. Every entry the system has written has already
        reached the ledger.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {drafts.map((d) => (
        <DraftCard key={d.journalId} draft={d} />
      ))}
    </div>
  );
}
