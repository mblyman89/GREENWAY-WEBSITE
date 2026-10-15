/**
 * R54 Slice B — month calendar of scheduled banners (server component, no JS).
 * Shared by any banner area (R58): pass CalendarBanner[] and an anchor id prefix.
 * Shows this month and next. ⚠️ marks days where 2+ banners START.
 */
import {
  STORE_TZ,
  WEEKDAYS,
  WEEKDAY_LABEL,
  buildScheduleCalendar,
  storeParts,
  type CalendarBanner,
} from "@/lib/cms/banner-schedule-core";

const COLORS = ["#7ed957", "#ffd700", "#ff7f00", "#5ec8f8", "#e879f9", "#f87171", "#a3e635", "#fbbf24"];

function nextMonth(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function BannerScheduleCalendar({
  banners,
  anchorPrefix,
  nowMs,
}: {
  banners: CalendarBanner[];
  /** e.g. "slide-" → chips link to #slide-<id>. */
  anchorPrefix: string;
  nowMs: number;
}) {
  const today = storeParts(nowMs, STORE_TZ).date;
  const color = new Map(banners.map((b, i) => [b.id, COLORS[i % COLORS.length]!]));
  const months = [today, nextMonth(today)];
  const fallbacks = banners.filter((b) => b.fallback);
  const anyScheduled = banners.some((b) => !b.fallback && (b.schedule.start || b.schedule.end || b.schedule.days.length || (b.schedule.from && b.schedule.to)));
  const clashDays = months.flatMap((m) => buildScheduleCalendar(banners, m, today).filter((d) => d.inMonth && d.startClash && d.date >= today));

  return (
    <details className="rounded-lg border border-white/10 p-3" open={clashDays.length > 0}>
      <summary className="cursor-pointer text-sm font-semibold text-white">
        🗓️ Schedule calendar{" "}
        <span className="font-normal text-white/50">
          (published slides · store time)
          {clashDays.length ? <span className="ml-2 text-amber-300">⚠️ {clashDays.length} day(s) with 2+ slides starting</span> : null}
        </span>
      </summary>
      <div className="mt-3 space-y-4">
        {fallbacks.length === 0 ? (
          <p className="text-xs text-amber-300">
            ⚠️ No fallback slide is set. If every scheduled slide ends, the homepage falls back to the built-in starter slides. Tick
            &ldquo;Fallback slide&rdquo; on one slide&apos;s schedule to choose what shows instead.
          </p>
        ) : (
          <p className="text-xs text-white/50">Fallback: {fallbacks.map((f) => f.label).join(", ")}. Shows whenever no other slide is live.</p>
        )}
        {!anyScheduled ? <p className="text-xs text-white/50">No slide has a schedule yet. Slides without one show every day and are left off the calendar.</p> : null}
        {months.map((m) => {
          const days = buildScheduleCalendar(banners, m, today);
          const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m.slice(0, 7)}-01T12:00:00Z`));
          return (
            <div key={m}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">{title}</div>
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 text-[0.68rem]">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="bg-black/60 px-1 py-0.5 text-center font-semibold text-white/50">
                    {WEEKDAY_LABEL[d]}
                  </div>
                ))}
                {days.map((d) => (
                  <div
                    key={d.date}
                    className={`min-h-[3.4rem] bg-black/40 p-1 ${d.inMonth ? "" : "opacity-35"} ${d.isToday ? "ring-1 ring-inset ring-[var(--admin-accent)]" : ""} ${d.startClash ? "bg-amber-500/15" : ""}`}
                    title={d.startClash ? `${d.starts.map((s) => s.label).join(" and ")} all start this day` : undefined}
                  >
                    <div className="flex items-center justify-between text-white/60">
                      <span>{Number(d.date.slice(8, 10))}</span>
                      {d.startClash ? <span aria-label="Two or more slides start this day">⚠️</span> : null}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {d.live.slice(0, 3).map((b) => (
                        <a
                          key={b.id}
                          href={`#${anchorPrefix}${b.id}`}
                          className="block truncate rounded px-1 text-black"
                          style={{ background: color.get(b.id) }}
                        >
                          {d.starts.some((s) => s.id === b.id) ? "▶ " : ""}
                          {b.label}
                        </a>
                      ))}
                      {d.live.length > 3 ? <span className="text-white/50">+{d.live.length - 3} more</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <p className="text-[0.7rem] text-white/40">▶ = starts that day. Click a slide to jump to it. Daily time windows aren&apos;t drawn; see each slide&apos;s summary.</p>
      </div>
    </details>
  );
}
