/**
 * S41 (bible S41.2) — the Product Onboarding row's full-width detail.
 *
 * Owner (R19): "the product rows in onboarding, have a lot of dead space, and
 * it's hard to read with the ai and other facts ... fully take advantage of
 * how much space is now available when the row expands down".
 * Owner (R21): "has the onboard product rows been changed to utilize all
 * available space?"
 *
 * The pattern is IBM Carbon's expandable data table: the opened content is a
 * SECOND <tr> directly under the summary row, with ONE cell spanning every
 * column. Inside it, three zones sit side by side on wide screens (one column
 * on narrow ones): What we know | AI lookup | Approve.
 *
 * Zero JS. The summary row keeps its <details> toggle; globals.css shows this
 * row only while that <details> is open (`tr:has(details[open]) + tr`). A
 * browser without :has() shows every detail row, so nothing is ever out of
 * reach and no required pick is ever hidden behind a closed row (F-006).
 *
 * Server component: plain markup, no state.
 */
import type { ReactNode } from "react";
import { DETAIL_ZONES } from "@/lib/catalog/onboarding-list-core";

export const DETAIL_ROW_CLASS = "draft-detail-row";
export const DETAIL_GRID_CLASS =
  "grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(18rem,0.9fr)]";

export function OnboardingDetailRow({
  id,
  colSpan,
  highlighted,
  facts,
  lookup,
  approve,
}: {
  id: string;
  /** The header cell count (onboardingColumns(v2Row).length). */
  colSpan: number;
  /** The pinned row keeps its gold highlight across both rows. */
  highlighted: boolean;
  facts: ReactNode;
  lookup: ReactNode;
  approve: ReactNode;
}) {
  const body: Record<(typeof DETAIL_ZONES)[number]["key"], ReactNode> = { facts, lookup, approve };
  return (
    <tr
      id={id}
      className={`${DETAIL_ROW_CLASS} align-top ${highlighted ? "bg-[var(--admin-gold-soft)]" : "bg-[var(--admin-surface)]"}`}
      data-testid="draft-detail-row"
    >
      <td colSpan={colSpan} className="px-4 pb-4 pt-1">
        <div className={DETAIL_GRID_CLASS}>
          {DETAIL_ZONES.map((z) => (
            <section
              key={z.key}
              aria-label={z.title}
              data-zone={z.key}
              className="flex min-w-0 flex-col gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)]/40 p-3 text-left text-sm"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">{z.title}</h3>
              {body[z.key] ?? <p className="text-xs text-[var(--admin-text-muted)]">Nothing to show yet.</p>}
            </section>
          ))}
        </div>
      </td>
    </tr>
  );
}

/**
 * A labelled group inside the Approve zone ("Classify", "Menu card", "Size &
 * compliance"). Off (the previous row) it renders its children unwrapped, so
 * ONBOARDING_V2_ROW=off is the old markup.
 */
export function ApproveGroup({ on, legend, children }: { on: boolean; legend: string; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-t border-[var(--admin-border)] pt-2 first:border-t-0 first:pt-0">
      <legend className="pb-1 text-xs font-semibold text-[var(--admin-text)]">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** A visible <label> for a control (WCAG 3.3.2); nothing on the previous row. */
export function FieldLabel({ on, htmlFor, children }: { on: boolean; htmlFor: string; children: ReactNode }) {
  if (!on) return null;
  return (
    <label htmlFor={htmlFor} className="text-xs text-[var(--admin-text-muted)]">
      {children}
    </label>
  );
}
