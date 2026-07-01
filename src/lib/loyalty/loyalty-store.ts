/**
 * src/lib/loyalty/loyalty-store.ts
 *
 * Server-side data access for the Slice 27 loyalty engine. Mirrors
 * supabase/migrations/0039_loyalty_engine.sql. The ledger is the source of
 * truth; loyalty_accounts.balance_points / lifetime_points are kept in sync
 * by these functions.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificParts } from "@/lib/reports/timezone";
import {
  type LoyaltyConfig,
  type LoyaltyTier,
  type LoyaltyPromotion,
  basePointsForSubtotal,
  earnedPoints,
  tierForPoints,
  pointsValueMinor,
  canRedeem,
  generateRedemptionCode,
  codeExpiry,
} from "@/lib/loyalty/engine";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
export type LoyaltyAccount = {
  id: string;
  customer_id: string;
  balance_points: number;
  lifetime_points: number;
  tier_id: string | null;
  enrolled_at: string;
  is_active: boolean;
};

export type LedgerRow = {
  id: string;
  account_id: string;
  kind: string;
  points: number;
  order_id: string | null;
  basis_minor: number | null;
  promotion_id: string | null;
  redemption_id: string | null;
  note: string | null;
  created_at: string;
};

export type RedemptionRow = {
  id: string;
  account_id: string;
  code: string;
  points: number;
  value_minor: number;
  status: "issued" | "redeemed" | "expired" | "cancelled";
  channel: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Config / tiers / promotions
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG: LoyaltyConfig = {
  pointsPerDollar: 1,
  pointValueMinor: 1,
  minRedeemPoints: 100,
  signupBonusPoints: 0,
  codeExpiryDays: null,
};

export async function getConfig(): Promise<LoyaltyConfig> {
  if (!isSupabaseServiceConfigured) return DEFAULT_CONFIG;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_config")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return DEFAULT_CONFIG;
  return {
    pointsPerDollar: Number(data.points_per_dollar ?? 1),
    pointValueMinor: Number(data.point_value_minor ?? 1),
    minRedeemPoints: Number(data.min_redeem_points ?? 100),
    signupBonusPoints: Number(data.signup_bonus_points ?? 0),
    codeExpiryDays: data.code_expiry_days == null ? null : Number(data.code_expiry_days),
  };
}

export async function listTiers(): Promise<LoyaltyTier[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_tiers")
    .select("*")
    .eq("is_active", true)
    .order("min_points", { ascending: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    minPoints: Number(r.min_points),
    discountBps: Number(r.discount_bps),
  }));
}

export async function listPromotions(opts?: { activeOnly?: boolean }): Promise<LoyaltyPromotion[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("loyalty_promotions").select("*").order("created_at", { ascending: false });
  if (opts?.activeOnly) q = q.eq("is_active", true);
  const { data } = await q;
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as LoyaltyPromotion["kind"],
    multiplierBps: Number(r.multiplier_bps),
    flatBonusPoints: Number(r.flat_bonus_points),
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
    hourStart: r.hour_start == null ? null : Number(r.hour_start),
    hourEnd: r.hour_end == null ? null : Number(r.hour_end),
    isActive: Boolean(r.is_active),
  }));
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export async function getAccountByCustomer(customerId: string): Promise<LoyaltyAccount | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_accounts")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle();
  return (data as LoyaltyAccount | null) ?? null;
}

export async function getAccount(accountId: string): Promise<LoyaltyAccount | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("loyalty_accounts").select("*").eq("id", accountId).maybeSingle();
  return (data as LoyaltyAccount | null) ?? null;
}

/**
 * Enroll a customer (idempotent). Grants the signup bonus once on creation.
 */
export async function enrollCustomer(
  customerId: string,
  actorId: string | null,
): Promise<{ ok: true; account: LoyaltyAccount } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const existing = await getAccountByCustomer(customerId);
  if (existing) return { ok: true, account: existing };

  const admin = createSupabaseAdminClient();
  const cfg = await getConfig();
  const { data, error } = await admin
    .from("loyalty_accounts")
    .insert({ customer_id: customerId, balance_points: 0, lifetime_points: 0 })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not enroll" };

  const account = data as LoyaltyAccount;
  if (cfg.signupBonusPoints > 0) {
    await applyLedger({
      accountId: account.id,
      kind: "signup_bonus",
      points: cfg.signupBonusPoints,
      note: "Signup bonus",
      actorId,
    });
    return { ok: true, account: (await getAccount(account.id)) ?? account };
  }
  return { ok: true, account };
}

