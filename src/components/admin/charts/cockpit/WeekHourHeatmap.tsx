/**
 * D209g: weekday x hour heatmap of average orders (last 28 days). Pure markup
 * (a CSS grid), no chart library and no client JS: it renders on the server.
 * Today's weekday row is outlined, so the owner sees the rush still to come.
 */
import type { WeekHourHeatmap as Heat } from "@/lib/admin/cockpit-analytics-core";
import { dowLabel } from "@/lib/admin/cockpit-analytics-core";
import { formatHourLabel } from "@/lib/reports/timezone";
import { shortHourLabel } from "@/lib/admin/cockpit-extras-core";

const short = (h: number) => shortHourLabel(formatHourLabel(h));

export function WeekHourHeatmap({ heat, todayDow }: { heat: Heat; todayDow: number }) {
  if (!heat.peak) {
    return <p className="py-8 text-center text-sm text-[var(--admin-text-faint)]">Not enough trading days for a weekly pattern yet.</p>;
  }
  const by = new Map(heat.cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[560px] gap-[3px] text-[10px]"
        style={{ gridTemplateColumns: `40px repeat(${heat.hours.length}, minmax(0, 1fr))` }}
        role="table"
        aria-label="Average orders by weekday and hour, last 28 days"
      >
        <div />
        {heat.hours.map((h) => (
          <div key={h} className="text-center text-[var(--admin-text-faint)]">
            {short(h)}
          </div>
        ))}
        {order.map((d) => (
          <div key={d} className="contents" role="row">
            <div className={`flex items-center pr-1 ${d === todayDow ? "font-bold text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"}`}>
              {dowLabel(d)}
              {heat.daysPerDow[d] === 0 ? <span className="ml-0.5 text-[var(--admin-text-faint)]">*</span> : null}
            </div>
            {heat.hours.map((h) => {
              const c = by.get(`${d}:${h}`);
              const i = c?.intensity ?? 0;
              return (
                <div
                  key={h}
                  role="cell"
                  className={`h-6 rounded-sm ${d === todayDow ? "ring-1 ring-[var(--admin-accent)]/40" : ""}`}
                  style={{ background: i > 0 ? `rgba(126,217,87,${0.08 + i * 0.82})` : "rgba(255,255,255,0.03)" }}
                  title={`${dowLabel(d)} ${formatHourLabel(h)}: ${c?.avgOrders ?? 0} orders on average (${heat.daysPerDow[d]} trading days)`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--admin-text-faint)]">
        <span>Fewer</span>
        {[0.1, 0.3, 0.5, 0.7, 0.9].map((x) => (
          <span key={x} className="h-2.5 w-5 rounded-sm" style={{ background: `rgba(126,217,87,${0.08 + x * 0.82})` }} />
        ))}
        <span>More orders</span>
        <span className="ml-auto">
          Peak: {dowLabel(heat.peak.dow)} {formatHourLabel(heat.peak.hour)} ({heat.peak.avgOrders} orders on average)
        </span>
      </div>
    </div>
  );
}
