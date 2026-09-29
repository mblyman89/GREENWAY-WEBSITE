/**
 * src/components/admin/ui/IssuesSummaryLine.tsx  (S28, owner decision D-R2-2)
 *
 * The ONE line a main tab may show about problems. Renders NOTHING when
 * nothing blocks (warnings live only as the Issues tab's count). When
 * something blocks: one persistent line in the danger tone — no close
 * button, no timer — with exactly one action, "Review issues", to the
 * Issues tab. It disappears only when the cause is fixed (PatternFly: alerts
 * for a persistent condition are removed only when the condition resolves).
 */

import Link from "next/link";
import type { IssueSummary } from "@/lib/admin/issues-core";

export type IssuesSummaryLineProps = {
  summary: IssueSummary;
  /** The Issues tab href (built with tabHref/tabHrefCarry so filters survive). */
  href: string;
};

export function IssuesSummaryLine({ summary, href }: IssuesSummaryLineProps) {
  if (summary.blocking <= 0 || !summary.headline) return null;
  return (
    <p
      role="status"
      data-testid="issues-summary-line"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--admin-danger)]/35 bg-[var(--admin-danger)]/5 px-4 py-2.5 text-sm text-[var(--admin-danger)]"
    >
      <span className="flex-1">{summary.headline}</span>
      <Link
        href={href}
        data-testid="issues-summary-review"
        className="text-xs font-semibold text-[var(--admin-danger)] underline underline-offset-2 hover:no-underline"
      >
        Review issues &rarr;
      </Link>
    </p>
  );
}
