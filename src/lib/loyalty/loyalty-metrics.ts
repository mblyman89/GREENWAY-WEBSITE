/**
 * src/lib/loyalty/loyalty-metrics.ts  (Task S-a)
 *
 * AGGREGATE program-health metrics for the loyalty command center. Everything
 * here is a count/sum computed server-side from the ledger, redemptions,
 * accounts, and completed orders — the AI advisor receives ONLY these
 * aggregates, never customer PII or raw rows.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type LoyaltyMetrics = {
  /** Enrollment */
  accounts: number;
  activeAccounts90d: number; // any ledger activity in the last 90 days
  newAccounts30d: number;
  /** Points economy (last 30 days) */
  pointsEarned30d: number;
  pointsRedeemed30d: number; // points converted into codes
  redemptionRate30d: number | null; // redeemed / earned (null when no earn)
  /** Liability */
  pointsOutstanding: number;
  pointValueMinor: number;
  liabilityMinor: number; // outstanding × value + issued codes' value
  /** Codes */
  codesIssuedOutstanding: number;
  codesOutstandingValueMinor: number;
  codesRedeemed30d: number;
  codesExpired: number;
  avgDaysIssueToUse: number | null;
  /** Sale-side (last 90 days, completed orders) */
  memberOrders90d: number;
  guestOrders90d: number;
  memberAvgOrderMinor: number | null;
  guestAvgOrderMinor: number | null;
  loyaltyDiscountTotal90dMinor: number; // total loyalty value given at sale
  /** Tiers */
  tierDistribution: { name: string; count: number }[];
  untieredAccounts: number;
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function computeLoyaltyMetrics(pointValueMinor: number): Promise<LoyaltyMetrics> {
  const empty: LoyaltyMetrics = {
    accounts: 0,
    activeAccounts90d: 0,
    newAccounts30d: 0,
    pointsEarned30d: 0,
    pointsRedeemed30d: 0,
    redemptionRate30d: null,
    pointsOutstanding: 0,
    pointValueMinor,
    liabilityMinor: 0,
    codesIssuedOutstanding: 0,
    codesOutstandingValueMinor: 0,
    codesRedeemed30d: 0,
    codesExpired: 0,
    avgDaysIssueToUse: null,
    memberOrders90d: 0,
    guestOrders90d: 0,
    memberAvgOrderMinor: null,
    guestAvgOrderMinor: null,
    loyaltyDiscountTotal90dMinor: 0,
    tierDistribution: [],
    untieredAccounts: 0,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const d30 = daysAgoIso(30);
  const d90 = daysAgoIso(90);

  const [accountsRes, ledger30Res, ledger90Res, redemptionsRes, tiersRes, orders90Res] =
    await Promise.all([
      admin.from("loyalty_accounts").select("id, balance_points, tier_id, enrolled_at, is_active"),
      admin.from("loyalty_ledger").select("kind, points, created_at").gte("created_at", d30),
      admin.from("loyalty_ledger").select("account_id, created_at").gte("created_at", d90),
      admin
        .from("loyalty_redemptions")
        .select("status, value_minor, created_at, redeemed_at"),
      admin.from("loyalty_tiers").select("id, name").eq("is_active", true),
      admin
        .from("orders")
        .select("customer_id, total_minor_units, loyalty_discount_minor_units")
        .eq("status", "completed")
        .gte("placed_at", d90),
    ]);

  const accounts =
    (accountsRes.data as
      | { id: string; balance_points: number; tier_id: string | null; enrolled_at: string; is_active: boolean }[]
      | null) ?? [];
  const ledger30 =
    (ledger30Res.data as { kind: string; points: number; created_at: string }[] | null) ?? [];
  const ledger90 =
    (ledger90Res.data as { account_id: string; created_at: string }[] | null) ?? [];
  const redemptions =
    (redemptionsRes.data as
      | { status: string; value_minor: number; created_at: string; redeemed_at: string | null }[]
      | null) ?? [];
  const tiers = (tiersRes.data as { id: string; name: string }[] | null) ?? [];
  // Orders query may fail pre-0116 (loyalty column missing) — degrade to a
  // shape without loyalty totals.
  let orders90 =
    (orders90Res.data as
      | { customer_id: string | null; total_minor_units: number; loyalty_discount_minor_units?: number }[]
      | null) ?? [];
  if (orders90Res.error) {
    const { data: fallback } = await admin
      .from("orders")
      .select("customer_id, total_minor_units")
      .eq("status", "completed")
      .gte("placed_at", d90);
    orders90 =
      (fallback as { customer_id: string | null; total_minor_units: number }[] | null) ?? [];
  }

  const active = accounts.filter((a) => a.is_active);
  const activeIds90 = new Set(ledger90.map((r) => r.account_id));
  const newAccounts30d = active.filter((a) => a.enrolled_at >= d30).length;

  const pointsEarned30d = ledger30
    .filter((r) => r.kind === "earn" || r.kind === "signup_bonus" || r.kind === "promo_bonus")
    .reduce((s, r) => s + Math.max(0, r.points), 0);
  const pointsRedeemed30d = ledger30
    .filter((r) => r.kind === "redeem")
    .reduce((s, r) => s + Math.max(0, -r.points), 0);

  const pointsOutstanding = active.reduce((s, a) => s + Math.max(0, a.balance_points), 0);
  const codesOutstanding = redemptions.filter((r) => r.status === "issued");
  const codesOutstandingValueMinor = codesOutstanding.reduce((s, r) => s + r.value_minor, 0);
  const codesRedeemed30d = redemptions.filter(
    (r) => r.status === "redeemed" && r.redeemed_at && r.redeemed_at >= d30,
  ).length;
  const codesExpired = redemptions.filter((r) => r.status === "expired").length;

  const useDurations = redemptions
    .filter((r) => r.status === "redeemed" && r.redeemed_at)
    .map((r) => (new Date(r.redeemed_at!).getTime() - new Date(r.created_at).getTime()) / 86400000)
    .filter((d) => Number.isFinite(d) && d >= 0);
  const avgDaysIssueToUse =
    useDurations.length > 0
      ? Math.round((useDurations.reduce((s, d) => s + d, 0) / useDurations.length) * 10) / 10
      : null;

  const memberOrders = orders90.filter((o) => o.customer_id);
  const guestOrders = orders90.filter((o) => !o.customer_id);
  const avg = (rows: { total_minor_units: number }[]) =>
    rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.total_minor_units, 0) / rows.length) : null;

  const tierNames = new Map(tiers.map((t) => [t.id, t.name]));
  const tierCounts = new Map<string, number>();
  let untiered = 0;
  for (const a of active) {
    const name = a.tier_id ? tierNames.get(a.tier_id) : null;
    if (!name) {
      untiered += 1;
      continue;
    }
    tierCounts.set(name, (tierCounts.get(name) ?? 0) + 1);
  }

  return {
    accounts: active.length,
    activeAccounts90d: active.filter((a) => activeIds90.has(a.id)).length,
    newAccounts30d,
    pointsEarned30d,
    pointsRedeemed30d,
    redemptionRate30d:
      pointsEarned30d > 0 ? Math.round((pointsRedeemed30d / pointsEarned30d) * 1000) / 10 : null,
    pointsOutstanding,
    pointValueMinor,
    liabilityMinor: pointsOutstanding * pointValueMinor + codesOutstandingValueMinor,
    codesIssuedOutstanding: codesOutstanding.length,
    codesOutstandingValueMinor,
    codesRedeemed30d,
    codesExpired,
    avgDaysIssueToUse,
    memberOrders90d: memberOrders.length,
    guestOrders90d: guestOrders.length,
    memberAvgOrderMinor: avg(memberOrders),
    guestAvgOrderMinor: avg(guestOrders),
    loyaltyDiscountTotal90dMinor: orders90.reduce(
      (s, o) => s + Math.max(0, o.loyalty_discount_minor_units ?? 0),
      0,
    ),
    tierDistribution: [...tierCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    untieredAccounts: untiered,
  };
}
