import Link from "next/link";

import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { pacificParts, pacificToday } from "@/lib/reports/timezone";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge, Button, Card, CardHeader, type BadgeTone } from "@/components/admin/ui";
import { CalculateOnlyBanner, PayrollCenterNav } from "@/components/admin/payroll-center/PayrollCenterNav";
import { AddPunch, AdjustPunch } from "@/components/admin/payroll-center/TimeCardPunchTools";
import { approveTimeCardsAction } from "@/app/admin/payroll-center/actions";
import { WEEKDAY_LONG, shortDay, weekdayName } from "@/lib/payroll/pay-schedule-core";
import { decimalHours, fmtMinutes, type CardException, type TimeCard } from "@/lib/payroll/time-card-core";
import { loadPeriodChoices, loadTimeCards, pickDefaultPeriod, type TimeCardsView } from "@/lib/payroll/time-card-store";
import type { PayPeriodRow } from "@/lib/payroll/timesheet-store";

/**
 * D248 slice 2 - TIME CARDS (owner + admin).
 *
 * Owner (verbatim excerpt): "I need a much better, more enterprise way of
 * managing time cards, adjustments, stats, charts, graphs ... Sick time, breaks,
 * overtime, total hours per week, total per period ..."
 *
 * One pay period, every employee: an exceptions board first (what blocks pay),
 * then a summary grid, then each person's card by workweek and day with every
 * punch. Fixes happen in place through the audited time-clock actions (reason
 * required). Approval re-runs the pay engine and refuses while anything blocks.
 * Calculate and compare only: nothing here books, files or pays.
 */

export const dynamic = "force-dynamic";

const STATUS: Record<TimeCard["status"], { tone: BadgeTone; label: string }> = {
  blocked: { tone: "danger", label: "Fix first" },
  attention: { tone: "gold", label: "Review" },
  ready: { tone: "green", label: "Ready" },
  no_hours: { tone: "neutral", label: "No hours" },
};

const SEV: Record<CardException["severity"], BadgeTone> = { block: "danger", warn: "gold", info: "neutral" };

function clock(iso: string | null): string {
  if (!iso) return "open";
  const p = pacificParts(iso);
  const h12 = ((p.hour + 11) % 12) + 1;
  return `${h12}:${String(p.minute).padStart(2, "0")}${p.hour < 12 ? "a" : "p"}`;
}

function dayHead(d: string) {
  return `${weekdayName(d).slice(0, 3)} ${shortDay(d)}`;
}

