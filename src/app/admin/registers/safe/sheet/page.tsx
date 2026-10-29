import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { formatCents, overShortLabel, denomTotalMinor } from "@/lib/registers/cash";
import { pacificToday } from "@/lib/reports/timezone";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import { SAFE_TARGET_MINOR } from "@/lib/registers/safe-core";
import { listSafeCountsRange, listSwapsRange } from "@/lib/registers/safe-store";
import { listEmployees } from "@/lib/staffing/store";
import {
  MASTER_TILL_STANDARD,
  WINDOW_WORD,
  mixCheck,
  mixRows,
  pacificTime,
  sheetCountFromRow,
  sheetSwapFromRow,
  sortForSheet,
} from "@/lib/registers/master-till-core";

/**
 * /admin/registers/safe/sheet?day=YYYY-MM-DD — the printable master till sheet.
 *
 * Fix Phase 2.7a (G-09 requirement 1, F-00-8). The owner: "I want to make sure
 * the master till spreadsheet is built … This should be exportable and
 * printable." One business day: the D11 standard, every count (AM, PM, then
 * extras) with each denomination's count and difference, the total, the
 * variance, the mix, who counted, the reason and notes, then the day's
 * change swaps and sign-off lines. Same black-on-white style as the
 * End-of-day report. Little-safe exchanges are not in the app yet (G-02):
 * the sheet says so and points to paper form 8.2.
 *
 * Same permission as the history it prints (inventory.manage). A bad day is
 * refused with a message, never replaced with today (F-03-8 rule).
 */

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

function fmtDay(ymd: string): string {
  try {
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return ymd;
  }
}

