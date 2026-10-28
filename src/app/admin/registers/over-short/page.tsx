import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Badge } from "@/components/admin/ui";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { listEmployees } from "@/lib/staffing/store";
import { businessDayFor } from "@/lib/staffing/time";
import { backHref } from "@/lib/admin/back-link-core";
import { loadWarningSources, WARNING_READ_CAP } from "@/lib/registers/over-short-warning-store";
import {
  buildWarningRows,
  summarizeWarnings,
  parseRangeDays,
  dayMinus,
  WARNING_RANGE_DAYS,
} from "@/lib/registers/over-short-warning-core";

/**
 * /admin/registers/over-short — Fix Phase 2.3 (G-03, F-01-11, F-02-6).
 *
 * Owner D7: "Q6- $5. It should be an admin only screen placed in the most
 * logical place to put it for me to interact with. Just warnings for now.
 * Who, when, how much, their reason for why it's over/ under (should be
 * required to be input for over/ under)."
 * D16: "Q02-3- yes, it applies to the master as well". D21: "Q-03-1- only over $5".
 *
 * Admin only (registers.warnings = owner, admin). Read only: a list of every
 * register drawer and master till count more than $5.00 over or short.
 */

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function OverShortWarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; days?: string }>;
}) {
  const sp = await searchParams;
  await requirePermission("registers.warnings");

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Register Activity", href: BASE }, { label: "Over / short warnings" }]} />
        <AdminPageHeader title="Over / short warnings" subtitle="Drawers and master till counts more than $5.00 off." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to see warnings." />
      </div>
    );
  }

  const days = parseRangeDays(sp.days);
  const today = businessDayFor(new Date().toISOString());
  const since = dayMinus(today, days - 1);
  const [sources, employees] = await Promise.all([
    loadWarningSources(since),
    listEmployees({ includeInactive: true }),
  ]);
  const names = new Map(employees.map((e) => [e.id, e.full_name]));
  const nameFor = (id: string | null) => (id ? (names.get(id) ?? "Unknown employee") : "Not recorded");
  const rows = buildWarningRows(sources.drawers, sources.safeCounts, nameFor);
  const sum = summarizeWarnings(rows);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Breadcrumbs items={[{ label: "Register Activity", href: BASE }, { label: "Over / short warnings" }]} />
      </div>
      <AdminPageHeader
        title="Over / short warnings"
        subtitle={`Register drawers and master till counts more than $5.00 over or short · ${since} to ${today}`}
        action={
          <div className="flex flex-wrap gap-2 print:hidden">
            <PrintButton />
            <Button href={`${BASE}/history`} variant="neutral">
              Cash drawer reports
            </Button>
            <Button href={`${BASE}/safe`} variant="neutral">
              Safe
            </Button>
            <Button href={backHref(BASE, sp.back)} variant="neutral">
              ← Register Activity
            </Button>
          </div>
        }
        help={
          <HelpPanel id="registers-over-short" title="About this screen">
            <p>
              Your rule (decision D7): <em>&quot;$5 … Just warnings for now. Who, when, how much, their reason for
              why it&apos;s over/ under.&quot;</em> It applies to the master till as well (D16), and a reason is
              required only when the difference is more than $5.00 (D21).
            </p>
            <p className="mt-2">
              A row appears here when a drawer is reconciled, or the master till is counted, and the result is more
              than $5.00 over or short. The manager could not save it without a reason. Nothing is blocked: these
              are warnings for you to follow up.
            </p>
            <p className="mt-2">
              <strong>Who</strong> is the closer and the second counter for a drawer, or the person picked as
              Counted by for the master till. <strong>Signed off</strong> is the manager who reconciled.
              <strong> No reason</strong> means the count was saved before Phase 2.3, when there was no reason box.
            </p>
            <p className="mt-2">Owners and admins only. Managers write the reasons but do not see this list.</p>
          </HelpPanel>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs print:hidden">
        <span className="text-[var(--admin-text-muted)]">Show the last</span>
        {WARNING_RANGE_DAYS.map((d) => (
          <Button key={d} href={`${BASE}/over-short?days=${d}`} variant={d === days ? "primary" : "neutral"} size="sm">
            {d} days
          </Button>
        ))}
      </div>

      {!sources.drawersOk || !sources.safeOk ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
          {!sources.drawersOk ? "The drawer records could not be read. " : ""}
          {!sources.safeOk ? "The master till counts could not be read. " : ""}
          This list may be missing warnings. Reload in a minute.
        </div>
      ) : null}
      {!sources.reasonsReady ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          Migration 0315 is not applied yet, so reasons cannot be shown here. Until then each reason is kept in the
          Security Log (actions drawer.over_short_warning and safe.over_short_warning).
        </div>
      ) : null}
      {sources.capped ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
          More than {WARNING_READ_CAP} records matched, so only the newest are shown. Pick a shorter range.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Warnings" value={String(sum.count)} hint={`Last ${days} days`} accent={sum.count > 0 ? "orange" : "green"} />
        <StatCard label="Short" value={String(sum.short)} hint="More than $5.00 short" accent={sum.short > 0 ? "orange" : "muted"} />
        <StatCard label="Over" value={String(sum.over)} hint="More than $5.00 over" accent={sum.over > 0 ? "gold" : "muted"} />
        <StatCard
          label="Drawers · master till"
          value={`${sum.drawer} · ${sum.masterTill}`}
          hint={sum.missingReason > 0 ? `${sum.missingReason} saved before reasons existed` : "Every warning has a reason"}
          accent="muted"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No warnings"
          description={`No drawer or master till count was more than $5.00 over or short in the last ${days} days.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] text-left text-xs uppercase tracking-wide text-white/40">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">What</th>
                <th className="px-4 py-3 font-medium">Who counted</th>
                <th className="px-4 py-3 font-medium">Signed off</th>
                <th className="px-4 py-3 text-right font-medium">How much</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium print:hidden">Record</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--admin-border)]/50 align-top last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-white/70">
                    {fmtTime(r.atIso)}
                    <span className="block text-xs text-white/40">Business day {r.businessDay}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-white">{r.where}</span>
                    <span className="mt-1 block">
                      <Badge tone={r.kind === "drawer" ? "outline" : "neutral"}>
                        {r.kind === "drawer" ? "Register drawer" : "Master till"}
                      </Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/80">{r.who}</td>
                  <td className="px-4 py-3 text-white/60">{r.signedBy ?? "—"}</td>
                  <td
                    className={`px-4 py-3 text-right font-semibold tabular-nums ${
                      r.minor > 0 ? "text-[var(--admin-gold)]" : "text-orange-400"
                    }`}
                  >
                    {r.amountWords}
                  </td>
                  <td className="px-4 py-3 text-white/80">
                    {r.reason ?? (
                      <span className="text-white/40">
                        {sources.reasonsReady ? "No reason (recorded before Phase 2.3)" : "Not readable before migration 0315"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 print:hidden">
                    <a
                      href={r.href}
                      className="text-xs font-semibold text-[var(--admin-accent)] underline-offset-2 hover:underline"
                    >
                      {r.kind === "drawer" ? "Till summary" : "Safe counts"}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
