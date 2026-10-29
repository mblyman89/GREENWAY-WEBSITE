import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { Button, Input } from "@/components/admin/ui";
import { PrintButton } from "@/components/admin/orders/PrintButton";
import { formatCents } from "@/lib/registers/cash";
import { pacificToday } from "@/lib/reports/timezone";
import { backHref } from "@/lib/admin/back-link-core";
import { parseBusinessDay } from "@/lib/registers/deposit-bag-flow-core";
import {
  averageSale,
  discountRate,
  netAfterRefunds,
  untracedNote,
  type ShiftSummary,
} from "@/lib/registers/cashier-report-core";
import { loadCashierReport } from "@/lib/registers/cashier-report-store";

/**
 * /admin/registers/cashiers — Fix Phase 2.1b (G-05, F-01-10).
 *
 * The per-cashier shift summary the owner asked for: "please completely
 * finish G-05 (2.1), the per cashier print out." One printable page per
 * date range: each cashier's sales, payment split, discounts (deal, manager
 * override, loyalty, special program, medical), no-sales with the approving
 * manager, cart adjustments, and the voids and returns of the sales they
 * rang. The X/Z day report stays per register (/api/pos/day-report).
 *
 * Managers and up (inventory.manage), the same gate as Cash drawer reports,
 * because it carries every cashier's cash figures. Read only.
 */

export const dynamic = "force-dynamic";

const BASE = "/admin/registers";
const HERE = `${BASE}/cashiers`;

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--admin-border)]/40 py-1 text-sm print:border-black/20">
      <span className="text-[var(--admin-text-muted)] print:text-black/70">{label}</span>
      <span className="text-right tabular-nums text-[var(--admin-text)] print:text-black">
        {value}
        {sub ? <span className="ml-1 text-xs text-[var(--admin-text-faint)] print:text-black/60">{sub}</span> : null}
      </span>
    </div>
  );
}

