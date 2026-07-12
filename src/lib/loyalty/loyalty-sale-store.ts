/**
 * src/lib/loyalty/loyalty-sale-store.ts  (Task S-a)
 *
 * Server-side application of loyalty value to an ORDER — the missing sale
 * side of the program. Redemption codes were issued in the back office but
 * nothing consumed them at the register, and tier standing discounts were
 * never applied to a sale. This store:
 *
 *   - applies a redemption CODE to an open order (atomic claim via the
 *     conditional markRedemptionUsed update; value spread by the pure
 *     loyalty-sale-core with statutory + acquisition-cost floors),
 *   - applies MEMBER TIER pricing (per-line best-deal-wins vs the promo
 *     price — never stacked),
 *   - removes a loyalty application (restores prices from the per-line
 *     snapshot; conditionally releases the code back to 'issued'),
 *   - releases the code when an order is cancelled / no-show, and
 *   - reads the loyalty context for the order detail UI + completion gate.
 *
 * ONE loyalty application per order (owner: "no discount stacking") — either
 * tier pricing or a code, never both. All money tax-inclusive minor units.
 * Degrades gracefully before migration 0116 (missing columns → clear error).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { computeOrderTotals } from "@/lib/orders/order-pricing-core";
import { loadProductCosts } from "@/lib/promotions/discount-engine";
import {
  applyTierPricing,
  spreadCodeValue,
  type LoyaltySaleLine,
} from "@/lib/loyalty/loyalty-sale-core";
import {
  getAccount,
  getAccountByCustomer,
  listTiers,
  lookupRedeemableCode,
  markRedemptionUsed,
} from "@/lib/loyalty/loyalty-store";
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
    costMinorUnits: l.product_id ? (costs.get(l.product_id) ?? null) : null,
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

// ---------------------------------------------------------------------------
// Apply a redemption CODE
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

  if (!OPEN_STATUSES.has(order.status)) {
    return { ok: false, error: "This order is closed — reopen it (logged reversal) before applying loyalty." };
  }
  if (order.loyalty_kind) {
    return {
      ok: false,
      error: "A loyalty discount is already applied. Remove it first — only ONE loyalty application per order (no stacking).",
    };
  }
  if (lines.length === 0) return { ok: false, error: "The order has no items." };

  const redemption = await lookupRedeemableCode(opts.code);
  if (!redemption) {
    return { ok: false, error: "Code not found, expired, or already used. Check the code with the customer." };
  }

  // Spread the stored value across the lines above the legal floors.
  const costs = await loadProductCosts();
  const spread = spreadCodeValue(toSaleLines(lines, costs), redemption.value_minor);
  if (!spread.ok) {
    if (spread.reason === "no_capacity") {
      return {
        ok: false,
        error:
          "This cart is already at the legal price floor (RCW 69.50.357 / acquisition cost) — the code cannot be applied. Add items first.",
      };
    }
    return {
      ok: false,
      error: `This cart can only absorb $${(spread.absorbableMinorUnits / 100).toFixed(2)} above the legal price floors, but the code is worth $${(redemption.value_minor / 100).toFixed(2)}. Add items, or issue the customer a smaller code from their profile — value is never partially burned.`,
    };
  }

  // ATOMIC CLAIM: conditional update on status='issued' — two registers
  // presenting the same code can't both win.
  const claimed = await markRedemptionUsed(opts.code, opts.orderId);
  if (!claimed.ok) return { ok: false, error: claimed.error ?? "Code could not be claimed." };

  // Look up the member behind the code so the order earns their points.
  const account = await getAccount(redemption.account_id);

  const admin = createSupabaseAdminClient();
  const byId = new Map(spread.lines.map((l) => [l.lineId, l]));
  const rollback = async () => {
    await admin
      .from("loyalty_redemptions")
      .update({ status: "issued", redeemed_at: null, redeemed_order_id: null })
      .eq("id", redemption.id)
      .eq("status", "redeemed")
      .eq("redeemed_order_id", opts.orderId);
  };

  // Write the reduced line prices + per-line snapshot.
  const updatedLines: LoyaltyLineRow[] = [];
  for (const line of lines) {
    const s = byId.get(line.id);
    const reduction = s?.loyaltyDiscountMinorUnits ?? 0;
    const newPrice = s ? s.unitPriceMinorUnits : line.price_minor_units;
    const { error } = await admin
      .from("order_lines")
      .update({ price_minor_units: newPrice, loyalty_discount_minor_units: reduction })
      .eq("id", line.id);
    if (error) {
      // Restore any lines already written (to their ORIGINAL prices), release
      // the code, and refuse.
      for (const [i, u] of updatedLines.entries()) {
        await admin
          .from("order_lines")
          .update({ price_minor_units: lines[i].price_minor_units, loyalty_discount_minor_units: 0 })
          .eq("id", u.id);
      }
      await rollback();
      if (isMissingColumnError(error)) {
        return { ok: false, error: "Migration 0116 (loyalty at sale) has not been applied yet." };
      }
      return { ok: false, error: `Could not apply the code: ${error.message}` };
    }
    updatedLines.push({ ...line, price_minor_units: newPrice, loyalty_discount_minor_units: reduction });
  }

  const totals = await recomputeHeaderTotals(updatedLines);
  const { error: headerError } = await admin
    .from("orders")
    .update({
      ...totals,
      loyalty_kind: "code",
      loyalty_redemption_id: redemption.id,
      loyalty_code: redemption.code,
      loyalty_discount_minor_units: spread.appliedMinorUnits,
      loyalty_tier_label: null,
      ...(account ? { customer_id: order.customer_id ?? account.customer_id } : {}),
    })
    .eq("id", opts.orderId);
  if (headerError) {
    for (const [i, u] of updatedLines.entries()) {
      await admin
        .from("order_lines")
        .update({ price_minor_units: lines[i].price_minor_units, loyalty_discount_minor_units: 0 })
        .eq("id", u.id);
    }
    await rollback();
    if (isMissingColumnError(headerError)) {
      return { ok: false, error: "Migration 0116 (loyalty at sale) has not been applied yet." };
    }
    return { ok: false, error: `Could not apply the code: ${headerError.message}` };
  }

  const applied = `$${(spread.appliedMinorUnits / 100).toFixed(2)}`;
  await insertLoyaltyEvent(
    opts.orderId,
    `Loyalty code ${redemption.code} applied (${applied} off${spread.unusedMinorUnits > 0 ? `; $${(spread.unusedMinorUnits / 100).toFixed(2)} penny-split remainder returned unused` : ""}).`,
    opts.actorLabel ?? null,
  );
  return { ok: true, message: `Code ${redemption.code} applied — ${applied} off.` };
}

// ---------------------------------------------------------------------------
// Apply MEMBER TIER pricing
// ---------------------------------------------------------------------------
export async function applyTierToOrder(opts: {
  orderId: string;
  customerId: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<LoyaltyMutation> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase not configured." };
  const loaded = await loadOrderWithLines(opts.orderId);
  if (!loaded) return { ok: false, error: "Order not found." };
  const { order, lines } = loaded;

  if (!OPEN_STATUSES.has(order.status)) {
    return { ok: false, error: "This order is closed — reopen it (logged reversal) before applying loyalty." };
  }
  if (order.loyalty_kind) {
    return {
      ok: false,
      error: "A loyalty discount is already applied. Remove it first — only ONE loyalty application per order (no stacking).",
    };
  }
  if (lines.length === 0) return { ok: false, error: "The order has no items." };

  const account = await getAccountByCustomer(opts.customerId);
  if (!account || !account.is_active) {
    return { ok: false, error: "This customer is not enrolled in the loyalty program. Enroll them from their customer page first." };
  }
  const tiers = await listTiers();
  const tier = tiers.find((t) => t.id === account.tier_id) ?? null;
  if (!tier || tier.discountBps <= 0) {
    return { ok: false, error: "This member has not reached a discount tier yet — no member pricing to apply." };
  }

  const costs = await loadProductCosts();
  const result = applyTierPricing(toSaleLines(lines, costs), tier.discountBps);
  if (result.additionalSavingsMinorUnits <= 0) {
    return {
      ok: false,
      error: `The current promo prices already beat or match ${tier.name} pricing on every line — the customer keeps the better deal (no stacking).`,
    };
  }

  const admin = createSupabaseAdminClient();
  const byId = new Map(result.lines.map((l) => [l.lineId, l]));
  const updatedLines: LoyaltyLineRow[] = [];
  for (const line of lines) {
    const t = byId.get(line.id);
    const reduction = t?.loyaltyDiscountMinorUnits ?? 0;
    const newPrice = t ? t.unitPriceMinorUnits : line.price_minor_units;
    const { error } = await admin
      .from("order_lines")
      .update({ price_minor_units: newPrice, loyalty_discount_minor_units: reduction })
      .eq("id", line.id);
    if (error) {
      for (const [i, u] of updatedLines.entries()) {
        await admin
          .from("order_lines")
          .update({ price_minor_units: lines[i].price_minor_units, loyalty_discount_minor_units: 0 })
          .eq("id", u.id);
      }
      if (isMissingColumnError(error)) {
        return { ok: false, error: "Migration 0116 (loyalty at sale) has not been applied yet." };
      }
      return { ok: false, error: `Could not apply member pricing: ${error.message}` };
    }
    updatedLines.push({ ...line, price_minor_units: newPrice, loyalty_discount_minor_units: reduction });
  }

  const totals = await recomputeHeaderTotals(updatedLines);
  const { error: headerError } = await admin
    .from("orders")
    .update({
      ...totals,
      loyalty_kind: "tier",
      loyalty_redemption_id: null,
      loyalty_code: null,
      loyalty_discount_minor_units: result.additionalSavingsMinorUnits,
      loyalty_tier_label: tier.name,
      customer_id: order.customer_id ?? opts.customerId,
    })
    .eq("id", opts.orderId);
  if (headerError) {
    for (const [i, u] of updatedLines.entries()) {
      await admin
        .from("order_lines")
        .update({ price_minor_units: lines[i].price_minor_units, loyalty_discount_minor_units: 0 })
        .eq("id", u.id);
    }
    if (isMissingColumnError(headerError)) {
      return { ok: false, error: "Migration 0116 (loyalty at sale) has not been applied yet." };
    }
    return { ok: false, error: `Could not apply member pricing: ${headerError.message}` };
  }

  const saved = `$${(result.additionalSavingsMinorUnits / 100).toFixed(2)}`;
  await insertLoyaltyEvent(
    opts.orderId,
    `Member tier pricing applied (${tier.name}, ${(tier.discountBps / 100).toFixed(0)}% — ${saved} additional savings; best deal wins per line, never stacked).`,
    opts.actorLabel ?? null,
  );
  return { ok: true, message: `${tier.name} member pricing applied — ${saved} additional savings.` };
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
  if (!order.loyalty_kind) return { ok: false, error: "No loyalty discount is applied to this order." };

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

  // Release the code back to the customer (their points stay stored in it).
  let releaseNote = "";
  if (order.loyalty_kind === "code" && order.loyalty_redemption_id) {
    const { data: released } = await admin
      .from("loyalty_redemptions")
      .update({ status: "issued", redeemed_at: null, redeemed_order_id: null })
      .eq("id", order.loyalty_redemption_id)
      .eq("status", "redeemed")
      .eq("redeemed_order_id", opts.orderId)
      .select("id");
    releaseNote =
      released && released.length > 0
        ? ` Code ${order.loyalty_code ?? ""} released back to the customer.`
        : ` NOTE: code ${order.loyalty_code ?? ""} could not be auto-released — check it on the customer's profile.`;
  }

  await insertLoyaltyEvent(
    opts.orderId,
    `Loyalty ${order.loyalty_kind === "code" ? "code" : "member tier pricing"} removed; prices restored.${releaseNote}`,
    opts.actorLabel ?? null,
  );
  return { ok: true, message: `Loyalty discount removed.${releaseNote}` };
}

// ---------------------------------------------------------------------------
// Release the code when an order is cancelled / no-show (best-effort)
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

  const { data: released } = await admin
    .from("loyalty_redemptions")
    .update({ status: "issued", redeemed_at: null, redeemed_order_id: null })
    .eq("id", order.loyalty_redemption_id)
    .eq("status", "redeemed")
    .eq("redeemed_order_id", orderId)
    .select("id");
  if (released && released.length > 0) {
    await insertLoyaltyEvent(
      orderId,
      `Order closed without completing — loyalty code ${order.loyalty_code ?? ""} automatically released back to the customer.`,
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
  redemption: { id: string; status: string; redeemedOrderId: string | null } | null;
  /** Linked customer's membership (for the "apply member pricing" offer). */
  member: {
    customerId: string;
    balancePoints: number;
    tierName: string | null;
    tierDiscountBps: number;
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
      .select("id, status, redeemed_order_id")
      .eq("id", order.loyalty_redemption_id)
      .maybeSingle<{ id: string; status: string; redeemed_order_id: string | null }>();
    redemption = row ? { id: row.id, status: row.status, redeemedOrderId: row.redeemed_order_id } : null;
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
        tierDiscountBps: tier?.discountBps ?? 0,
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
 * Preview what a member's tier pricing would additionally save on this order
 * (0 when promos already win everywhere). Read-only; used by the register UI.
 */
export async function previewTierSavings(
  orderId: string,
  customerId: string,
): Promise<{ tierName: string; additionalSavingsMinorUnits: number } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const loaded = await loadOrderWithLines(orderId);
  if (!loaded) return null;
  const account = await getAccountByCustomer(customerId);
  if (!account || !account.is_active || !account.tier_id) return null;
  const tiers = await listTiers();
  const tier = tiers.find((t) => t.id === account.tier_id);
  if (!tier || tier.discountBps <= 0) return null;
  const costs = await loadProductCosts();
  const result = applyTierPricing(toSaleLines(loaded.lines, costs), tier.discountBps);
  return { tierName: tier.name, additionalSavingsMinorUnits: result.additionalSavingsMinorUnits };
}
