import Link from "next/link";
import type { JourneyStageKey } from "@/lib/catalog/journey-core";
import { sopHref, TRUCK_DAY_SLUG } from "@/lib/catalog/sop-core";

/**
 * W13 — the standard "prefer paper?" line inside each stage's HelpPanel,
 * linking to that stage's printable one-page SOP (audit G11: SOP pack lives
 * at /admin/sop; linked from each HelpPanel).
 *
 * Server-safe: plain markup, no hooks — HelpPanel renders it as children.
 */
export function SopSheetLink({ slug }: { slug: JourneyStageKey | typeof TRUCK_DAY_SLUG }) {
  return (
    <p className="text-xs text-[var(--admin-text-muted)]">
      Prefer paper?{" "}
      <Link href={sopHref(slug)} className="text-[var(--admin-accent)] hover:underline">
        Print the one-page SOP
      </Link>{" "}
      for this stage — wall-ready, black-on-white.
    </p>
  );
}
