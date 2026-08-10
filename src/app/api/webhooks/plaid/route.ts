/**
 * POST /api/webhooks/plaid  (Slice P4)
 *
 * Receives Plaid webhooks so bank transactions sync in near-real-time and
 * connection-health changes (login required, permission revoked, repaired) show
 * up on the Plaid Health tab without waiting for a manual "Sync now". This is
 * the reliability half of the bank feed: Plaid tells us the moment there's new
 * data instead of us polling blindly.
 *
 * Security (S-9, fail closed — mirrors the Resend webhook posture):
 *   • Verify the `Plaid-Verification` JWT (ES256) against Plaid's published JWK
 *     using node crypto (verifyPlaidWebhook). Uses the existing Plaid keys — no
 *     new secret to configure.
 *   • In PRODUCTION, if Plaid isn't configured we refuse with 503 (never accept
 *     unsigned traffic). In development, an unverifiable webhook is refused too,
 *     but Plaid isn't configured locally so this endpoint simply won't be hit.
 *   • Bad/missing/stale signature → 401. Plaid retries, and a real delivery will
 *     verify; a forged one never will.
 *
 * Idempotent: dedup on the SHA-256 of the raw body (plaid_webhook_events unique
 * index). A duplicate delivery is acknowledged with 200 and does no work.
 *
 * Always returns 200 on an accepted (verified) payload — even if the follow-up
 * sync had a hiccup — so Plaid doesn't retry-storm; the sync's own status is
 * recorded on the item for the Health tab. Only signature failures return 401.
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isProductionRuntime } from "@/lib/security/fail-closed";
import { verifyPlaidWebhook } from "@/lib/plaid/plaid-webhook-verify";
import { mapWebhookToAction } from "@/lib/plaid/plaid-webhook-core";
import { recordPlaidWebhookEvent, markPlaidWebhookProcessed } from "@/lib/plaid/store";
import { runPlaidSyncForItem, runAllPlaidSync } from "@/lib/plaid/sync-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  // Read the RAW body first — the signed hash is whitespace-sensitive, so we
  // must hash/verify the exact bytes Plaid sent (never a re-serialized object).
  const rawBody = await request.text();

  // 1) Verify authenticity. Fail CLOSED.
  const verified = await verifyPlaidWebhook(rawBody, request.headers);
  if (!verified.ok) {
    if (verified.refuseUnconfigured && isProductionRuntime()) {
      return NextResponse.json(
        { ok: false, error: "Plaid is not configured on this deployment." },
        { status: 503 },
      );
    }
    // Log the specific reason server-side ONLY (never echo it to the caller).
    console.warn(`[plaid webhook] rejected — ${verified.reason}`);
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
  }

  // 2) Parse the (now-trusted) body.
  let parsed: Record<string, unknown> = {};
  try {
    const obj = JSON.parse(rawBody);
    if (obj && typeof obj === "object") parsed = obj as Record<string, unknown>;
  } catch {
    // Verified but unparseable is not expected; acknowledge so Plaid stops.
    return NextResponse.json({ ok: true, note: "empty" }, { status: 200 });
  }
  const webhookType = typeof parsed.webhook_type === "string" ? parsed.webhook_type : null;
  const webhookCode = typeof parsed.webhook_code === "string" ? parsed.webhook_code : null;
  const itemId = typeof parsed.item_id === "string" ? parsed.item_id : null;

  // 3) Idempotency — dedup on the exact body hash.
  const bodySha256 = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const recorded = await recordPlaidWebhookEvent({ bodySha256, webhookType, webhookCode, itemId });
  if (recorded.ok && recorded.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  // 4) Decide + take the designed action. Never guess: unknown → acknowledge only.
  const action = mapWebhookToAction(webhookType, webhookCode);
  if (action.resync) {
    try {
      if (action.targetItem && itemId) {
        await runPlaidSyncForItem(itemId);
      } else {
        await runAllPlaidSync();
      }
    } catch (err) {
      // The sync driver records its own item status; swallow so we still 200.
      console.error(`[plaid webhook] follow-up sync error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await markPlaidWebhookProcessed(bodySha256);

  return NextResponse.json(
    { ok: true, type: webhookType, code: webhookCode, resynced: action.resync },
    { status: 200 },
  );
}
