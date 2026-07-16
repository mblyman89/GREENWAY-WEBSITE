/**
 * POST /api/orders — guest pickup-order placement (no auth).
 *
 * SERVER-AUTHORITATIVE since Phase A (GAP H-1 / H-2):
 *   1. Every line is re-resolved + re-priced against the CURRENT published
 *      menu (src/lib/orders/order-pricing.ts). Client prices are a cross-check
 *      only; a mismatch beyond rounding returns 409 with the fresh totals so
 *      the storefront can refresh its cart.
 *   2. The WAC 314-55-095 sales-limit SOFT check runs at placement. An
 *      over-limit cart is still accepted as a pickup reservation but the order
 *      is flagged (limit_flag + limit_reasons) and the customer is told the
 *      quantity will be adjusted at pickup. The COMPLETION hard gate lives in
 *      the admin order action.
 *   3. The order is persisted via the service-role orders store (the anon
 *      insert RLS policies were dropped in migration 0096).
 *
 * NO online payment is captured — this is a pickup reservation; final
 * price/tax/limits are confirmed in store.
 */
import { NextResponse } from "next/server";
import { createOrder } from "@/lib/orders/orders-store";
import { notifyOrderPlaced } from "@/lib/orders/notify";
import { queueOrderReceipt } from "@/lib/printing/printer-store";
import { repriceOrderLines, clientTotalsMatch } from "@/lib/orders/order-pricing";
import { evaluateCartWithSettings, logSalesLimitEvent } from "@/lib/compliance/sales-limits";
import type { NewOrderLineInput, PersistOrderInput } from "@/lib/orders/types";

export const runtime = "nodejs";

function asInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseLines(raw: unknown): NewOrderLineInput[] {
  if (!Array.isArray(raw)) return [];
  const lines: NewOrderLineInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const productName = asString(r.productName).trim();
    const quantity = asInt(r.quantity, 0);
    if (!productName || quantity <= 0) continue;
    lines.push({
      productId: asString(r.productId) || null,
      variantId: asString(r.variantId) || null,
      productName,
      brand: asString(r.brand) || null,
      variantLabel: asString(r.variantLabel) || null,
      quantity,
      priceMinorUnits: asInt(r.priceMinorUnits, 0),
      regularPriceMinorUnits:
        r.regularPriceMinorUnits == null ? null : asInt(r.regularPriceMinorUnits, 0),
    });
  }
  return lines;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const firstName = asString(body.customerFirstName).trim();
  const rawLines = parseLines(body.lines);

  if (!firstName) {
    return NextResponse.json({ error: "A first name is required." }, { status: 400 });
  }
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "The order has no items." }, { status: 400 });
  }

  // ── S-2a: SERVER-AUTHORITATIVE REPRICE ───────────────────────────────────
  // Resolve every line against the published menu, recompute discounts with
  // the shared engine, apply the cannabis price floor, and rebuild totals.
  const repriced = await repriceOrderLines(rawLines);
  if (!repriced.ok) {
    return NextResponse.json(
      { error: repriced.error, problems: repriced.problems },
      { status: repriced.status },
    );
  }

  // Cross-check the client's claimed totals. Beyond rounding tolerance =>
  // stale prices or a tampered payload; refuse with the fresh totals.
  const clientTotals = {
    subtotalMinorUnits: asInt(body.subtotalMinorUnits, 0),
    estimatedTaxMinorUnits: asInt(body.estimatedTaxMinorUnits, 0),
    totalMinorUnits: asInt(body.totalMinorUnits, 0),
  };
  if (!clientTotalsMatch(clientTotals, repriced.totals)) {
    return NextResponse.json(
      {
        error: "Prices changed while you were shopping. Please review your cart and try again.",
        freshTotals: repriced.totals,
      },
      { status: 409 },
    );
  }

  // ── S-1a: PLACEMENT SALES-LIMIT SOFT CHECK (WAC 314-55-095) ─────────────
  // Online guests are recreational by default (medical status is verified in
  // store). Over-limit carts are flagged — never silently accepted.
  let limitFlag = false;
  let limitReasons: string[] = [];
  try {
    const evaluation = await evaluateCartWithSettings(repriced.limitLines, "recreational");
    if (evaluation.blocked || evaluation.reasons.length > 0) {
      limitFlag = evaluation.reasons.length > 0;
      limitReasons = evaluation.reasons;
      if (limitFlag) {
        await logSalesLimitEvent(evaluation, { orderId: null, actorId: null });
      }
    }
  } catch (err) {
    // The soft check must never break placement; the completion hard gate
    // re-evaluates with full settings.
    console.error("[orders] placement limit check failed:", err);
  }

  const input: PersistOrderInput = {
    customerFirstName: firstName,
    customerLastName: asString(body.customerLastName).trim() || null,
    customerEmail: asString(body.customerEmail).trim() || null,
    customerPhone: asString(body.customerPhone).trim() || null,
    customerBirthday: asString(body.customerBirthday).trim() || null,
    customerNote: asString(body.customerNote).trim() || null,
    // SERVER-computed money — the client payload is never persisted.
    subtotalMinorUnits: repriced.totals.subtotalMinorUnits,
    estimatedTaxMinorUnits: repriced.totals.estimatedTaxMinorUnits,
    savingsMinorUnits: repriced.totals.savingsMinorUnits,
    totalMinorUnits: repriced.totals.totalMinorUnits,
    limitFlag,
    limitReasons,
    lines: repriced.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      productName: l.productName,
      brand: l.brand,
      variantLabel: l.variantLabel,
      category: l.category,
      quantity: l.quantity,
      priceMinorUnits: l.priceMinorUnits,
      regularPriceMinorUnits: l.regularPriceMinorUnits,
      // AN-1: per-unit grams snapshot (parsed from the variant label) so the
      // completion gate can meter WAC 314-55-095 limits on actual package
      // sizes instead of category defaults.
      unitGrams: l.unitGrams ?? null,
    })),
  };

  const result = await createOrder(input);

  if (!result) {
    // Either Supabase is not configured yet or the insert failed. The client
    // falls back to its local sessionStorage confirmation so checkout still
    // works during rollout.
    return NextResponse.json(
      { error: "Order could not be saved on the server." },
      { status: 503 },
    );
  }

  const itemCount = input.lines.reduce((sum, l) => sum + l.quantity, 0);

  // Best-effort notification; never blocks the customer response.
  notifyOrderPlaced({
    orderNumber: result.orderNumber,
    customerFirstName: input.customerFirstName,
    customerEmail: input.customerEmail ?? null,
    itemCount,
    totalMinorUnits: input.totalMinorUnits,
  }).catch(() => {});

  // Best-effort receipt print queue (Slice 37). Only queues if a printer is
  // configured and auto-print is enabled; never blocks the customer response.
  queueOrderReceipt({
    orderNumber: result.orderNumber,
    orderId: null,
    placedAt: new Date().toISOString(),
    customerName: [input.customerFirstName, input.customerLastName ?? ""]
      .join(" ")
      .trim(),
    customerPhone: input.customerPhone ?? null,
    lines: input.lines.map((l) => ({
      productName: l.productName,
      brand: l.brand ?? null,
      variantLabel: l.variantLabel ?? null,
      quantity: l.quantity,
      priceMinorUnits: l.priceMinorUnits,
    })),
    subtotalMinorUnits: input.subtotalMinorUnits,
    savingsMinorUnits: input.savingsMinorUnits,
    estimatedTaxMinorUnits: input.estimatedTaxMinorUnits,
    totalMinorUnits: input.totalMinorUnits,
    customerNote: input.customerNote ?? null,
    itemCount,
  }).catch(() => {});

  return NextResponse.json(
    {
      ...result,
      // Surface the placement soft-check so the storefront can show the
      // polite "we'll adjust at pickup" note (S-1a).
      limitFlag,
      limitReasons,
      totals: repriced.totals,
    },
    { status: 201 },
  );
}
