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
export type LoyaltyKindRow = { kind: string; label: string; points: number };
export type LoyaltyTierRow = {
  tierId: string | null;
  name: string;
  members: number;
  discountBps: number;
  outstandingPoints: number;
  lifetimePoints: number;
};
export type LoyaltyCodeFunnelRow = { label: string; count: number; valueMinor: number };

export type LoyaltyReport = {
  // Headline membership + points
  enrolledAccounts: number;
  activeAccounts: number;
  pointsEarned: number;
  pointsRedeemed: number;
  pointsOutstanding: number;
  // Program economics (the professional layer)
  pointValueMinor: number; // cash value of one point (cents)
  liabilityMinor: number; // outstanding points valued at cash
  redeemedValueMinor: number; // points redeemed in window valued at cash
  breakagePoints: number; // points expired in window (never redeemed)
  breakageMinor: number; // breakage valued at cash
  redemptionRate: number; // points redeemed / points earned (0..1) in window
  avgEarnBasisMinor: number; // avg pretax basis behind each earn event
  newEnrollments: number; // accounts enrolled in window
  // Discount codes
  codesIssued: number;
  codesRedeemed: number;
  codesExpired: number;
  codesCancelled: number;
  codesOutstanding: number;
  codeRedemptionRate: number; // redeemed / issued (0..1) in window
  avgDaysToRedeem: number; // avg days issue -> redeem
  discountValueMinor: number; // value of redeemed codes
  outstandingCodeValueMinor: number; // value tied up in still-issued codes
  // Breakdowns
  pointsByKind: LoyaltyKindRow[];
  tiers: LoyaltyTierRow[];
  codeFunnel: LoyaltyCodeFunnelRow[];
  dailyEarn: { date: string; points: number }[];
  dailyRedeem: { date: string; points: number }[];
  enrollmentTrend: { date: string; count: number }[];
  topEarners: { label: string; points: number }[];
};

const LEDGER_KIND_LABELS: Record<string, string> = {
  earn: "Earned (purchases)",
  signup_bonus: "Signup bonus",
  promo_bonus: "Promo bonus",
  adjust: "Manual adjustment",
  redeem: "Redeemed",
  expire: "Expired (breakage)",
};

export const EMPTY_LOYALTY_REPORT: LoyaltyReport = {
  enrolledAccounts: 0,
  activeAccounts: 0,
  pointsEarned: 0,
  pointsRedeemed: 0,
  pointsOutstanding: 0,
  pointValueMinor: 1,
  liabilityMinor: 0,
  redeemedValueMinor: 0,
  breakagePoints: 0,
  breakageMinor: 0,
  redemptionRate: 0,
  avgEarnBasisMinor: 0,
  newEnrollments: 0,
  codesIssued: 0,
  codesRedeemed: 0,
  codesExpired: 0,
  codesCancelled: 0,
  codesOutstanding: 0,
  codeRedemptionRate: 0,
  avgDaysToRedeem: 0,
  discountValueMinor: 0,
  outstandingCodeValueMinor: 0,
  pointsByKind: [],
  tiers: [],
  codeFunnel: [],
  dailyEarn: [],
  dailyRedeem: [],
  enrollmentTrend: [],
  topEarners: [],
};

