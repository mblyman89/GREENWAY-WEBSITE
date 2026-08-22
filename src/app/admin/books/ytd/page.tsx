/**
 * src/app/admin/books/ytd/page.tsx   (books-37)
 *
 * YEAR-TO-DATE WAGES AND WITHHOLDING, PER ACTIVE EMPLOYEE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "The 16 inactive employees are no longer working for me. I will keep their
 *    data in my sage backups, I only need the active employees I currently
 *    have. Please proceed with the net pay and the deferred ytd store slice."
 *
 * So this board lists ACTIVE employees only. The count of stored rows belonging
 * to inactive people is still reported — as a number, not as rows — because
 * "the screen shows 8 people and the 941 shows 11" is a frightening thing to
 * discover in April. Nothing was deleted; the departed employees' figures stay
 * in Sage exactly as Michael asked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * YEAR-TO-DATE IS AN INPUT, NOT A REPORT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is the part that is easy to get backwards, and it is the reason the YTD
 * store was built before the net-pay screen rather than after it.
 *
 * Social Security stops at a wage ceiling. Whether this Friday's cheque is
 * taxed for Social Security depends entirely on what the employee has already
 * been paid this year — so the accumulator is not a summary produced AFTER
 * payroll, it is a fact consumed DURING payroll. Before books-37 the only
 * non-test caller of `computePaycheckTaxes` passed `ZERO_YTD`, which meant the
 * ceiling could never engage: every cheque was computed as though the year had
 * just started, and a high earner would have been over-withheld all the way to
 * December. That is what this store fixes and what this page makes visible.
 *
 * The key column is therefore ROOM REMAINING, not wages paid. Wages paid is
 * history; room remaining is the number that changes the next paycheque.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TAX YEAR IS NOT `new Date().getFullYear()` ALONE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It is derived from the clock, but the wage-base year it is compared against
 * is stated explicitly, and `loadYtdBoard` emits a caveat whenever the two
 * differ. On 1 January 2027 — Michael's first payroll — the clock says 2027
 * while the mirrored Social Security wage base is the verified 2026 figure.
 * Silently measuring 2027 wages against a 2026 ceiling is precisely the kind of
 * drift this codebase refuses to ship, so the page says so in a banner instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `requireBooksAccess()` runs BEFORE any read. These rows are every employee's
 * annual earnings and tax withheld — W-2 data — and `ytd-store` runs as the
 * service role, which bypasses RLS entirely. That makes this call the real
 * gate, not a second opinion.
 */

import { Card, CardHeader } from "@/components/admin/ui";
import { YtdBoard } from "@/components/admin/books/YtdBoard";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadYtdBoard } from "@/lib/payroll/ytd-store";

export const dynamic = "force-dynamic";

/**
 * The year the mirrored Social Security wage base was verified for.
 *
 * A literal rather than a computed value, because it is a claim about which
 * SSA announcement is on file — a fact about our evidence, not about today's
 * date. When the 2027 announcement is mirrored this becomes 2027 and the
 * caveat below stops appearing on its own.
 */
const VERIFIED_WAGE_BASE_YEAR = 2026;

export default async function YtdPage() {
  await requireBooksAccess();

  const taxYear = new Date().getFullYear();
  const board = await loadYtdBoard(taxYear, VERIFIED_WAGE_BASE_YEAR);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Year-to-date wages &amp; withholding
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Where every current employee stands for {taxYear}. This is not a report printed
          after the fact &mdash; these totals are read by the next pay run to decide whether
          the Social Security wage cap has been reached, so the column that matters most
          is how much room is left, not how much has been paid.
        </p>
      </div>

      {/* A read failure is reported AS a read failure. An empty board and a
          failed read look identical on screen and mean opposite things: one
          says nobody has been paid, the other says we could not find out. On a
          page that feeds W-2s, letting those two blur is how a year of wages
          goes missing quietly (standing rule 39: guard the vacuous read). */}
      {!board.ok ? (
        <Card>
          <CardHeader title="This screen could not load its data" />
          <p className="text-sm text-[var(--admin-danger)]">{board.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Nothing was changed and no totals were calculated. This is a problem reading
            the records &mdash; it is NOT confirmation that nobody has been paid this year,
            so please do not run payroll or file a return on the assumption that these
            totals are zero.
          </p>
        </Card>
      ) : (
        <YtdBoard board={board.value} />
      )}
    </div>
  );
}