// ---------------------------------------------------------------------------
// Ledger (source of truth; keeps balance/lifetime in sync)
// ---------------------------------------------------------------------------
async function applyLedger(opts: {
  accountId: string;
  kind: LedgerRow["kind"];
  points: number; // signed
  orderId?: string | null;
  basisMinor?: number | null;
  promotionId?: string | null;
  redemptionId?: string | null;
  note?: string | null;
  actorId?: string | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("loyalty_ledger").insert({
    account_id: opts.accountId,
    kind: opts.kind,
    points: opts.points,
    order_id: opts.orderId ?? null,
    basis_minor: opts.basisMinor ?? null,
    promotion_id: opts.promotionId ?? null,
    redemption_id: opts.redemptionId ?? null,
    note: opts.note ?? null,
    created_by: opts.actorId ?? null,
  });

  const account = await getAccount(opts.accountId);
  if (!account) return;
  const newBalance = account.balance_points + opts.points;
  const newLifetime = opts.points > 0 ? account.lifetime_points + opts.points : account.lifetime_points;
  const tiers = await listTiers();
  const tier = tierForPoints(newLifetime, tiers);
  await admin
    .from("loyalty_accounts")
    .update({ balance_points: newBalance, lifetime_points: newLifetime, tier_id: tier?.id ?? null })
    .eq("id", opts.accountId);
}

export async function recentLedger(accountId: string, limit = 50): Promise<LedgerRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_ledger")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as LedgerRow[] | null) ?? [];
}

/**
 * Accrue points for a completed order on its PRETAX subtotal. Idempotent per
 * order (skips if a ledger row already references the order).
 */
export async function accrueForOrder(opts: {
  customerId: string;
  orderId: string;
  subtotalMinor: number;
  at?: Date;
  actorId?: string | null;
}): Promise<{ ok: boolean; points: number }> {
  if (!isSupabaseServiceConfigured) return { ok: false, points: 0 };
  const admin = createSupabaseAdminClient();

  // idempotency: already accrued for this order?
  const { data: existing } = await admin
    .from("loyalty_ledger")
    .select("id")
    .eq("order_id", opts.orderId)
    .eq("kind", "earn")
    .limit(1);
  if (existing && existing.length > 0) return { ok: true, points: 0 };

  const enrolled = await enrollCustomer(opts.customerId, opts.actorId ?? null);
  if (!enrolled.ok) return { ok: false, points: 0 };

  const cfg = await getConfig();
  const promos = await listPromotions({ activeOnly: true });
  const when = opts.at ?? new Date();
  const hour = pacificParts(when).hour;

  const base = basePointsForSubtotal(opts.subtotalMinor, cfg);
  const { points, promotionId } = earnedPoints(base, promos, when, hour);
  if (points <= 0) return { ok: true, points: 0 };

  await applyLedger({
    accountId: enrolled.account.id,
    kind: "earn",
    points,
    orderId: opts.orderId,
    basisMinor: opts.subtotalMinor,
    promotionId,
    note: `Earned on $${(opts.subtotalMinor / 100).toFixed(2)} pretax`,
    actorId: opts.actorId ?? null,
  });
  return { ok: true, points };
}

