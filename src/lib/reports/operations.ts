/**
 * src/lib/reports/operations.ts
 *
 * Report queries for the loyalty/discount, employee-performance, and medical
 * report tabs (Slice 29). All time buckets are Pacific. Money in minor units.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { isMissingColumn } from "@/lib/payments/payee-banking-store";
import { dayBreakFlags, summarizeBreaks, EMPTY_BREAK_SUMMARY, type BreakFlagCode, type BreakPunch } from "@/lib/staffing/break-clock-core";
import { LOYALTY_REWARDS, MIN_REWARD_POINTS } from "@/lib/loyalty/loyalty-reward-core";
import { resolveEndorsement, type RawEndorsementRow } from "@/lib/medical/endorsement-switch-core";

// ---------------------------------------------------------------------------
// Loyalty & discount report
// ---------------------------------------------------------------------------
const TOP_REWARD_POINTS = LOYALTY_REWARDS[LOYALTY_REWARDS.length - 1].points;
export type LoyaltyKindRow = { kind: string; label: string; points: number };
export type LoyaltyTierRow = {
  tierId: string | null;
  name: string;
  members: number;
  outstandingPoints: number;
  lifetimePoints: number;
};
/**
 * `takenOffMinor` is the amount a USED reward actually took off a sale; open,
 * expired and cancelled codes took nothing off, so it is null for them
 * (D138 — points have no cash value, so there is nothing else to report).
 */
export type LoyaltyCodeFunnelRow = { label: string; count: number; takenOffMinor: number | null };

export type LoyaltyReport = {
  // Headline membership + points
  enrolledAccounts: number;
  activeAccounts: number;
  pointsEarned: number;
  pointsRedeemed: number;
  pointsOutstanding: number;
  // Program economics. D138: points have NO cash value, so there is no
  // dollar "liability" — the real numbers are reward readiness and usage.
  membersWithReward: number; // balance covers at least the 150-pt reward
  membersWithTopReward: number; // balance covers the 300-pt reward
  rewards10Used: number; // 150-pt (10% off) rewards used in window
  rewards25Used: number; // 300-pt (25% off) rewards used in window
  breakagePoints: number; // points expired in window (never redeemed)
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
  discountValueMinor: number; // amount actually taken off sales by used rewards
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
  redeem: "Used for rewards",
  expire: "Expired (breakage)",
};

export const EMPTY_LOYALTY_REPORT: LoyaltyReport = {
  enrolledAccounts: 0,
  activeAccounts: 0,
  pointsEarned: 0,
  pointsRedeemed: 0,
  pointsOutstanding: 0,
  membersWithReward: 0,
  membersWithTopReward: 0,
  rewards10Used: 0,
  rewards25Used: 0,
  breakagePoints: 0,
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
    admin.from("loyalty_tiers").select("id, name, sort_order").eq("is_active", true).order("sort_order"),
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

  const membersWithReward = bals.filter((b) => (b.balance_points ?? 0) >= MIN_REWARD_POINTS).length;
  const membersWithTopReward = bals.filter((b) => (b.balance_points ?? 0) >= TOP_REWARD_POINTS).length;

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
  const tierDefs = (tierRows as { id: string; name: string }[] | null) ?? [];
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
      outstandingPoints: agg.outstanding,
      lifetimePoints: agg.lifetime,
    };
  });
  const untiered = tierAgg.get(null);
  if (untiered && untiered.members > 0) {
    tiers.push({
      tierId: null,
      name: "No badge yet",
      members: untiered.members,
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
  const usedReds = reds.filter((r) => r.status === "redeemed");
  const rewards10Used = usedReds.filter((r) => Number(r.points) === 150).length;
  const rewards25Used = usedReds.filter((r) => Number(r.points) === 300).length;

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
    { label: "Issued", count: codesIssued, takenOffMinor: null },
    { label: "Used", count: codesRedeemed, takenOffMinor: discountValueMinor },
    { label: "Still open", count: codesOutstanding, takenOffMinor: null },
    { label: "Expired", count: codesExpired, takenOffMinor: null },
    { label: "Cancelled (points returned)", count: codesCancelled, takenOffMinor: null },
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
    membersWithReward,
    membersWithTopReward,
    rewards10Used,
    rewards25Used,
    breakagePoints,
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
  /** D211 — unpaid lunch / other breaks (closed), and breaks never ended. */
  lunchCount: number;
  lunchMinutes: number;
  otherBreakCount: number;
  otherBreakMinutes: number;
  openBreaks: number;
  /** D211 — days with a meal-break check (WAC 296-126-092), any code. */
  mealFlagDays: number;
  avgShiftMinutes: number;
  ordersHandled: number;
  lastActiveDay: string | null;
};

/** D211 — one meal-break check, named, for the report table and the export. */
export type EmployeeBreakFlagRow = { employeeId: string; name: string; day: string; code: BreakFlagCode; detail: string };

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
  /** D211 — lunch vs other break totals, and the meal-break checks. */
  totalLunchMinutes: number;
  totalOtherBreakMinutes: number;
  breakFlags: EmployeeBreakFlagRow[];
  /** D211 — true while migration 0348 is not applied (reasons unknown). */
  breakReasonsMissing: boolean;
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
  totalLunchMinutes: 0,
  totalOtherBreakMinutes: 0,
  breakFlags: [],
  breakReasonsMissing: false,
};

const SHIFT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
};
const PUNCH_SOURCE_LABELS: Record<string, string> = {
  web: "Web",
  station: "Station",
  phone: "Phone",
  register: "Register",
  manager_edit: "Manager edit",
};

