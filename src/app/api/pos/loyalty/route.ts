/**
 * POST /api/pos/loyalty  (Task AM-B)
 *
 * Loyalty redemption AT THE REGISTER. An authenticated DEVICE sends its
 * CURRENT priced cart lines and one of three actions:
 *
 *   "redeem-points" — the attached member spends points right now. The
 *     server sizes the redemption to what this cart can legally absorb
 *     (never more than the balance, never below the program minimum),
 *     ISSUES the code (points deducted, status='issued'), and returns the
 *     per-variant spread computed with the SAME pure spreadCodeValue +
 *     statutory/cost floors the back office uses (acquisition costs live
 *     server-side only — the device could never compute the floors).
 *
 *   "apply-code" — the customer brought an existing GW-XXXX-XXXX code
 *     (issued from their profile). Looked up but NOT claimed — the atomic
 *     claim (markRedemptionUsed) happens at sync against the materialized
 *     order, exactly like the back-office apply path. Value is never
 *     partially burned: a cart that can't absorb the full value refuses
 *     with the absorbable amount, same message discipline as the back
 *     office.
 *
 *   "release" — the register dropped the discount (cart changed, sale
 *     cancelled or saved). A code issued via "redeem-points" is cancelled
 *     (conditional on still being 'issued') and the points refunded; a
 *     customer-brought code needs nothing (it was never claimed).
 *
 * ONLINE-ONLY by design: redemption needs the live balance and the live
 * cost floors. An offline register still rings the sale — just without the
 * loyalty discount (same posture as the B14 member lookup).
 *
 * Auth: same X-POS-Device-Id / X-POS-Device-Key headers as /api/pos/sync.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import {
  adjustPoints,
  getAccountByCustomer,
  getConfig,
  issueRedemption,
  lookupRedeemableCode,
} from "@/lib/loyalty/loyalty-store";
import { canRedeem, pointsValueMinor } from "@/lib/loyalty/engine";
import { spreadCodeValue, type LoyaltySaleLine } from "@/lib/loyalty/loyalty-sale-core";
import { loadProductCosts } from "@/lib/promotions/discount-engine";
// Mastering Slice 1: sold lines resolve the variant's own lot key first.
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A priced cart line as the device sees it (final, tax-inclusive prices). */
type DeviceLine = {
  variantId?: string;
  productId: string;
  category: string;
  quantity: number;
  unitPriceMinor: number;
  regularPriceMinor: number;
};

function parseLines(raw: unknown): DeviceLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  const out: DeviceLine[] = [];
  for (const l of raw) {
    if (!l || typeof l !== "object") return null;
    const line = l as Partial<DeviceLine>;
    if (typeof line.productId !== "string" || !line.productId.trim()) return null;
    if (typeof line.category !== "string" || !line.category.trim()) return null;
    if (!Number.isInteger(line.quantity) || (line.quantity as number) < 1) return null;
    if (!Number.isInteger(line.unitPriceMinor) || (line.unitPriceMinor as number) < 0) return null;
    if (!Number.isInteger(line.regularPriceMinor) || (line.regularPriceMinor as number) < 0) return null;
    if (line.variantId !== undefined && (typeof line.variantId !== "string" || !line.variantId.trim())) return null;
    out.push({
      variantId: line.variantId,
      productId: line.productId,
      category: line.category,
      quantity: line.quantity as number,
      unitPriceMinor: line.unitPriceMinor as number,
      regularPriceMinor: line.regularPriceMinor as number,
    });
  }
  return out;
}

/** Device line identity — the same key applyLoyaltyToPricedLines uses. */
function lineKey(l: DeviceLine): string {
  return l.variantId ?? l.productId;
}

async function toSaleLines(lines: DeviceLine[]): Promise<LoyaltySaleLine[]> {
  const costs = await loadProductCosts();
  return lines.map((l) => ({
    lineId: lineKey(l),
    category: l.category,
    quantity: l.quantity,
    unitPriceMinorUnits: l.unitPriceMinor,
    regularPriceMinorUnits: l.regularPriceMinor,
    // Mastering Slice 1: the variant's own lot cost wins; single-lot cards
    // resolve the identical key either way.
    costMinorUnits: (() => {
      const key = lotKeyForSaleLine({ productId: l.productId, variantId: l.variantId ?? null });
      return key ? (costs.get(key) ?? null) : null;
    })(),
  }));
}