/** Manual staff adjustment (positive or negative). */
export async function adjustPoints(opts: {
  accountId: string;
  points: number;
  note: string;
  actorId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  if (opts.points === 0) return { ok: false, error: "Adjustment cannot be zero" };
  await applyLedger({
    accountId: opts.accountId,
    kind: "adjust",
    points: opts.points,
    note: opts.note,
    actorId: opts.actorId ?? null,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Redemption codes
// ---------------------------------------------------------------------------
export async function issueRedemption(opts: {
  accountId: string;
  points: number;
  channel?: "sms" | "email" | "both";
  actorId?: string | null;
}): Promise<{ ok: true; code: string; valueMinor: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const account = await getAccount(opts.accountId);
  if (!account) return { ok: false, error: "Account not found" };
  const cfg = await getConfig();
  if (!canRedeem(account.balance_points, opts.points, cfg)) {
    return {
      ok: false,
      error: `Cannot redeem ${opts.points} pts (balance ${account.balance_points}, min ${cfg.minRedeemPoints}).`,
    };
  }

  const admin = createSupabaseAdminClient();
  const valueMinor = pointsValueMinor(opts.points, cfg);
  const expires = codeExpiry(new Date(), cfg);

  // generate a unique code (retry a few times on collision)
  let code = "";
  for (let i = 0; i < 6; i++) {
    code = generateRedemptionCode();
    const { data: clash } = await admin
      .from("loyalty_redemptions")
      .select("id")
      .eq("code", code)
      .limit(1);
    if (!clash || clash.length === 0) break;
    code = "";
  }
  if (!code) return { ok: false, error: "Could not generate a unique code" };

  const { data: redemption, error } = await admin
    .from("loyalty_redemptions")
    .insert({
      account_id: opts.accountId,
      code,
      points: opts.points,
      value_minor: valueMinor,
      status: "issued",
      channel: opts.channel ?? "both",
      expires_at: expires,
      issued_by: opts.actorId ?? null,
    })
    .select("id")
    .single();
  if (error || !redemption) return { ok: false, error: error?.message ?? "Could not issue code" };

  // deduct points now (reserved by the code)
  await applyLedger({
    accountId: opts.accountId,
    kind: "redeem",
    points: -opts.points,
    redemptionId: (redemption as { id: string }).id,
    note: `Redemption code ${code} ($${(valueMinor / 100).toFixed(2)})`,
    actorId: opts.actorId ?? null,
  });

  return { ok: true, code, valueMinor };
}

export async function listRedemptions(accountId: string): Promise<RedemptionRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_redemptions")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  return (data as RedemptionRow[] | null) ?? [];
}

/**
 * Look up an issued code (for the online menu / in-store POS to validate &
 * apply). Returns null if not found, expired, or already used.
 */
export async function lookupRedeemableCode(code: string): Promise<RedemptionRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_redemptions")
    .select("*")
    .eq("code", code.trim().toUpperCase())
    .eq("status", "issued")
    .maybeSingle();
  const row = (data as RedemptionRow | null) ?? null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("loyalty_redemptions").update({ status: "expired" }).eq("id", row.id);
    return null;
  }
  return row;
}

/** Mark a code redeemed against an order (in-store or online). */
export async function markRedemptionUsed(
  code: string,
  orderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const row = await lookupRedeemableCode(code);
  if (!row) return { ok: false, error: "Code not found, expired, or already used" };
  const admin = createSupabaseAdminClient();
  await admin
    .from("loyalty_redemptions")
    .update({ status: "redeemed", redeemed_at: new Date().toISOString(), redeemed_order_id: orderId })
    .eq("id", row.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Program-wide summary for the dashboard
// ---------------------------------------------------------------------------
export async function loyaltySummary(): Promise<{
  accounts: number;
  pointsOutstanding: number;
  codesIssued: number;
}> {
  if (!isSupabaseServiceConfigured) return { accounts: 0, pointsOutstanding: 0, codesIssued: 0 };
  const admin = createSupabaseAdminClient();
  const [{ count: accounts }, { data: balances }, { count: codes }] = await Promise.all([
    admin.from("loyalty_accounts").select("id", { count: "exact", head: true }),
    admin.from("loyalty_accounts").select("balance_points"),
    admin.from("loyalty_redemptions").select("id", { count: "exact", head: true }).eq("status", "issued"),
  ]);
  const pointsOutstanding = ((balances as { balance_points: number }[] | null) ?? []).reduce(
    (acc, r) => acc + (r.balance_points ?? 0),
    0,
  );
  return { accounts: accounts ?? 0, pointsOutstanding, codesIssued: codes ?? 0 };
}

// ---------------------------------------------------------------------------
// Customizer editor rows + write helpers (Slice 67 — item 2)
// ---------------------------------------------------------------------------
export type TierEditRow = LoyaltyTier & { sortOrder: number; isActive: boolean };
export type PromoEditRow = LoyaltyPromotion & { name: string; notes: string | null };

/** All tiers (including inactive) with editor fields, ordered for display. */
export async function listTiersForEdit(): Promise<TierEditRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_tiers")
    .select("*")
    .order("min_points", { ascending: true });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    minPoints: Number(r.min_points),
    discountBps: Number(r.discount_bps),
    sortOrder: Number(r.sort_order ?? 0),
    isActive: Boolean(r.is_active),
  }));
}

