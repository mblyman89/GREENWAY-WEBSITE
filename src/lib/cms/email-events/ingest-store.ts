/**
 * src/lib/cms/email-events/ingest-store.ts  (Slice 50)  — SERVER-ONLY
 *
 * Persists normalized newsletter engagement events into
 * public.newsletter_email_events (migration 0050). Idempotent: upsert on
 * (provider, provider_event_id) so a provider re-posting the same event is
 * counted exactly once.
 *
 * Webhook routes call ingestEmailEvents() after verifying the provider
 * signature and normalizing the payload. Writes go through the service-role
 * client (bypasses RLS) — the routes are the trust boundary.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { NormalizedEmailEvent } from "./normalize-core";

export type IngestResult = { stored: number; skipped: number; error?: string };

export async function ingestEmailEvents(
  events: NormalizedEmailEvent[],
): Promise<IngestResult> {
  if (events.length === 0) return { stored: 0, skipped: 0 };
  if (!isSupabaseServiceConfigured) {
    return { stored: 0, skipped: events.length, error: "Supabase service not configured." };
  }

  const admin = createSupabaseAdminClient();

  // Resolve which send_ids actually exist so a stale/spoofed tag doesn't break
  // the FK insert; unknown ids are stored as null (still counted, just not
  // correlated to a campaign).
  const sendIds = Array.from(
    new Set(events.map((e) => e.newsletterSendId).filter((v): v is string => Boolean(v))),
  );
  const validSendIds = new Set<string>();
  if (sendIds.length > 0) {
    const { data } = await admin
      .from("newsletter_sends")
      .select("id")
      .in("id", sendIds);
    for (const row of (data as { id: string }[] | null) ?? []) validSendIds.add(row.id);
  }

  const rows = events.map((e) => ({
    provider: e.provider,
    provider_event_id: e.providerEventId,
    provider_message_id: e.providerMessageId,
    newsletter_send_id:
      e.newsletterSendId && validSendIds.has(e.newsletterSendId) ? e.newsletterSendId : null,
    recipient_email: e.recipientEmail,
    event_type: e.eventType,
    occurred_at: e.occurredAt,
    bounce_kind: e.bounceKind,
    reason: e.reason,
    url: e.url,
    machine_open: e.machineOpen,
    raw: e as unknown as Record<string, unknown>,
  }));

  // onConflict on the unique (provider, provider_event_id) index → idempotent.
  const { error, count } = await admin
    .from("newsletter_email_events")
    .upsert(rows, { onConflict: "provider,provider_event_id", ignoreDuplicates: true, count: "exact" });

  if (error) {
    return { stored: 0, skipped: rows.length, error: error.message };
  }
  const stored = count ?? rows.length;
  return { stored, skipped: rows.length - stored };
}
