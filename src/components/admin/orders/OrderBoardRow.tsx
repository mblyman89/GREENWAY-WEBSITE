/**
 * src/components/admin/orders/OrderBoardRow.tsx
 *
 * SLICE L-38 — ONE ROW SHAPE FOR EVERY ORDER ON THE DASHBOARD.
 *
 * The owner asked for the Leafly section to "look identical to the online
 * orders rows", with the Details button "on the far right". The only way to
 * keep two lists identical for longer than one release is for them to render
 * through the same component, so both the website table (orders/page.tsx) and
 * the Leafly panel (LeaflyOrdersPanel.tsx) use this shell. A styling change
 * made here lands on both; there is no second copy to drift.
 *
 * It is deliberately dumb: the callers decide what goes in each slot. There
 * are NO step buttons here, by design — per the owner, an order is moved
 * along its steps on its details page only, never from the dashboard.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";

export function OrderBoardRow({
  href,
  title,
  badges,
  reference,
  customer,
  meta,
  footer,
  alerts,
  accent,
}: {
  /** The details page. Null → no link and no button (never a 404 button). */
  href: string | null;
  /** The big name (order name / number). */
  title: ReactNode;
  /** Status + origin badges, shown beside the title. */
  badges?: ReactNode;
  /** Small mono line under the title (e.g. "#1234"). */
  reference?: ReactNode;
  /** Customer line. */
  customer?: ReactNode;
  /** Items · total · placed-ago line. */
  meta?: ReactNode;
  /** Progress strip under the text. */
  footer?: ReactNode;
  /** Compact warnings (deadline, cancellation) — kept visible on the row. */
  alerts?: ReactNode;
  /** Left stripe — used only to flag a row that needs attention now. */
  accent?: "green" | "gold" | "orange";
}) {
  return (
    <Card padding="sm" className="sm:p-5" accent={accent}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {href ? (
              <Link
                href={href}
                className="text-lg font-black text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
              >
                {title}
              </Link>
            ) : (
              <span className="text-lg font-black text-[var(--admin-text)]">{title}</span>
            )}
            {badges}
          </div>
          {reference ? (
            <p className="mt-0.5 font-mono text-xs text-[var(--admin-text-faint)]">{reference}</p>
          ) : null}
          {customer ? <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{customer}</p> : null}
          {meta ? <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">{meta}</p> : null}
          {alerts ? <div className="mt-2 space-y-1">{alerts}</div> : null}
          {footer ? <div className="mt-3">{footer}</div> : null}
        </div>

        {href ? (
          <div className="flex flex-wrap items-center gap-2 sm:self-center">
            <Button href={href} variant="neutral" size="sm">
              Details
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