function signedDiff(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`;
}

function SignLine({ label }: { label: string }) {
  return (
    <div>
      <div className="h-10 border-b border-black/60" />
      <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-black/60">{label}</p>
    </div>
  );
}

export default async function MasterTillSheetPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const sp = await searchParams;
  await requirePermission("inventory.manage");
  const crumbs = (
    <div className="print:hidden">
      <Breadcrumbs
        items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Safe", href: `${BASE}/safe` }, { label: "Master till sheet" }]}
      />
    </div>
  );

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        {crumbs}
        <EmptyState title="Supabase not configured" description="Connect the service role key to print the master till sheet." />
      </div>
    );
  }

  const dayRes = parseBusinessDay(sp.day, pacificToday());
  if (!dayRes.ok) {
    return (
      <div className="space-y-6">
        {crumbs}
        <EmptyState title="That day could not be read" description={`${dayRes.error} Nothing is shown in its place.`} />
      </div>
    );
  }
  const day = dayRes.day;

  const [countsRes, swapsRes, employees] = await Promise.all([
    listSafeCountsRange(day, day),
    listSwapsRange(day, day),
    listEmployees({ includeInactive: true }),
  ]);
  const empName = new Map(employees.map((e) => [e.id, e.full_name]));
  const nameFor = (id: string | null): string => (id ? (empName.get(id) ?? "\u2014") : "\u2014");
  const counts = sortForSheet(countsRes.counts.map((r) => sheetCountFromRow(r, nameFor)));
  const swaps = [...swapsRes.swaps].reverse().map((r) => sheetSwapFromRow(r, nameFor));
  const problems = [
    countsRes.error ? `Counts could not all be read: ${countsRes.error}` : null,
    swapsRes.error ? `Change swaps could not all be read: ${swapsRes.error}` : null,
  ].filter((x): x is string => x != null);
  const notReady = !countsRes.ready || !swapsRes.ready;
  const stdRows = mixRows(MASTER_TILL_STANDARD);
  const shownKeys = new Set(
    stdRows.filter((r) => r.standard > 0 || counts.some((c) => c.denoms[r.key] > 0)).map((r) => r.key),
  );
  const exportBase = `${BASE}/safe/export?from=${day}&to=${day}`;

  return (
    <div>
      {crumbs}
      <div className="ticket-print mx-auto mt-4 max-w-4xl bg-white px-8 py-8 text-black">
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <p className="text-xl font-black uppercase tracking-tight">Greenway Marijuana</p>
            <p className="text-xs uppercase tracking-[0.18em] text-black/60">Master till sheet · {formatCents(SAFE_TARGET_MINOR)} change fund</p>
            <p className="mt-1 text-sm font-bold">{fmtDay(day)}</p>
          </div>
          <PrintButton />
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 print:hidden">
          <form method="get" action={`${BASE}/safe/sheet`} className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold uppercase tracking-[0.12em] text-black/60">
              Business day
              <input type="date" name="day" defaultValue={day} required className="ml-2 rounded border border-black/40 px-2 py-1 text-sm text-black" />
            </label>
            <button type="submit" className="rounded border-2 border-black px-3 py-1 text-xs font-black uppercase tracking-[0.1em]">
              Show day
            </button>
          </form>
          {problems.length === 0 && !notReady ? (
            <p className="text-xs font-bold uppercase tracking-[0.1em]">
              Export:{" "}
              <a className="underline" href={`${exportBase}&format=csv`}>
                CSV
              </a>{" "}
              ·{" "}
              <a className="underline" href={`${exportBase}&format=xlsx`}>
                Excel
              </a>
            </p>
          ) : (
            <p className="text-xs text-black/60">Export is off until every record reads.</p>
          )}
        </div>

        {notReady ? (
          <p className="mt-4 rounded border-2 border-black px-3 py-2 text-sm" role="alert">
            Safe tracking is not set up yet: run migration 0135_safe_counts_swaps.sql. Use paper form 8.1 (SOP-02).
          </p>
        ) : null}
        {problems.length > 0 ? (
          <div className="mt-4 rounded border-2 border-black px-3 py-2 text-sm" role="alert">
            <p className="font-black uppercase tracking-[0.1em]">⚠ This sheet may be incomplete. Do not file it.</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Counts: denominations down, Standard then each count across */}
        <h2 className="mt-5 text-xs font-black uppercase tracking-[0.18em]">Counts</h2>
        {counts.length === 0 ? (
          <p className="mt-2 text-sm">No master till count was recorded for this day.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr className="border-b-2 border-black">
                  <th className="py-1 pr-2 text-left">Denomination</th>
                  <th className="py-1 pr-2 text-right">Standard (D11)</th>
                  {counts.map((c) => (
                    <th key={c.id} className="py-1 pr-2 text-right" colSpan={2}>
                      {WINDOW_WORD[c.window] ?? c.window} · {pacificTime(c.countedAt)}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-black/40 text-[0.65rem] uppercase text-black/60">
                  <th />
                  <th />
                  {counts.map((c) => [
                    <th key={`${c.id}-c`} className="pr-2 text-right">
                      Counted
                    </th>,
                    <th key={`${c.id}-d`} className="pr-2 text-right">
                      Diff
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {stdRows
                  .filter((r) => shownKeys.has(r.key))
                  .map((r) => (
                    <tr key={r.key} className="border-b border-black/10">
                      <td className="py-0.5 pr-2 font-bold">{r.label}</td>
                      <td className="py-0.5 pr-2 text-right">{r.standard}</td>
                      {counts.map((c) => {
                        const n = c.denoms[r.key];
                        const d = n - r.standard;
                        return [
                          <td key={`${c.id}-c`} className="py-0.5 pr-2 text-right">
                            {n}
                          </td>,
                          <td key={`${c.id}-d`} className={`py-0.5 pr-2 text-right ${d === 0 ? "text-black/40" : "font-black"}`}>
                            {signedDiff(d)}
                          </td>,
                        ];
                      })}
                    </tr>
                  ))}
                <tr className="border-t-2 border-black font-black">
                  <td className="py-1 pr-2">Total</td>
                  <td className="py-1 pr-2 text-right">{formatCents(denomTotalMinor(MASTER_TILL_STANDARD))}</td>
                  {counts.map((c) => (
                    <td key={c.id} className="py-1 pr-2 text-right" colSpan={2}>
                      {formatCents(c.totalMinor)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-0.5 pr-2 font-bold">Over / short</td>
                  <td />
                  {counts.map((c) => (
                    <td key={c.id} className="py-0.5 pr-2 text-right" colSpan={2}>
                      {overShortLabel(c.varianceMinor)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-0.5 pr-2 font-bold">Mix</td>
                  <td />
                  {counts.map((c) => {
                    const m = mixCheck(c.denoms);
                    return (
                      <td key={c.id} className="py-0.5 pr-2 text-right" colSpan={2}>
                        {m.onStandard ? "On standard" : "Off standard"}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="py-0.5 pr-2 font-bold">Counted by</td>
                  <td />
                  {counts.map((c) => (
                    <td key={c.id} className="py-0.5 pr-2 text-right" colSpan={2}>
                      {c.countedByName}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <ul className="mt-2 space-y-0.5 text-xs">
              {counts
                .filter((c) => c.reason || c.notes)
                .map((c) => (
                  <li key={c.id}>
                    <strong>
                      {WINDOW_WORD[c.window] ?? c.window} · {pacificTime(c.countedAt)}:
                    </strong>{" "}
                    {c.reason ? `Reason: ${c.reason}. ` : ""}
                    {c.notes ? `Notes: ${c.notes}` : ""}
                  </li>
                ))}
            </ul>
          </div>
        )}

        <h2 className="mt-6 text-xs font-black uppercase tracking-[0.18em]">Register change swaps (till ↔ master till)</h2>
        {swaps.length === 0 ? (
          <p className="mt-2 text-sm">No change swaps recorded for this day.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2 text-right">Amount (one side)</th>
                <th className="py-1 pr-2">Performed by</th>
                <th className="py-1 pr-2">Approved by</th>
                <th className="py-1">Notes</th>
              </tr>
            </thead>
            <tbody>
              {swaps.map((s) => (
                <tr key={s.id} className="border-b border-black/10">
                  <td className="py-0.5 pr-2">{pacificTime(s.occurredAt)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{formatCents(s.amountMinor)}</td>
                  <td className="py-0.5 pr-2">{s.performedByName}</td>
                  <td className="py-0.5 pr-2">{s.approvedByName}</td>
                  <td className="py-0.5">{s.notes ?? "\u2014"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-black font-black">
                <td className="py-1 pr-2">{swaps.length} swaps</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatCents(swaps.reduce((a, s) => a + s.amountMinor, 0))}</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        )}

        <h2 className="mt-6 text-xs font-black uppercase tracking-[0.18em]">Master till ↔ little safe exchanges</h2>
        <p className="mt-1 text-xs">Not recorded in the app yet (gap G-02). Attach paper form 8.2 (SOP-02 §4.10) for this day.</p>

        <div className="mt-8 grid grid-cols-2 gap-6">
          <SignLine label="AM counter — signature" />
          <SignLine label="PM counter — signature" />
          <SignLine label="Manager review — signature" />
          <SignLine label="Date reviewed" />
        </div>
        <p className="mt-6 text-[0.65rem] text-black/50">
          Standard mix per owner decision D11. Every count is checked on the server against {formatCents(SAFE_TARGET_MINOR)}; over or short
          by more than $5.00 needs a reason (D7, D16, D21). SOP-02 §4.18.
        </p>
      </div>
    </div>
  );
}
