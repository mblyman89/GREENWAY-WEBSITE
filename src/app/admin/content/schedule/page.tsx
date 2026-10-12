import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { HelpPanel } from "@/components/admin/ux";
import { defaultRunAtLocal } from "@/lib/cms/content-schedule-core";
import {
  listSchedules,
  listScheduleTargets,
  SCHEDULE_MIGRATION_HINT,
} from "@/lib/cms/content-schedule-server";
import { listReleases } from "@/lib/cms/content-release-server";
import { scheduleChangeAction } from "./actions";
import { ReleasesSection } from "./ReleasesSection";
import { ScheduleTable, TargetSelect, groupTargets, SCHEDULE_ROUTE } from "./schedule-ui";

/**
 * R46: Schedule & Releases (Website group).
 *
 * One page that answers "what is going to change on the website, and when?"
 * - every upcoming scheduled change (from any editor), cancellable;
 * - a picker to schedule ANY item, including Page wording blocks, which have
 *   no card of their own to hang a Schedule strip on;
 * - Releases (R46-S2): named groups of changes that go live together;
 * - the last 14 days of history, with the reason for anything that failed.
 */
export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ scheduled?: string; error?: string }>;
}) {
  await requirePermission("content.edit");
  const sp = await searchParams;
  const nowIso = new Date().toISOString();

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Schedule & Releases" />
        <div className="px-5 py-6 text-sm text-[var(--admin-gold)] sm:px-8">The database isn&apos;t fully set up yet.</div>
      </div>
    );
  }

  const [{ ready, rows }, targets, releases] = await Promise.all([
    listSchedules({ recentDays: 14 }),
    listScheduleTargets(),
    listReleases(),
  ]);
  const upcoming = rows.filter((r) => (r.status === "pending" || r.status === "running") && !r.release_id);
  const history = rows
    .filter((r) => r.status === "done" || r.status === "failed" || r.status === "cancelled")
    .sort((a, b) => Date.parse(b.ran_at ?? b.run_at ?? b.created_at) - Date.parse(a.ran_at ?? a.run_at ?? a.created_at))
    .slice(0, 50);
  const groups = groupTargets(targets);

  return (
    <div>
      <AdminPageHeader
        title="Schedule & Releases"
        subtitle="Set website changes to go live, or come down, on their own at a date and time (Pacific). Group several changes into a release so they all switch together."
        help={
          <HelpPanel
            id="content-schedule"
            title="How scheduling works"
            steps={[
              "Edit and SAVE the draft as usual (home slide, Shop banner slide, page section, FAQ question or page wording).",
              "Pick “Go live” or “Come down” and a time. Times are Pacific and run on a 5-minute clock.",
              "At that time the website publishes the saved draft, exactly as if you had pressed Publish, or hides the item.",
              "For a sale: schedule the banner to go live Friday morning and to come down Sunday night.",
              "For a launch with several changes, make a Release, add the items, and give the release one time (or press Publish now).",
            ]}
          >
            <p>
              Every change is recorded in the audit log under your name. If something cannot be published (for example
              the item was deleted), it is tried up to three times and then shows here as failed, with the reason.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">{decodeURIComponent(sp.error)}</div>
        ) : null}
        {sp.scheduled ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">{decodeURIComponent(sp.scheduled)}</div>
        ) : null}
        {!ready ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            <strong>One-time setup pending.</strong> {SCHEDULE_MIGRATION_HINT}
          </div>
        ) : null}

        {/* Upcoming */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-[var(--admin-text)]">Coming up</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">Nothing is scheduled outside a release.</p>
          ) : (
            <ScheduleTable rows={upcoming} nowIso={nowIso} cancellable />
          )}
        </section>

        {/* Schedule anything */}
        {ready ? (
          <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <h2 className="mb-1 text-lg font-bold text-[var(--admin-text)]">Schedule a change</h2>
            <p className="mb-3 text-sm text-[var(--admin-text-muted)]">
              Any slide, section, FAQ question or piece of page wording. Page wording can only be scheduled to go live
              (it has no on/off switch).
            </p>
            <form action={scheduleChangeAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="return_to" value={SCHEDULE_ROUTE} />
              <TargetSelect groups={groups} />
              <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
                What should happen
                <select name="action" defaultValue="publish" className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]">
                  <option value="publish">Go live (publish the saved draft)</option>
                  <option value="unpublish">Come down (hide it)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
                When (Pacific time)
                <input type="datetime-local" name="run_at_local" required step={300} defaultValue={defaultRunAtLocal(nowIso)} className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]" />
              </label>
              <button type="submit" className="admin-focus inline-flex items-center rounded-full bg-[var(--admin-accent)] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-black hover:brightness-110">
                Schedule
              </button>
            </form>
          </section>
        ) : null}

        {/* Releases (R46-S2) */}
        {ready ? <ReleasesSection releases={releases} rows={rows} groups={groups} nowIso={nowIso} /> : null}

        {/* History */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-[var(--admin-text)]">Last 14 days</h2>
          {history.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">No scheduled changes have run yet.</p>
          ) : (
            <ScheduleTable rows={history} nowIso={nowIso} />
          )}
        </section>
      </div>
    </div>
  );
}