/** All promotions with editor fields (name + notes), newest first. */
export async function listPromotionsForEdit(): Promise<PromoEditRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("loyalty_promotions")
    .select("*")
    .order("created_at", { ascending: false });
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: String(r.kind) as LoyaltyPromotion["kind"],
    multiplierBps: Number(r.multiplier_bps),
    flatBonusPoints: Number(r.flat_bonus_points),
    startsAt: (r.starts_at as string | null) ?? null,
    endsAt: (r.ends_at as string | null) ?? null,
    hourStart: r.hour_start == null ? null : Number(r.hour_start),
    hourEnd: r.hour_end == null ? null : Number(r.hour_end),
    isActive: Boolean(r.is_active),
    notes: (r.notes as string | null) ?? null,
  }));
}

/**
 * Update the active program configuration. Keeps a single active row; if none
 * exists yet, inserts one. Returns the persisted config.
 */
export async function updateConfig(
  cfg: {
    pointsPerDollar: number;
    pointValueMinor: number;
    minRedeemPoints: number;
    signupBonusPoints: number;
    codeExpiryDays: number | null;
    notes?: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const payload = {
    points_per_dollar: cfg.pointsPerDollar,
    point_value_minor: cfg.pointValueMinor,
    min_redeem_points: cfg.minRedeemPoints,
    signup_bonus_points: cfg.signupBonusPoints,
    code_expiry_days: cfg.codeExpiryDays,
    notes: cfg.notes ?? null,
    updated_by: actorId,
    is_active: true,
  };
  const { data: existing } = await admin
    .from("loyalty_config")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await admin.from("loyalty_config").update(payload).eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin
      .from("loyalty_config")
      .insert({ ...payload, created_by: actorId });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Create or update a tier. */
export async function upsertTier(tier: {
  id?: string | null;
  name: string;
  minPoints: number;
  discountBps: number;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const payload = {
    name: tier.name,
    min_points: tier.minPoints,
    discount_bps: tier.discountBps,
    sort_order: tier.sortOrder ?? tier.minPoints,
    is_active: tier.isActive ?? true,
  };
  if (tier.id) {
    const { error } = await admin.from("loyalty_tiers").update(payload).eq("id", tier.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("loyalty_tiers").insert(payload);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Soft-delete a tier (mark inactive) so historical assignments stay intact. */
export async function deactivateTier(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("loyalty_tiers").update({ is_active: false }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Create or update a promotion. */
export async function upsertPromotion(promo: {
  id?: string | null;
  name: string;
  kind: LoyaltyPromotion["kind"];
  multiplierBps: number;
  flatBonusPoints: number;
  hourStart: number | null;
  hourEnd: number | null;
  isActive: boolean;
  notes?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const payload = {
    name: promo.name,
    kind: promo.kind,
    multiplier_bps: promo.multiplierBps,
    flat_bonus_points: promo.flatBonusPoints,
    hour_start: promo.hourStart,
    hour_end: promo.hourEnd,
    is_active: promo.isActive,
    notes: promo.notes ?? null,
  };
  if (promo.id) {
    const { error } = await admin.from("loyalty_promotions").update(payload).eq("id", promo.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin
      .from("loyalty_promotions")
      .insert({ ...payload, created_by: promo.createdBy ?? null });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Toggle a promotion active/inactive. */
export async function setPromotionActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured" };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("loyalty_promotions").update({ is_active: isActive }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