function spreadToPerVariant(spread: { lineId: string; loyaltyDiscountMinorUnits: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of spread) {
    if (s.loyaltyDiscountMinorUnits > 0) out[s.lineId] = s.loyaltyDiscountMinorUnits;
  }
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";
  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isSupabaseServiceConfigured) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const action = String(body.action ?? "");

  // ── release — cancel a points-issued code the register dropped ──────────
  if (action === "release") {
    const redemptionId = String(body.redemptionId ?? "");
    if (!redemptionId) {
      return NextResponse.json({ error: "redemptionId required." }, { status: 400 });
    }
    const admin = createSupabaseAdminClient();
    // Conditional on still-'issued': a code that synced (claimed) or was
    // already cancelled is left alone — release is best-effort cleanup.
    const { data: cancelled } = await admin
      .from("loyalty_redemptions")
      .update({ status: "cancelled" })
      .eq("id", redemptionId)
      .eq("status", "issued")
      .select("id, account_id, points, code");
    const row = (cancelled ?? [])[0] as
      | { id: string; account_id: string; points: number; code: string }
      | undefined;
    if (!row) return NextResponse.json({ released: false, refundedPoints: 0 });
    // Refund the points the issuance deducted.
    await adjustPoints({
      accountId: row.account_id,
      points: row.points,
      note: `Register released code ${row.code} before the sale completed — points refunded.`,
    });
    return NextResponse.json({ released: true, refundedPoints: row.points });
  }

  const lines = parseLines(body.lines);
  if (!lines) {
    return NextResponse.json({ error: "lines must be 1–200 priced cart lines." }, { status: 400 });
  }
  const saleLines = await toSaleLines(lines);

  // ── apply-code — customer-brought code; looked up, spread, NOT claimed ──
  if (action === "apply-code") {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "code required." }, { status: 400 });
    const redemption = await lookupRedeemableCode(code);
    if (!redemption) {
      return NextResponse.json(
        { error: "Code not found, expired, or already used. Check the code with the customer." },
        { status: 404 },
      );
    }
    const spread = spreadCodeValue(saleLines, redemption.value_minor);
    if (!spread.ok) {
      const msg =
        spread.reason === "no_capacity"
          ? "This cart is already at the legal price floor (RCW 69.50.357 / acquisition cost) — the code cannot be applied. Add items first."
          : `This cart can only absorb $${(spread.absorbableMinorUnits / 100).toFixed(2)} above the legal price floors, but the code is worth $${(redemption.value_minor / 100).toFixed(2)}. Add items first — value is never partially burned.`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({
      redemptionId: redemption.id,
      code: redemption.code,
      valueMinor: redemption.value_minor,
      appliedMinor: spread.appliedMinorUnits,
      pointsSpent: 0,
      source: "code",
      perVariant: spreadToPerVariant(spread.lines),
    });
  }

  // ── redeem-points — size to the cart, issue, spread ──────────────────────
  if (action === "redeem-points") {
    const customerId = String(body.customerId ?? "");
    if (!customerId) return NextResponse.json({ error: "customerId required." }, { status: 400 });
    const account = await getAccountByCustomer(customerId);
    if (!account) {
      return NextResponse.json(
        { error: "This member has no loyalty account yet — points start earning on their first completed sale." },
        { status: 404 },
      );
    }
    const cfg = await getConfig();
    if (cfg.pointValueMinor <= 0) {
      return NextResponse.json({ error: "The loyalty program has no point cash value configured." }, { status: 409 });
    }
    if (!canRedeem(account.balance_points, Math.max(1, cfg.minRedeemPoints), cfg)) {
      return NextResponse.json(
        {
          error: `Not enough points: balance ${account.balance_points}, minimum ${cfg.minRedeemPoints}.`,
        },
        { status: 409 },
      );
    }

    // Size the redemption to what the cart can absorb: try the full balance,
    // and on insufficient capacity shrink to the absorbable value — value is
    // never partially burned, so the spread below always applies in full.
    let points = account.balance_points;
    let spread = spreadCodeValue(saleLines, pointsValueMinor(points, cfg));
    if (!spread.ok && spread.reason === "insufficient_capacity") {
      points = Math.min(points, Math.floor(spread.absorbableMinorUnits / cfg.pointValueMinor));
      if (points >= cfg.minRedeemPoints && points > 0) {
        spread = spreadCodeValue(saleLines, pointsValueMinor(points, cfg));
      }
    }
    if (!spread.ok) {
      const msg =
        spread.reason === "no_capacity"
          ? "This cart is already at the legal price floor — points cannot be applied. Add items first."
          : `This cart can only absorb $${(spread.absorbableMinorUnits / 100).toFixed(2)}, which is below the ${cfg.minRedeemPoints}-point minimum redemption. Add items first.`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    // Issue the code NOW (points deducted, status='issued'); the sync claims
    // it atomically against the materialized order. If the sale never syncs,
    // the register's release (or the code's expiry) returns the value.
    const issued = await issueRedemption({ accountId: account.id, points });
    if (!issued.ok) {
      return NextResponse.json({ error: issued.error }, { status: 409 });
    }
    // The device needs the redemption row id for the payload + release
    // (issueRedemption returns only the human code).
    const admin = createSupabaseAdminClient();
    const { data: row } = await admin
      .from("loyalty_redemptions")
      .select("id")
      .eq("code", issued.code)
      .maybeSingle<{ id: string }>();
    if (!row) {
      return NextResponse.json({ error: "Issued code could not be resolved — try again." }, { status: 500 });
    }
    return NextResponse.json({
      redemptionId: row.id,
      code: issued.code,
      valueMinor: issued.valueMinor,
      appliedMinor: spread.appliedMinorUnits,
      pointsSpent: points,
      source: "points",
      perVariant: spreadToPerVariant(spread.lines),
    });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
