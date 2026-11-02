/**
 * src/lib/loyalty/loyalty-sale-store.ts  (Task S-a)
 *
 * Server-side application of loyalty value to an ORDER — the missing sale
 * side of the program. Redemption codes were issued in the back office but
 * nothing consumed them at the register, and tier standing discounts were
 * never applied to a sale. This store:
 *
 *   - applies a REWARD CODE the customer brought (atomic claim via the
 *     conditional markRedemptionUsed update),
 *   - (D137) uses one of the member's REWARDS on the order — 150 pts = 10%
 *     off, 300 pts = 25% off — the back-office twin of the register buttons.
 *     Either way the percent is priced by the pure loyalty-reward-core:
 *     better of the deal or the reward per item, legal floors, never-discount
 *     items untouched, no dollar cap. Member TIER pricing is RETIRED (D139):
 *     Bronze / Gold are badge names only,
 *   - removes a loyalty application (restores prices from the per-line
 *     snapshot; a code the customer brought goes back to 'issued', a code
 *     issued for this sale is cancelled and its points returned),
 *   - releases the code when an order is cancelled / no-show, and
 *   - reads the loyalty context for the order detail UI + completion gate.
 *
 * ONE reward per sale (owner: "one redemption per sale"). All money tax-inclusive minor units.
 * Degrades gracefully before migration 0116 (missing columns → clear error).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { computeOrderTotals } from "@/lib/orders/order-pricing-core";
import { loadProductCosts } from "@/lib/promotions/discount-engine";
// Mastering Slice 1: sold lines resolve the variant's own lot key first.
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";
import { costForLine } from "@/lib/promotions/size-cost-core";
import { type LoyaltySaleLine } from "@/lib/loyalty/loyalty-sale-core";
import {
  LEGACY_CODE_MESSAGE,
  applyRewardPricing,
  chooseReward,
  redemptionReward,
  rewardOptionsFor,
  rewardShortLabel,
} from "@/lib/loyalty/loyalty-reward-core";
import {
  cancelRedemption,
  getAccount,
  getAccountByCustomer,
  issueRedemption,
  listTiers,
  lookupRedeemableCode,
  markRedemptionUsed,
} from "@/lib/loyalty/loyalty-store";
import { listNeverDiscountKeys } from "@/lib/promotions/promotions-store";
import type { OrderLineRow, OrderRow } from "@/lib/orders/types";

const OPEN_STATUSES = new Set(["new", "acknowledged", "preparing", "ready"]);

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist|could not find .* column/i.test(error.message ?? "");
}

type LoyaltyOrderRow = OrderRow & {
  customer_id?: string | null;
  loyalty_kind?: "code" | "tier" | null;
  loyalty_redemption_id?: string | null;
  loyalty_code?: string | null;
  loyalty_discount_minor_units?: number;
  loyalty_tier_label?: string | null;
};

type LoyaltyLineRow = OrderLineRow & { loyalty_discount_minor_units?: number };

async function loadOrderWithLines(
  orderId: string,
): Promise<{ order: LoyaltyOrderRow; lines: LoyaltyLineRow[] } | null> {
  const admin = createSupabaseAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle<LoyaltyOrderRow>();
  if (!order) return null;
  const { data: lines } = await admin
    .from("order_lines")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  return { order, lines: (lines as LoyaltyLineRow[] | null) ?? [] };
}

function toSaleLines(
  lines: LoyaltyLineRow[],
  costs: Map<string, number>,
): LoyaltySaleLine[] {
  return lines.map((l) => ({
    lineId: l.id,
    category: l.category ?? null,
    quantity: l.quantity,
    unitPriceMinorUnits: l.price_minor_units,
    regularPriceMinorUnits: l.regular_price_minor_units ?? l.price_minor_units,
    costMinorUnits: (() => {
      // Mastering Slice 1: the variant's own lot cost wins; single-lot cards
      // resolve the identical key either way.
      const key = lotKeyForSaleLine({ productId: l.product_id, variantId: l.variant_id });
      // R74 S31: the size's own cost (0294 link) first, then the lot/card key.
      return key ? (costForLine(costs, key, l.variant_id) ?? null) : null;
    })(),
  }));
}

async function recomputeHeaderTotals(lines: LoyaltyLineRow[]): Promise<{
  subtotal_minor_units: number;
  estimated_tax_minor_units: number;
  savings_minor_units: number;
  total_minor_units: number;
}> {
  const totals = computeOrderTotals(
    lines.map((l) => ({
      category: l.category ?? null,
      quantity: l.quantity,
      unitPriceMinorUnits: l.price_minor_units,
      regularPriceMinorUnits: l.regular_price_minor_units ?? l.price_minor_units,
    })),
  );
  return {
    subtotal_minor_units: totals.subtotalMinorUnits,
    estimated_tax_minor_units: totals.estimatedTaxMinorUnits,
    savings_minor_units: totals.savingsMinorUnits,
    total_minor_units: totals.totalMinorUnits,
  };
}

async function insertLoyaltyEvent(orderId: string, note: string, actorLabel: string | null) {
  const admin = createSupabaseAdminClient();
  await admin.from("order_events").insert({
    order_id: orderId,
    event_type: "note",
    note,
    actor_label: actorLabel,
  });
}

export type LoyaltyMutation = { ok: true; message: string } | { ok: false; error: string };

/** Order lines whose product is on the owner's never-discount list (D140). */
async function neverDiscountLineIds(lines: LoyaltyLineRow[]): Promise<Set<string>> {
  const keys = new Set((await listNeverDiscountKeys()).map((k) => k.trim().toLowerCase()));
  const out = new Set<string>();
  if (keys.size === 0) return out;
  for (const l of lines) if (keys.has(String(l.product_id ?? "").trim().toLowerCase())) out.add(l.id);
  return out;
}

