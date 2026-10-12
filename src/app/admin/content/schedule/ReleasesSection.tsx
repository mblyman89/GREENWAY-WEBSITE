/**
 * R46-S2: Releases on the Schedule & Releases page (server component).
 * A release is a named group of changes that switch together: by one
 * scheduled time, or by "Publish now".
 */
import { canDo, summarizeItems, type ReleaseStatus } from "@/lib/cms/content-release-core";
import { defaultRunAtLocal, describeSchedule, formatRunAt, shortLabel, TARGET_KIND_LABEL } from "@/lib/cms/content-schedule-core";
import type { ScheduleRow } from "@/lib/cms/content-schedule-server";
import type { ReleaseRow } from "@/lib/cms/content-release-server";
import {
  addReleaseItemAction,
  cancelReleaseAction,
  createReleaseAction,
  publishReleaseNowAction,
  removeReleaseItemAction,
  scheduleReleaseAction,
  unscheduleReleaseAction,
} from "./release-actions";
import { editHref, TargetSelect, type TargetGroups } from "./schedule-ui";

const BADGE: Record<ReleaseStatus, string> = {
  draft: "bg-[var(--admin-surface)] text-[var(--admin-text-muted)]",
  scheduled: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  published: "bg-[var(--admin-surface)] text-[var(--admin-text)]",
  cancelled: "bg-[var(--admin-surface)] text-[var(--admin-text-faint)]",
};

const BTN =
  "admin-focus inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] ring-1 ring-[var(--admin-border)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]";
const BTN_PRIMARY =
  "admin-focus inline-flex items-center rounded-full bg-[var(--admin-accent)] px-4 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-black hover:brightness-110";
const INPUT =
  "rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]";

function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="release_id" value={id} />;
}

export function ReleasesSection({
  releases,
  rows,
  groups,
  nowIso,
}: {
  releases: ReleaseRow[];
  rows: ScheduleRow[];
  groups: TargetGroups;
  nowIso: string;
}) {
  const itemsBy = new Map<string, ScheduleRow[]>();
  for (const r of rows) if (r.release_id && r.status !== "cancelled") (itemsBy.get(r.release_id) ?? itemsBy.set(r.release_id, []).get(r.release_id)!).push(r);

  return (
    <section id="releases" className="scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold text-[var(--admin-text)]">Releases</h2>
      <p className="mb-3 text-sm text-[var(--admin-text-muted)]">
        A release groups several changes (for example a new home slide, a Shop banner slide and an FAQ answer for a
        holiday) so they all go live, or come down, at the same moment. Nothing in a release happens until you schedule
        it or press Publish now.
      </p>

      <form action={createReleaseAction} className="mb-5 flex flex-wrap items-end gap-3 rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border)] p-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
          New release name
          <input name="name" required maxLength={80} placeholder="Black Friday weekend" className={`${INPUT} min-w-[14rem]`} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
          Note (optional, staff only)
          <input name="note" maxLength={500} placeholder="What this release is for" className={`${INPUT} min-w-[14rem]`} />
        </label>
        <button type="submit" className={BTN_PRIMARY}>Create release</button>
      </form>

      {releases.length === 0 ? (
        <p className="text-sm text-[var(--admin-text-muted)]">No releases yet.</p>
      ) : (
        <div className="space-y-4">
          {releases.map((rel) => {
            const items = itemsBy.get(rel.id) ?? [];
            const open = canDo(rel.status, "add_item");
            return (
              <article
                key={rel.id}
                id={`release-${rel.id}`}
                className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4"
              >
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-[var(--admin-text)]">{rel.name}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${BADGE[rel.status] ?? ""}`}>{rel.status}</span>
                  <span className="text-xs text-[var(--admin-text-muted)]">{summarizeItems(items)}</span>
                </header>
                {rel.note ? <p className="mb-2 text-sm text-[var(--admin-text-muted)]">{rel.note}</p> : null}
                <p className="mb-3 text-sm text-[var(--admin-text)]">
                  {rel.status === "scheduled" && rel.run_at
                    ? `Goes out ${describeSchedule("publish", rel.run_at, nowIso).replace(/^Goes live /, "")}.`
                    : rel.status === "published" && rel.published_at
                      ? `Published ${formatRunAt(rel.published_at)}.`
                      : rel.status === "draft"
                        ? "Draft: on hold until you schedule it or press Publish now."
                        : "Cancelled."}
                </p>

                {items.length > 0 ? (
                  <ul className="mb-3 divide-y divide-[var(--admin-border)] rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)]">
                    {items.map((it) => {
                      const href = editHref(it);
                      return (
                        <li key={it.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                          <span className={`text-xs font-bold uppercase ${it.action === "publish" ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>
                            {it.action === "publish" ? "Go live" : "Come down"}
                          </span>
                          <span className="text-xs text-[var(--admin-text-muted)]">{TARGET_KIND_LABEL[it.target_kind] ?? it.target_kind}</span>
                          {href ? (
                            <a href={href} className="text-[var(--admin-accent)] underline-offset-2 hover:underline">{shortLabel(it.target_label ?? it.target_key)}</a>
                          ) : (
                            <span className="text-[var(--admin-text)]">{shortLabel(it.target_label ?? it.target_key)}</span>
                          )}
                          {it.status === "done" || it.status === "failed" || it.status === "running" ? (
                            <span className={`text-xs ${it.status === "failed" ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"}`}>
                              {it.status}
                              {it.error ? `: ${it.error}` : ""}
                            </span>
                          ) : null}
                          {open && (it.status === "held" || it.status === "pending") ? (
                            <form action={removeReleaseItemAction} className="ml-auto">
                              <Hidden id={rel.id} />
                              <input type="hidden" name="item_id" value={it.id} />
                              <button type="submit" className={BTN}>Remove</button>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {open ? (
                  <div className="space-y-3">
                    <form action={addReleaseItemAction} className="flex flex-wrap items-end gap-3">
                      <Hidden id={rel.id} />
                      <TargetSelect groups={groups} />
                      <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
                        Change
                        <select name="action" defaultValue="publish" className={INPUT}>
                          <option value="publish">Go live</option>
                          <option value="unpublish">Come down</option>
                        </select>
                      </label>
                      <button type="submit" className={BTN}>Add to release</button>
                    </form>

                    <div className="flex flex-wrap items-end gap-3 border-t border-[var(--admin-border)] pt-3">
                      <form action={scheduleReleaseAction} className="flex flex-wrap items-end gap-2">
                        <Hidden id={rel.id} />
                        <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
                          {rel.status === "scheduled" ? "Move to (Pacific time)" : "Schedule for (Pacific time)"}
                          <input type="datetime-local" name="run_at_local" required step={300} defaultValue={defaultRunAtLocal(nowIso)} className={INPUT} />
                        </label>
                        <button type="submit" className={BTN_PRIMARY}>{rel.status === "scheduled" ? "Reschedule" : "Schedule release"}</button>
                      </form>
                      <form action={publishReleaseNowAction}>
                        <Hidden id={rel.id} />
                        <button type="submit" className={BTN}>Publish now</button>
                      </form>
                      {rel.status === "scheduled" ? (
                        <form action={unscheduleReleaseAction}>
                          <Hidden id={rel.id} />
                          <button type="submit" className={BTN}>Unschedule</button>
                        </form>
                      ) : null}
                      <form action={cancelReleaseAction} className="ml-auto">
                        <Hidden id={rel.id} />
                        <button type="submit" className={`${BTN} hover:text-[var(--admin-danger)]`}>Cancel release</button>
                      </form>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
