/**
 * /admin/settings/platform-health: daily database health check (slice G-71a).
 *
 * Owner message 12 (verbatim excerpt): "Let's build 1-4 first. I see real
 * value in all of them." Item 1 was a daily check that the server can still
 * reach every table and function the app uses, with an email either way.
 *
 * Shows the latest run (what is wrong and the exact fix) and the last 30
 * runs. "Run check now" records a run without sending the daily email.
 *
 * G-71b adds the platform changes register (item 2): vendor changes that could
 * affect Greenway, their deadlines, what to do, and when the register was last
 * reviewed (standing rule 16).
 */
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState, HelpPanel } from "@/components/admin/ux";
import { Badge, Card } from "@/components/admin/ui";
import { RunHealthCheckButton } from "@/components/admin/platform/RunHealthCheckButton";
import { listRecentHealthRuns, type HealthRunRow } from "@/lib/platform/platform-health-store";
import { DB_CONTRACT_FUNCTIONS, DB_CONTRACT_TABLES } from "@/lib/platform/db-contract";
import type { HealthProblem } from "@/lib/platform/db-contract-core";
import {
  PLATFORM_CHANGES,
  PLATFORM_SOURCES,
  REGISTER_REVIEWED_ON,
  daysUntil,
  reviewDigest,
  type PlatformChange,
} from "@/lib/platform/platform-changes";
import { pacificToday } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";

function tone(s: HealthRunRow["status"]): "green" | "gold" | "danger" {
  return s === "ok" ? "green" : s === "warn" ? "gold" : "danger";
}

function label(s: HealthRunRow["status"]): string {
  return s === "ok" ? "All clear" : s === "warn" ? "Warning" : "Action needed";
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
}

function changeTone(s: PlatformChange["status"]): "danger" | "gold" | "green" | "neutral" {
  return s === "action-needed" ? "danger" : s === "watch" ? "gold" : s === "done" ? "green" : "neutral";
}

function changeLabel(s: PlatformChange["status"]): string {
  return s === "action-needed" ? "Action needed" : s === "watch" ? "Watch" : s === "done" ? "Done" : "Not affected";
}

function problemsOf(row: HealthRunRow): HealthProblem[] {
  const r = row.report as { problems?: unknown } | null;
  return Array.isArray(r?.problems) ? (r.problems as HealthProblem[]) : [];
}

export default async function PlatformHealthPage() {
  await requirePermission("settings.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Platform health" subtitle="Daily check that the server can reach the database." />
        <EmptyState title="Supabase not configured" description="Connect the database to run the health check." />
      </div>
    );
  }

  const { rows, error } = await listRecentHealthRuns(30);
  const latest = rows[0] ?? null;
  const today = pacificToday();
  const digest = reviewDigest(PLATFORM_CHANGES, today);
  const order: Record<PlatformChange["status"], number> = { "action-needed": 0, watch: 1, done: 2, "not-affected": 3 };
  const changes = [...PLATFORM_CHANGES].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div>
      <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Platform health" }]} />
      <AdminPageHeader
        title="Platform health"
        subtitle="Every morning the system checks that the server can still reach every table and function the app uses."
        action={<RunHealthCheckButton />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="platform-health"
          title="What this checks"
          steps={[
            `The app's code uses ${DB_CONTRACT_TABLES.length} tables and views and ${DB_CONTRACT_FUNCTIONS.length} database functions. The list is rebuilt from the code on every change.`,
            "Each morning (about 6:25am Pacific) the database is asked whether the server can still read and call each one. This is the check that would have caught the October 2026 Supabase change that broke customer returns.",
            "Staff get one email a day: an all clear, or what is wrong and the exact fix (usually a migration to run in the Supabase SQL editor). Phones get a push only when something is wrong.",
            "The same morning run also rings up a test sale, takes it out of stock, writes it to the books, takes a customer return, drops cash and closes a test till, all as the server, then undoes every bit of it inside the database. If any step fails, the email names the step, what it breaks at the counter and the fix (migration 0332).",
            "Run check now records a run here but does not send the email.",
          ]}
        />

        {error ? (
          <Card>
            <p className="text-sm text-[var(--admin-danger)]">{error}</p>
          </Card>
        ) : null}

        {latest ? (
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={tone(latest.status)}>{label(latest.status)}</Badge>
              <span className="text-sm text-[var(--admin-text-muted)]">
                Last checked {when(latest.created_at)} ({latest.source === "cron" ? "morning check" : "run by hand"})
              </span>
            </div>
            <p className="mt-3 text-sm">{latest.summary}</p>
            {problemsOf(latest).length > 0 ? (
              <ul className="mt-4 space-y-3">
                {problemsOf(latest).map((p, i) => (
                  <li key={i} className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone={p.severity === "fail" ? "danger" : "gold"}>{p.severity === "fail" ? "Fail" : "Warn"}</Badge>
                      <strong>{p.title}</strong>
                    </div>
                    <p className="mt-1 text-[var(--admin-text-muted)]">{p.detail}</p>
                    <p className="mt-1">
                      <strong>Fix:</strong> {p.fix}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : !error ? (
          <EmptyState title="No checks yet" description="The first check runs tomorrow morning, or press Run check now." />
        ) : null}

        {rows.length > 1 ? (
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Recent checks</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[var(--admin-text-muted)]">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Result</th>
                  <th className="py-1 pr-3">How</th>
                  <th className="py-1">Summary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--admin-border)]">
                    <td className="py-1 pr-3 whitespace-nowrap">{when(r.created_at)}</td>
                    <td className="py-1 pr-3">
                      <Badge tone={tone(r.status)}>{label(r.status)}</Badge>
                    </td>
                    <td className="py-1 pr-3">{r.source === "cron" ? "Morning" : "By hand"}</td>
                    <td className="py-1">{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Platform changes register</h2>
          <p className="mb-3 text-sm text-[var(--admin-text-muted)]">
            Vendor changes (Supabase, Vercel, Next.js, GitHub, Node.js) that could affect Greenway. Last reviewed {REGISTER_REVIEWED_ON} ({digest.ageDays} day(s) ago)
            {digest.stale ? <strong className="text-[var(--admin-danger)]"> &mdash; a monthly review was missed</strong> : null}. {digest.open.length} open item(s). Staff get a
            review email on the first run of each month and a warning 30, 7 and 1 day before each open deadline.
          </p>
          <ul className="space-y-3">
            {changes.map((c) => (
              <li key={c.id} className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={changeTone(c.status)}>{changeLabel(c.status)}</Badge>
                  <strong>{c.title}</strong>
                  {c.deadline ? (
                    <span className="text-[var(--admin-text-muted)]">
                      {c.deadline}
                      {c.status === "action-needed" || c.status === "watch"
                        ? daysUntil(c.deadline, today) < 0
                          ? ` (${-daysUntil(c.deadline, today)} day(s) ago)`
                          : ` (in ${daysUntil(c.deadline, today)} day(s))`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[var(--admin-text-muted)]">{c.impact}</p>
                {c.action ? (
                  <p className="mt-1">
                    <strong>Do:</strong> {c.action}
                  </p>
                ) : null}
                <a className="mt-1 inline-block underline" href={c.source} target="_blank" rel="noreferrer">
                  Vendor notice
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-[var(--admin-text-muted)]">Monthly review sources:</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {PLATFORM_SOURCES.map((s) => (
              <li key={s.url}>
                <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
