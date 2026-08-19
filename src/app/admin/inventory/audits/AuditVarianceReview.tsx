/**
 * src/app/admin/inventory/audits/AuditVarianceReview.tsx   (slice books-12)
 *
 * THE VARIANCE TABLE.
 *
 * ---------------------------------------------------------------------------
 * WHY GROSS LEADS AND NET FOLLOWS
 * ---------------------------------------------------------------------------
 * A $600 overage on one lot and a $600 shortage on another net to zero. A
 * summary that leads with the net number reports "no difference" on a count
 * that found $1,200 of error and, very probably, two lots of the same product
 * counted as one pile. Gross is the honest number. Net is shown too, because it
 * is the one that reaches the ledger, but it is never allowed to be the
 * headline.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ENGINE'S MESSAGES ARE RENDERED VERBATIM
 * ---------------------------------------------------------------------------
 * `assessLine` already writes a sentence for each line explaining what it found
 * and why it matters. Re-describing that here in friendlier words would create
 * two copies of one judgement, and the copy on screen would be the one that
 * drifted. The assessment speaks for itself; this file only arranges it.
 */
import { Badge, Button, Textarea } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import type { ReviewLine } from "@/lib/inventory/audit-hub-store";
import {
  VARIANCE_REASONS,
  findVarianceReason,
} from "@/lib/inventory/audit-hub-guidance-core";
import { saveReasonAction } from "./actions";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-sm leading-relaxed text-[var(--admin-text-muted)]";

/** Tone by assessment status. `clean` is quiet; problems are loud. */
function toneFor(status: string): "neutral" | "green" | "gold" | "orange" | "danger" | "outline" {
  switch (status) {
    case "clean":
      return "green";
    case "uncounted":
      return "outline";
    case "immaterial":
      return "neutral";
    case "material":
      return "orange";
    case "unvalued":
      return "gold";
    default:
      return "neutral";
  }
}

