/**
 * R46-S1: the "Schedule" strip under an editor card (home carousel slide,
 * Shop banner slide, page section, FAQ question).
 *
 * A SERVER component (no client JS): every date is formatted on the server in
 * Pacific time by content-schedule-core, so there is no hydration mismatch and
 * no dependence on the browser's time zone. The datetime-local input is read
 * as PACIFIC by the server action (the label says so), never as browser time.
 *
 * Pattern: Contentful "Scheduled actions" / Sanity "Scheduled drafts" - pick
 * Publish or Unpublish and a date/time; upcoming changes are listed with a
 * Cancel button. Publishing at the scheduled time publishes the SAVED draft,
 * exactly as pressing Publish then would.
 */
import {
  actionsFor,
  defaultRunAtLocal,
  describeSchedule,
  type ScheduleTargetKind,
} from "@/lib/cms/content-schedule-core";
import type { ScheduleRow } from "@/lib/cms/content-schedule-server";
import { scheduleChangeAction, cancelScheduleAction } from "@/app/admin/content/schedule/actions";

export function SchedulePanel({
  kind,
  targetKey,
  returnTo,
  open,
  ready,
  nowIso,
  locked = false,
}: {
  kind: ScheduleTargetKind;
  targetKey: string;
  /** Admin path to come back to (with #anchor), validated server-side. */
  returnTo: string;
  /** Open (held/pending/running) schedules for this item. */
  open: ScheduleRow[];
  /** False until migration 0267 is applied. */
  ready: boolean;
  nowIso: string;
  locked?: boolean;
}) {
  if (locked) return null;
  const actions = actionsFor(kind);
  const pending = open.filter((r) => r.status !== "held");
  const held = open.filter((r) => r.status === "held");

  return (
    <div className="mt-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm">
      {pending.length > 0 ? (
        <ul className="mb-2 space-y-1.5">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className={r.action === "publish" ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}>
                ⏰ {r.run_at ? describeSchedule(r.action, r.run_at, nowIso) : "Waiting for its release"}
                {r.release_id ? <span className="ml-1 text-xs text-[var(--admin-text-muted)]">(part of a release)</span> : null}
                {r.error ? <span className="ml-1 text-xs text-[var(--admin-danger)]">Last try failed: {r.error}</span> : null}
              </span>
              {r.status === "pending" && !r.release_id ? (
                <form action={cancelScheduleAction}>
                  <input type="hidden" name="schedule_id" value={r.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button type="submit" className="admin-focus rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--admin-text-muted)] ring-1 ring-[var(--admin-border)] hover:text-[var(--admin-text)]">
                    Cancel
                  </button>
                </form>
              ) : (
                <span className="text-xs text-[var(--admin-text-muted)]">{r.status === "running" ? "Running now…" : "Managed on the Schedule page"}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {held.length > 0 ? (
        <p className="mb-2 text-xs text-[var(--admin-text-muted)]">
          In {held.length} release{held.length === 1 ? "" : "s"} that {held.length === 1 ? "has" : "have"} no time yet. See{" "}
          <a href="/admin/content/schedule" className="text-[var(--admin-accent)] underline-offset-2 hover:underline">Schedule &amp; releases</a>.
        </p>
      ) : null}

      <details>
        <summary className="cursor-pointer select-none font-semibold text-[var(--admin-text)]">
          ⏰ Schedule this to go live or come down later…
        </summary>
        {!ready ? (
          <p className="mt-2 text-xs text-[var(--admin-gold)]">
            Scheduling turns on once database migration 0267 is applied (supabase/migrations/0267_content_schedule_releases.sql).
          </p>
        ) : (
          <form action={scheduleChangeAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="target_kind" value={kind} />
            <input type="hidden" name="target_key" value={targetKey} />
            <input type="hidden" name="return_to" value={returnTo} />
            <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
              What should happen
              <select name="action" defaultValue="publish" className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]">
                <option value="publish">Go live (publish the saved draft)</option>
                {actions.includes("unpublish") ? <option value="unpublish">Come down (hide it)</option> : null}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
              When (Pacific time)
              <input
                type="datetime-local"
                name="run_at_local"
                required
                step={300}
                defaultValue={defaultRunAtLocal(nowIso)}
                className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]"
              />
            </label>
            <button type="submit" className="admin-focus inline-flex items-center rounded-full bg-[var(--admin-accent)] px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-black hover:brightness-110">
              Schedule
            </button>
            <p className="basis-full text-xs text-[var(--admin-text-muted)]">
              Times run on a 5-minute clock (9:02 becomes 9:05). &ldquo;Go live&rdquo; publishes whatever draft is
              <strong> saved</strong> at that moment, so save your edits first. Tip: schedule a sale banner to go live
              Friday morning and come down Sunday night, two schedules on the same item.
            </p>
          </form>
        )}
      </details>
    </div>
  );
}
