/**
 * src/components/admin/promotions/WeeklyScheduleStrip.tsx
 *
 * A friendly 7-day "what runs when" visual for the promotions list. Recurring
 * weekday deals (e.g. the Thursday brand selector) land on their day; dated
 * one-off promos are summarized separately below. Today's column is
 * highlighted so staff instantly see what's live now.
 *
 * Server component, presentational. The page maps PromotionRows into the
 * lightweight shape below.
 */
import Link from "next/link";
import { WEEKDAY_LABELS } from "@/lib/promotions/types";
import type { Weekday, PostStatus } from "@/lib/promotions/types";

export type ScheduleItem = {
  id: string;
  title: string;
  status: PostStatus;
  weekday: Weekday | null;
};

const DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

const STATUS_DOT: Record<PostStatus, string> = {
  published: "bg-[#7ed957]",
  scheduled: "bg-[#ffd700]",
  draft: "bg-white/30",
  archived: "bg-white/15",
};

export function WeeklyScheduleStrip({
  items,
  todayWeekday,
}: {
  items: ScheduleItem[];
  todayWeekday: Weekday;
}) {
  const recurring = items.filter((i) => i.weekday !== null);
  const dated = items.filter((i) => i.weekday === null);

  const byDay = new Map<Weekday, ScheduleItem[]>();
  for (const d of DAYS) byDay.set(d, []);
  for (const item of recurring) byDay.get(item.weekday as Weekday)!.push(item);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
      <h3 className="text-sm font-semibold text-white">Weekly schedule</h3>
      <p className="mt-1 text-xs text-white/40">Recurring weekday deals at a glance. Today is highlighted.</p>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {DAYS.map((day) => {
          const dayItems = byDay.get(day)!;
          const isToday = day === todayWeekday;
          return (
            <div
              key={day}
              className={`min-h-24 rounded-lg border p-2 ${
                isToday ? "border-[#7ed957]/50 bg-[#7ed957]/5" : "border-white/10 bg-black/30"
              }`}
            >
              <p className={`text-center text-[10px] font-semibold uppercase ${isToday ? "text-[#7ed957]" : "text-white/40"}`}>
                {WEEKDAY_LABELS[day].slice(0, 3)}
              </p>
              <div className="mt-1.5 space-y-1">
                {dayItems.length === 0 && <span className="block text-center text-[10px] text-white/15">—</span>}
                {dayItems.map((it) => (
                  <Link
                    key={it.id}
                    href={`/admin/promotions/${it.id}`}
                    className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-1 text-[10px] text-white/80 transition hover:bg-white/10"
                    title={`${it.title} (${it.status})`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[it.status]}`} />
                    <span className="truncate">{it.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {dated.length > 0 && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Dated / one-off</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {dated.map((it) => (
              <Link
                key={it.id}
                href={`/admin/promotions/${it.id}`}
                className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/70 transition hover:border-[#7ed957]/40"
                title={`${it.title} (${it.status})`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[it.status]}`} />
                {it.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 border-t border-white/5 pt-3 text-[10px] text-white/40">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#7ed957]" /> Live</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#ffd700]" /> Scheduled</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-white/30" /> Draft</span>
      </div>
    </div>
  );
}
