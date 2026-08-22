/**
 * src/app/admin/books/garnishments/page.tsx   (books-36)
 *
 * WAGE GARNISHMENTS AND CHILD SUPPORT.
 *
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 *
 *   "in the summary report, will you check and confirm that the child support
 *    is included in the garnishments page. I will need it as well."
 *
 * Checking that honestly produced an uncomfortable answer. The child support
 * ARITHMETIC was complete: `garnishment-core.ts` implements the full CCPA
 * 50/55/60/65 matrix, applies RCW 26.18.090(2)'s stricter 50% Washington cap,
 * refuses rather than guesses when either determining fact is unknown, and is
 * mutation-tested. The MENTORING was complete too - 862 lines of it, plus
 * eleven verbatim legal texts.
 *
 * There was no garnishments page. `grep -rln garnishment src/app src/components`
 * returned nothing at all. Two and a half thousand lines of correct, tested,
 * well-taught code that no human being could reach. That is standing rule 50 -
 * dead code wearing a green check - at the largest scale found in this repo,
 * and it was found by the phase A audit rather than by guessing.
 *
 * So the answer to Michael's question is now yes, and this file is the reason
 * it can be yes.
 *
 * WHY /admin/books/ AND NOT /admin/staffing/
 *
 * Same reasoning as Sick Leave Approvals. A garnishment is money withheld from
 * a paycheque, remitted to a third party, and reported. It is a liability from
 * the moment it is withheld until the moment it is paid over. That is the
 * ledger's business, so it lives with the ledger.
 *
 * THE GATE
 *
 * `requireBooksAccess()` - `is_owner()` in application form - is called before
 * anything is read. Wage orders name the employee, the case number, the
 * custodial parent and the amount owed; this is among the most sensitive data
 * in the system, and a shift lead has no business seeing it. `garnishment-store`
 * runs as the service role and therefore bypasses 0198's RLS policies entirely,
 * which means this call is the real gate, not a second opinion.
 *
 * WHY NO PAY PERIOD IS SUPPLIED YET
 *
 * `loadGarnishmentBoard()` is called with no arguments, so it lists the orders
 * and reports which ones are blocked WITHOUT computing withholding. It cannot
 * honestly compute anything yet: disposable earnings under 15 USC 1672(b) are
 * gross pay minus amounts required by law to be withheld, and the required
 * withholding for a period is exactly what the net pay slice - the one after
 * this - is being built to produce. Passing invented gross pay in to make the
 * screen look finished would put a fabricated number next to a real child's
 * support order. The worked-example card appears the moment net pay can supply
 * a genuine `PaycheckFacts`, and the store already accepts it (standing rule
 * 62e: the seam for the next slice is built now, empty, rather than retrofitted).
 */

import { Card, CardHeader } from "@/components/admin/ui";
import { GarnishmentWorkbench } from "@/components/admin/books/GarnishmentWorkbench";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadGarnishmentBoard } from "@/lib/payroll/garnishment-store";

export const dynamic = "force-dynamic";

export default async function GarnishmentsPage() {
  await requireBooksAccess();

  const board = await loadGarnishmentBoard();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Wage garnishments &amp; child support
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Every court order, support order and tax levy that attaches to somebody&rsquo;s
          wages is listed here, with the legal ceiling that applies to it. An order
          that is missing a fact the law needs is shown as blocked rather than
          estimated, because withholding too little on a support order is something
          an employer can be made to pay for personally.
        </p>
      </div>

      {/* A read failure is reported AS a read failure. It is never rendered as
          "no garnishments on file", because those two look identical on screen
          and mean opposite things - and one of them means a live court order is
          being ignored. This is the same shape as the leave inbox for exactly
          the same reason (standing rule 39: guard the vacuous read). */}
      {!board.ok ? (
        <Card>
          <CardHeader title="This screen could not load its data" />
          <p className="text-sm text-[var(--admin-danger)]">{board.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Nothing was changed and no withholding was calculated. This is a problem
            reading the records - it is NOT confirmation that there are no orders on
            file, so please do not run payroll on the assumption that there are none.
          </p>
        </Card>
      ) : (
        <GarnishmentWorkbench
          orders={board.orders}
          activeCount={board.activeCount}
          blockedCount={board.blockedCount}
          worked={board.worked}
        />
      )}
    </div>
  );
}
