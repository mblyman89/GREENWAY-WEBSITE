/**
 * AttachReceiptView -- SLICE S07. What "Save selected" ACTUALLY did, field by
 * field, shared by the onboarding worksheet and the enrichment look-up panel.
 *
 * The headline is attachReceiptSentence() (pure, attach-plan-core.ts). Below
 * it, every field the person kept appears EXACTLY ONCE in one of three groups:
 *   Attached  - on a live record now (product record / strain library)
 *   Waiting   - saved for a person to approve (hidden strain draft or the
 *               Enrichment suggestions list) - nothing there is live yet
 *   Not saved - with the plain-English reason
 * The receipt is reconciled server-side against what really landed, so a
 * failed write is never shown as attached.
 *
 * No hooks -- renders on the server or the client alike.
 */
import { ATTACH_FIELD_LABEL, type AttachReceipt } from "@/lib/catalog/attach-plan-core";

export function AttachReceiptView({
  receipt,
  sentence,
  notes = [],
}: {
  receipt: AttachReceipt;
  sentence: string;
  notes?: string[];
}) {
  const pct = (c: number | null) => (c === null ? "" : ` (${c}%)`);
  return (
    <div className="space-y-1" data-testid="attach-receipt">
      <p className="text-[var(--admin-accent)]" data-testid="attach-receipt-sentence">
        {sentence}
      </p>
      {receipt.attached.length > 0 && (
        <div data-testid="attach-receipt-attached">
          <p className="font-semibold text-[var(--admin-text)]">Attached</p>
          <ul className="ml-3 list-disc">
            {receipt.attached.map((a) => (
              <li key={`a-${a.field}`}>
                {ATTACH_FIELD_LABEL[a.field]}
                {pct(a.confidence)} {"\u2192"} {a.to.join(" + ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {receipt.queued.length > 0 && (
        <div data-testid="attach-receipt-queued">
          <p className="font-semibold text-[var(--admin-text)]">Waiting for you (not live yet)</p>
          <ul className="ml-3 list-disc">
            {receipt.queued.map((q) => (
              <li key={`q-${q.field}`}>
                {ATTACH_FIELD_LABEL[q.field]}
                {pct(q.confidence)} {"\u2192"} {q.to.join(" + ")}
                <span className="text-[var(--admin-text-faint)]"> - {q.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {receipt.skipped.length > 0 && (
        <div data-testid="attach-receipt-skipped">
          <p className="font-semibold text-[var(--admin-text)]">Not saved</p>
          <ul className="ml-3 list-disc">
            {receipt.skipped.map((s) => (
              <li key={`s-${s.field}`}>
                {ATTACH_FIELD_LABEL[s.field]}
                <span className="text-[var(--admin-text-faint)]"> - {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes.map((n, i) => (
        <p key={`n-${i}`} className="text-[10px] text-[var(--admin-text-faint)]">
          {n}
        </p>
      ))}
    </div>
  );
}
