/**
 * POST /api/pos/loyalty  (Task AM-B)
 *
 * Loyalty redemption AT THE REGISTER. An authenticated DEVICE sends its
 * CURRENT priced cart lines and one of three actions:
 *
 *   "redeem-points" — D137 (owner 2026-11-02): the attached member uses ONE
 *     reward: `rewardPoints` 150 (10% off) or 300 (25% off). Exactly those
 *     points are deducted, never the whole balance. The percent comes off
 *     each item's regular price; per item the customer gets the BETTER of
 *     the day's deal or the reward (never both), every price stays at the
 *     legal floor or above (acquisition costs live server-side only), items
 *     on the never-discount list keep their price, and there is no dollar
 *     cap. An older register app that sends no `rewardPoints` gets the best
 *     reward the balance covers. Nothing is deducted when the reward would
 *     save nothing.
 *
 *   "apply-code" — the customer brought a GW-XXXX-XXXX reward code (issued
 *     from their profile). Looked up but NOT claimed — the atomic claim
 *     happens at sync against the materialized order, exactly like the
 *     back-office apply path. The code's percent is applied with the same
 *     rules. Codes from the retired $0.10-per-point program are refused
 *     with instructions to cancel them (the points go back).
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
  cancelRedemption,
  getAccountByCustomer,
  issueRedemption,
  lookupRedeemableCode,
} from "@/lib/loyalty/loyalty-store";
import { type LoyaltySaleLine } from "@/lib/loyalty/loyalty-sale-core";
import {
  LEGACY_CODE_MESSAGE,
  applyRewardPricing,
  chooseReward,
  redemptionReward,
  rewardShortLabel,
} from "@/lib/loyalty/loyalty-reward-core";
import { loadProductCosts } from "@/lib/promotions/discount-engine";
import { listNeverDiscountKeys } from "@/lib/promotions/promotions-store";
import { recordAudit } from "@/lib/auth/audit";
// Mastering Slice 1: sold lines resolve the variant's own lot key first.
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";
import { costForLine } from "@/lib/promotions/size-cost-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

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
      // R74 S31: the size's own cost (0294 link) first, then the lot/card key.
      return key ? (costForLine(costs, key, l.variantId ?? null) ?? null) : null;
    })(),
  }));
}

/** Device lines whose product is on the owner's never-discount list. */
async function neverDiscountLineIds(lines: DeviceLine[]): Promise<Set<string>> {
  const keys = new Set((await listNeverDiscountKeys()).map((k) => k.trim().toLowerCase()));
  const out = new Set<string>();
  if (keys.size === 0) return out;
  for (const l of lines) if (keys.has(l.productId.trim().toLowerCase())) out.add(lineKey(l));
  return out;
}

function spreadToPerVariant(spread: { lineId: string; loyaltyDiscountMinorUnits: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of spread) {
    if (s.loyaltyDiscountMinorUnits > 0) out[s.lineId] = s.loyaltyDiscountMinorUnits;
  }
  return out;
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
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
    // Only a code THIS register issued for a sale in progress may be
    // cancelled here; a code the customer brought from their profile is
    // never touched by release (it was never claimed).
    const admin = createSupabaseAdminClient();
    const { data: own } = await admin
      .from("loyalty_redemptions")
      .select("id, channel")
      .eq("id", redemptionId)
      .maybeSingle<{ id: string; channel: string | null }>();
    if (!own || (own.channel !== "register" && own.channel !== "both")) {
      return NextResponse.json({ released: false, refundedPoints: 0 });
    }
    // Conditional on still-'issued': a code that synced (claimed) or was
    // already cancelled is left alone — release is best-effort cleanup.
    const res = await cancelRedemption({
      redemptionId,
      note: "Register removed the reward before the sale completed, points returned",
    });
    if (!res.ok) return NextResponse.json({ released: false, refundedPoints: 0 });
    return NextResponse.json({ released: true, refundedPoints: res.refundedPoints });
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
    const reward = redemptionReward(redemption);
    if (!reward) {
      return NextResponse.json({ error: LEGACY_CODE_MESSAGE }, { status: 409 });
    }
    const priced = applyRewardPricing(saleLines, reward, { excludeLineIds: await neverDiscountLineIds(lines) });
    if (!priced.ok) {
      return NextResponse.json({ error: priced.message.replace(" No points were used.", " The code stays open.") }, { status: 409 });
    }
    return NextResponse.json({
      redemptionId: redemption.id,
      code: redemption.code,
      valueMinor: priced.appliedMinorUnits,
      appliedMinor: priced.appliedMinorUnits,
      pointsSpent: 0,
      source: "code",
      rewardPoints: reward.points,
      percentBps: reward.percentBps,
      perVariant: spreadToPerVariant(priced.lines),
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
    // One reward per sale (D137): 150 pts = 10% off, 300 pts = 25% off.
    // An older register app sends no rewardPoints and gets the best reward
    // the balance covers, never the whole balance.
    const chosen = chooseReward(account.balance_points, body.rewardPoints);
    if (!chosen.ok) return NextResponse.json({ error: chosen.error }, { status: 409 });
    const reward = chosen.reward;
    const priced = applyRewardPricing(saleLines, reward, { excludeLineIds: await neverDiscountLineIds(lines) });
    if (!priced.ok) return NextResponse.json({ error: priced.message }, { status: 409 });

    // Issue the code NOW (exactly the reward's points deducted,
    // status='issued'); the sync claims it atomically against the
    // materialized order. If the sale never syncs, the register's release
    // returns the points.
    const issued = await issueRedemption({
      accountId: account.id,
      points: reward.points,
      valueMinor: priced.appliedMinorUnits,
      channel: "register",
    });
    if (!issued.ok) {
      return NextResponse.json({ error: issued.error }, { status: 409 });
    }
    await recordAudit({
      actorId: null,
      actorEmail: `pos-device:${deviceId}`,
      action: "loyalty.reward_used",
      entityType: "loyalty_account",
      entityId: account.id,
      after: {
        code: issued.code,
        reward: rewardShortLabel(reward),
        points: reward.points,
        applied_minor: priced.appliedMinorUnits,
        requested: body.rewardPoints ?? "best (older register app)",
      },
    }).catch(() => {});
    return NextResponse.json({
      redemptionId: issued.id,
      code: issued.code,
      valueMinor: priced.appliedMinorUnits,
      appliedMinor: priced.appliedMinorUnits,
      pointsSpent: reward.points,
      source: "points",
      rewardPoints: reward.points,
      percentBps: reward.percentBps,
      perVariant: spreadToPerVariant(priced.lines),
    });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}
