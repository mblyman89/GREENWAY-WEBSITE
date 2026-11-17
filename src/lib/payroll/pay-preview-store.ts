/**
 * src/lib/payroll/pay-preview-store.ts   (D248 slice 3)
 *
 * READS ONLY. Runs the existing pay-run engine (loadPayRun - the same answer
 * /admin/books/pay-run gives) for one period and lays it out as a register via
 * pay-preview-core. Beside the engine's money it gathers the hours split
 * (computeTimesheetForPeriod), sick leave taken (sick_leave_ledger usage rows)
 * and tips (loadTipReport) - shown "not in gross", never added.
 *
 * Never books a journal, never files, never pays. Nothing here writes.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { loadPayRun, type PayRunStoreFailure } from "@/lib/payroll/pay-run-store";
import { computeTimesheetForPeriod } from "@/lib/payroll/timesheet-store";
import { loadTipReport } from "@/lib/staffing/tips-store";
import {
  buildPreviewRow,
  previewTotals,
  type PreviewHours,
  type PreviewLineInput,
  type PreviewRow,
  type PreviewTotals,
} from "@/lib/payroll/pay-preview-core";

const short = (e: unknown) =>
  (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 240);

export type PayPreviewView = {
  readonly ok: true;
  readonly periodLabel: string;
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly payDateIso: string;
  readonly periodStatus: "planned" | "approved" | "locked";
  readonly rows: readonly PreviewRow[];
  readonly totals: PreviewTotals;
  readonly readyCount: number;
  readonly attentionCount: number;
  readonly blockedCount: number;
  /** Names of employees whose stored W-4 could not be read. */
  readonly unreadableW4Names: readonly string[];
  /** Side-reads that failed (sick leave, tips). The register still shows; these columns say "not read". */
  readonly warnings: readonly string[];
  /** Employees on statutory-default withholding (no W-4 / unsigned), by name. */
  readonly defaultW4Names: readonly string[];
};

export type PayPreviewResult = PayPreviewView | PayRunStoreFailure;

export async function loadPayPreview(periodId: string): Promise<PayPreviewResult> {
  const run = await loadPayRun(periodId);
  if (!run.ok) return run;

  const warnings: string[] = [];

  // Hours split per employee (the engine's own timesheet; loadPayRun already proved it computes).
  const hoursBy = new Map<string, { reg: number; ot: number; st: number; prem: number; rate: number | null }>();
  const ts = await computeTimesheetForPeriod(periodId);
  if (ts.ok) {
    for (const s of ts.sheets) {
      hoursBy.set(s.employee.employeeId, {
        reg: s.hours?.regularHundredthHours ?? NaN,
        ot: s.hours?.overtimeHundredthHours ?? NaN,
        st: s.hours?.straightTimeCents ?? NaN,
        prem: s.hours?.overtimePremiumCents ?? NaN,
        rate: s.employee.hourlyRateMilliCents,
      });
    }
  } else {
    warnings.push(`The hours split could not be re-read: ${ts.message}`);
  }

  // Sick leave taken in the period.
  const sickBy = new Map<string, number>();
  let sickRead = false;
  if (isSupabaseServiceConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const s = await admin
        .from("sick_leave_ledger")
        .select("employee_id, minutes")
        .eq("entry_kind", "usage")
        .gte("entry_date", run.periodStartDate)
        .lte("entry_date", run.periodEndDate);
      if (s.error) throw new Error(short(s.error));
      for (const r of (s.data ?? []) as { employee_id: string; minutes: number }[]) {
        sickBy.set(r.employee_id, (sickBy.get(r.employee_id) ?? 0) + Math.abs(r.minutes));
      }
      sickRead = true;
    } catch (e) {
      warnings.push(`Sick leave taken could not be read, so the sick columns are blank: ${short(e)}`);
    }
  }

  // Tips over the period (reported beside gross; WA tips are not wages paid by the employer here).
  const tipsBy = new Map<string, number>();
  let tipsRead = false;
  try {
    const t = await loadTipReport(run.periodStartDate, run.periodEndDate);
    if ("error" in t) {
      warnings.push(`Tips could not be read, so the tips column is blank: ${t.error}`);
    } else {
      for (const e of t.report.employees) tipsBy.set(e.employeeId, e.totalMinor);
      tipsRead = true;
    }
  } catch (e) {
    warnings.push(`Tips could not be read, so the tips column is blank: ${short(e)}`);
  }

  const rows: PreviewRow[] = run.result.lines.map((line) => {
    const h = hoursBy.get(line.employeeId);
    const num = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? null : v);
    const hours: PreviewHours = {
      regularHundredthHours: num(h?.reg),
      overtimeHundredthHours: num(h?.ot),
      straightTimeCents: num(h?.st),
      overtimePremiumCents: num(h?.prem),
      hourlyRateMilliCents: h?.rate ?? null,
      sickMinutes: sickRead ? sickBy.get(line.employeeId) ?? 0 : 0,
      tipsCents: tipsRead ? tipsBy.get(line.employeeId) ?? 0 : null,
    };
    return buildPreviewRow(line as unknown as PreviewLineInput, hours);
  });

  const nameOf = new Map(run.result.lines.map((l) => [l.employeeId, l.employeeName]));
  return {
    ok: true,
    periodLabel: run.periodLabel,
    periodStartDate: run.periodStartDate,
    periodEndDate: run.periodEndDate,
    payDateIso: run.payDateIso,
    periodStatus: run.periodStatus,
    rows,
    totals: previewTotals(rows),
    readyCount: run.result.readyCount,
    attentionCount: run.result.attentionCount,
    blockedCount: run.result.blockedCount,
    unreadableW4Names: run.unreadableW4EmployeeIds.map((id) => nameOf.get(id) ?? id),
    warnings,
    defaultW4Names: run.result.lines
      .filter((l) => l.w4Provenance && l.w4Provenance !== "furnished")
      .map((l) => l.employeeName),
  };
}