export async function getLoyaltyReport(fromISO: string, toISO: string): Promise<LoyaltyReport> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_LOYALTY_REPORT };
  const admin = createSupabaseAdminClient();

  const [
    { count: accounts },
    { count: activeAccounts },
    { data: balances },
    { data: accountsInWindow },
    { data: ledger },
    { data: redemptions },
    { data: config },
    { data: tierRows },
  ] = await Promise.all([
    admin.from("loyalty_accounts").select("id", { count: "exact", head: true }),
    admin.from("loyalty_accounts").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("loyalty_accounts").select("balance_points, lifetime_points, tier_id"),
    admin
      .from("loyalty_accounts")
      .select("id, enrolled_at")
      .gte("enrolled_at", fromISO)
      .lte("enrolled_at", toISO),
    admin
      .from("loyalty_ledger")
      .select("account_id, kind, points, basis_minor, created_at")
      .gte("created_at", fromISO)
      .lte("created_at", toISO),
    admin
      .from("loyalty_redemptions")
      .select("status, points, value_minor, created_at, redeemed_at")
      .gte("created_at", fromISO)
      .lte("created_at", toISO),
    admin.from("loyalty_config").select("point_value_minor").eq("is_active", true).limit(1),
    admin.from("loyalty_tiers").select("id, name, discount_bps, sort_order").order("sort_order"),
  ]);

  const led =
    (ledger as
      | { account_id: string; kind: string; points: number; basis_minor: number | null; created_at: string }[]
      | null) ?? [];
  const reds =
    (redemptions as
      | { status: string; points: number; value_minor: number; created_at: string; redeemed_at: string | null }[]
      | null) ?? [];
  const bals =
    (balances as { balance_points: number; lifetime_points: number; tier_id: string | null }[] | null) ?? [];

  const pointValueMinor = Number(
    ((config as { point_value_minor: number }[] | null) ?? [])[0]?.point_value_minor ?? 1,
  );

  // --- Points totals + composition by ledger kind ---
  const pointsEarned = led.filter((l) => l.points > 0).reduce((a, l) => a + l.points, 0);
  const pointsRedeemed = led.filter((l) => l.kind === "redeem").reduce((a, l) => a + Math.abs(l.points), 0);
  const breakagePoints = led.filter((l) => l.kind === "expire").reduce((a, l) => a + Math.abs(l.points), 0);
  const pointsOutstanding = bals.reduce((a, r) => a + (r.balance_points ?? 0), 0);

  const kindMap = new Map<string, number>();
  for (const l of led) kindMap.set(l.kind, (kindMap.get(l.kind) ?? 0) + Math.abs(l.points));
  const pointsByKind: LoyaltyKindRow[] = [...kindMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, points]) => ({ kind, label: LEDGER_KIND_LABELS[kind] ?? kind, points }));

  const earnEvents = led.filter((l) => l.kind === "earn" && (l.basis_minor ?? 0) > 0);
  const avgEarnBasisMinor =
    earnEvents.length > 0
      ? Math.round(earnEvents.reduce((a, l) => a + (l.basis_minor ?? 0), 0) / earnEvents.length)
      : 0;

  // --- Daily trends ---
  const dailyEarnMap = new Map<string, number>();
  const dailyRedeemMap = new Map<string, number>();
  for (const l of led) {
    const key = pacificDayKey(l.created_at);
    if (l.points > 0) dailyEarnMap.set(key, (dailyEarnMap.get(key) ?? 0) + l.points);
    if (l.kind === "redeem") dailyRedeemMap.set(key, (dailyRedeemMap.get(key) ?? 0) + Math.abs(l.points));
  }
  const dailyEarn = [...dailyEarnMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, points]) => ({ date, points }));
  const dailyRedeem = [...dailyRedeemMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, points]) => ({ date, points }));

  const enrollMap = new Map<string, number>();
  for (const a of (accountsInWindow as { enrolled_at: string }[] | null) ?? []) {
    const key = pacificDayKey(a.enrolled_at);
    enrollMap.set(key, (enrollMap.get(key) ?? 0) + 1);
  }
  const enrollmentTrend = [...enrollMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));

  // --- Tier distribution (member count + points by tier) ---
  const tierDefs = (tierRows as { id: string; name: string; discount_bps: number }[] | null) ?? [];
  const tierAgg = new Map<string | null, { members: number; outstanding: number; lifetime: number }>();
  for (const b of bals) {
    const key = b.tier_id ?? null;
    const cur = tierAgg.get(key) ?? { members: 0, outstanding: 0, lifetime: 0 };
    cur.members += 1;
    cur.outstanding += b.balance_points ?? 0;
    cur.lifetime += b.lifetime_points ?? 0;
    tierAgg.set(key, cur);
  }
  const tiers: LoyaltyTierRow[] = tierDefs.map((t) => {
    const agg = tierAgg.get(t.id) ?? { members: 0, outstanding: 0, lifetime: 0 };
    return {
      tierId: t.id,
      name: t.name,
      members: agg.members,
      discountBps: t.discount_bps,
      outstandingPoints: agg.outstanding,
      lifetimePoints: agg.lifetime,
    };
  });
  const untiered = tierAgg.get(null);
  if (untiered && untiered.members > 0) {
    tiers.push({
      tierId: null,
      name: "No tier yet",
      members: untiered.members,
      discountBps: 0,
      outstandingPoints: untiered.outstanding,
      lifetimePoints: untiered.lifetime,
    });
  }

  // --- Discount code funnel + economics ---
  const codesIssued = reds.length;
  const codesRedeemed = reds.filter((r) => r.status === "redeemed").length;
  const codesExpired = reds.filter((r) => r.status === "expired").length;
  const codesCancelled = reds.filter((r) => r.status === "cancelled").length;
  const codesOutstanding = reds.filter((r) => r.status === "issued").length;
  const discountValueMinor = reds
    .filter((r) => r.status === "redeemed")
    .reduce((a, r) => a + (r.value_minor ?? 0), 0);
  const outstandingCodeValueMinor = reds
    .filter((r) => r.status === "issued")
    .reduce((a, r) => a + (r.value_minor ?? 0), 0);

  const redeemedWithDates = reds.filter((r) => r.status === "redeemed" && r.redeemed_at && r.created_at);
  const avgDaysToRedeem =
    redeemedWithDates.length > 0
      ? Math.round(
          (redeemedWithDates.reduce(
            (a, r) => a + (new Date(r.redeemed_at!).getTime() - new Date(r.created_at).getTime()),
            0,
          ) /
            redeemedWithDates.length /
            (1000 * 60 * 60 * 24)) *
            10,
        ) / 10
      : 0;

  const codeFunnel: LoyaltyCodeFunnelRow[] = [
    { label: "Issued", count: codesIssued, valueMinor: reds.reduce((a, r) => a + (r.value_minor ?? 0), 0) },
    { label: "Redeemed", count: codesRedeemed, valueMinor: discountValueMinor },
    { label: "Outstanding", count: codesOutstanding, valueMinor: outstandingCodeValueMinor },
    {
      label: "Expired",
      count: codesExpired,
      valueMinor: reds.filter((r) => r.status === "expired").reduce((a, r) => a + (r.value_minor ?? 0), 0),
    },
    {
      label: "Cancelled",
      count: codesCancelled,
      valueMinor: reds.filter((r) => r.status === "cancelled").reduce((a, r) => a + (r.value_minor ?? 0), 0),
    },
  ];

  // --- Top earners (names) ---
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
    activeAccounts: activeAccounts ?? 0,
    pointsEarned,
    pointsRedeemed,
    pointsOutstanding,
    pointValueMinor,
    liabilityMinor: pointsOutstanding * pointValueMinor,
    redeemedValueMinor: pointsRedeemed * pointValueMinor,
    breakagePoints,
    breakageMinor: breakagePoints * pointValueMinor,
    redemptionRate: pointsEarned > 0 ? pointsRedeemed / pointsEarned : 0,
    avgEarnBasisMinor,
    newEnrollments: ((accountsInWindow as unknown[] | null) ?? []).length,
    codesIssued,
    codesRedeemed,
    codesExpired,
    codesCancelled,
    codesOutstanding,
    codeRedemptionRate: codesIssued > 0 ? codesRedeemed / codesIssued : 0,
    avgDaysToRedeem,
    discountValueMinor,
    outstandingCodeValueMinor,
    pointsByKind,
    tiers,
    codeFunnel,
    dailyEarn,
    dailyRedeem,
    enrollmentTrend,
    topEarners,
  };
}

