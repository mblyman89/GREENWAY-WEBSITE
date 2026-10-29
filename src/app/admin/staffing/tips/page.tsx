import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Input } from "@/components/admin/ui";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { formatCents } from "@/lib/registers/cash";
import { pacificToday, addPacificDays } from "@/lib/reports/timezone";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import { formatWorked, isTipFigure } from "@/lib/staffing/tips-core";
import { employeeIdForStaff, loadTipReport } from "@/lib/staffing/tips-store";
import { correctTipsAction } from "./actions";

/**
 * /admin/staffing/tips — Fix Phase 2.1c, the employee tip tracker.
 *
 * Owner message 6: "an employee tip tracker with a new page in the employee
 * drop down menu to track tips and give stats on them."
 *
 * Built on the tip record that already exists: drawer_sessions.tips_minor
 * (migration 0134), counted out of the jar at close on the iPad or the back
 * office. Tips belong to the employee who closed the drawer (the register
 * tells the closer "tips are your money"). Managers and up see everyone and
 * can correct a figure (with a reason, audited). Everyone else signed in sees
 * only their own tips, through the employee record linked to their sign-in.
 */

export const dynamic = "force-dynamic";

const HERE = "/admin/staffing/tips";

export default async function TipTrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; employee?: string; error?: string; done?: string }>;
}) {
  const sp = await searchParams;
  const session = await requirePermission("timeclock.use");
  const manager = can(session.profile.role, "staffing.manage");
  const today = pacificToday();
  const crumbs = <Breadcrumbs items={[{ label: "Employee" }, { label: "Tip Tracker" }]} />;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        {crumbs}
        <AdminPageHeader title="Tip Tracker" subtitle="Tips counted at each drawer close, by employee." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to read drawer sessions." />
      </div>
    );
  }

  // A staff member only ever reads their own sessions.
  let ownId: string | null = null;
  if (!manager) {
    ownId = await employeeIdForStaff(session.userId);
    if (!ownId) {
      return (
        <div className="space-y-6">
          {crumbs}
          <AdminPageHeader title="My tips" subtitle="Tips you counted at each drawer close." />
          <EmptyState
            title="Your sign-in is not linked to an employee record"
            description="Ask a manager to link your login on Employee → Employees. Tips are recorded against the employee who closes a drawer."
          />
        </div>
      );
    }
  }

  const fromRes = parseBusinessDay(sp.from, addPacificDays(today, -29));
  const toRes = parseBusinessDay(sp.to, today);
  const from = fromRes.ok ? fromRes.day : addPacificDays(today, -29);
  const to = toRes.ok ? toRes.day : today;
  const inputError = !fromRes.ok ? `From: ${fromRes.error}` : !toRes.ok ? `To: ${toRes.error}` : null;
  const loaded = inputError ? null : await loadTipReport(from, to, ownId);
  const error = inputError ?? (loaded && "error" in loaded ? loaded.error : null);
  const data = loaded && !("error" in loaded) ? loaded : null;
  const nameOf = (id: string | null) => (id ? (data?.names[id] ?? `employee ${id.slice(0, 8)}`) : "—");
  const regName = (id: string) => data?.registers[id] ?? id.slice(0, 8);
  const focus = manager && sp.employee ? sp.employee : null;
  const shownSessions = data ? data.report.sessions.filter((s) => !focus || s.closedBy === focus) : [];
  const query = `from=${from}&to=${to}${focus ? `&employee=${focus}` : ""}`;
  const st = data?.report.store;
  const best = data ? [...data.report.weekdays].filter((w) => w.days > 0).sort((a, b) => b.averagePerDayMinor - a.averagePerDayMinor)[0] : undefined;

  return (
    <div className="space-y-6">
      <div className="print:hidden">{crumbs}</div>
      <div className="print:hidden">
        <AdminPageHeader
          title={manager ? "Tip Tracker" : "My tips"}
          subtitle="Tips counted out of the tip jar at each drawer close: totals, averages, best days, and every session behind them."
          help={
            <HelpPanel id="staffing-tips" title="How tips are tracked (SOP-01 §4.36)">
              <p>
                At close, the cashier counts the tip jar <strong>by itself</strong> and types it in the Tips box on the iPad (or the
                back-office close form). Tips are the employee&apos;s money: they never enter the drawer count, the expected close or
                the over/short.
              </p>
              <p className="mt-2">
                Each session&apos;s tips belong to the employee who <strong>closed</strong> it. If somebody else opened that drawer,
                the row says so; the app never splits tips on its own.
              </p>
              <p className="mt-2">
                <strong>Not recorded</strong> (the box was left blank) is kept apart from <strong>$0.00</strong> (an empty jar was
                counted). Averages use recorded sessions only. Tips per hour use the time clock&apos;s worked hours in the same days.
              </p>
              {manager ? (
                <p className="mt-2">
                  A manager can correct one session&apos;s figure below. A reason is required and the change is logged with the old
                  and new amounts. Leave the amount blank to set it back to not recorded.
                </p>
              ) : null}
            </HelpPanel>
          }
        />
      </div>

      <div className="space-y-6 px-5 sm:px-8 print:px-0">
        {sp.error ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)] print:hidden">{sp.error}</div>
        ) : sp.done ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)] print:hidden">{sp.done}</div>
        ) : null}

        <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:border-0 print:bg-white print:p-0 print:text-black">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--admin-text)] print:text-black">
                {manager ? "Tips by employee" : `Tips · ${nameOf(ownId)}`} · {from} to {to}
              </h2>
              <p className="text-xs text-[var(--admin-text-muted)] print:text-black/70">Greenway Marijuana · printed {today}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2 print:hidden">
              <form method="get" action={HERE} className="flex flex-wrap items-end gap-2">
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  From
                  <Input type="date" name="from" defaultValue={from} max={today} />
                </label>
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  To
                  <Input type="date" name="to" defaultValue={to} max={today} />
                </label>
                <Button type="submit" variant="neutral" size="sm">
                  Show
                </Button>
              </form>
              {data ? (
                <Button href={`${HERE}/csv?${query}`} variant="neutral" size="sm">
                  Download CSV
                </Button>
              ) : null}
              <PrintButton />
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-[var(--admin-danger)]">{error}</p> : null}
          {data && data.warnings.length > 0 ? (
            <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)] print:border-black print:bg-white print:text-black">
              <p className="font-semibold">Some records could not be read. The figures below may be short.</p>
              <ul className="mt-1 list-disc pl-5">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {data && st ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total tips" value={formatCents(st.totalMinor)} hint={`${st.sessionsRecorded} recorded closes`} accent="green" />
              <StatCard label="Average per close" value={formatCents(st.averagePerRecordedMinor)} hint="Recorded closes only" accent="muted" />
              <StatCard
                label="Closes not recorded"
                value={String(st.sessionsNotRecorded)}
                hint={`${st.recordedRate} of ${st.sessionsClosed} closes recorded`}
                accent={st.sessionsNotRecorded > 0 ? "gold" : "muted"}
              />
              <StatCard
                label="Best day of the week"
                value={best ? best.label : "—"}
                hint={best ? `${formatCents(best.averagePerDayMinor)} average` : "No recorded days"}
                accent="muted"
              />
            </div>

            {manager ? (
              <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:border-0 print:bg-white print:p-0 print:text-black">
                <h2 className="text-sm font-semibold text-[var(--admin-text)] print:text-black">By employee</h2>
                {data.report.employees.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No closed drawers in this range.</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--admin-border)] uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black">
                          <th className="py-2 pr-2">Employee</th>
                          <th className="py-2 pr-2 text-right">Total</th>
                          <th className="py-2 pr-2 text-right">Closes</th>
                          <th className="py-2 pr-2 text-right">Recorded</th>
                          <th className="py-2 pr-2 text-right">Not recorded</th>
                          <th className="py-2 pr-2 text-right">Average</th>
                          <th className="py-2 pr-2 text-right">Highest</th>
                          <th className="py-2 pr-2 text-right">Hours worked</th>
                          <th className="py-2 pr-2 text-right">Per hour</th>
                          <th className="py-2 print:hidden" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.report.employees.map((e) => (
                          <tr key={e.employeeId} className="border-b border-[var(--admin-border)]/50 text-[var(--admin-text)] print:text-black">
                            <td className="py-2 pr-2 font-semibold">{nameOf(e.employeeId)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{formatCents(e.totalMinor)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{e.sessionsClosed}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{e.sessionsRecorded}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{e.sessionsNotRecorded}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{formatCents(e.averagePerRecordedMinor)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {e.highestDay ? `${formatCents(e.highestMinor)} (${e.highestDay})` : "—"}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">{formatWorked(e.workedMinutes)}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{e.perHourMinor === null ? "—" : formatCents(e.perHourMinor)}</td>
                            <td className="py-2 text-right print:hidden">
                              <a className="text-[var(--admin-accent)] underline" href={`${HERE}?from=${from}&to=${to}&employee=${e.employeeId}`}>
                                Sessions
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.report.unattributed.count > 0 ? (
                  <p className="mt-2 text-xs text-[var(--admin-gold)] print:text-black">
                    {data.report.unattributed.count} closed drawer(s) with {formatCents(data.report.unattributed.totalMinor)} in tips have no
                    closer on record, so they are given to nobody.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:border-0 print:bg-white print:p-0 print:text-black">
              <h2 className="text-sm font-semibold text-[var(--admin-text)] print:text-black">By day of the week</h2>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {data.report.weekdays.map((w) => (
                  <div key={w.weekday} className="rounded-lg border border-[var(--admin-border)] p-2 text-xs print:border-black/30">
                    <div className="font-semibold text-[var(--admin-text)] print:text-black">{w.label}</div>
                    <div className="tabular-nums text-[var(--admin-text-muted)] print:text-black/70">
                      {w.days > 0 ? `${formatCents(w.averagePerDayMinor)} avg · ${w.days} day${w.days === 1 ? "" : "s"}` : "no data"}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:border-0 print:bg-white print:p-0 print:text-black">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--admin-text)] print:text-black">
                  Sessions{focus ? ` · ${nameOf(focus)}` : ""}
                </h2>
                {focus ? (
                  <a className="text-xs text-[var(--admin-accent)] underline print:hidden" href={`${HERE}?from=${from}&to=${to}`}>
                    Show everyone
                  </a>
                ) : null}
              </div>
              {shownSessions.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--admin-text-muted)]">No closed drawers in this range.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--admin-border)] uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black">
                        <th className="py-2 pr-2">Day</th>
                        <th className="py-2 pr-2">Register</th>
                        <th className="py-2 pr-2">Closed by</th>
                        <th className="py-2 pr-2">Status</th>
                        <th className="py-2 pr-2 text-right">Tips</th>
                        {manager ? <th className="py-2 print:hidden">Correct</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {shownSessions.map((s) => (
                        <tr key={s.sessionId} className="border-b border-[var(--admin-border)]/50 align-top text-[var(--admin-text)] print:text-black">
                          <td className="py-2 pr-2 whitespace-nowrap">{s.businessDay}</td>
                          <td className="py-2 pr-2">{regName(s.registerId)}</td>
                          <td className="py-2 pr-2">
                            {nameOf(s.closedBy)}
                            {s.openedByOther ? (
                              <div className="text-[var(--admin-text-faint)] print:text-black/60">opened by {nameOf(s.openedBy)}</div>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2">{s.status}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {isTipFigure(s.tipsMinor) ? formatCents(s.tipsMinor) : <span className="text-[var(--admin-gold)]">not recorded</span>}
                          </td>
                          {manager ? (
                            <td className="py-2 print:hidden">
                              <form action={correctTipsAction} className="flex flex-wrap items-center gap-1">
                                <input type="hidden" name="session_id" value={s.sessionId} />
                                <input type="hidden" name="back_query" value={query} />
                                <Input name="tips" placeholder="$0.00 or blank" inputMode="decimal" className="w-28" />
                                <Input name="reason" placeholder="Reason (required)" required minLength={5} maxLength={300} className="w-48" />
                                <Button type="submit" variant="neutral" size="sm">
                                  Save
                                </Button>
                              </form>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
