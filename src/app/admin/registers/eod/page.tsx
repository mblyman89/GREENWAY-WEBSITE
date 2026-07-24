import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { formatCents, overShortLabel } from "@/lib/registers/cash";
import { pacificToday } from "@/lib/reports/timezone";
import { eodData } from "@/lib/registers/eod-store";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

/** Only accept a real YYYY-MM-DD; anything else falls back to today. */
function normalizeDay(raw: string | undefined): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return pacificToday();
}

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

function dash(minor: number | null): string {
  return minor == null ? "—" : formatCents(minor);
}

export default async function EodReportPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const sp = await searchParams;
  await requirePermission("inventory.manage");
  const businessDay = normalizeDay(sp.day);

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "End-of-day report" }]} />
        <EmptyState title="Supabase not configured" description="Connect the service role key to build the end-of-day report." />
      </div>
    );
  }

  const { model } = await eodData(businessDay);
  const { registers, totals, sales, safe } = model;

  return (
    <div>
      <div className="print:hidden">
        <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "End-of-day report" }]} />
      </div>

      <div className="ticket-print mx-auto mt-4 max-w-3xl bg-white px-8 py-8 text-black">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <p className="text-xl font-black uppercase tracking-tight">Greenway Marijuana</p>
            <p className="text-xs uppercase tracking-[0.18em] text-black/60">End-of-day summary report</p>
          </div>
          <PrintButton />
        </div>

        {/* Day + status banner */}
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.2em] text-black/50">Business day</p>
            <p className="text-2xl font-black leading-tight tracking-tight">{fmtDay(businessDay)}</p>
          </div>
          <p
            className={`rounded border-2 px-3 py-1 text-sm font-black uppercase tracking-[0.1em] ${
              model.final ? "border-black" : "border-black/40 text-black/60"
            }`}
          >
            {model.final ? "Final — all drawers closed" : "Preliminary — a drawer is still open"}
          </p>
        </div>

        {/* Sales summary (verified ledger facts) */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Sales (all registers, server-verified)
        </h2>
        <table className="mt-2 w-full text-sm">
          <tbody>
            <tr>
              <td className="py-0.5">Completed sales</td>
              <td className="py-0.5 text-right font-bold tabular-nums">{sales.saleCount}</td>
            </tr>
            <tr>
              <td className="py-0.5">Subtotal</td>
              <td className="py-0.5 text-right font-bold tabular-nums">{formatCents(sales.subtotalMinor)}</td>
            </tr>
            <tr>
              <td className="py-0.5">Tax collected</td>
              <td className="py-0.5 text-right font-bold tabular-nums">{formatCents(sales.taxMinor)}</td>
            </tr>
            <tr className="border-t border-black/20">
              <td className="py-0.5 font-bold">Gross sales</td>
              <td className="py-0.5 text-right font-black tabular-nums">{formatCents(sales.grossMinor)}</td>
            </tr>
            {sales.roundedSaleCount > 0 ? (
              <tr>
                <td className="py-0.5">Cash rounding ({sales.roundedSaleCount} sales)</td>
                <td className="py-0.5 text-right font-bold tabular-nums">{formatCents(sales.roundingMinor)}</td>
              </tr>
            ) : null}
            {sales.medicalSaleCount > 0 ? (
              <tr>
                <td className="py-0.5">Medical sales (tax savings)</td>
                <td className="py-0.5 text-right font-bold tabular-nums">
                  {sales.medicalSaleCount} · {formatCents(sales.medicalSavingsMinor)}
                </td>
              </tr>
            ) : null}
            <tr>
              <td className="py-0.5">Audited no-sale drawer opens</td>
              <td className="py-0.5 text-right font-bold tabular-nums">{sales.noSaleCount}</td>
            </tr>
            {sales.exceptionCount > 0 || sales.pendingCount > 0 ? (
              <tr>
                <td className="py-0.5 font-bold">⚠ Unresolved: exceptions / pending</td>
                <td className="py-0.5 text-right font-black tabular-nums">
                  {sales.exceptionCount} / {sales.pendingCount}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* Per-register tills */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Tills by register
        </h2>
        {registers.length === 0 ? (
          <p className="mt-2 text-sm text-black/60">No drawer sessions on this business day.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-black/30 text-left text-[0.65rem] font-bold uppercase tracking-[0.12em] text-black/60">
                <th className="py-1 pr-2">Register</th>
                <th className="py-1 pr-2 text-right">Opening</th>
                <th className="py-1 pr-2 text-right">Drops</th>
                <th className="py-1 pr-2 text-right">Closed count</th>
                <th className="py-1 pr-2 text-right">Over/short</th>
                <th className="py-1 text-right">Tips</th>
              </tr>
            </thead>
            <tbody>
              {registers.map((r) => (
                <tr key={r.registerId} className="border-b border-black/10">
                  <td className="py-1 pr-2 font-bold">
                    {r.registerName}
                    {r.anyOpen ? <span className="ml-1 text-[0.65rem] font-black uppercase">(open)</span> : null}
                    {r.sessionCount > 1 ? (
                      <span className="ml-1 text-[0.65rem] text-black/50">×{r.sessionCount}</span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCents(r.openingMinor)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.dropCount > 0 ? `${formatCents(r.dropsMinor)} (${r.dropCount})` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{dash(r.closedMinor)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.overShortMinor == null ? "—" : overShortLabel(r.overShortMinor)}
                  </td>
                  <td className="py-1 text-right tabular-nums">{dash(r.tipsMinor)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-black">
                <td className="py-1 pr-2 font-black">Store total</td>
                <td className="py-1 pr-2 text-right font-black tabular-nums">{formatCents(totals.openingMinor)}</td>
                <td className="py-1 pr-2 text-right font-black tabular-nums">
                  {totals.dropCount > 0 ? `${formatCents(totals.dropsMinor)} (${totals.dropCount})` : "—"}
                </td>
                <td className="py-1 pr-2 text-right font-black tabular-nums">{dash(totals.closedMinor)}</td>
                <td className="py-1 pr-2 text-right font-black tabular-nums">
                  {totals.overShortMinor == null ? "—" : overShortLabel(totals.overShortMinor)}
                </td>
                <td className="py-1 text-right font-black tabular-nums">{dash(totals.tipsMinor)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="mt-1 text-[0.65rem] text-black/50">
          Over/short shows only after a manager reconciles a session — blind counts stay blind until then. Tips are
          employee money, listed for the record and never part of drawer math.
        </p>

        {/* Safe */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Safe ($1,000 change fund)
        </h2>
        {!safe.ready ? (
          <p className="mt-2 text-sm text-black/60">
            Safe tracking not set up yet — run migration 0135_safe_counts_swaps.sql to include safe counts and change
            swaps on this report.
          </p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              <tr>
                <td className="py-0.5">AM count</td>
                <td className="py-0.5 text-right font-bold tabular-nums">
                  {safe.amCount ? `${formatCents(safe.amCount.totalMinor)} · ${overShortLabel(safe.amCount.varianceMinor)}` : "Not done"}
                </td>
              </tr>
              <tr>
                <td className="py-0.5">PM count</td>
                <td className="py-0.5 text-right font-bold tabular-nums">
                  {safe.pmCount ? `${formatCents(safe.pmCount.totalMinor)} · ${overShortLabel(safe.pmCount.varianceMinor)}` : "Not done"}
                </td>
              </tr>
              {safe.otherCount > 0 ? (
                <tr>
                  <td className="py-0.5">Extra counts</td>
                  <td className="py-0.5 text-right font-bold tabular-nums">{safe.otherCount}</td>
                </tr>
              ) : null}
              <tr>
                <td className="py-0.5">Change swaps (value-neutral)</td>
                <td className="py-0.5 text-right font-bold tabular-nums">
                  {safe.swapCount > 0 ? `${safe.swapCount} · ${formatCents(safe.swapsMinor)}` : "None"}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Sign-off */}
        <div className="mt-8 grid grid-cols-2 gap-8 border-t-2 border-black pt-4">
          <div>
            <div className="h-10 border-b border-black/60" />
            <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-black/60">Prepared by (signature)</p>
          </div>
          <div>
            <div className="h-10 border-b border-black/60" />
            <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-black/60">Date / time</p>
          </div>
        </div>
        <p className="mt-3 text-center text-[0.6rem] uppercase tracking-[0.15em] text-black/40">
          Greenway Marijuana · WA license 413541 · file with the day&apos;s physical records
        </p>
      </div>
    </div>
  );
}
