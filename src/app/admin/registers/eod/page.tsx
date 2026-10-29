import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { formatCents, overShortLabel } from "@/lib/registers/cash";
import { pacificToday } from "@/lib/reports/timezone";
import { eodData } from "@/lib/registers/eod-store";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import { denomGridRows } from "@/lib/registers/eod-sheet-core";
import { RegisterCashSpecimen } from "./RegisterCashSpecimen";
import { UndepositedFunds } from "./UndepositedFunds";

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";

/**
 * Fix Phase 2.6b (F-03-8): the date picker. A bad ?day= is refused with a
 * message (parseBusinessDay); it no longer shows today silently.
 */
function DayPicker({ value }: { value: string }) {
  return (
    <form method="get" action={`${BASE}/eod`} className="flex flex-wrap items-end gap-2 print:hidden">
      <label className="text-xs font-bold uppercase tracking-[0.12em] text-black/60">
        Business day
        <input type="date" name="day" defaultValue={value} required className="ml-2 rounded border border-black/40 px-2 py-1 text-sm text-black" />
      </label>
      <button type="submit" className="rounded border-2 border-black px-3 py-1 text-xs font-black uppercase tracking-[0.1em]">
        Show day
      </button>
    </form>
  );
}

function SignLine({ label, name }: { label: string; name?: string | null }) {
  return (
    <div>
      <div className="flex h-10 items-end border-b border-black/60 pb-1 text-xs text-black/50">{name ? `In the app: ${name}` : ""}</div>
      <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-black/60">{label}</p>
    </div>
  );
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

/** Fix Phase 2.7a (G-08 requirement 5): "mix on standard: yes/no" on the safe lines. */
function mixWords(onStandard: boolean | undefined): string {
  if (onStandard === undefined) return "";
  return onStandard ? " · mix on standard: yes" : " · mix on standard: no";
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
  const today = pacificToday();
  const dayCheck = parseBusinessDay(sp.day, today);
  if (!dayCheck.ok) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "End-of-day report" }]} />
        <div className="mx-auto max-w-3xl space-y-4 bg-white px-8 py-8 text-black">
          <p className="rounded border-2 border-black px-3 py-2 text-sm font-bold" role="alert">
            {dayCheck.error}
          </p>
          <DayPicker value={today} />
        </div>
      </div>
    );
  }
  const businessDay = dayCheck.day;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "End-of-day report" }]} />
        <EmptyState title="Supabase not configured" description="Connect the service role key to build the end-of-day report." />
        <RegisterCashSpecimen />
      </div>
    );
  }

  const { model, sheet, readProblems } = await eodData(businessDay);
  const { registers, totals, sales, safe } = model;
  const dep = sheet.deposit;
  const bag = sheet.bag;
  const grid = denomGridRows(bag?.nightDenoms ?? null, bag?.morningDenoms ?? null);
  const exportBase = `${BASE}/eod/export?day=${businessDay}`;

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

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 print:hidden">
          <DayPicker value={businessDay} />
          {readProblems.length === 0 ? (
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
            <p className="text-xs text-black/60">Export is off until every record reads (see the warning below).</p>
          )}
        </div>

        {readProblems.length > 0 ? (
          <div className="mt-4 rounded border-2 border-black px-3 py-2 text-sm" role="alert">
            <p className="font-black uppercase tracking-[0.1em]">⚠ This report may be incomplete. Do not file it.</p>
            <ul className="mt-1 list-disc pl-5">
              {readProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Reload in a minute. If it keeps failing, tell the owner and use the close slips (SOP-03 §6).</p>
          </div>
        ) : null}

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

        {/* Deposit by till (G-15 requirement 1; SOP-03 §4.1) */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Deposit: what goes in the bag
        </h2>
        {dep.sessionCount === 0 ? (
          <p className="mt-2 text-sm text-black/60">No drawer sessions to deposit from.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-black/30 text-left text-[0.65rem] font-bold uppercase tracking-[0.12em] text-black/60">
                <th className="py-1 pr-2">Till</th>
                <th className="py-1 pr-2 text-right">Closing count</th>
                <th className="py-1 pr-2 text-right">− Float</th>
                <th className="py-1 pr-2 text-right">= Takings</th>
                <th className="py-1 pr-2 text-right">+ Drops</th>
                <th className="py-1 text-right">To the bag</th>
              </tr>
            </thead>
            <tbody>
              {dep.lines.map((l) => (
                <tr key={l.sessionId} className="border-b border-black/10">
                  <td className="py-1 pr-2 font-bold">{l.registerName}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCents(l.closingMinor)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCents(l.floatMinor)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCents(l.takingsMinor)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.dropsMinor > 0 ? formatCents(l.dropsMinor) : "—"}</td>
                  <td className="py-1 text-right font-bold tabular-nums">{formatCents(l.toBagMinor)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-black">
                <td className="py-1 pr-2 font-black" colSpan={3}>
                  Expected deposit (takings {formatCents(dep.totalTakingsMinor)} + drops {formatCents(dep.totalDropsMinor)})
                </td>
                <td className="py-1 text-right font-black tabular-nums" colSpan={3}>
                  {dep.expectedMinor === null ? "Cannot be worked out" : formatCents(dep.expectedMinor)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {dep.problems.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 text-xs font-bold">
            {dep.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        {/* Cash check with refunds (G-15 requirement 3; F-03-6) */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Cash check (refunds taken off)
        </h2>
        <table className="mt-2 w-full text-sm">
          <tbody>
            <tr>
              <td className="py-0.5">Cash sales ({sheet.cash.cashSaleCount}, with rounding)</td>
              <td className="py-0.5 text-right font-bold tabular-nums">{formatCents(sheet.cash.cashSalesMinor)}</td>
            </tr>
            <tr>
              <td className="py-0.5">
                Voided sales ({sheet.refunds.summary.voidCount}) and counter returns ({sheet.refunds.summary.returnCount}) paid from drawers
              </td>
              <td className="py-0.5 text-right font-bold tabular-nums">-{formatCents(sheet.refunds.fromDrawersMinor)}</td>
            </tr>
            <tr className="border-t border-black/20">
              <td className="py-0.5 font-bold">Net cash from sales</td>
              <td className="py-0.5 text-right font-black tabular-nums">
                {sheet.netCashMinor === null ? "Cannot be worked out" : formatCents(sheet.netCashMinor)}
              </td>
            </tr>
            <tr>
              <td className="py-0.5">Expected deposit − net cash (should match the drawers&apos; total over/short)</td>
              <td className="py-0.5 text-right font-bold tabular-nums">
                {sheet.differenceMinor === null ? "—" : overShortLabel(sheet.differenceMinor)}
              </td>
            </tr>
            {sheet.refunds.fromSafeMinor > 0 ? (
              <tr>
                <td className="py-0.5">Refunds paid from the safe (not drawer cash)</td>
                <td className="py-0.5 text-right font-bold tabular-nums">{formatCents(sheet.refunds.fromSafeMinor)}</td>
              </tr>
            ) : null}
            {sheet.cash.otherTenderCount > 0 ? (
              <tr>
                <td className="py-0.5">Other tender, not cash ({sheet.cash.otherTenderCount})</td>
                <td className="py-0.5 text-right font-bold tabular-nums">{formatCents(sheet.cash.otherTenderMinor)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {sheet.netCashProblem ? <p className="mt-1 text-xs font-bold">{sheet.netCashProblem}</p> : null}

        {/* The day's bag, by denomination (G-15 requirement 2; G-04) */}
        <h2 className="mt-6 border-b border-black/30 pb-1 text-sm font-black uppercase tracking-[0.15em]">
          Deposit bag{bag ? ` ${bag.bagNo} · ${bag.stageLabel}` : ""}
        </h2>
        {!bag ? (
          <p className="mt-2 text-sm text-black/60">{sheet.bagNote}</p>
        ) : (
          <>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-black/30 text-left text-[0.65rem] font-bold uppercase tracking-[0.12em] text-black/60">
                  <th className="py-1 pr-2">Denomination</th>
                  <th className="py-1 pr-2 text-right">Night qty</th>
                  <th className="py-1 pr-2 text-right">Night</th>
                  <th className="py-1 pr-2 text-right">Morning qty</th>
                  <th className="py-1 text-right">Morning</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((g) => (
                  <tr key={g.key} className="border-b border-black/10">
                    <td className="py-0.5 pr-2">{g.label}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{g.nightQty ?? "—"}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{g.nightMinor === null ? "—" : formatCents(g.nightMinor)}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{g.morningQty ?? "—"}</td>
                    <td className="py-0.5 text-right tabular-nums">{g.morningMinor === null ? "—" : formatCents(g.morningMinor)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-black">
                  <td className="py-1 pr-2 font-black">Counted</td>
                  <td className="py-1 pr-2 text-right font-black tabular-nums" colSpan={2}>
                    {bag.nightShown ? formatCents(bag.nightCountMinor) : "hidden until the morning recount"}
                  </td>
                  <td className="py-1 text-right font-black tabular-nums" colSpan={2}>
                    {bag.morningCountMinor === null ? "not recounted yet" : formatCents(bag.morningCountMinor)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-xs">
              {bag.againstExpectedMinor === null ? "" : `Bag against expected deposit: ${overShortLabel(bag.againstExpectedMinor)}. `}
              {bag.varianceReason ? `Reason: ${bag.varianceReason}. ` : ""}
              {bag.sealedByName ? `Sealed by ${bag.sealedByName}. ` : ""}
              {bag.bankedOn ? `Taken to the bank ${bag.bankedOn}.` : ""}
            </p>
          </>
        )}

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
              <td className="py-0.5 font-bold">Gross sales (not the cash: see Cash check)</td>
              <td className="py-0.5 text-right font-black tabular-nums">{formatCents(sales.grossMinor)}</td>
            </tr>
            {sales.roundedSaleCount > 0 ? (
              <tr>
                <td className="py-0.5">Cash rounding ({sales.roundedSaleCount} sales)</td>
                <td className="py-0.5 text-right font-bold tabular-nums">{formatCents(sales.roundingMinor)}</td>
              </tr>
            ) : null}
            {sales.employeeTabCount ? (
              <tr>
                <td className="py-0.5">Employee tab, no cash ({sales.employeeTabCount})</td>
                <td className="py-0.5 text-right font-bold tabular-nums">-{formatCents(sales.employeeTabMinor ?? 0)}</td>
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
          <p className="mt-2 text-sm text-black/60">
            {readProblems.some((p) => p.startsWith("Drawer sessions") || p.startsWith("Registers"))
              ? "The drawer sessions could not be read (see the warning at the top). This is not \"no drawers\"."
              : "No drawer sessions on this business day."}
          </p>
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
                  {safe.amCount ? `${formatCents(safe.amCount.totalMinor)} · ${overShortLabel(safe.amCount.varianceMinor)}${mixWords(safe.amCount.mixOnStandard)}` : "Not done"}
                </td>
              </tr>
              <tr>
                <td className="py-0.5">PM count</td>
                <td className="py-0.5 text-right font-bold tabular-nums">
                  {safe.pmCount ? `${formatCents(safe.pmCount.totalMinor)} · ${overShortLabel(safe.pmCount.varianceMinor)}${mixWords(safe.pmCount.mixOnStandard)}` : "Not done"}
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
        {safe.ready ? (
          <p className="mt-1 text-xs print:hidden">
            <a className="underline" href={`${BASE}/safe/sheet?day=${businessDay}`}>
              Master till sheet for this day
            </a>{" "}
            (every denomination against the standard; print or export).
          </p>
        ) : null}

        {/* Sign-off */}
        <div className="mt-8 grid grid-cols-2 gap-8 border-t-2 border-black pt-4">
          <SignLine label="Night count, prepared by (signature)" name={bag?.nightCountedByName} />
          <SignLine label="Date / time" />
          <SignLine label="Morning recount and verify, a different employee (signature)" name={bag?.morningCountedByName} />
          <SignLine label="Date / time" />
        </div>
        <p className="mt-3 text-center text-[0.6rem] uppercase tracking-[0.15em] text-black/40">
          Greenway Marijuana · WA license 413541 · file with the day&apos;s physical records
        </p>

        <UndepositedFunds />
        <RegisterCashSpecimen />
      </div>
    </div>
  );
}
