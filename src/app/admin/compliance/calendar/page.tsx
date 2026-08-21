import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  getCalendarEntries,
  todayPacific,
} from "@/lib/compliance/compliance-calendar-store";
import {
  formatPlainDate,
  overdueCount,
  type CalendarEntry,
} from "@/lib/compliance/compliance-calendar-core";
import { setPeriodDoneAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Compliance calendar (S-18) — the recurring licensing obligations with due
 * dates and a logged done-check per period. This page (plus the dashboard
 * nag) is part of the WAC 314-55-509 mitigation story: the store demonstrably
 * TRACKS its reporting and operational duties.
 */

function statusBadge(entry: CalendarEntry) {
  if (entry.status === "done") return <Badge tone="green">Done</Badge>;
  if (entry.status === "overdue") return <Badge tone="danger">Overdue</Badge>;
  if (entry.daysUntilDue <= 3) return <Badge tone="orange">Due in {entry.daysUntilDue}d</Badge>;
  return <Badge tone="neutral">Due in {entry.daysUntilDue}d</Badge>;
}

export default async function ComplianceCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  // books-23: OWNER ONLY. Was settings.manage (owner + admin). Michael, verbatim:
  // "I want it to be for me alone too, the employees should not be harassed by
  // the system for my not making a payment or filing a report etc. I'll keep
  // that burden for myself."
  await requirePermission("compliance.calendar");
  const [entries, sp] = await Promise.all([getCalendarEntries(), searchParams]);
  const today = todayPacific();
  const overdue = overdueCount(entries);
  const dueSoon = entries.filter((e) => e.status === "due" && e.daysUntilDue <= 3).length;

  return (
    <div>
      <AdminPageHeader
        title="Compliance calendar"
        subtitle="Recurring licensing obligations — due dates, logged sign-offs, dashboard nags."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Compliance", href: "/admin/compliance/health" }, { label: "Calendar" }]}
          />
        }
        help={
          <HelpPanel
            id="compliance-calendar"
            title="How the calendar works"
            steps={[
              "Each obligation shows its CURRENT pending period and due date (store Pacific time).",
              "When you finish the real-world task, tick it done — who and when is logged for audit.",
              "Anything past due turns red here AND on the admin dashboard until it's ticked.",
              "Periods roll automatically: a new month/week/year re-opens the task by itself.",
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.saved ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-emerald-300/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            Saved.
          </div>
        ) : null}
        {sp.error ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {sp.error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Today (store time)" value={formatPlainDate(today)} accent="muted" />
          <StatCard label="Overdue" value={String(overdue)} accent={overdue > 0 ? "orange" : "green"} />
          <StatCard label="Due within 3 days" value={String(dueSoon)} accent={dueSoon > 0 ? "gold" : "muted"} />
        </div>

        <div className="space-y-4">
          {entries.map((entry) => (
            <Card key={entry.task.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-[var(--admin-text)]">{entry.task.label}</h2>
                    {statusBadge(entry)}
                    <Badge tone="neutral">{entry.task.cadence}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{entry.task.description}</p>
                  <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
                    {entry.task.authority} · Period: {entry.period.periodLabel} · Due{" "}
                    {formatPlainDate(entry.period.dueDate)}
                    {entry.done
                      ? ` · Signed off ${new Date(entry.done.doneAt).toLocaleString()}${entry.done.byEmail ? ` by ${entry.done.byEmail}` : ""}`
                      : ""}
                  </p>
                </div>
                <form action={setPeriodDoneAction}>
                  <input type="hidden" name="task_id" value={entry.task.id} />
                  <input type="hidden" name="period_key" value={entry.period.periodKey} />
                  <input type="hidden" name="done" value={entry.status === "done" ? "0" : "1"} />
                  <Button
                    type="submit"
                    variant={entry.status === "done" ? "neutral" : "save"}
                    size="sm"
                  >
                    {entry.status === "done" ? "Undo sign-off" : "Mark done"}
                  </Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
