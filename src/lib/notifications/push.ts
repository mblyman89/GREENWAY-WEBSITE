/**
 * src/lib/notifications/push.ts  (Task W)
 *
 * Web Push (VAPID) helper for compliance reminders. Env-gated like every other
 * notifier in this codebase (orders/notify.ts pattern): when the VAPID keys are
 * not configured this is a silent no-op, so nothing breaks during rollout.
 *
 * Env:
 *   VAPID_PUBLIC_KEY   — URL-safe base64 public key (also sent to the browser)
 *   VAPID_PRIVATE_KEY  — matching private key
 *   VAPID_SUBJECT      — mailto: or https: contact (defaults to the store site)
 *
 * Generate a keypair once with:  npx web-push generate-vapid-keys
 *
 * Subscriptions live in push_subscriptions (migration 0118). Expired/revoked
 * endpoints (404/410 from the push service) are pruned automatically.
 */
import "server-only";

import webpush from "web-push";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** The public key the browser needs for PushManager.subscribe. */
export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

function configure(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!pub || !priv) return false;
  const subject = process.env.VAPID_SUBJECT ?? "https://greenwaymarijuana.com";
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Save (upsert) a browser push subscription for a staff member. */
export async function savePushSubscription(opts: {
  staffId: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  if (!opts.endpoint.startsWith("https://")) return { ok: false, error: "Invalid endpoint." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("push_subscriptions").upsert(
      {
        staff_id: opts.staffId,
        endpoint: opts.endpoint,
        p256dh: opts.p256dh,
        auth: opts.auth,
        user_agent: opts.userAgent ?? null,
      },
      { onConflict: "endpoint" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Remove a subscription (user turned notifications off). */
export async function deletePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  if (!isSupabaseServiceConfigured) return { ok: false };
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Send a push notification to EVERY registered staff subscription. Prunes
 * endpoints the push service reports as gone (404/410). Returns the number of
 * successful sends; 0 when unconfigured (silent no-op).
 */
export async function sendPushToAll(payload: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<number> {
  if (!isSupabaseServiceConfigured || !configure()) return 0;

  let rows: PushSubscriptionRow[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .limit(200);
    rows = (data as PushSubscriptionRow[] | null) ?? [];
  } catch {
    return 0;
  }
  if (rows.length === 0) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/admin/compliance/ccrs",
    tag: payload.tag ?? "ccrs-reminder",
  });

  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          body,
          { TTL: 24 * 60 * 60 },
        );
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        if (status === 404 || status === 410) gone.push(r.endpoint);
      }
    }),
  );

  if (gone.length > 0) {
    try {
      const admin = createSupabaseAdminClient();
      await admin.from("push_subscriptions").delete().in("endpoint", gone);
    } catch {
      /* best effort prune */
    }
  }
  return sent;
}
