/**
 * R46: shared pieces of the Schedule & Releases page (server components).
 */
import {
  describeSchedule,
  formatRunAt,
  shortLabel,
  TARGET_KIND_LABEL,
  type ScheduleTargetKind,
} from "@/lib/cms/content-schedule-core";
import type { ScheduleRow, ScheduleTargetOption } from "@/lib/cms/content-schedule-server";
import { cancelScheduleAction } from "./actions";

export const SCHEDULE_ROUTE = "/admin/content/schedule";
const ROUTE = SCHEDULE_ROUTE;

/** Where to edit each kind of item. */
export function editHref(r: { target_kind: ScheduleTargetKind; target_key: string }): string | null {
  switch (r.target_kind) {
    case "carousel_slide":
      return `/admin/pages/home?tab=carousel#slide-${r.target_key}`;
    case "shop_slide":
      return `/admin/content/shop-banner#slide-${r.target_key}`;
    case "faq_item":
      return `/admin/pages/faq?tab=qanda#faq-${r.target_key}`;
    default:
      return null;
  }
}

const STATUS_STYLE: Record<string, string> = {
  pending: "text-[var(--admin-accent)]",
  running: "text-[var(--admin-gold)]",
  held: "text-[var(--admin-text-muted)]",
  done: "text-[var(--admin-text-muted)]",
  failed: "text-[var(--admin-danger)]",
  cancelled: "text-[var(--admin-text-faint)]",
};

export type TargetGroups = { group: string; options: ScheduleTargetOption[] }[];

export function groupTargets(targets: ScheduleTargetOption[]): TargetGroups {
  const map = new Map<string, ScheduleTargetOption[]>();
  for (const t of targets) {
    const list = map.get(t.group) ?? [];
    list.push(t);
    map.set(t.group, list);
  }
  return [...map.entries()].map(([group, options]) => ({ group, options }));
}

export function TargetSelect({ groups }: { groups: TargetGroups }) {
  return (
    <label className="flex min-w-[16rem] flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
      Item
      <select name="target" required defaultValue="" className="max-w-[28rem] rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text)]">
        <option value="" disabled>
          Choose a slide, section, question or wording…
        </option>
        {groups.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={`${o.kind}|${o.key}`} value={`${o.kind}|${o.key}`}>
                {shortLabel(o.label, 80)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function ScheduleTable({
  rows,
  nowIso,
  cancellable = false,
}: {
  rows: ScheduleRow[];
  nowIso: string;
  cancellable?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)]">
      <table className="w-full text-left text-sm">
        <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
          <tr>
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Change</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = editHref(r);
            return (
              <tr key={r.id} className="border-t border-[var(--admin-border)] align-top">
                <td className="px-3 py-2 text-[var(--admin-text)]">
                  {r.status === "done" && r.ran_at
                    ? formatRunAt(r.ran_at)
                    : r.run_at
                      ? describeSchedule(r.action, r.run_at, nowIso).replace(/^(Goes live|Comes down) /, "")
                      : "No time yet"}
                </td>
                <td className="px-3 py-2">{r.action === "publish" ? "Go live" : "Come down"}</td>
                <td className="px-3 py-2">
                  <div className="text-xs text-[var(--admin-text-muted)]">{TARGET_KIND_LABEL[r.target_kind] ?? r.target_kind}</div>
                  {href ? (
                    <a href={href} className="text-[var(--admin-accent)] underline-offset-2 hover:underline">{shortLabel(r.target_label ?? r.target_key)}</a>
                  ) : (
                    <span className="text-[var(--admin-text)]">{shortLabel(r.target_label ?? r.target_key)}</span>
                  )}
                </td>
                <td className={`px-3 py-2 font-semibold ${STATUS_STYLE[r.status] ?? ""}`}>
                  {r.status}
                  {r.error ? <div className="max-w-xs text-xs font-normal text-[var(--admin-danger)]">{r.error}</div> : null}
                </td>
                <td className="px-3 py-2 text-right">
                  {cancellable && r.status === "pending" ? (
                    <form action={cancelScheduleAction}>
                      <input type="hidden" name="schedule_id" value={r.id} />
                      <input type="hidden" name="return_to" value={ROUTE} />
                      <button type="submit" className="admin-focus rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--admin-text-muted)] ring-1 ring-[var(--admin-border)] hover:text-[var(--admin-text)]">
                        Cancel
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
