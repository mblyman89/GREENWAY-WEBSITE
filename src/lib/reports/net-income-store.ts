/**
 * src/lib/reports/net-income-store.ts — I/O for the P6c net-income roll-up.
 *
 * Gathers the verified figures the PURE net-income core needs for a date range:
 *   • revenue + COGS  — from the existing COGS report (getCogsReport).
 *   • payroll net pay — completed runs (file_generated | submitted) whose
 *     pay_date falls in the range.
 *   • ATM surcharge   — settlements whose settlementDate falls in the range.
 *
 * All money is CENTS. Reads degrade to zeros when the DB isn't configured, so
 * the page renders an empty roll-up instead of crashing. NEVER invents numbers.
 */
import "server-only";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getCogsReport } from "@/lib/reports/cogs";
import { listPayrollRuns } from "@/lib/payroll/payroll-store";
import { listAtmSettlements } from "@/lib/atm/store";
import type { NetIncomeInputs } from "@/lib/reports/net-income-core";

/**
 * Assemble net-income inputs for the Pacific date window [fromDate, toDate]
 * (yyyy-mm-dd, inclusive). `fromISO`/`toISO` are the precise UTC instants the
 * COGS report expects; the payroll/ATM date filters use the plain calendar
 * dates because pay_date and settlementDate are stored as yyyy-mm-dd.
 */
export async function getNetIncomeInputs(args: {
  fromISO: string;
  toISO: string;
  fromDate: string;
  toDate: string;
}): Promise<NetIncomeInputs> {
  if (!isSupabaseServiceConfigured) {
    return {
      revenueCents: 0,
      cogsCents: 0,
      atmSurchargeCents: 0,
      payrollNetCents: 0,
      payrollRunCount: 0,
    };
  }

  const cogs = await getCogsReport(args.fromISO, args.toISO);

  // Payroll net pay: only runs that actually cleared (have an ACH file) and
  // whose pay date is inside the window.
  const runs = await listPayrollRuns(500);
  const paidRuns = runs.filter(
    (r) =>
      (r.status === "file_generated" || r.status === "submitted") &&
      r.pay_date >= args.fromDate &&
      r.pay_date <= args.toDate,
  );
  const payrollNetCents = paidRuns.reduce((s, r) => s + (r.total_net_cents || 0), 0);

  // ATM surcharge income: settlements whose settlement date is in the window.
  const settlements = await listAtmSettlements(800);
  const atmSurchargeCents = settlements
    .filter((s) => s.settlementDate >= args.fromDate && s.settlementDate <= args.toDate)
    .reduce((sum, s) => sum + (s.surchargeCents ?? 0), 0);

  return {
    revenueCents: cogs.totalRevenueMinorUnits,
    cogsCents: cogs.totalCogsMinorUnits,
    atmSurchargeCents,
    payrollNetCents,
    payrollRunCount: paidRuns.length,
  };
}