type ReportPunchRow = {
  id: string;
  employee_id: string;
  punch_kind: string;
  minutes: number | null;
  source: string;
  clock_in_at: string;
  clock_out_at: string | null;
  break_reason?: string | null;
};

/**
 * D211 — the punches whose clock-in falls in the Pacific date range. The old query
 * filtered time_punches.business_day, a column that table has never had, so the
 * request errored and the report showed zero hours. Paged (rule 18) with a unique
 * order, and tolerant of 0348 not being applied yet (break_reason missing).
 */
async function reportPunches(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  fromDate: string,
  toDate: string,
): Promise<{ rows: ReportPunchRow[]; reasonsMissing: boolean }> {
  const lo = pacificWallTimeToUtcISO(fromDate, "start");
  const hi = pacificWallTimeToUtcISO(toDate, "end");
  const base = "id, employee_id, punch_kind, minutes, source, clock_in_at, clock_out_at";
  const run = async (cols: string) => {
    let err: { code?: string; message?: string } | null = null;
    const rows = await pagedAll<ReportPunchRow>(async (a, b) => {
      if (err) return [];
      const { data, error } = await admin
        .from("time_punches")
        .select(cols)
        .gte("clock_in_at", lo)
        .lte("clock_in_at", hi)
        .order("id", { ascending: true })
        .range(a, b);
      if (error) {
        err = error;
        return [];
      }
      return (data as unknown as ReportPunchRow[] | null) ?? [];
    });
    return { rows, err: err as { code?: string; message?: string } | null };
  };
  const first = await run(`${base}, break_reason`);
  if (!first.err) return { rows: first.rows, reasonsMissing: false };
  if (!isMissingColumn(first.err)) return { rows: [], reasonsMissing: false };
  const second = await run(base);
  return { rows: second.err ? [] : second.rows, reasonsMissing: true };
}

export async function getEmployeeReport(fromDate: string, toDate: string): Promise<EmployeeReport> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_EMPLOYEE_REPORT };
  const admin = createSupabaseAdminClient();

  const [{ data: shifts }, { data: employees }, punchRead] = await Promise.all([
    admin
      .from("shifts")
      .select("id, employee_id, business_day, shift_role, status, scheduled_start, scheduled_end, started_at, ended_at")
      .gte("business_day", fromDate)
      .lte("business_day", toDate),
    admin.from("employees").select("id, full_name, job_role, active, staff_id"),
    reportPunches(admin, fromDate, toDate),
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
  const punchRows = punchRead.rows.map((p) => ({ ...p, business_day: pacificDayKey(p.clock_in_at) }));
  // D211 — breaks by reason and the meal-break checks (flags, not blocks).
  const breakPunches: BreakPunch[] = punchRows.map((p) => ({
    employeeId: p.employee_id,
    kind: p.punch_kind === "break" ? "break" : "work",
    reason: p.break_reason ?? null,
    clockInIso: p.clock_in_at,
    clockOutIso: p.clock_out_at,
  }));
  const breakSummary = summarizeBreaks(breakPunches);
  const rawFlags = dayBreakFlags(breakPunches);
  const flagDays = new Map<string, Set<string>>();
  for (const f of rawFlags) {
    const set = flagDays.get(f.employeeId) ?? new Set<string>();
    set.add(f.day);
    flagDays.set(f.employeeId, set);
  }

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
      const bs = breakSummary.get(employeeId) ?? EMPTY_BREAK_SUMMARY;
      return {
        employeeId,
        name: emp?.full_name ?? "Employee",
        jobRole: emp?.job_role ?? "sales",
        active: emp?.active ?? true,
        shifts: v.shifts,
        daysWorked: v.days.size,
        minutesWorked: v.workMinutes,
        breakMinutes: v.breakMinutes,
        lunchCount: bs.lunchCount,
        lunchMinutes: bs.lunchMinutes,
        otherBreakCount: bs.otherCount,
        otherBreakMinutes: bs.otherMinutes,
        openBreaks: bs.openBreaks,
        mealFlagDays: flagDays.get(employeeId)?.size ?? 0,
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
    totalLunchMinutes: rows.reduce((a, r) => a + r.lunchMinutes, 0),
    totalOtherBreakMinutes: rows.reduce((a, r) => a + r.otherBreakMinutes, 0),
    breakFlags: rawFlags.map((f) => ({ ...f, name: empById.get(f.employeeId)?.full_name ?? "Employee" })),
    breakReasonsMissing: punchRead.reasonsMissing,
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
        .select("*")
        .order("created_at", { ascending: false })
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
  // A-06: the same fail-closed, dated resolver every money path uses.
  const cfg = endorsement ? resolveEndorsement(endorsement as RawEndorsementRow, pacificDayKey(today)) : null;
  const exemptionUntil = cfg?.exciseExemptionUntil ?? null;
  const daysUntilExemptionEnds = exemptionUntil
    ? Math.round((new Date(exemptionUntil).getTime() - today.getTime()) / 86_400_000)
    : null;

  return {
    patients: patients ?? 0,
    activeCards,
    expiringSoon,
    isEndorsed: cfg?.isMedicallyEndorsed ?? false,
    endorsementNumber: cfg?.endorsementNumber ?? null,
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