function money(c: number) {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function periodOption(p: PayPeriodRow) {
  return `${p.start_date} → ${p.end_date} · paid ${p.pay_date} · ${p.status}`;
}

export default async function TimeCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; emp?: string; msg?: string; error?: string }>;
}) {
  const session = await requirePermission("settings.manage");
  const canAdjust = can(session.profile.role, "staffing.manage");
  const sp = await searchParams;
  const today = pacificToday();

  let periods: PayPeriodRow[] = [];
  let view: TimeCardsView | null = null;
  let failure: string | null = null;
  if (!isSupabaseServiceConfigured) failure = "The database is not connected on this server.";
  else {
    try {
      periods = await loadPeriodChoices();
      const chosen = periods.find((p) => p.id === sp.period) ?? pickDefaultPeriod(periods, today);
      if (chosen) view = await loadTimeCards(chosen.id);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  const r = view?.rollup ?? null;
  const focus = sp.emp ? view?.cards.find((c) => c.employeeId === sp.emp) ?? null : null;
  const shown = view ? (focus ? [focus] : view.cards.filter((c) => c.status !== "no_hours")) : [];
  const maxDay = r ? Math.max(1, ...r.byDay.map((d) => d.workMinutes)) : 1;
  const base = `/admin/payroll-center/time-cards?period=${view?.period.id ?? ""}`;

  return (
    <div>
      <AdminPageHeader
        title="Time cards"
        subtitle="Every punch, break, overtime hour and sick hour for a pay period - by workweek and day - with fixes in place and approval when it's clean."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Payroll command center", href: "/admin/payroll-center" }, { label: "Time cards" }]} />
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8" data-testid="time-cards-page">
        <PayrollCenterNav current="time-cards" />
        <CalculateOnlyBanner />

        {sp.msg ? <p className="rounded-[var(--admin-radius)] bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">{sp.msg}</p> : null}
        {sp.error ? <p className="rounded-[var(--admin-radius)] bg-[var(--admin-danger-soft)] px-4 py-2 text-sm text-[var(--admin-danger)]">{sp.error}</p> : null}
        {failure ? (
          <Card>
            <CardHeader title="Time cards could not load" />
            <p className="text-sm text-[var(--admin-danger)]">{failure}</p>
          </Card>
        ) : null}

        {!failure && periods.length === 0 ? (
          <Card>
            <CardHeader title="No pay periods yet" subtitle="Time cards are laid out per pay period." />
            <p className="text-sm text-[var(--admin-text-muted)]">
              Set the pay Friday and period, then add the year&apos;s periods to the calendar.
            </p>
            <div className="mt-3">
              <Button href="/admin/payroll-center/schedule" variant="primary">
                Open pay schedule
              </Button>
            </div>
          </Card>
        ) : null}

        {view && r ? (
          <>
            {/* Period picker */}
            <form method="get" className="flex flex-wrap items-center gap-2" data-testid="period-picker">
              <label htmlFor="period" className="text-xs font-semibold text-[var(--admin-text-muted)]">
                Pay period
              </label>
              <select id="period" name="period" defaultValue={view.period.id} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm">
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {periodOption(p)}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="neutral" size="sm">
                Show
              </Button>
              <Badge tone={view.period.status === "planned" ? "gold" : "green"}>{view.period.status}</Badge>
              <span className="text-xs text-[var(--admin-text-muted)]">
                Workweek: {view.workweekStartsOn === null ? "not set" : `starts ${WEEKDAY_LONG[view.workweekStartsOn]}`}
              </span>
            </form>

            {view.workweekStartsOn === null ? (
              <p className="rounded-[var(--admin-radius)] bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
                The workweek is not set, so hours are shown but overtime is not split (that would be a guess).{" "}
                <Link className="underline" href="/admin/payroll-center/schedule">
                  Set the workweek
                </Link>
                .
              </p>
            ) : null}
            {view.engineProblem ? (
              <p className="rounded-[var(--admin-radius)] bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">Pay engine: {view.engineProblem}</p>
            ) : null}

            {/* KPIs */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="time-card-kpis">
              <StatCard label="Hours worked" value={decimalHours(r.workMinutes)} hint={`${r.withHours} of ${r.employees} employees worked`} accent="green" />
              <StatCard
                label="Regular / overtime"
                value={r.regularMinutes === null ? "—" : `${decimalHours(r.regularMinutes)} / ${decimalHours(r.overtimeMinutes ?? 0)}`}
                hint="Overtime = over 40 in a workweek, at 1.5x"
                accent={r.overtimeMinutes ? "gold" : "muted"}
              />
              <StatCard label="Sick hours used" value={decimalHours(r.sickMinutes)} hint={`Unpaid breaks: ${decimalHours(r.breakMinutes)} h`} accent="muted" />
              <StatCard
                label="Ready to approve"
                value={`${r.ready + r.attention} / ${r.withHours}`}
                hint={`${r.blocked} to fix · ${r.breakFlagCount} meal-break flag${r.breakFlagCount === 1 ? "" : "s"} · ${r.editedCount} manager edit${r.editedCount === 1 ? "" : "s"}`}
                accent={r.blocked ? "gold" : "green"}
              />
            </div>
            {view.engineGrossCents !== null ? (
              <p className="text-xs text-[var(--admin-text-muted)]">
                Straight-time + overtime gross from the pay engine for employees with clean cards: <strong className="text-[var(--admin-text)]">{money(view.engineGrossCents)}</strong>{" "}
                (taxes and net on the pay-run preview).
              </p>
            ) : null}

            {/* Hours by day chart */}
            <Card>
              <CardHeader title="Hours by day" subtitle="Everybody's paid hours, each day of the period." />
              <div className="flex h-40 items-end gap-1" data-testid="hours-by-day-chart" role="img" aria-label="Hours worked by day">
                {r.byDay.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[0.6rem] text-[var(--admin-text-muted)]">{d.workMinutes ? decimalHours(d.workMinutes) : ""}</span>
                    <div
                      className="w-full rounded-t bg-[var(--admin-accent)]"
                      style={{ height: `${Math.round((d.workMinutes / maxDay) * 100)}%`, minHeight: d.workMinutes ? 2 : 0 }}
                      title={`${dayHead(d.day)}: ${decimalHours(d.workMinutes)} h`}
                    />
                    <span className="text-[0.6rem] text-[var(--admin-text-muted)]">{weekdayName(d.day).slice(0, 2)}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Summary grid */}
            <Card>
              <CardHeader title="Everybody this period" subtitle="Fix-first rows on top. Click a name to see just that card." />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm" data-testid="time-card-summary">
                  <thead className="text-xs text-[var(--admin-text-muted)]">
                    <tr>
                      <th className="py-2 pr-3">Employee</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3 text-right">Days</th>
                      {view.workweekStartsOn !== null
                        ? (view.cards[0]?.weeks ?? []).map((w) => (
                            <th key={w.index} className="py-2 pr-3 text-right">
                              Wk {w.index}
                            </th>
                          ))
                        : null}
                      <th className="py-2 pr-3 text-right">Regular</th>
                      <th className="py-2 pr-3 text-right">OT</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pr-3 text-right">Breaks</th>
                      <th className="py-2 pr-3 text-right">Sick</th>
                      <th className="py-2 pr-3 text-right">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.cards.map((c) => (
                      <tr key={c.employeeId} className="border-t border-[var(--admin-border)]">
                        <td className="py-2 pr-3">
                          <Link className="font-semibold hover:text-[var(--admin-accent)]" href={`${base}&emp=${c.employeeId}`}>
                            {c.fullName}
                          </Link>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-right">{c.daysWorked}</td>
                        {c.weeks
                          ? c.weeks.map((w) => (
                              <td key={w.index} className={`py-2 pr-3 text-right ${w.overtimeMinutes ? "text-[var(--admin-gold)]" : ""}`}>
                                {decimalHours(w.workMinutes)}
                              </td>
                            ))
                          : null}
                        <td className="py-2 pr-3 text-right">{c.regularMinutes === null ? "—" : decimalHours(c.regularMinutes)}</td>
                        <td className="py-2 pr-3 text-right">{c.overtimeMinutes === null ? "—" : decimalHours(c.overtimeMinutes)}</td>
                        <td className="py-2 pr-3 text-right font-semibold">{decimalHours(c.workMinutes)}</td>
                        <td className="py-2 pr-3 text-right">{decimalHours(c.breakMinutes)}</td>
                        <td className="py-2 pr-3 text-right">{decimalHours(c.sickMinutes)}</td>
                        <td className="py-2 pr-3 text-right">{c.exceptions.filter((e) => e.severity !== "info").length || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--admin-border)] font-semibold">
                      <td className="py-2 pr-3" colSpan={3 + (view.cards[0]?.weeks?.length ?? 0)}>
                        Period total
                      </td>
                      <td className="py-2 pr-3 text-right">{r.regularMinutes === null ? "—" : decimalHours(r.regularMinutes)}</td>
                      <td className="py-2 pr-3 text-right">{r.overtimeMinutes === null ? "—" : decimalHours(r.overtimeMinutes)}</td>
                      <td className="py-2 pr-3 text-right">{decimalHours(r.workMinutes)}</td>
                      <td className="py-2 pr-3 text-right">{decimalHours(r.breakMinutes)}</td>
                      <td className="py-2 pr-3 text-right">{decimalHours(r.sickMinutes)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            {/* Approval */}
            <Card>
              <CardHeader
                title="Approve this period's hours"
                subtitle="Re-checks every card with the pay engine at the moment you click. Approval marks the hours as checked - it books nothing and pays nothing."
              />
              {view.period.status === "locked" ? (
                <p className="text-sm text-[var(--admin-text-muted)]">This period is locked.</p>
              ) : (
                <form action={approveTimeCardsAction} className="flex flex-wrap items-center gap-3" data-testid="approve-hours-form">
                  <input type="hidden" name="period_id" value={view.period.id} />
                  <Button type="submit" variant="confirm" disabled={!r.canApprove}>
                    {view.period.status === "approved" ? "Re-approve hours" : "Approve hours"}
                  </Button>
                  <span className="text-xs text-[var(--admin-text-muted)]">
                    {r.canApprove
                      ? view.period.approved_at
                        ? `Last approved ${view.period.approved_at.slice(0, 10)}.`
                        : "Every card with hours is clean enough to approve."
                      : r.blocked
                        ? `${r.blocked} card${r.blocked === 1 ? "" : "s"} must be fixed first.`
                        : view.workweekStartsOn === null
                          ? "Set the workweek first."
                          : "Nobody has hours in this period yet."}
                  </span>
                </form>
              )}
            </Card>

            {/* Cards */}
            {focus ? (
              <p className="text-sm">
                Showing one card.{" "}
                <Link className="text-[var(--admin-accent)] underline" href={base}>
                  Show everybody
                </Link>
              </p>
            ) : null}
            <div className="space-y-4" data-testid="time-card-list">
              {shown.map((c) => (
                <Card key={c.employeeId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{c.fullName}</h3>
                    <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                    <span className="text-xs text-[var(--admin-text-muted)]">
                      {decimalHours(c.workMinutes)} h · {c.regularMinutes === null ? "OT not split" : `${decimalHours(c.regularMinutes)} reg · ${decimalHours(c.overtimeMinutes ?? 0)} OT`} · {decimalHours(c.sickMinutes)} sick · {c.punchCount} punches
                    </span>
                  </div>

                  {c.exceptions.length ? (
                    <ul className="mt-3 space-y-1 text-xs">
                      {c.exceptions.map((e, i) => (
                        <li key={i} className="flex gap-2">
                          <Badge tone={SEV[e.severity]}>{e.code.replace(/_/g, " ").toLowerCase()}</Badge>
                          <span>{e.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {(c.weeks ?? [{ index: 0, startDate: view.period.start_date, endDate: view.period.end_date, isPartial: false, days: c.days, workMinutes: c.workMinutes, regularMinutes: 0, overtimeMinutes: 0, breakMinutes: c.breakMinutes, sickMinutes: c.sickMinutes }]).map((w) => (
                    <div key={w.index} className="mt-4">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--admin-text-muted)]">
                        {c.weeks ? `Workweek ${w.index}` : "Period"} · {dayHead(w.startDate)} – {dayHead(w.endDate)}
                        {w.isPartial ? <Badge tone="gold">partial week</Badge> : null}
                        <span className="text-[var(--admin-text)]">
                          {decimalHours(w.workMinutes)} h{c.weeks ? ` (${decimalHours(w.regularMinutes)} reg, ${decimalHours(w.overtimeMinutes)} OT)` : ""}
                        </span>
                        {c.weeks ? (
                          <span className="h-1.5 w-32 overflow-hidden rounded bg-[var(--admin-surface-2)]" title="Progress to 40 hours">
                            <span
                              className={`block h-full ${w.overtimeMinutes ? "bg-[var(--admin-gold)]" : "bg-[var(--admin-accent)]"}`}
                              style={{ width: `${Math.min(100, Math.round((w.workMinutes / 2400) * 100))}%` }}
                            />
                          </span>
                        ) : null}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <tbody>
                            {w.days.map((d) => (
                              <tr key={d.day} className={`border-t border-[var(--admin-border)] align-top ${d.workMinutes || d.punches.length || d.sickMinutes ? "" : "text-[var(--admin-text-muted)]"}`}>
                                <td className="w-24 py-1.5 pr-2 font-semibold">{dayHead(d.day)}</td>
                                <td className="py-1.5 pr-2">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    {d.punches.map((p) => (
                                      <span key={p.id} className="inline-flex flex-wrap items-center gap-1">
                                        <span className={p.kind === "break" ? "text-[var(--admin-gold)]" : p.clockOutIso ? "" : "text-[var(--admin-danger)]"}>
                                          {p.kind === "break" ? `${p.breakReason ?? "break"} ` : ""}
                                          {clock(p.clockInIso)}–{clock(p.clockOutIso)}
                                        </span>
                                        {p.source === "manager_edit" ? <Badge tone="gold">edited</Badge> : null}
                                        {canAdjust ? <AdjustPunch id={p.id} inLocal={p.inLocal} outLocal={p.outLocal} label={`${c.fullName} ${dayHead(d.day)} ${clock(p.clockInIso)}`} /> : null}
                                      </span>
                                    ))}
                                    {canAdjust ? <AddPunch employeeId={c.employeeId} day={d.day} name={c.fullName} /> : null}
                                  </div>
                                  {d.flags.map((f, i) => (
                                    <div key={i} className="text-[var(--admin-gold)]">
                                      ⚠ {f.label} ({f.detail})
                                    </div>
                                  ))}
                                </td>
                                <td className="w-16 py-1.5 pr-2 text-right">{d.workMinutes ? fmtMinutes(d.workMinutes) : ""}</td>
                                <td className="w-16 py-1.5 pr-2 text-right text-[var(--admin-gold)]">{d.breakMinutes ? `${fmtMinutes(d.breakMinutes)} br` : ""}</td>
                                <td className="w-16 py-1.5 text-right text-[var(--admin-accent)]">{d.sickMinutes ? `${fmtMinutes(d.sickMinutes)} sick` : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </Card>
              ))}
              {shown.length === 0 ? <p className="text-sm text-[var(--admin-text-muted)]">Nobody has punches in this period yet.</p> : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
