/**
 * src/lib/reports/special-discounts.ts  (SLICE 29)
 *
 * Server-side assembly for the Special Discounts report: fetch the ledger
 * window (paged — never truncated), roll it up with the PURE summarizer, and
 * resolve the human names (employees + registers) the page and export show.
 *
 * The owner's three questions, answered from special_discount_uses (0133):
 *   WHO gives them (cashiers, and approvers on employee buys),
 *   TO WHOM (employee beneficiaries; industry companies),
 *   HOW OFTEN (totals, per-program split, per-Pacific-day trend).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  listSpecialDiscountUsesBetween,
  type SpecialDiscountUseRow,
} from "@/lib/discounts/special-discount-store";
import {
  summarizeSpecialDiscountUses,
  type SpecialDiscountReportSummary,
} from "@/lib/discounts/special-discount-report-core";

/** A person rollup with the display name resolved. */
export type NamedPersonSummary = {
  id: string;
  name: string;
  uses: number;
  discountMinor: number;
  lastUsedAt: string;
};

/** One recent ledger row, ready to display (names resolved). */
export type SpecialDiscountUseDisplayRow = {
  occurredAt: string;
  kind: SpecialDiscountUseRow["kind"];
  cashierName: string;
  registerName: string;
  /** Who received it: employee name, company, or "Veteran (ID checked)". */
  recipientLabel: string;
  approverName: string | null;
  subtotalMinor: number;
  discountMinor: number;
};

export type SpecialDiscountReport = {
  summary: SpecialDiscountReportSummary;
  byCashier: NamedPersonSummary[];
  byBeneficiary: NamedPersonSummary[];
  byApprover: NamedPersonSummary[];
  /** Newest-first detail rows, capped for display/export sanity. */
  recentUses: SpecialDiscountUseDisplayRow[];
};

const RECENT_USES_CAP = 200;

const EMPTY_REPORT: SpecialDiscountReport = {
  summary: summarizeSpecialDiscountUses([]),
  byCashier: [],
  byBeneficiary: [],
  byApprover: [],
  recentUses: [],
};

/** Resolve employee ids → full names (chunked; unknown ids keep a stub). */
async function employeeNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const admin = createSupabaseAdminClient();
  const rows = await chunkedIn(ids, async (chunk) => {
    const { data } = await admin.from("employees").select("id, full_name").in("id", chunk);
    return (data as { id: string; full_name: string | null }[] | null) ?? [];
  });
  for (const r of rows) map.set(r.id, r.full_name?.trim() || "Employee");
  return map;
}

/** Resolve register ids → names. */
async function registerNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const admin = createSupabaseAdminClient();
  const rows = await chunkedIn(ids, async (chunk) => {
    const { data } = await admin.from("registers").select("id, name").in("id", chunk);
    return (data as { id: string; name: string | null }[] | null) ?? [];
  });
  for (const r of rows) map.set(r.id, r.name?.trim() || "Register");
  return map;
}

function withNames(
  people: SpecialDiscountReportSummary["byCashier"],
  names: Map<string, string>,
): NamedPersonSummary[] {
  return people.map((p) => ({ ...p, name: names.get(p.id) ?? "Employee" }));
}

export async function getSpecialDiscountReport(
  fromISO: string,
  toISO: string,
): Promise<SpecialDiscountReport> {
  if (!isSupabaseServiceConfigured) return EMPTY_REPORT;

  const uses = await listSpecialDiscountUsesBetween(fromISO, toISO);
  const summary = summarizeSpecialDiscountUses(uses);

  // One name lookup for every employee id the report mentions.
  const employeeIds = new Set<string>();
  const registerIds = new Set<string>();
  for (const u of uses) {
    if (u.cashierEmployeeId) employeeIds.add(u.cashierEmployeeId);
    if (u.beneficiaryEmployeeId) employeeIds.add(u.beneficiaryEmployeeId);
    if (u.approvedByEmployeeId) employeeIds.add(u.approvedByEmployeeId);
    if (u.registerId) registerIds.add(u.registerId);
  }
  const [empNames, regNames] = await Promise.all([
    employeeNames([...employeeIds]),
    registerNames([...registerIds]),
  ]);

  // The store returns newest-first already; cap the detail table.
  const recentUses: SpecialDiscountUseDisplayRow[] = uses.slice(0, RECENT_USES_CAP).map((u) => ({
    occurredAt: u.occurredAt,
    kind: u.kind,
    cashierName: empNames.get(u.cashierEmployeeId) ?? "Employee",
    registerName: regNames.get(u.registerId) ?? "Register",
    recipientLabel:
      u.kind === "employee"
        ? (u.beneficiaryEmployeeId && empNames.get(u.beneficiaryEmployeeId)) || "Employee"
        : u.kind === "industry"
          ? u.companyName?.trim() || "Company"
          : u.militaryIdChecked
            ? "Veteran (ID checked)"
            : "Veteran",
    approverName: u.approvedByEmployeeId
      ? (empNames.get(u.approvedByEmployeeId) ?? "Employee")
      : null,
    subtotalMinor: u.subtotalMinor,
    discountMinor: u.discountMinor,
  }));

  return {
    summary,
    byCashier: withNames(summary.byCashier, empNames),
    byBeneficiary: withNames(summary.byBeneficiary, empNames),
    byApprover: withNames(summary.byApprover, empNames),
    recentUses,
  };
}