// ---------------------------------------------------------------------------
// Employee performance report (from shifts / time punches)
// ---------------------------------------------------------------------------
export type EmployeeReportRow = {
  employeeId: string;
  name: string;
  jobRole: string;
  active: boolean;
  shifts: number;
  daysWorked: number;
  minutesWorked: number; // work punches only (break excluded)
  breakMinutes: number;
  avgShiftMinutes: number;
  ordersHandled: number;
  lastActiveDay: string | null;
};

export type EmployeeReport = {
  // headline
  activeEmployees: number;
  inactiveEmployees: number;
  totalShifts: number;
  totalMinutes: number; // net worked minutes
  totalBreakMinutes: number;
  avgShiftMinutes: number;
  // schedule adherence
  scheduledMinutes: number;
  scheduleAdherence: number; // actual / scheduled (0..1+)
  onTimeRate: number; // shifts started <=5 min after scheduled_start (0..1)
  // breakdowns
  shiftsByStatus: { label: string; count: number }[];
  punchesBySource: { label: string; count: number }[];
  roleBreakdown: { label: string; minutes: number }[];
  dailyCoverage: { date: string; minutes: number }[];
  rows: EmployeeReportRow[];
};

export const EMPTY_EMPLOYEE_REPORT: EmployeeReport = {
  activeEmployees: 0,
  inactiveEmployees: 0,
  totalShifts: 0,
  totalMinutes: 0,
  totalBreakMinutes: 0,
  avgShiftMinutes: 0,
  scheduledMinutes: 0,
  scheduleAdherence: 0,
  onTimeRate: 0,
  shiftsByStatus: [],
  punchesBySource: [],
  roleBreakdown: [],
  dailyCoverage: [],
  rows: [],
};

