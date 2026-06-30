/**
 * src/lib/reports/operations.ts
 *
 * Report queries for the loyalty/discount, employee-performance, and medical
 * report tabs (Slice 29). All time buckets are Pacific. Money in minor units.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Loyalty & discount report
// ---------------------------------------------------------------------------
export type LoyaltyReport = {
  enrolledAccounts: number;
  pointsEarned: number;
  pointsRedeemed: number;
  pointsOutstanding: number;
  codesIssued: number;
  codesRedeemed: number;
  discountValueMinor: number;
  dailyEarn: { date: string; points: number }[];
  topEarners: { label: string; points: number }[];
};

export async function getLoyaltyReport(fromISO: string, toISO: string): Promise<LoyaltyReport> {
  const empty: LoyaltyReport = {
    enrolledAccounts: 0,
    pointsEarned: 0,
    pointsRedeemed: 0,
    pointsOutstanding: 0,
    codesIssued: 0,
    codesRedeemed: 0,
    discountValueMinor: 0,
    dailyEarn: [],
    topEarners: [],
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  const [{ count: accounts }, { data: balances }, { data: ledger }, { data: redemptions }] =
    await Promise.all([
      admin.from("loyalty_accounts").select("id", { count: "exact", head: true }),
      admin.from("loyalty_accounts").select("balance_points"),
      admin
        .from("loyalty_ledger")
        .select("account_id, kind, points, created_at")
        .gte("created_at", fromISO)
        .lte("created_at", toISO),
      admin
        .from("loyalty_redemptions")
        .select("status, value_minor, created_at")
        .gte("created_at", fromISO)
        .lte("created_at", toISO),
    ]);

  const led = (ledger as { account_id: string; kind: string; points: number; created_at: string }[] | null) ?? [];
  const reds = (redemptions as { status: string; value_minor: number }[] | null) ?? [];

  const pointsEarned = led.filter((l) => l.points > 0).reduce((a, l) => a + l.points, 0);
  const pointsRedeemed = led.filter((l) => l.kind === "redeem").reduce((a, l) => a + Math.abs(l.points), 0);
  const pointsOutstanding = ((balances as { balance_points: number }[] | null) ?? []).reduce(
    (a, r) => a + (r.balance_points ?? 0),
    0,
  );

  const dailyMap = new Map<string, number>();
  for (const l of led) {
    if (l.points <= 0) continue;
    const key = pacificDayKey(l.created_at);
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + l.points);
  }
  const dailyEarn = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, points]) => ({ date, points }));

  const earnByAccount = new Map<string, number>();
  for (const l of led) {
    if (l.points <= 0) continue;
    earnByAccount.set(l.account_id, (earnByAccount.get(l.account_id) ?? 0) + l.points);
  }
  const topAccountIds = [...earnByAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  let topEarners: { label: string; points: number }[] = [];
  if (topAccountIds.length > 0) {
    const ids = topAccountIds.map(([id]) => id);
    const { data: accts } = await admin.from("loyalty_accounts").select("id, customer_id").in("id", ids);
    const acctToCust = new Map(
      ((accts as { id: string; customer_id: string }[] | null) ?? []).map((a) => [a.id, a.customer_id]),
    );
    const custIds = [...acctToCust.values()];
    const { data: custs } = await admin
      .from("customers")
      .select("id, first_name, last_name")
      .in("id", custIds);
    const custName = new Map(
      ((custs as { id: string; first_name: string; last_name: string | null }[] | null) ?? []).map((c) => [
        c.id,
        `${c.first_name} ${c.last_name ?? ""}`.trim(),
      ]),
    );
    topEarners = topAccountIds.map(([id, points]) => ({
      label: custName.get(acctToCust.get(id) ?? "") ?? "Member",
      points,
    }));
  }

  return {
    enrolledAccounts: accounts ?? 0,
    pointsEarned,
    pointsRedeemed,
    pointsOutstanding,
    codesIssued: reds.length,
    codesRedeemed: reds.filter((r) => r.status === "redeemed").length,
    discountValueMinor: reds.filter((r) => r.status === "redeemed").reduce((a, r) => a + (r.value_minor ?? 0), 0),
    dailyEarn,
    topEarners,
  };
}

// ---------------------------------------------------------------------------
// Employee performance report (from shifts / time punches)
// ---------------------------------------------------------------------------
export type EmployeeReportRow = {
  employeeId: string;
  name: string;
  shifts: number;
  minutesWorked: number;
};

export type EmployeeReport = {
  totalShifts: number;
  totalMinutes: number;
  rows: EmployeeReportRow[];
};

export async function getEmployeeReport(fromDate: string, toDate: string): Promise<EmployeeReport> {
  if (!isSupabaseServiceConfigured) return { totalShifts: 0, totalMinutes: 0, rows: [] };
  const admin = createSupabaseAdminClient();

  const [{ data: shifts }, { data: employees }, { data: punches }] = await Promise.all([
    admin
      .from("shifts")
      .select("id, employee_id, business_day")
      .gte("business_day", fromDate)
      .lte("business_day", toDate),
    admin.from("employees").select("id, full_name"),
    admin
      .from("time_punches")
      .select("employee_id, minutes, business_day")
      .gte("business_day", fromDate)
      .lte("business_day", toDate),
  ]);

  const empName = new Map(
    ((employees as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name]),
  );
  const shiftRows = (shifts as { id: string; employee_id: string }[] | null) ?? [];
  const punchRows = (punches as { employee_id: string; minutes: number | null }[] | null) ?? [];

  const byEmp = new Map<string, { shifts: number; minutes: number }>();
  for (const s of shiftRows) {
    const cur = byEmp.get(s.employee_id) ?? { shifts: 0, minutes: 0 };
    cur.shifts += 1;
    byEmp.set(s.employee_id, cur);
  }
  for (const p of punchRows) {
    const cur = byEmp.get(p.employee_id) ?? { shifts: 0, minutes: 0 };
    cur.minutes += p.minutes ?? 0;
    byEmp.set(p.employee_id, cur);
  }

  const rows: EmployeeReportRow[] = [...byEmp.entries()]
    .map(([employeeId, v]) => ({
      employeeId,
      name: empName.get(employeeId) ?? "Employee",
      shifts: v.shifts,
      minutesWorked: v.minutes,
    }))
    .sort((a, b) => b.minutesWorked - a.minutesWorked);

  return {
    totalShifts: shiftRows.length,
    totalMinutes: rows.reduce((a, r) => a + r.minutesWorked, 0),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Medical report (recognition cards + WAC 314-55-090 exempt sales)
// ---------------------------------------------------------------------------
export type MedicalReport = {
  patients: number;
  activeCards: number;
  expiringSoon: number;
  exemptSales: number;
  salesTaxExemptedMinor: number;
  exciseExemptedMinor: number;
  dailyExcise: { date: string; minor: number }[];
};

export async function getMedicalReport(fromDate: string, toDate: string): Promise<MedicalReport> {
  const empty: MedicalReport = {
    patients: 0,
    activeCards: 0,
    expiringSoon: 0,
    exemptSales: 0,
    salesTaxExemptedMinor: 0,
    exciseExemptedMinor: 0,
    dailyExcise: [],
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  const soonCutoff = new Date();
  soonCutoff.setDate(soonCutoff.getDate() + 30);
  const soonISO = soonCutoff.toISOString().slice(0, 10);
  const todayISO = new Date().toISOString().slice(0, 10);

  const [{ count: patients }, { count: activeCards }, { count: expiringSoon }, { data: exempt }] =
    await Promise.all([
      admin.from("customers").select("id", { count: "exact", head: true }).eq("is_medical_patient", true),
      admin.from("patient_authorizations").select("id", { count: "exact", head: true }).eq("status", "active"),
      admin
        .from("patient_authorizations")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .gte("expires_on", todayISO)
        .lte("expires_on", soonISO),
      admin
        .from("medical_exempt_sales")
        .select("sale_date, sales_price_minor, excise_amount_exempt_minor, sales_tax_exempt")
        .gte("sale_date", fromDate)
        .lte("sale_date", toDate),
    ]);

  const rows =
    (exempt as
      | { sale_date: string; sales_price_minor: number; excise_amount_exempt_minor: number; sales_tax_exempt: boolean }[]
      | null) ?? [];

  // 9.3% sales tax exempted (approx from price; precise records would carry it).
  const salesTaxExemptedMinor = rows
    .filter((r) => r.sales_tax_exempt)
    .reduce((a, r) => a + Math.round((r.sales_price_minor * 930) / 10000), 0);
  const exciseExemptedMinor = rows.reduce((a, r) => a + (r.excise_amount_exempt_minor ?? 0), 0);

  const dailyMap = new Map<string, number>();
  for (const r of rows) {
    dailyMap.set(r.sale_date, (dailyMap.get(r.sale_date) ?? 0) + (r.excise_amount_exempt_minor ?? 0));
  }
  const dailyExcise = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, minor]) => ({ date, minor }));

  return {
    patients: patients ?? 0,
    activeCards: activeCards ?? 0,
    expiringSoon: expiringSoon ?? 0,
    exemptSales: rows.length,
    salesTaxExemptedMinor,
    exciseExemptedMinor,
    dailyExcise,
  };
}
