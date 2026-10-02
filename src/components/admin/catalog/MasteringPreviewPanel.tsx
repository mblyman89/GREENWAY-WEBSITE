/**
 * src/components/admin/catalog/MasteringPreviewPanel.tsx  (S34)
 *
 * Above the Onboarding table, for ONE focused delivery: which invoice rows
 * Approve will master as one card, with which sizes, and which live card each
 * group joins (its sizes, prices and stock right now). Server component,
 * presentational only - the groups come from the SAME S19 dry run as the row
 * chips (previewMasteringGroups), so the panel and the chips cannot disagree.
 *
 * Renders NOTHING when there is no preview (flag off / incomplete read / too
 * many cards / no delivery): the page already shows the one unavailable line
 * (previewUnavailableCopy), never a panel built on part of the menu.
 * Product links only for a joined card (always from the published version);
 * a NEW card has no page yet, so it is plain text (F-101 notFound() trap).
 * Ambiguous groups link to the S32 match review for this delivery.
 */
import Link from "next/link";
import type { PreviewGroupView } from "@/lib/pos/intake-mastering-core";
import {
  MASTERING_PREVIEW_HEADING,
  MASTERING_PREVIEW_INTRO,
  masteringGroupLine,
  masteringSummaryText,
} from "@/lib/inventory/mastering-preview-core";

const KIND_CLASS: Record<"joins" | "new" | "ambiguous", string> = {
  joins: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  new: "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]",
  ambiguous: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
};
const KIND_LABEL: Record<"joins" | "new" | "ambiguous", string> = {
  joins: "Joins live card",
  new: "New card",
  ambiguous: "Your choice",
};

export function MasteringPreviewPanel({
  groups,
  rowNames,
  totalRows,
  manifestId,
  back,
}: {
  /** null = no preview this render (the panel renders nothing). */
  groups: PreviewGroupView[] | null;
  /** draft id -> product name, for the member list. */
  rowNames: Map<string, string>;
  totalRows: number;
  manifestId: string | null;
  back?: string | null;
}) {
  if (!groups || groups.length === 0) return null;
  return (
    <section
      className="mb-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
      data-testid="mastering-preview"
      aria-labelledby="mastering-preview-heading"
    >
      <h2 id="mastering-preview-heading" className="text-sm font-semibold text-[var(--admin-text)]">
        {MASTERING_PREVIEW_HEADING}
      </h2>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{MASTERING_PREVIEW_INTRO}</p>
      <p className="mt-1 text-xs font-medium text-[var(--admin-text)]" data-testid="mastering-preview-summary">
        {masteringSummaryText(groups, totalRows)}
      </p>
      <ul className="mt-3 space-y-2">
        {groups.map((g) => {
          const line = masteringGroupLine(g, { manifestId, back });
          return (
            <li
              key={g.identity}
              className="rounded-lg border border-[var(--admin-border)] px-3 py-2 text-xs"
              data-testid="mastering-group"
              data-kind={line.kind}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_CLASS[line.kind]}`}>
                  {KIND_LABEL[line.kind]}
                </span>
                <span className="text-[var(--admin-text)]">
                  {line.lead}
                  {line.cardName ? (
                    <>
                      {" "}
                      <strong>{line.cardName}</strong>
                    </>
                  ) : null}
                  {line.tail ? <> {line.tail}</> : null}
                </span>
                {line.link ? (
                  <Link
                    href={line.link.href}
                    className="font-semibold text-[var(--admin-accent)] underline"
                    data-testid="mastering-group-link"
                  >
                    {line.link.label} {"\u2192"}
                  </Link>
                ) : null}
              </div>
              <div className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
                {g.draftIds.map((id) => rowNames.get(id) ?? id).join(" \u00b7 ")}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
