/**
 * POST /api/orders — guest pickup-order placement (no auth).
 *
 * Validates the JSON payload from the checkout flow, persists the order via the
 * service-role orders store (DB generates the GWY number + private token), fires
 * a best-effort notification, and returns { orderNumber, publicToken }.
 *
 * NO online payment is captured — this is a pickup reservation; final
 * price/tax/limits are confirmed in store.
 */
import { NextResponse } from "next/server";
import { createOrder } from "@/lib/orders/orders-store";
import { notifyOrderPlaced } from "@/lib/orders/notify";
import { queueOrderReceipt } from "@/lib/printing/printer-store";
import type { NewOrderInput, NewOrderLineInput } from "@/lib/orders/types";

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
  const lines = parseLines(body.lines);

  if (!firstName) {
    return NextResponse.json({ error: "A first name is required." }, { status: 400 });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "The order has no items." }, { status: 400 });
  }

  const input: NewOrderInput = {
    customerFirstName: firstName,
    customerLastName: asString(body.customerLastName).trim() || null,
    customerEmail: asString(body.customerEmail).trim() || null,
    customerPhone: asString(body.customerPhone).trim() || null,
    customerBirthday: asString(body.customerBirthday).trim() || null,
    customerNote: asString(body.customerNote).trim() || null,
    subtotalMinorUnits: asInt(body.subtotalMinorUnits, 0),
    estimatedTaxMinorUnits: asInt(body.estimatedTaxMinorUnits, 0),
    savingsMinorUnits: asInt(body.savingsMinorUnits, 0),
    totalMinorUnits: asInt(body.totalMinorUnits, 0),
    lines,
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

  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

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
    lines: lines.map((l) => ({
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

  return NextResponse.json(result, { status: 201 });
}
