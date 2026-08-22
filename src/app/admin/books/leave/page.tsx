/**
 * src/app/admin/books/leave/page.tsx   (books-35)
 *
 * SICK LEAVE APPROVALS - the inbox Michael asked to have land "in accounting".
 *
 * WHAT HE DECIDED, VERBATIM (standing rule 1)
 *
 *   "Thank you. I like option 1 as well. It should reach me in accounting
 *    somewhere logical."
 *
 * Option 1, of the two he was offered, was: a sick-leave request must be
 * APPROVED BEFORE it appears on the timesheet. The alternative was letting the
 * hours land on the sheet and reversing them if they turned out to be wrong.
 *
 * WHY OPTION 1 IS THE SAFER OF THE TWO, in bookkeeping terms
 *
 * In the reversal model, the REVERSAL is the step that can be forgotten. A
 * forgotten reversal is an overpayment of wages, and recovering an overpayment
 * from an employee is legally fiddly, socially unpleasant, and frequently not
 * worth doing - so in practice it is written off. In the approval model the
 * thing that can be forgotten is the APPROVAL, and a forgotten approval is an
 * employee asking "did you see my request?". One failure mode costs money and
 * goodwill; the other costs a reminder.
 *
 * WHY /admin/books/ AND NOT /admin/staffing/
 *
 * Because approving sick leave is an act with money attached. It moves a
 * balance, it creates a payable, it lands on a paycheque and eventually in box
 * 1 of a W-2. Staffing is where the schedule lives; accounting is where the
 * ledger lives, and this writes to a ledger. It sits beside Timesheets in the
 * Accounting group for exactly that reason - the two screens feed the same pay
 * run, and separating them would hide that connection.
 *
 * THE GATE
 *
 * `requireBooksAccess()` - `is_owner()` in application form. It is called here
 * AND again inside the server action, because a server action is a public
 * endpoint reachable without ever loading this page. `sick-leave-store.ts` runs
 * as the service role and therefore bypasses the owner-only RLS policies
 * migration 0198 puts on `sick_leave_ledger` entirely; these calls are the real
 * gate, and the SQL one is inert on this path.
 *
 * WHAT THE NEXT SLICES DO WITH THIS (standing rule 62e)
 *
 *   - The TIMESHEET reads APPROVED requests only. That is the whole of option
 *     1: paid sick hours appear on the sheet because Michael said yes.
 *   - NET PAY prices those minutes at the rate WAC 296-128-670(1) requires -
 *     the GREATER of normal hourly compensation or the minimum wage in force on
 *     the day the leave was used - and posts them to 71030, excluded from the
 *     regular rate under 29 CFR 778.218(a).
 *   - The MONTHLY NOTIFICATION required by WAC 296-128-755(2) reads the same
 *     ledger this screen writes, which is why every row it creates carries a
 *     reason in plain English.
 */

import { Card, CardHeader } from "@/components/admin/ui";
import { LeaveInboxWorkbench } from "@/components/admin/books/LeaveInboxWorkbench";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadLeaveInbox } from "@/lib/payroll/sick-leave-store";

import { decideLeaveRequestAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LeaveApprovalsPage() {
  await requireBooksAccess();

  const inbox = await loadLeaveInbox();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">
          Sick leave approvals
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          Sick leave requests arrive here first. Nothing reaches a timesheet or a
          paycheque until you approve it, and nothing is deducted from anyone&rsquo;s
          balance until you do. Every decision is recorded with your name, the time,
          and - if you deny one - your reason.
        </p>
      </div>

      {/* A read failure is reported AS a read failure. It is never rendered as
          an empty inbox, because "nobody has asked for sick leave" and "the
          requests could not be read" look identical on screen and mean opposite
          things - and one of them leaves an employee waiting. */}
      {!inbox.ok ? (
        <Card>
          <CardHeader title="This screen could not load its data" />
          <p className="text-sm text-[var(--admin-danger)]">{inbox.message}</p>
          <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
            No decisions were recorded and nothing was changed. This is a problem
            reading the records, not a sign that nobody has requested leave - so
            please do not treat this as an empty inbox.
          </p>
        </Card>
      ) : (
        <LeaveInboxWorkbench
          requests={inbox.requests}
          clearCount={inbox.clearCount}
          blockedCount={inbox.blockedCount}
          policyRefusals={inbox.policyRefusals}
          decideAction={decideLeaveRequestAction}
        />
      )}
    </div>
  );
}
