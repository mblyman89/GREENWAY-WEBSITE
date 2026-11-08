/**
 * D210d: who on the clock is selling right now. Server-rendered markup.
 *
 * TODAY shows counts only (sales rung, items, items per sale, sales per hour
 * on the clock, share of today's sales). Same-day per-person dollars could
 * rebuild a drawer's expected cash and defeat the blind count (B34), so they
 * are never shown here. The 7-day gross spans finished, reconciled days.
 */
import type { OnShiftBoard as Board } from "@/lib/admin/cockpit-analytics-core";

function money(minor: number): string {
  const abs = Math.abs(Math.round(minor));
  return `${minor < 0 ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}`;
}

function onClock(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function OnShiftBoard({ board }: { board: Board }) {
  if (board.rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--admin-text-faint)]">
        Nobody is on the clock right now{board.totalSalesToday > 0 ? ` (${board.totalSalesToday} sales rung today)` : ""}.
      </p>
    );
  }
  const maxSales = Math.max(1, ...board.rows.map((r) => r.saleCount));
  const maxWeek = Math.max(1, ...board.rows.map((r) => r.weekGrossMinor));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--admin-text-faint)]">
            <th className="w-8 pb-2">#</th>
            <th className="pb-2">On the clock</th>
            <th className="pb-2">Sales today</th>
            <th className="pb-2 text-right">Items</th>
            <th className="pb-2 text-right" title="Items per sale">Items/sale</th>
            <th className="pb-2 text-right" title="Sales rung per hour on the clock">Sales/hr</th>
            <th className="pb-2 text-right" title="Share of every sale rung today">Share</th>
            <th className="pb-2 pl-4">Last 7 days</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r) => (
            <tr key={r.employeeId} className="border-t border-[var(--admin-border)]">
              <td className="py-2 text-xs font-bold text-[var(--admin-text-muted)]">{r.saleCount > 0 ? (r.rankToday === 1 ? "\ud83c\udfc6" : r.rankToday) : "\u2013"}</td>
              <td className="py-2">
                <div className="font-medium text-[var(--admin-text)]">{r.name}</div>
                <div className="text-[11px] text-[var(--admin-text-faint)]">
                  {`${r.role ? `${r.role} \u00b7 ` : ""}${onClock(r.minutesOnClock)} on the clock`}
                </div>
              </td>
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-28 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                    <div className="h-full rounded-full bg-[var(--admin-accent)]" style={{ width: `${(r.saleCount / maxSales) * 100}%` }} />
                  </div>
                  <span className="tabular-nums text-[var(--admin-text)]">{r.saleCount}</span>
                </div>
              </td>
              <td className="py-2 text-right tabular-nums text-[var(--admin-text-muted)]">{r.itemCount}</td>
              <td className="py-2 text-right tabular-nums text-[var(--admin-text-muted)]">{r.itemsPerSale ?? "\u2014"}</td>
              <td className="py-2 text-right tabular-nums text-[var(--admin-text-muted)]">{r.salesPerHour ?? "\u2014"}</td>
              <td className="py-2 text-right tabular-nums text-[var(--admin-text-muted)]">{Math.round(r.shareOfSales * 100)}%</td>
              <td className="py-2 pl-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-20 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                    <div className="h-full rounded-full bg-[var(--admin-gold)]" style={{ width: `${(r.weekGrossMinor / maxWeek) * 100}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-[var(--admin-text-muted)]">
                    {`${money(r.weekGrossMinor)} \u00b7 ${r.weekSaleCount} sales`}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
        Today is counts only (no per-person dollars, to protect the blind drawer count). The 7-day column is gross over finished days.
        {board.offClockSaleCount > 0 ? ` ${board.offClockSaleCount} of today's ${board.totalSalesToday} sales were rung by people now off the clock.` : ""}
      </p>
    </div>
  );
}
