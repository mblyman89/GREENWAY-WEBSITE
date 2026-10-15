/**
 * R41 S4: the "Timberland room left" bar (Guide, payroll, vendor payments).
 *
 * Today: what is in process at Timberland right now (released, not voided,
 * not prenote, not yet settled) against the $50,000 daily in-process limit.
 * This month: everything uploaded or effective this month (Q3 strict) against
 * the $100,000 monthly limit. Gold at 80%; a failed read says so and is never
 * shown as all clear. Server component; reads only.
 */
import { loadTimberlandRoomLeft } from "@/lib/payments/ach-file-ledger-store";
import { LIMIT_DAILY_IN_PROCESS_CENTS, LIMIT_MONTHLY_CENTS, centsToUsdText } from "@/lib/payments/timberland-profile-core";
import { friendlyMonth } from "@/lib/payments/timberland-limits-core";

function Bar({ label, usedCents, limitCents, warn }: { label: string; usedCents: number; limitCents: number; warn: boolean }) {
  const pct = Math.min(100, Math.round((usedCents * 100) / limitCents));
  const room = Math.max(0, limitCents - usedCents);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-white">{label}</span>
        <span className={warn ? "text-[var(--admin-gold)]" : "text-white/60"}>
          ${centsToUsdText(room)} room left of ${centsToUsdText(limitCents)} (${centsToUsdText(usedCents)} used)
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded bg-white/10" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={`h-full ${warn ? "bg-[var(--admin-gold)]" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export async function TimberlandRoomLeft({ today }: { today: string }) {
  const r = await loadTimberlandRoomLeft(today);
  if (!r.ok) {
    return (
      <div role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
        {r.error}
      </div>
    );
  }
  const room = r.room;
  return (
    <section aria-label="Timberland room left" className="space-y-3 rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-semibold text-white">Timberland room left</h2>
      <Bar label="Today (in process until each file settles)" usedCents={room.todayInProcessCents} limitCents={LIMIT_DAILY_IN_PROCESS_CENTS} warn={room.todayWarn} />
      <Bar label={`${friendlyMonth(room.month)} (uploaded or effective this month)`} usedCents={room.monthUsedCents} limitCents={LIMIT_MONTHLY_CENTS} warn={room.monthWarn} />
      <p className="text-xs text-white/50">
        These are Timberland&apos;s limits (Schedule C). A file that would go over is refused and cannot be overridden; the refusal names the earliest
        date it would fit. Prenotes do not count; test credits do.
      </p>
    </section>
  );
}
