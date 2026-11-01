/**
 * /admin/settings/platform-health: daily database health check (slice G-71a).
 *
 * Owner message 12 (verbatim excerpt): "Let's build 1-4 first. I see real
 * value in all of them." Item 1 was a daily check that the server can still
 * reach every table and function the app uses, with an email either way.
 *
 * Shows the latest run (what is wrong and the exact fix) and the last 30
 * runs. "Run check now" records a run without sending the daily email.
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
      </div>
    </div>
  );
}