const SHIFT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
};
const PUNCH_SOURCE_LABELS: Record<string, string> = {
  web: "Web",
  station: "Station",
  manager_edit: "Manager edit",
};

export async function getEmployeeReport(fromDate: string, toDate: string): Promise<EmployeeReport> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_EMPLOYEE_REPORT };
  const admin = createSupabaseAdminClient();

  const [{ data: shifts }, { data: employees }, { data: punches }] = await Promise.all([
    admin
      .from("shifts")
      .select("id, employee_id, business_day, shift_role, status, scheduled_start, scheduled_end, started_at, ended_at")
      .gte("business_day", fromDate)
      .lte("business_day", toDate),
    admin.from("employees").select("id, full_name, job_role, active, staff_id"),
    admin
      .from("time_punches")
      .select("employee_id, punch_kind, minutes, source, business_day, clock_in_at")
      .gte("business_day", fromDate)
      .lte("business_day", toDate),
  ]);

  const empRows =
    (employees as { id: string; full_name: string; job_role: string; active: boolean; staff_id: string | null }[] | null) ??
    [];
  const empById = new Map(empRows.map((e) => [e.id, e]));
  const shiftRows =
    (shifts as
      | {
          id: string;
          employee_id: string;
          business_day: string;
          shift_role: string;
          status: string;
          scheduled_start: string | null;
          scheduled_end: string | null;
          started_at: string | null;
          ended_at: string | null;
        }[]
      | null) ?? [];
  const punchRows =
    (punches as
      | { employee_id: string; punch_kind: string; minutes: number | null; source: string; business_day: string; clock_in_at: string }[]
      | null) ?? [];

  // --- Orders handled per employee (via employees.staff_id -> orders.handled_by) ---
  const staffToEmp = new Map<string, string>();
  for (const e of empRows) if (e.staff_id) staffToEmp.set(e.staff_id, e.id);
  const ordersHandled = new Map<string, number>();
  if (staffToEmp.size > 0) {
    const { data: orders } = await admin
      .from("orders")
      .select("handled_by, placed_at")
      .gte("placed_at", `${fromDate}T00:00:00Z`)
      .lte("placed_at", `${toDate}T23:59:59Z`)
      .not("handled_by", "is", null);
    for (const o of (orders as { handled_by: string | null }[] | null) ?? []) {
      const empId = o.handled_by ? staffToEmp.get(o.handled_by) : undefined;
      if (empId) ordersHandled.set(empId, (ordersHandled.get(empId) ?? 0) + 1);
    }
  }

  // --- Per-employee aggregation ---
  type Agg = {
    shifts: number;
    workMinutes: number;
    breakMinutes: number;
    days: Set<string>;
    lastDay: string | null;
  };
  const byEmp = new Map<string, Agg>();
  const ensure = (id: string): Agg => {
    let a = byEmp.get(id);
    if (!a) {
      a = { shifts: 0, workMinutes: 0, breakMinutes: 0, days: new Set(), lastDay: null };
      byEmp.set(id, a);
    }
    return a;
  };

  for (const s of shiftRows) {
    const a = ensure(s.employee_id);
    a.shifts += 1;
    a.days.add(s.business_day);
    if (!a.lastDay || s.business_day > a.lastDay) a.lastDay = s.business_day;
  }
  for (const p of punchRows) {
    const a = ensure(p.employee_id);
    const m = p.minutes ?? 0;
    if (p.punch_kind === "break") a.breakMinutes += m;
    else a.workMinutes += m;
    a.days.add(p.business_day);
    if (!a.lastDay || p.business_day > a.lastDay) a.lastDay = p.business_day;
  }

  const rows: EmployeeReportRow[] = [...byEmp.entries()]
    .map(([employeeId, v]) => {
      const emp = empById.get(employeeId);
      return {
        employeeId,
        name: emp?.full_name ?? "Employee",
        jobRole: emp?.job_role ?? "sales",
        active: emp?.active ?? true,
        shifts: v.shifts,
        daysWorked: v.days.size,
        minutesWorked: v.workMinutes,
        breakMinutes: v.breakMinutes,
        avgShiftMinutes: v.shifts > 0 ? Math.round(v.workMinutes / v.shifts) : 0,
        ordersHandled: ordersHandled.get(employeeId) ?? 0,
        lastActiveDay: v.lastDay,
      };
    })
    .sort((a, b) => b.minutesWorked - a.minutesWorked);

  // --- Schedule adherence ---
  let scheduledMinutes = 0;
  let scheduledShiftsWithStart = 0;
  let onTimeShifts = 0;
  for (const s of shiftRows) {
    if (s.scheduled_start && s.scheduled_end) {
      const mins = Math.max(
        0,
        Math.round((new Date(s.scheduled_end).getTime() - new Date(s.scheduled_start).getTime()) / 60000),
      );
      scheduledMinutes += mins;
    }
    if (s.scheduled_start && s.started_at) {
      scheduledShiftsWithStart += 1;
      const lateMs = new Date(s.started_at).getTime() - new Date(s.scheduled_start).getTime();
      if (lateMs <= 5 * 60000) onTimeShifts += 1; // within 5 minutes = on time
    }
  }

  // --- Breakdowns ---
  const statusMap = new Map<string, number>();
  for (const s of shiftRows) statusMap.set(s.status, (statusMap.get(s.status) ?? 0) + 1);
  const shiftsByStatus = [...statusMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ label: SHIFT_STATUS_LABELS[status] ?? status, count }));

  const sourceMap = new Map<string, number>();
  for (const p of punchRows) sourceMap.set(p.source, (sourceMap.get(p.source) ?? 0) + 1);
  const punchesBySource = [...sourceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ label: PUNCH_SOURCE_LABELS[source] ?? source, count }));

  const roleMap = new Map<string, number>();
  for (const r of rows) roleMap.set(r.jobRole, (roleMap.get(r.jobRole) ?? 0) + r.minutesWorked);
  const roleBreakdown = [...roleMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, minutes]) => ({ label: role.charAt(0).toUpperCase() + role.slice(1), minutes }));

  const coverageMap = new Map<string, number>();
  for (const p of punchRows) {
    if (p.punch_kind === "break") continue;
    coverageMap.set(p.business_day, (coverageMap.get(p.business_day) ?? 0) + (p.minutes ?? 0));
  }
  const dailyCoverage = [...coverageMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, minutes]) => ({ date, minutes }));

  const totalMinutes = rows.reduce((a, r) => a + r.minutesWorked, 0);
  const totalBreakMinutes = rows.reduce((a, r) => a + r.breakMinutes, 0);

  return {
    activeEmployees: empRows.filter((e) => e.active).length,
    inactiveEmployees: empRows.filter((e) => !e.active).length,
    totalShifts: shiftRows.length,
    totalMinutes,
    totalBreakMinutes,
    avgShiftMinutes: shiftRows.length > 0 ? Math.round(totalMinutes / shiftRows.length) : 0,
    scheduledMinutes,
    scheduleAdherence: scheduledMinutes > 0 ? totalMinutes / scheduledMinutes : 0,
    onTimeRate: scheduledShiftsWithStart > 0 ? onTimeShifts / scheduledShiftsWithStart : 0,
    shiftsByStatus,
    punchesBySource,
    roleBreakdown,
    dailyCoverage,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Medical report (recognition cards + WAC 314-55-090 exempt sales)
// ---------------------------------------------------------------------------
export type MedicalAuthStatusRow = { status: string; label: string; count: number };
export type MedicalExpiryBucketRow = { label: string; count: number };
export type MedicalProductRow = {
  sku: string;
  name: string;
  units: number;
  salesMinor: number;
  exciseExemptMinor: number;
};
export type MedicalCardIssue = {
  saleDate: string;
  upid: string;
  productName: string;
  cardExpiresOn: string | null;
  salesPriceMinor: number;
};
export type MedicalDailyRow = { date: string; sales: number; salesMinor: number; exciseMinor: number };

export type MedicalReport = {
  // Headline patient / card counts
  patients: number;
  activeCards: number;
  expiringSoon: number; // active cards expiring within 30 days
  // Store medical endorsement / compliance status
  isEndorsed: boolean;
  endorsementNumber: string | null;
  exemptionUntil: string | null; // date the WAC 314-55-090(6) excise exemption sunsets
  daysUntilExemptionEnds: number | null;
  // Authorization pipeline
  authByStatus: MedicalAuthStatusRow[];
  expiryBuckets: MedicalExpiryBucketRow[]; // 0-30 / 31-60 / 61-90 / expired
  inDohDatabase: number; // active cards validated in the DOH MCR database
  // Exempt-sale activity in the window
  exemptSales: number; // count of exempt line items
  uniquePatients: number; // distinct UPIDs served in window
  exemptSalesMinor: number; // gross exempt sales value
  salesTaxExemptedMinor: number; // est. 9.3% sales tax not collected
  exciseExemptedMinor: number; // 37% excise not collected
  avgExemptBasketMinor: number; // exempt sales value / unique patients
  // Product mix + compliance audit
  topExemptProducts: MedicalProductRow[];
  cardValidityIssues: MedicalCardIssue[]; // exempt sales where the card was expired at sale
  // Trend
  dailyExcise: { date: string; minor: number }[]; // retained for backward compat
  daily: MedicalDailyRow[];
};

export const EMPTY_MEDICAL_REPORT: MedicalReport = {
  patients: 0,
  activeCards: 0,
  expiringSoon: 0,
  isEndorsed: false,
  endorsementNumber: null,
  exemptionUntil: null,
  daysUntilExemptionEnds: null,
  authByStatus: [],
  expiryBuckets: [],
  inDohDatabase: 0,
  exemptSales: 0,
  uniquePatients: 0,
  exemptSalesMinor: 0,
  salesTaxExemptedMinor: 0,
  exciseExemptedMinor: 0,
  avgExemptBasketMinor: 0,
  topExemptProducts: [],
  cardValidityIssues: [],
  dailyExcise: [],
  daily: [],
};

const AUTH_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

type ExemptRow = {
  sale_date: string;
  unique_patient_identifier: string | null;
  card_expires_on: string | null;
  product_sku: string | null;
  product_name: string | null;
  sales_price_minor: number;
  excise_amount_exempt_minor: number | null;
  sales_tax_exempt: boolean;
};

type AuthRow = {
  status: string | null;
  expires_on: string | null;
  in_doh_database: boolean | null;
};

export async function getMedicalReport(fromDate: string, toDate: string): Promise<MedicalReport> {
  if (!isSupabaseServiceConfigured) return EMPTY_MEDICAL_REPORT;
  const admin = createSupabaseAdminClient();

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const soonISO = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

  const [{ count: patients }, { data: auths }, { data: exempt }, { data: endorsement }] =
    await Promise.all([
      admin.from("customers").select("id", { count: "exact", head: true }).eq("is_medical_patient", true),
      admin.from("patient_authorizations").select("status, expires_on, in_doh_database"),
      admin
        .from("medical_exempt_sales")
        .select(
          "sale_date, unique_patient_identifier, card_expires_on, product_sku, product_name, sales_price_minor, excise_amount_exempt_minor, sales_tax_exempt",
        )
        .gte("sale_date", fromDate)
        .lte("sale_date", toDate),
      admin
        .from("medical_endorsement_config")
        .select("is_medically_endorsed, endorsement_number, excise_exemption_until")
        .limit(1)
        .maybeSingle(),
    ]);

  const authRows = (auths as AuthRow[] | null) ?? [];
  const rows = (exempt as ExemptRow[] | null) ?? [];

  // --- Authorization pipeline ------------------------------------------------
  const statusCounts = new Map<string, number>();
  let activeCards = 0;
  let expiringSoon = 0;
  let inDohDatabase = 0;
  const buckets = { b30: 0, b60: 0, b90: 0, expired: 0 };
  for (const a of authRows) {
    const status = a.status ?? "active";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    if (status !== "active") continue;
    activeCards += 1;
    if (a.in_doh_database) inDohDatabase += 1;
    const exp = a.expires_on;
    if (!exp) continue;
    if (exp < todayISO) {
      buckets.expired += 1;
    } else if (exp <= soonISO) {
      buckets.b30 += 1;
      expiringSoon += 1;
    } else {
      const days = Math.round((new Date(exp).getTime() - today.getTime()) / 86_400_000);
      if (days <= 60) buckets.b60 += 1;
      else if (days <= 90) buckets.b90 += 1;
    }
  }
  const authByStatus: MedicalAuthStatusRow[] = [...statusCounts.entries()]
    .map(([status, count]) => ({ status, label: AUTH_STATUS_LABELS[status] ?? status, count }))
    .sort((a, b) => b.count - a.count);
  const expiryBuckets: MedicalExpiryBucketRow[] = [
    { label: "Expiring ≤ 30 days", count: buckets.b30 },
    { label: "31–60 days", count: buckets.b60 },
    { label: "61–90 days", count: buckets.b90 },
    { label: "Already expired", count: buckets.expired },
  ];

  // --- Exempt-sale activity --------------------------------------------------
  const uniqueUpids = new Set<string>();
  let exemptSalesMinor = 0;
  let salesTaxExemptedMinor = 0;
  let exciseExemptedMinor = 0;
  const productMap = new Map<string, MedicalProductRow>();
  const dailyMap = new Map<string, MedicalDailyRow>();
  const cardValidityIssues: MedicalCardIssue[] = [];

  for (const r of rows) {
    const upid = r.unique_patient_identifier ?? "";
    if (upid) uniqueUpids.add(upid);
    const price = r.sales_price_minor ?? 0;
    const excise = r.excise_amount_exempt_minor ?? 0;
    exemptSalesMinor += price;
    if (r.sales_tax_exempt) salesTaxExemptedMinor += Math.round((price * 930) / 10000);
    exciseExemptedMinor += excise;

    // product mix
    const sku = r.product_sku ?? "—";
    const pr = productMap.get(sku) ?? {
      sku,
      name: r.product_name ?? sku,
      units: 0,
      salesMinor: 0,
      exciseExemptMinor: 0,
    };
    pr.units += 1;
    pr.salesMinor += price;
    pr.exciseExemptMinor += excise;
    productMap.set(sku, pr);

    // daily trend
    const d = dailyMap.get(r.sale_date) ?? { date: r.sale_date, sales: 0, salesMinor: 0, exciseMinor: 0 };
    d.sales += 1;
    d.salesMinor += price;
    d.exciseMinor += excise;
    dailyMap.set(r.sale_date, d);

    // compliance audit: card was expired at the time of the exempt sale
    if (r.card_expires_on && r.card_expires_on < r.sale_date) {
      cardValidityIssues.push({
        saleDate: r.sale_date,
        upid: upid || "—",
        productName: r.product_name ?? sku,
        cardExpiresOn: r.card_expires_on,
        salesPriceMinor: price,
      });
    }
  }

  const uniquePatients = uniqueUpids.size;
  const topExemptProducts = [...productMap.values()]
    .sort((a, b) => b.salesMinor - a.salesMinor)
    .slice(0, 12);
  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const dailyExcise = daily.map((d) => ({ date: d.date, minor: d.exciseMinor }));
  cardValidityIssues.sort((a, b) => b.saleDate.localeCompare(a.saleDate));

  // --- Endorsement / compliance ---------------------------------------------
  const cfg =
    (endorsement as
      | { is_medically_endorsed: boolean; endorsement_number: string | null; excise_exemption_until: string | null }
      | null) ?? null;
  const exemptionUntil = cfg?.excise_exemption_until ?? null;
  const daysUntilExemptionEnds = exemptionUntil
    ? Math.round((new Date(exemptionUntil).getTime() - today.getTime()) / 86_400_000)
    : null;

  return {
    patients: patients ?? 0,
    activeCards,
    expiringSoon,
    isEndorsed: cfg?.is_medically_endorsed ?? false,
    endorsementNumber: cfg?.endorsement_number ?? null,
    exemptionUntil,
    daysUntilExemptionEnds,
    authByStatus,
    expiryBuckets,
    inDohDatabase,
    exemptSales: rows.length,
    uniquePatients,
    exemptSalesMinor,
    salesTaxExemptedMinor,
    exciseExemptedMinor,
    avgExemptBasketMinor: uniquePatients > 0 ? Math.round(exemptSalesMinor / uniquePatients) : 0,
    topExemptProducts,
    cardValidityIssues,
    dailyExcise,
    daily,
  };
}