/** The common refusals before any loyalty is applied to an order. */
function precheckOrder(order: LoyaltyOrderRow, lines: LoyaltyLineRow[]): string | null {
  if (!OPEN_STATUSES.has(order.status)) {
    return "This order is closed — reopen it (logged reversal) before applying loyalty.";
  }
  if (order.loyalty_kind) {
    return "A loyalty reward is already applied. Remove it first — only ONE reward per sale (no stacking).";
  }
  if (lines.length === 0) return "The order has no items.";
  return null;
}

/**
 * Write a priced reward onto the order: reduced line prices + per-line
 * snapshot, recomputed header totals, the loyalty header columns. On any
 * write error the lines are restored and `undo` runs (release / refund).
 */
async function writeRewardToOrder(opts: {
  orderId: string;
  order: LoyaltyOrderRow;
  lines: LoyaltyLineRow[];
  priced: { lines: { lineId: string; unitPriceMinorUnits: number; loyaltyDiscountMinorUnits: number }[]; appliedMinorUnits: number };
  redemptionId: string;
  code: string;
  customerId: string | null;
  undo: () => Promise<void>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const byId = new Map(opts.priced.lines.map((l) => [l.lineId, l]));
  const updatedLines: LoyaltyLineRow[] = [];
  const restore = async () => {
    for (const [i, u] of updatedLines.entries()) {
      await admin
        .from("order_lines")
        .update({ price_minor_units: opts.lines[i].price_minor_units, loyalty_discount_minor_units: 0 })
        .eq("id", u.id);
    }
  };
  for (const line of opts.lines) {
    const s = byId.get(line.id);
    const reduction = s?.loyaltyDiscountMinorUnits ?? 0;
    const newPrice = s ? s.unitPriceMinorUnits : line.price_minor_units;
    const { error } = await admin
      .from("order_lines")
      .update({ price_minor_units: newPrice, loyalty_discount_minor_units: reduction })
      .eq("id", line.id);
    if (error) {
      await restore();
      await opts.undo();
      if (isMissingColumnError(error)) {
        return { ok: false, error: "Migration 0116 (loyalty at sale) has not been applied yet." };
      }
      return { ok: false, error: `Could not apply the reward: ${error.message}` };
    }
    updatedLines.push({ ...line, price_minor_units: newPrice, loyalty_discount_minor_units: reduction });
  }

  const totals = await recomputeHeaderTotals(updatedLines);
  const { error: headerError } = await admin
    .from("orders")
    .update({
      ...totals,
      loyalty_kind: "code",
      loyalty_redemption_id: opts.redemptionId,
      loyalty_code: opts.code,
      loyalty_discount_minor_units: opts.priced.appliedMinorUnits,
      loyalty_tier_label: null,
      ...(opts.customerId ? { customer_id: opts.order.customer_id ?? opts.customerId } : {}),
    })
    .eq("id", opts.orderId);
  if (headerError) {
    await restore();
    await opts.undo();
    if (isMissingColumnError(headerError)) {
      return { ok: false, error: "Migration 0116 (loyalty at sale) has not been applied yet." };
    }
    return { ok: false, error: `Could not apply the reward: ${headerError.message}` };
  }

  // Record what the reward actually took off (the code was issued at $0 when
  // it came from the customer's profile). Best-effort: display/reporting only.
  const { error: valueError } = await admin
    .from("loyalty_redemptions")
    .update({ value_minor: opts.priced.appliedMinorUnits })
    .eq("id", opts.redemptionId);
  if (valueError) {
    await insertLoyaltyEvent(
      opts.orderId,
      `NOTE: the reward amount could not be recorded on code ${opts.code} (${valueError.message}); the sale itself is correct.`,
      "system",
    );
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Apply a reward CODE the customer brought (issued from their profile)
// ---------------------------------------------------------------------------
export async function applyCodeToOrder(opts: {
  orderId: string;
  code: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<LoyaltyMutation> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const loaded = await loadOrderWithLines(opts.orderId);
  if (!loaded) return { ok: false, error: "Order not found." };
  const { order, lines } = loaded;
  const refusal = precheckOrder(order, lines);
  if (refusal) return { ok: false, error: refusal };

  const redemption = await lookupRedeemableCode(opts.code);
  if (!redemption) {
    return { ok: false, error: "Code not found, expired, or already used. Check the code with the customer." };
  }
  // D137: a code is a PERCENT reward (150 pts = 10%, 300 pts = 25%). A code
  // from the retired $0.10-per-point program is refused (cancel it to refund).
  const reward = redemptionReward(redemption);
  if (!reward) return { ok: false, error: LEGACY_CODE_MESSAGE };

  const costs = await loadProductCosts();
  const priced = applyRewardPricing(toSaleLines(lines, costs), reward, {
    excludeLineIds: await neverDiscountLineIds(lines),
  });
  if (!priced.ok) {
    return { ok: false, error: priced.message.replace(" No points were used.", " The code stays open for another visit.") };
  }

  // ATOMIC CLAIM: conditional update on status='issued' — two registers
  // presenting the same code can't both win.
  const claimed = await markRedemptionUsed(opts.code, opts.orderId);
  if (!claimed.ok) return { ok: false, error: claimed.error ?? "Code could not be claimed." };

  const account = await getAccount(redemption.account_id);
  const admin = createSupabaseAdminClient();
  const written = await writeRewardToOrder({
    orderId: opts.orderId,
    order,
    lines,
    priced,
    redemptionId: redemption.id,
    code: redemption.code,
    customerId: account?.customer_id ?? null,
    undo: async () => {
      await admin
        .from("loyalty_redemptions")
        .update({ status: "issued", redeemed_at: null, redeemed_order_id: null })
        .eq("id", redemption.id)
        .eq("status", "redeemed")
        .eq("redeemed_order_id", opts.orderId);
    },
  });
  if (!written.ok) return written;

  const applied = `$${(priced.appliedMinorUnits / 100).toFixed(2)}`;
  await insertLoyaltyEvent(
    opts.orderId,
    `Loyalty reward ${rewardShortLabel(reward)} applied with code ${redemption.code} — ${applied} off (better of the deal or the reward on each item, never both).`,
    opts.actorLabel ?? null,
  );
  return { ok: true, message: `${rewardShortLabel(reward)} applied with code ${redemption.code} — ${applied} off.` };
}

// ---------------------------------------------------------------------------
// D137: use one of the member's REWARDS on this order (back office)
// ---------------------------------------------------------------------------
/**
 * The back-office twin of the register's reward buttons: 150 pts = 10% off,
 * 300 pts = 25% off, exactly those points deducted, same pricing rules. The
 * code is issued (channel "order") and claimed by this order at once; removing
 * the reward (or cancelling the order) cancels the code and returns the points.
 */
export async function applyRewardToOrder(opts: {
  orderId: string;
  customerId: string;
  rewardPoints: number;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<LoyaltyMutation> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const loaded = await loadOrderWithLines(opts.orderId);
  if (!loaded) return { ok: false, error: "Order not found." };
  const { order, lines } = loaded;
  const refusal = precheckOrder(order, lines);
  if (refusal) return { ok: false, error: refusal };

  const account = await getAccountByCustomer(opts.customerId);
  if (!account || !account.is_active) {
    return { ok: false, error: "This customer is not enrolled in the loyalty program. Enroll them from their customer page first." };
  }
  const chosen = chooseReward(account.balance_points, opts.rewardPoints);
  if (!chosen.ok) return { ok: false, error: chosen.error };
  const reward = chosen.reward;

  const costs = await loadProductCosts();
  const priced = applyRewardPricing(toSaleLines(lines, costs), reward, {
    excludeLineIds: await neverDiscountLineIds(lines),
  });
  if (!priced.ok) return { ok: false, error: priced.message };

  const issued = await issueRedemption({
    accountId: account.id,
    points: reward.points,
    valueMinor: priced.appliedMinorUnits,
    channel: "order",
    actorId: opts.actorId ?? null,
  });
  if (!issued.ok) return { ok: false, error: issued.error };

  const refund = async (why: string) => {
    // Put the code back to 'issued' (if the claim landed) so cancelRedemption
    // can cancel it and return the points.
    const admin = createSupabaseAdminClient();
    await admin
      .from("loyalty_redemptions")
      .update({ status: "issued", redeemed_at: null, redeemed_order_id: null })
      .eq("id", issued.id)
      .eq("status", "redeemed")
      .eq("redeemed_order_id", opts.orderId);
    await cancelRedemption({ redemptionId: issued.id, note: why, actorId: opts.actorId ?? null });
  };

  const claimed = await markRedemptionUsed(issued.code, opts.orderId);
  if (!claimed.ok) {
    await refund("Reward could not be attached to the order, points returned");
    return { ok: false, error: claimed.error ?? "The reward could not be attached to the order. No points were used." };
  }

  const written = await writeRewardToOrder({
    orderId: opts.orderId,
    order,
    lines,
    priced,
    redemptionId: issued.id,
    code: issued.code,
    customerId: opts.customerId,
    undo: () => refund("Reward could not be written to the order, points returned"),
  });
  if (!written.ok) return written;

  const applied = `$${(priced.appliedMinorUnits / 100).toFixed(2)}`;
  await insertLoyaltyEvent(
    opts.orderId,
    `Loyalty reward ${rewardShortLabel(reward)} used (code ${issued.code}) — ${applied} off (better of the deal or the reward on each item, never both).`,
    opts.actorLabel ?? null,
  );
  return { ok: true, message: `${rewardShortLabel(reward)} applied — ${applied} off. ${reward.points} points used.` };
}

/**
 * Give an order's reward back to the customer. A code the customer BROUGHT
 * (issued from their profile) goes back to 'issued' so they can use it
 * another time; a code issued FOR this sale (register / back office) is
 * cancelled and its points are returned to the balance.
 */
async function giveRewardBack(
  orderId: string,
  redemptionId: string,
  why: string,
): Promise<{ released: boolean; refundedPoints: number }> {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("loyalty_redemptions")
    .select("id, channel")
    .eq("id", redemptionId)
    .maybeSingle<{ id: string; channel: string | null }>();
  const { data: released } = await admin
    .from("loyalty_redemptions")
    .update({ status: "issued", redeemed_at: null, redeemed_order_id: null })
    .eq("id", redemptionId)
    .eq("status", "redeemed")
    .eq("redeemed_order_id", orderId)
    .select("id");
  if (!released || released.length === 0) return { released: false, refundedPoints: 0 };
  if (row && (row.channel === "order" || row.channel === "register")) {
    const res = await cancelRedemption({ redemptionId, note: why });
    return { released: true, refundedPoints: res.ok ? res.refundedPoints : 0 };
  }
  return { released: true, refundedPoints: 0 };
}

// ---------------------------------------------------------------------------
// Remove the loyalty application (open orders)
// ---------------------------------------------------------------------------
export async function removeLoyaltyFromOrder(opts: {
  orderId: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<LoyaltyMutation> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const loaded = await loadOrderWithLines(opts.orderId);
  if (!loaded) return { ok: false, error: "Order not found." };
  const { order, lines } = loaded;

  if (!OPEN_STATUSES.has(order.status)) {
    return { ok: false, error: "This order is closed — reopen it (logged reversal) before changing loyalty." };
  }
  if (!order.loyalty_kind) return { ok: false, error: "No loyalty reward is applied to this order." };

  const admin = createSupabaseAdminClient();

  // Restore each line from its per-unit snapshot.
  const restoredLines: LoyaltyLineRow[] = [];
  for (const line of lines) {
    const reduction = line.loyalty_discount_minor_units ?? 0;
    const restored = line.price_minor_units + Math.max(0, reduction);
    if (reduction > 0) {
      const { error } = await admin
        .from("order_lines")
        .update({ price_minor_units: restored, loyalty_discount_minor_units: 0 })
        .eq("id", line.id);
      if (error) return { ok: false, error: `Could not restore line prices: ${error.message}` };
    }
    restoredLines.push({ ...line, price_minor_units: restored, loyalty_discount_minor_units: 0 });
  }

  const totals = await recomputeHeaderTotals(restoredLines);
  const { error: headerError } = await admin
    .from("orders")
    .update({
      ...totals,
      loyalty_kind: null,
      loyalty_redemption_id: null,
      loyalty_code: null,
      loyalty_discount_minor_units: 0,
      loyalty_tier_label: null,
    })
    .eq("id", opts.orderId);
  if (headerError) return { ok: false, error: `Could not clear the loyalty columns: ${headerError.message}` };

  let releaseNote = "";
  if (order.loyalty_kind === "code" && order.loyalty_redemption_id) {
    const back = await giveRewardBack(opts.orderId, order.loyalty_redemption_id, "Reward removed from the order, points returned");
    releaseNote = !back.released
      ? ` NOTE: code ${order.loyalty_code ?? ""} could not be given back automatically — check it on the customer's profile.`
      : back.refundedPoints > 0
        ? ` ${back.refundedPoints} points returned to the customer.`
        : ` Code ${order.loyalty_code ?? ""} given back to the customer for another visit.`;
  }

  await insertLoyaltyEvent(
    opts.orderId,
    `Loyalty ${order.loyalty_kind === "code" ? "reward" : "member pricing (retired)"} removed; prices restored.${releaseNote}`,
    opts.actorLabel ?? null,
  );
  return { ok: true, message: `Loyalty reward removed.${releaseNote}` };
}

// ---------------------------------------------------------------------------
// Give the reward back when an order is cancelled / no-show (best-effort)
// ---------------------------------------------------------------------------
export async function releaseLoyaltyCodeForOrder(orderId: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id, loyalty_kind, loyalty_redemption_id, loyalty_code")
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      loyalty_kind: string | null;
      loyalty_redemption_id: string | null;
      loyalty_code: string | null;
    }>();
  if (error || !order) return; // pre-0116 or missing — nothing to release
  if (order.loyalty_kind !== "code" || !order.loyalty_redemption_id) return;

  const back = await giveRewardBack(orderId, order.loyalty_redemption_id, "Order closed without completing, points returned");
  if (back.released) {
    await insertLoyaltyEvent(
      orderId,
      back.refundedPoints > 0
        ? `Order closed without completing — the loyalty reward was cancelled and ${back.refundedPoints} points returned to the customer.`
        : `Order closed without completing — loyalty code ${order.loyalty_code ?? ""} automatically given back to the customer.`,
      "system",
    );
  }
}

// ---------------------------------------------------------------------------
// Reads for the order detail UI + completion gate
// ---------------------------------------------------------------------------
export type OrderLoyaltyContext = {
  kind: "code" | "tier" | null;
  code: string | null;
  tierLabel: string | null;
  discountMinorUnits: number;
  redemption: { id: string; status: string; redeemedOrderId: string | null; points: number } | null;
  /** Linked customer's membership (for the "use a reward" buttons). */
  member: {
    customerId: string;
    balancePoints: number;
    /** Member badge name (Bronze / Gold, renameable) — a name only. */
    tierName: string | null;
  } | null;
  migrationApplied: boolean;
};

export async function getOrderLoyaltyContext(orderId: string): Promise<OrderLoyaltyContext> {
  const empty: OrderLoyaltyContext = {
    kind: null,
    code: null,
    tierLabel: null,
    discountMinorUnits: 0,
    redemption: null,
    member: null,
    migrationApplied: true,
  };
  if (!isSupabaseServiceConfigured) return { ...empty, migrationApplied: false };
  const admin = createSupabaseAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select("id, customer_id, loyalty_kind, loyalty_redemption_id, loyalty_code, loyalty_discount_minor_units, loyalty_tier_label")
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      customer_id: string | null;
      loyalty_kind: "code" | "tier" | null;
      loyalty_redemption_id: string | null;
      loyalty_code: string | null;
      loyalty_discount_minor_units: number;
      loyalty_tier_label: string | null;
    }>();
  if (error) {
    if (isMissingColumnError(error)) return { ...empty, migrationApplied: false };
    return empty;
  }
  if (!order) return empty;

  let redemption: OrderLoyaltyContext["redemption"] = null;
  if (order.loyalty_redemption_id) {
    const { data: row } = await admin
      .from("loyalty_redemptions")
      .select("id, status, redeemed_order_id, points")
      .eq("id", order.loyalty_redemption_id)
      .maybeSingle<{ id: string; status: string; redeemed_order_id: string | null; points: number }>();
    redemption = row
      ? { id: row.id, status: row.status, redeemedOrderId: row.redeemed_order_id, points: row.points }
      : null;
  }

  let member: OrderLoyaltyContext["member"] = null;
  if (order.customer_id) {
    const account = await getAccountByCustomer(order.customer_id);
    if (account && account.is_active) {
      const tiers = await listTiers();
      const tier = tiers.find((t) => t.id === account.tier_id) ?? null;
      member = {
        customerId: order.customer_id,
        balancePoints: account.balance_points,
        tierName: tier?.name ?? null,
      };
    }
  }

  return {
    kind: order.loyalty_kind ?? null,
    code: order.loyalty_code ?? null,
    tierLabel: order.loyalty_tier_label ?? null,
    discountMinorUnits: order.loyalty_discount_minor_units ?? 0,
    redemption,
    member,
    migrationApplied: true,
  };
}

/**
 * D137: preview what each reward the member can afford would take off THIS
 * order (read-only; 0 when today's deals already win everywhere), so the
 * back-office buttons read "Use 300 pts – 25% off ($21.96)".
 */
export async function previewRewardSavings(
  orderId: string,
  balancePoints: number,
): Promise<{ points: number; percentBps: number; savingsMinorUnits: number }[]> {
  if (!isSupabaseServiceConfigured) return [];
  const options = rewardOptionsFor(balancePoints);
  if (options.length === 0) return [];
  const loaded = await loadOrderWithLines(orderId);
  if (!loaded) return [];
  const costs = await loadProductCosts();
  const saleLines = toSaleLines(loaded.lines, costs);
  const exclude = await neverDiscountLineIds(loaded.lines);
  return options.map((r) => {
    const priced = applyRewardPricing(saleLines, r, { excludeLineIds: exclude });
    return { points: r.points, percentBps: r.percentBps, savingsMinorUnits: priced.ok ? priced.appliedMinorUnits : 0 };
  });
}