export function AuditVarianceReview({
  sessionId,
  lines,
  editable,
}: {
  sessionId: string;
  lines: readonly ReviewLine[];
  editable: boolean;
}) {
  // Sort so the lines that need a decision are at the top. A reviewer should
  // never have to scroll past forty clean lines to find the one problem.
  const ordered = [...lines].sort((a, b) => {
    const rank = (l: ReviewLine) =>
      l.assessment.blocksPosting ? 0 : l.assessment.isMaterial ? 1 : l.assessment.status === "clean" ? 3 : 2;
    return rank(a) - rank(b);
  });

  return (
    <section className={CARD}>
      <h2 className="text-sm font-bold text-white">Line by line</h2>
      <p className={`mt-1 ${P}`}>
        Anything needing a decision is at the top. A clean line is not a formality &mdash; it is
        evidence your day-to-day controls are working.
      </p>

      <div className="mt-4 space-y-3">
        {ordered.map((l) => {
          const a = l.assessment;
          const reason = findVarianceReason(l.reasonCode);
          const needsReason = a.requiresDocumentation && l.reasonCode === null;

          return (
            <div
              key={l.lotId}
              className={`rounded-xl border p-4 ${
                a.blocksPosting
                  ? "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/[0.05]"
                  : "border-white/10 bg-white/[0.015]"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {l.productName ?? "Unnamed product"}
                  </p>
                  <p className="font-mono text-xs text-[var(--admin-text-muted)]">
                    {l.lotCode ?? "NO LOT CODE"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneFor(a.status)}>{a.status}</Badge>
                  {/* "scanned" is a claim about HOW A NUMBER ARRIVED, so it is
                      only shown when a number actually arrived. A line nobody
                      counted cannot have been scanned, and a badge saying so
                      would attach a quality stamp to the absence of evidence.
                      0191 gives capture_method no default, so this should
                      already be null on an uncounted line -- but the badge is
                      an assertion about reliability, and an assertion about
                      reliability should not depend on a column staying empty. */}
                  {l.captureMethod && l.assessment.effectiveCountedQty !== null ? (
                    <Badge tone={l.captureMethod === "scan" ? "neutral" : "outline"}>
                      {l.captureMethod === "scan" ? "scanned" : "typed by hand"}
                    </Badge>
                  ) : null}
                </div>
              </div>

              {/* The three numbers, side by side. The system quantity IS shown
                  here and deliberately was not shown on the count sheet: the
                  count is finished, and comparison is now the entire job. */}
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label="Books said" value={l.systemQty.toLocaleString()} />
                <Figure
                  label="You counted"
                  value={l.countedQty === null ? "not counted" : l.countedQty.toLocaleString()}
                  muted={l.countedQty === null}
                />
                <Figure
                  label="Second count"
                  value={l.recountQty === null ? "\u2014" : l.recountQty.toLocaleString()}
                  muted={l.recountQty === null}
                />
                <Figure
                  label="Difference"
                  value={
                    a.varianceQty === null
                      ? "unknown"
                      : `${a.varianceQty > 0 ? "+" : ""}${a.varianceQty.toLocaleString()}`
                  }
                  muted={a.varianceQty === null}
                  emphasis={a.varianceQty !== null && a.varianceQty !== 0}
                />
              </div>

              <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                Money effect:{" "}
                <span className="text-white/85">
                  {a.varianceCents === null
                    ? "cannot be worked out \u2014 this lot has no cost on file"
                    : formatCents(a.varianceCents)}
                </span>
              </p>

              {/* The engine's own words, unedited. */}
              {a.messages.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {a.messages.map((m) => (
                    <li key={m} className="flex gap-2 text-xs text-white/75">
                      <span className="text-[var(--admin-gold)]">&bull;</span>
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* ── THE REASON ─────────────────────────────────────────── */}
              {reason ? (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                  <p className="text-xs text-white/85">
                    <span className="font-semibold">Reason:</span> {reason.label}
                  </p>
                  {l.reasonNote ? (
                    <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{l.reasonNote}</p>
                  ) : null}
                  {reason.costsTax ? (
                    <p className="mt-1 text-xs text-[var(--admin-orange)]">
                      This answer is likely to be taxed as if the product were sold.
                    </p>
                  ) : null}
                </div>
              ) : needsReason && editable ? (
                <ReasonForm sessionId={sessionId} lotId={l.lotId} />
              ) : needsReason ? (
                <p className="mt-3 text-xs text-[var(--admin-orange)]">
                  This difference still has no explanation recorded.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  muted,
  emphasis,
}: {
  label: string;
  value: string;
  muted?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
        {label}
      </p>
      <p
        className={`tabular-nums ${
          muted
            ? "text-sm text-[var(--admin-text-muted)]"
            : emphasis
              ? "text-base font-semibold text-[var(--admin-orange)]"
              : "text-base text-white/90"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * The reason picker.
 *
 * There is NO pre-selected option. A default would get accepted by pressing
 * save, and the most convenient default would quietly become the most common
 * recorded explanation for missing regulated product. Every reason here has to
 * be chosen on purpose.
 */
function ReasonForm({ sessionId, lotId }: { sessionId: string; lotId: string }) {
  return (
    <form action={saveReasonAction} className="mt-3 rounded-lg border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.05] p-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="lotId" value={lotId} />
      <p className="text-xs font-semibold text-white">Why did this differ?</p>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        Washington treats product that disappears with no explanation as a sale, and taxes it.
        Naming what actually happened is usually the cheaper answer as well as the true one.
      </p>

      <div className="mt-2 space-y-1.5">
        {VARIANCE_REASONS.map((r) => (
          <label key={r.code} className="flex cursor-pointer gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
            <input type="radio" name="reasonCode" value={r.code} required className="mt-1" />
            <span>
              <span className="block text-xs font-semibold text-white/90">
                {r.label}
                {r.costsTax ? (
                  <span className="ml-2 rounded bg-[var(--admin-orange)]/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--admin-orange)]">
                    taxed as a sale
                  </span>
                ) : null}
              </span>
              <span className="block text-[11px] leading-relaxed text-[var(--admin-text-muted)]">
                {r.whenToUse}
              </span>
            </span>
          </label>
        ))}
      </div>

      <Textarea
        name="reasonNote"
        rows={2}
        placeholder="One sentence of detail. 'Jar cracked in transit' is enough."
        className="mt-2 text-xs"
      />

      <Button type="submit" variant="confirm" size="sm" className="mt-2">
        Record this reason
      </Button>
    </form>
  );
}
