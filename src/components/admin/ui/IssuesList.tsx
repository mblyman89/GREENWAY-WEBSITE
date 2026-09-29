/**
 * src/components/admin/ui/IssuesList.tsx  (S28)
 *
 * THE Issues-tab body for Publish, Inventory and the Manifest page. Server
 * component, zero JS. The card markup is lifted from the one place that
 * already humanised diagnostics well (menu-imports/version/[versionId]
 * "Things to fix (and how)", F-116): title, what it means, the raw message
 * small, "How to fix it" + ONE fix button, S26 extras, and a collapsed
 * "Why did this happen?".
 *
 * Two sections, always in this order (D-R2-1): "Needs action" (blocking)
 * above "Worth a look" (warning). FYI rows are never rendered here — they
 * belong to History / the timeline. Rows come from issues-core, which only
 * reads STORED state, so a row disappears the moment its cause is fixed.
 */

import { Button } from "./Button";
import { splitIssueSections, type Issue } from "@/lib/admin/issues-core";

export type IssuesListProps = {
  issues: readonly Issue[];
  /** Shown when there is nothing to do. */
  emptyText?: string;
  /** Optional id for the section (deep links). */
  id?: string;
};

const TONE = {
  blocking: {
    card: "border-[var(--admin-danger)]/35 bg-[var(--admin-danger)]/5",
    title: "text-[var(--admin-danger)]",
  },
  warning: {
    card: "border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5",
    title: "text-[var(--admin-gold)]",
  },
} as const;

function IssueCard({ issue, tone }: { issue: Issue; tone: "blocking" | "warning" }) {
  const t = TONE[tone];
  return (
    <div data-testid="issue-row" data-severity={tone} className={`rounded-lg border px-3 py-2.5 ${t.card}`}>
      {issue.subject ? <p className="text-[11px] uppercase tracking-wide text-white/40">{issue.subject}</p> : null}
      <p className={`text-xs font-semibold ${t.title}`}>{issue.title}</p>
      <p className="mt-1 text-xs text-white/70">{issue.meaning}</p>
      {issue.detail ? <p className="mt-1 text-[11px] text-white/45">{issue.detail}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {issue.fixText ? (
          <p className="flex-1 text-xs text-white/50">
            <strong className="text-white/70">How to fix it:</strong> {issue.fixText}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        {issue.fix ? (
          <Button href={issue.fix.href} size="sm" variant="neutral" data-testid="issue-fix-link">
            {issue.fix.label} &rarr;
          </Button>
        ) : null}
      </div>
      {issue.extra && issue.extra.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-3 text-xs" data-testid="issue-fix-extra">
          {issue.extra.map((e) => (
            <a key={e.href} href={e.href} className="text-[var(--admin-accent)] underline-offset-2 hover:underline">
              {e.label} &rarr;
            </a>
          ))}
        </div>
      ) : null}
      {issue.why ? (
        <details className="mt-1.5 text-xs text-white/50">
          <summary className="cursor-pointer">Why did this happen?</summary>
          <p className="mt-1">{issue.why}</p>
        </details>
      ) : null}
    </div>
  );
}

export function IssuesList({ issues, emptyText = "Nothing needs your attention here.", id }: IssuesListProps) {
  const { needsAction, worthALook } = splitIssueSections(issues);
  if (needsAction.length === 0 && worthALook.length === 0) {
    return (
      <section id={id} data-testid="issues-list" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
        <p data-testid="issues-empty" className="text-sm text-white/50">
          {emptyText}
        </p>
      </section>
    );
  }
  return (
    <section id={id} data-testid="issues-list" className="space-y-5 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      {needsAction.length > 0 ? (
        <div data-testid="issues-needs-action">
          <h2 className="text-sm font-semibold text-white">
            Needs action <span className="text-[var(--admin-danger)]">({needsAction.length})</span>
          </h2>
          <p className="mt-1 text-xs text-white/50">
            These stop product from selling or publishing, or cross a compliance rule. Each button opens the one
            page that fixes it.
          </p>
          <div className="mt-3 space-y-2">
            {needsAction.map((issue, i) => (
              <IssueCard key={`b-${issue.code}-${i}`} issue={issue} tone="blocking" />
            ))}
          </div>
        </div>
      ) : null}
      {worthALook.length > 0 ? (
        <div data-testid="issues-worth-a-look">
          <h2 className="text-sm font-semibold text-white">
            Worth a look <span className="text-[var(--admin-gold)]">({worthALook.length})</span>
          </h2>
          <p className="mt-1 text-xs text-white/50">
            Nothing here blocks you. Fix the cause and the row disappears on the next reload.
          </p>
          <div className="mt-3 space-y-2">
            {worthALook.map((issue, i) => (
              <IssueCard key={`w-${issue.code}-${i}`} issue={issue} tone="warning" />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
