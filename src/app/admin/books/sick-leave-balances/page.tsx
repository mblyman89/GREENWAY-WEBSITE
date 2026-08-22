/**
 * src/app/admin/books/sick-leave-balances/page.tsx   (books-36)
 *
 * SICK LEAVE BALANCES AND THE GENEROSITY LEDGER.
 *
 * WHY THIS PAGE EXISTS, VERBATIM (standing rule 1)
 *
 *   "I use the legally required minimum, it's easier that way, I give extra on
 *    demand, I don't want to try and figure out a complex formula to accumulate
 *    sick time. I just need a smart and easy to use tool that tracks their sick
 *    time, including if it goes negative. I want to keep track of how generous
 *    I am being."
 *
 * WHY THIS IS A SEPARATE SCREEN FROM SICK LEAVE APPROVALS
 *
 * The approvals inbox answers "what is being asked of me today". This answers
 * "where does everybody stand". They are different questions asked at different
 * moments - the inbox is opened when a notification arrives, this is opened
 * before a pay run or when Michael wonders what his kindness has cost him - and
 * merging them would produce one screen that does neither well. It also means
 * the inbox stays short, which is what makes it get read.
 *
 * WHY /admin/books/ AND NOT /admin/staffing/
 *
 * Same reasoning as the inbox and the garnishments board. A sick leave balance
 * is an accrued liability. It is priced under WAC 296-128-670(1), it lands in
 * box 1 of a W-2 when it is taken, and it is a real number on a real balance
 * sheet from the moment it accrues. That is the ledger's business.
 *
 * THE GATE
 *
 * `requireBooksAccess()` before anything is read. This screen lists every
 * employee's balance on one page, which is precisely the kind of aggregate a
 * shift lead should never see. `sick-leave-store` runs as the service role and
 * bypasses 0198's RLS policies entirely, so this call is the real gate.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO YET (standing rule 62e)
 *
 * It does not let Michael CREATE an award from here. `planAward` exists in the
 * engine, is tested, and refuses an award with no written reason - but the
 * server action, the PIN check and the audit row that a write needs are the
 * next slice's work, and a half-built write path is worse than an honest
 * read-only screen. What this page does is make the numbers visible so that
 * when the award button arrives there is somewhere sensible for it to live.
 */

import { Card, CardHeader } from "@/components/admin/ui";
import { SickLeaveGenerosityBoard } from "@/components/admin/books/SickLeaveGenerosityBoard";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadGenerosityBoard } from "@/lib/payroll/sick-leave-store";

export const dynamic = "force-dynamic";

export default async function SickLeaveBalancesPage() {
  await requireBooksAccess();

  const board = await loadGenerosityBoard();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Sick leave balances &amp; generosity
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Where everybody stands on paid sick leave, with the hours you were required to
          give kept separate from the hours you chose to give. Nothing here is a stored
          number &ndash; every figure is added up from the ledger the moment you open the
          page, so it always agrees with the entries behind it.
        </p>
      </div>

      {/* A read failure is reported AS a read failure. A partly-read ledger
          would show balances that are too low, and a balance that is too low
          is how somebody gets told they have no sick leave left when they do.
          Standing rule 39. */}
      {!board.ok ? (
        <Card>
          <CardHeader title="This screen could not load its data" />
          <p className="text-sm text-[var(--admin-danger)]">{board.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            Nothing was changed and no balance was altered. Do not treat a blank screen as
            confirmation that somebody has no sick leave available &ndash; this is a problem
            reading the records, not a statement about anybody&rsquo;s balance.
          </p>
        </Card>
      ) : (
        <SickLeaveGenerosityBoard
          summary={board.summary}
          accruesAtStatutoryFloor={board.accruesAtStatutoryFloor}
          policyNote={board.policyNote}
        />
      )}
    </div>
  );
}
