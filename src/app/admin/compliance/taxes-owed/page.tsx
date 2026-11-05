/**
 * /admin/compliance/taxes-owed  (D183, round slice S6)
 *
 * Owner (2026-11-04): "I need to pay the correct amount in taxes."
 *
 * One card per month, newest first, in plain English: the excise owed to the
 * LCB on the LIQ-1295 (by the 20th of the next month) and the retail sales
 * tax owed to the Department of Revenue (by the 25th, rolled past weekends and
 * holidays), whether each is marked filed on the Compliance Calendar, and a
 * money check: what the register took must equal price + sales tax + excise.
 *
 * Read-only. Marking a return filed stays on the Compliance Calendar.
 */
import { requirePermission } from "@/lib/auth/session";
import { formatCents } from "@/lib/accounting/books-view-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card } from "@/components/admin/ui";
import { SALES_CHECK_PAGE, taxesOwed } from "@/lib/compliance/ccrs-completeness-store";
import { nextReturn, statusText, type ReturnStatus } from "@/lib/compliance/taxes-owed-core";

export const dynamic = "force-dynamic";

function statusClass(s: ReturnStatus): string {
  switch (s) {
    case "filed":
      return "text-[var(--admin-accent)]";
    case "overdue":
      return "font-bold text-[var(--admin-danger)]";
    case "due_soon":
      return "font-bold text-amber-700";
    default:
      return "text-[var(--admin-text-muted)]";
  }
}

export default async function TaxesOwedPage() {
  await requirePermission("reports.view");
  const { cards, errors } = await taxesOwed(6);
  const next = nextReturn(cards);

  return (
    <div>
      <AdminPageHeader
        title="Taxes owed"
        subtitle="What to pay, to whom, and by when, from the register's own numbers."
        breadcrumbs={<Breadcrumbs items={[{ label: "CCRS Command Center", href: "/admin/compliance/ccrs" }, { label: "Taxes owed" }]} />}
        action={
          <Button href={SALES_CHECK_PAGE} variant="neutral" size="sm">
            CCRS sales check
          </Button>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8" data-testid="taxes-owed">
        {errors.length ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            Some numbers could not be read, so do not file from this page until this is fixed:
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {next ? (
          <div className="rounded-[var(--admin-radius)] border border-amber-400/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-bold">Next to file:</span> {next.form} for {next.label}, {formatCents(next.amountMinor)}, due {next.dueDate} ({statusText(next.status, next.daysUntilDue)}).
          </div>
        ) : !errors.length ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            Nothing is waiting to be filed for a finished month.
          </div>
        ) : null}

        <HelpPanel
          id="taxes-owed"
          title="Where these numbers come from"
          steps={[
            "Every completed sale's price already includes sales tax and the 37% cannabis excise. These numbers back them out line by line, the same way the tax report does.",
            "Excise goes to the LCB on the LIQ-1295, due the 20th of the next month. Sales tax goes to the Department of Revenue, due the 25th (moved to the next business day if it lands on a weekend or holiday).",
            "The money check adds price + sales tax + excise back up and compares it to what the register took. A match means nothing was lost between the register and the return.",
            "Mark a return filed on the Compliance Calendar once you have paid it; this page then shows it as filed.",
          ]}
        />

        {cards.map((c) => (
          <Card key={c.month}>
            <div className="space-y-3 p-5" data-testid={`tax-month-${c.month}`}>
              <h2 className="text-base font-bold text-[var(--admin-text)]">{c.label}</h2>
              <p className="text-sm">{c.sentence}</p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-[var(--admin-text-muted)]">
                    <th className="py-1">Return</th>
                    <th>Pay</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {c.returns.map((r) => (
                    <tr key={r.form} className="border-t border-[var(--admin-border)]">
                      <td className="py-2">
                        <div className="font-semibold">{r.form}</div>
                        <div className="text-xs text-[var(--admin-text-muted)]">{r.what}</div>
                      </td>
                      <td className="font-semibold">{formatCents(r.amountMinor)}</td>
                      <td>{r.dueDate}</td>
                      <td className={statusClass(r.status)}>{statusText(r.status, r.daysUntilDue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-[var(--admin-text-muted)]">Orders</dt>
                  <dd>{c.input.orders}</dd>
                </div>
                <div>
                  <dt className="text-[var(--admin-text-muted)]">Sales before tax</dt>
                  <dd>{formatCents(c.input.totalBaseMinor)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--admin-text-muted)]">State / local sales tax</dt>
                  <dd>
                    {formatCents(c.input.stateSalesTaxMinor)} / {formatCents(c.input.localSalesTaxMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--admin-text-muted)]">Money check</dt>
                  <dd className={c.moneyMatches === false ? "font-bold text-[var(--admin-danger)]" : c.moneyMatches ? "text-[var(--admin-accent)]" : ""}>
                    {c.moneyMatches === null
                      ? "Could not read what the register took"
                      : c.moneyMatches
                        ? `Matches (${formatCents(c.takenMinor ?? 0)} taken)`
                        : `OFF by ${formatCents(c.gapMinor ?? 0)}: see the tax report before filing`}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>
        ))}

        <div className="flex flex-wrap gap-3 text-sm">
          <a className="underline" href="/admin/compliance/calendar">
            Compliance Calendar (mark filed)
          </a>
          <a className="underline" href="/admin/reports/tax">
            Tax report (detail)
          </a>
          <a className="underline" href="/admin/reports/excise">
            Excise report
          </a>
        </div>
      </div>
    </div>
  );
}
