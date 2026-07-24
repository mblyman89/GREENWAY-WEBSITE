/**
 * src/components/admin/inventory/IntakeReviewFlagsPanel.tsx
 *
 * SLICE 39 connectivity audit — renders the Slice 97 intake REVIEW summary
 * (built by intake-review-core via the staged-rows adapter) on the manifest
 * review page. This is the compliance eyeball list a WA I-502 receiver works
 * through BEFORE accepting a delivery:
 *   - vendor license present (CCRS reporting needs it),
 *   - every line has a lot code + COA (WAC 314-55-102),
 *   - failed lab results (must NOT be accepted for retail),
 *   - $0 / sample lines, missing quantities/costs.
 *
 * Pure presentation server component — zero client JS, all logic in the core.
 * Renders NOTHING when there are no flags (clean intake = no noise).
 */

import type {
  IntakeReviewSummary,
  IntakeReviewFlag,
} from "@/lib/inventory/intake-review-core";

function severityBadge(severity: IntakeReviewFlag["severity"]): {
  glyph: string;
  chipClass: string;
  label: string;
} {
  switch (severity) {
    case "error":
      return {
        glyph: "✕",
        chipClass: "bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
        label: "Blocker",
      };
    case "warning":
      return {
        glyph: "!",
        chipClass: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
        label: "Confirm",
      };
    case "info":
    default:
      return {
        glyph: "i",
        chipClass: "bg-white/10 text-[var(--admin-text-muted)]",
        label: "Note",
      };
  }
}

const SEVERITY_ORDER: Record<IntakeReviewFlag["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function IntakeReviewFlagsPanel({ summary }: { summary: IntakeReviewSummary }) {
  // Clean intake: nothing to eyeball — render nothing rather than an empty box.
  if (summary.flags.length === 0) return null;

  const flags = [...summary.flags].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  const errorCount = flags.filter((f) => f.severity === "error").length;
  const warningCount = flags.filter((f) => f.severity === "warning").length;

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
          🔍 Review flags
        </h2>
        <span className="text-xs font-bold text-[var(--admin-text-faint)]">
          {errorCount > 0 && `${errorCount} blocker${errorCount === 1 ? "" : "s"} · `}
          {warningCount} to confirm
        </span>
      </div>

      {errorCount > 0 ? (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-2 text-sm text-[var(--admin-danger)]">
          <span className="mr-1.5 font-bold">Hold on:</span>
          {errorCount === 1 ? "1 item" : `${errorCount} items`} must be resolved before this
          delivery should be accepted.
        </div>
      ) : (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
          No blockers — confirm the items below while you verify counts.
        </div>
      )}

      <ul className="space-y-2">
        {flags.map((flag, i) => {
          const badge = severityBadge(flag.severity);
          return (
            <li key={i} className="flex items-start gap-3 rounded-[var(--admin-radius)] px-3 py-2">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-black ${badge.chipClass}`}
                aria-hidden
              >
                {badge.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-[var(--admin-text-faint)]">
                    {badge.label}
                    {flag.line !== null && ` · line ${flag.line}`}
                    {flag.label && ` · ${flag.label}`}
                  </span>
                </div>
                <p className="text-sm text-[var(--admin-text)]">{flag.message}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
