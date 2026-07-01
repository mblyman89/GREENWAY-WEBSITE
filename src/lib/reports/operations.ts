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