function ShiftBlock({ s, nameOf, regName }: { s: ShiftSummary; nameOf: (id: string | null) => string; regName: (id: string) => string }) {
  const kinds = Object.entries(s.discounts.specialByKind);
  return (
    <div className="grid gap-x-8 gap-y-1 md:grid-cols-2 print:grid-cols-2">
      <div>
        <Row label="Sales" value={String(s.saleCount)} sub={`${s.unitCount} units`} />
        <Row label="Gross (tax in)" value={formatCents(s.grossMinor)} />
        <Row label="Pre-tax / tax" value={`${formatCents(s.subtotalMinor)} / ${formatCents(s.taxMinor)}`} />
        <Row label="Average sale" value={formatCents(averageSale(s))} />
        <Row label="Cash" value={formatCents(s.cashGrossMinor)} sub={`${s.cashSaleCount} sales`} />
        <Row label="Employee tab" value={formatCents(s.employeeTabMinor)} sub={`${s.employeeTabCount}`} />
        <Row label="Other tender" value={formatCents(s.otherTenderMinor)} sub={`${s.otherTenderCount}`} />
        <Row label="Cash rounding" value={formatCents(s.roundingMinor)} />
        <Row label="Medical sales" value={String(s.medicalSaleCount)} />
        <Row label="Registers" value={s.registerIds.map(regName).join(", ") || "—"} />
      </div>
      <div>
        <Row label="Discounts total" value={formatCents(s.discounts.totalMinor)} sub={discountRate(s)} />
        <Row label="· Deals and sale prices" value={formatCents(s.discounts.dealMinor)} />
        <Row label="· Manager overrides" value={formatCents(s.discounts.overrideMinor)} sub={`${s.discounts.overrideCount} lines`} />
        <Row label="· Loyalty rewards" value={formatCents(s.discounts.loyaltyMinor)} />
        <Row label="· Special programs" value={formatCents(s.discounts.specialMinor)} sub={kinds.map(([k, v]) => `${k} ×${v.count}`).join(", ")} />
        <Row label="· Medical tax exempt" value={formatCents(s.discounts.medicalMinor)} />
        <Row label="No-sales (drawer opened)" value={String(s.noSaleCount)} />
        <Row
          label="Cart adjustments"
          value={`${s.adjustments.count} · ${formatCents(s.adjustments.valueMinor)}`}
          sub={`${s.adjustments.lineRemove} removed, ${s.adjustments.qtyDecrease} qty down, ${s.adjustments.cartCancel} carts cancelled`}
        />
        <Row label="Voids of their sales" value={`${s.voidCount} · ${formatCents(s.voidMinor)}`} />
        <Row label="Returns of their sales" value={`${s.returnCount} · ${formatCents(s.returnMinor)}`} />
        <Row label="Net after refunds" value={formatCents(netAfterRefunds(s))} />
        {s.exceptionCount + s.pendingCount > 0 ? (
          <Row label="Not counted as money" value={`${s.exceptionCount} exception, ${s.pendingCount} pending`} />
        ) : null}
      </div>
      {s.noSales.length > 0 ? (
        <div className="md:col-span-2 print:col-span-2">
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black/70">No-sale reasons</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-[var(--admin-text)] print:text-black">
            {s.noSales.map((n, i) => (
              <li key={i}>
                {n.reason || "(no reason)"} — approved by {nameOf(n.approvedByEmployeeId)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default async function CashierReportPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  await requirePermission("inventory.manage");
  const today = pacificToday();
  const crumbs = <Breadcrumbs items={[{ label: "Sell" }, { label: "Register Activity", href: BASE }, { label: "Cashier shift report" }]} />;
  const back = (
    <Button href={backHref(BASE, sp.back)} variant="neutral">
      ← Register Activity
    </Button>
  );

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="space-y-6">
        {crumbs}
        <AdminPageHeader title="Cashier shift report" subtitle="Per-cashier sales, discounts, no-sales, adjustments, voids and returns." />
        <EmptyState title="Supabase not configured" description="Connect the service role key to read register activity." />
      </div>
    );
  }

  const fromRes = parseBusinessDay(sp.from, today);
  const toRes = parseBusinessDay(sp.to, fromRes.ok ? (sp.from ? fromRes.day : today) : today);
  const from = fromRes.ok ? fromRes.day : today;
  const to = toRes.ok ? toRes.day : from;
  const inputError = !fromRes.ok ? `From: ${fromRes.error}` : !toRes.ok ? `To: ${toRes.error}` : null;
  const loaded = inputError ? null : await loadCashierReport(from, to);
  const error = inputError ?? (loaded && "error" in loaded ? loaded.error : null);
  const data = loaded && !("error" in loaded) ? loaded : null;
  const nameOf = (id: string | null) => (id ? (data?.names[id] ?? `employee ${id.slice(0, 8)}`) : "—");
  const regName = (id: string) => data?.registers[id] ?? id.slice(0, 8);
  const note = data ? untracedNote(data.report) : null;
  const rangeLabel = from === to ? from : `${from} to ${to}`;

  return (
    <div className="space-y-6">
      <div className="print:hidden">{crumbs}</div>
      <div className="print:hidden">
        <AdminPageHeader
          title="Cashier shift report"
          subtitle="Each cashier's sales, discounts, no-sales, cart adjustments, and the voids and returns of the sales they rang."
          action={back}
          help={
            <HelpPanel id="registers-cashiers" title="How the cashier shift report works (SOP-01 §4.35)">
              <p>
                A <strong>shift</strong> here is one cashier on one Pacific business day. Sales and no-sales come from the register
                events, which always carry the employee who signed in to ring them. Only <strong>processed</strong> sales count as
                money (the same rule as the X/Z report); exceptions and pending sales are shown as counts.
              </p>
              <p className="mt-2">
                <strong>Voids and returns</strong> do not record the cashier, so each is filed against the cashier who rang the
                original sale, on the day of the refund. A refund that cannot be traced to a register sale (an online order) is listed
                separately and given to nobody.
              </p>
              <p className="mt-2">
                <strong>Discounts</strong> are split the way the receipt explains them: deals and sale prices, manager overrides,
                loyalty rewards, special programs (employee, industry, veteran, friends and family) and the medical tax exemption. The
                parts always add up to the total.
              </p>
              <p className="mt-2">Up to 31 days per report. Print it, or download the CSV (one row per shift).</p>
            </HelpPanel>
          }
        />
      </div>

      <div className="space-y-6 px-5 sm:px-8 print:px-0">
        <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:border-0 print:bg-white print:p-0 print:text-black">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--admin-text)] print:text-black">Cashier shift report · {rangeLabel}</h2>
              <p className="text-xs text-[var(--admin-text-muted)] print:text-black/70">
                Greenway Marijuana · WA license 413541 · printed {today}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2 print:hidden">
              <form method="get" action={HERE} className="flex flex-wrap items-end gap-2">
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  From
                  <Input type="date" name="from" defaultValue={from} max={today} />
                </label>
                <label className="block text-xs text-[var(--admin-text-muted)]">
                  To
                  <Input type="date" name="to" defaultValue={to} max={today} />
                </label>
                <Button type="submit" variant="neutral" size="sm">
                  Show
                </Button>
              </form>
              {data ? (
                <Button href={`${HERE}/csv?from=${from}&to=${to}`} variant="neutral" size="sm">
                  Download CSV
                </Button>
              ) : null}
              <PrintButton />
            </div>
          </div>

          {error ? <p className="mt-3 text-sm text-[var(--admin-danger)]">{error}</p> : null}
          {data && data.warnings.length > 0 ? (
            <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)] print:border-black print:bg-white print:text-black">
              <p className="font-semibold">This report is incomplete. Do not file it until it loads cleanly.</p>
              <ul className="mt-1 list-disc pl-5">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data && data.report.cashiers.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">No register activity in this range.</p>
          ) : null}

          {data && data.report.cashiers.length > 0 ? (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--admin-border)] uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black">
                      <th className="py-2 pr-2">Cashier</th>
                      <th className="py-2 pr-2 text-right">Shifts</th>
                      <th className="py-2 pr-2 text-right">Sales</th>
                      <th className="py-2 pr-2 text-right">Gross</th>
                      <th className="py-2 pr-2 text-right">Cash</th>
                      <th className="py-2 pr-2 text-right">Discounts</th>
                      <th className="py-2 pr-2 text-right">No-sales</th>
                      <th className="py-2 pr-2 text-right">Adjustments</th>
                      <th className="py-2 pr-2 text-right">Voids</th>
                      <th className="py-2 pr-2 text-right">Returns</th>
                      <th className="py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.cashiers.map((c) => (
                      <tr key={c.employeeId} className="border-b border-[var(--admin-border)]/50 text-[var(--admin-text)] print:text-black">
                        <td className="py-2 pr-2 font-semibold">{nameOf(c.employeeId)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{c.shifts.length}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{c.saleCount}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatCents(c.grossMinor)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatCents(c.cashGrossMinor)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatCents(c.discounts.totalMinor)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{c.noSaleCount}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{c.adjustments.count}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatCents(c.voidMinor)}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">{formatCents(c.returnMinor)}</td>
                        <td className="py-2 text-right tabular-nums">{formatCents(netAfterRefunds(c))}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold text-[var(--admin-text)] print:text-black">
                      <td className="py-2 pr-2">Store</td>
                      <td className="py-2 pr-2 text-right tabular-nums">—</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{data.report.store.saleCount}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatCents(data.report.store.grossMinor)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatCents(data.report.store.cashGrossMinor)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatCents(data.report.store.discounts.totalMinor)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{data.report.store.noSaleCount}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{data.report.store.adjustments.count}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatCents(data.report.store.voidMinor)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatCents(data.report.store.returnMinor)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCents(netAfterRefunds(data.report.store))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {note ? <p className="mt-3 text-xs text-[var(--admin-gold)] print:text-black">{note}</p> : null}
              {data.report.untracedRefunds.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-[var(--admin-text-muted)] print:text-black/70">
                  {data.report.untracedRefunds.map((r, i) => (
                    <li key={i}>
                      {r.businessDay} · {r.label} · {formatCents(r.refundMinor)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </section>

        {data
          ? data.report.cashiers.map((c) => (
              <section
                key={c.employeeId}
                className="break-inside-avoid rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 print:break-before-page print:border-0 print:bg-white print:p-0 print:text-black"
              >
                <h2 className="text-base font-semibold text-[var(--admin-text)] print:text-black">
                  {nameOf(c.employeeId)} · {rangeLabel}
                </h2>
                <p className="mb-2 text-xs text-[var(--admin-text-muted)] print:text-black/70">
                  {c.shifts.length} shift{c.shifts.length === 1 ? "" : "s"} · cashier sign-off: ____________________ · manager: ____________________
                </p>
                {c.shifts.length > 1 ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black/70">All shifts</p>
                    <ShiftBlock s={c} nameOf={nameOf} regName={regName} />
                  </>
                ) : null}
                {c.shifts.map((s) => (
                  <div key={s.businessDay} className="mt-4 break-inside-avoid">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)] print:text-black/70">Shift · {s.businessDay}</p>
                    <ShiftBlock s={s} nameOf={nameOf} regName={regName} />
                  </div>
                ))}
              </section>
            ))
          : null}
      </div>
    </div>
  );
}
