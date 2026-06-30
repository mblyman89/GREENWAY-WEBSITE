/**
 * src/lib/reports/newsletter-stats.ts  (Slice 50)  — SERVER-ONLY
 *
 * Loads newsletter campaigns (newsletter_sends) + engagement events
 * (newsletter_email_events) from Supabase for a date window and computes the
 * stats via the pure builder in newsletter-stats-core. Powers the newsletter
 * statistics section of the Customers report tab + its CSV/XLSX export.
 *
 * The window is applied to the CAMPAIGN send date (created_at); all events for
 * those campaigns are then pulled regardless of when they fired (opens trickle
 * in for days after a send).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  buildNewsletterStats,
  type EventRow,
  type EventType,
  type NewsletterStats,
  type SendRow,
} from "./newsletter-stats-core";

export type { NewsletterStats, CampaignStats } from "./newsletter-stats-core";

export const EMPTY_NEWSLETTER_STATS: NewsletterStats = {
  campaigns: [],
  totals: {
    campaigns: 0,
    recipients: 0,
    delivered: 0,
    opened: 0,
    openedIncludingMachine: 0,
    clicked: 0,
    bounced: 0,
    blocked: 0,
    returnToSender: 0,
    complained: 0,
    unsubscribed: 0,
    failed: 0,
    openRate: 0,
    clickRate: 0,
    clickToOpenRate: 0,
    bounceRate: 0,
    complaintRate: 0,
    unsubscribeRate: 0,
  },
};

export async function getNewsletterStats(
  fromISO: string,
  toISO: string,
): Promise<NewsletterStats> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_NEWSLETTER_STATS };
  const admin = createSupabaseAdminClient();

  // Campaigns whose send date falls in the window.
  const { data: sendData } = await admin
    .from("newsletter_sends")
    .select(
      "id, subject, send_kind, status, recipient_count, delivered_count, created_at, sent_by_email",
    )
    .gte("created_at", fromISO)
    .lte("created_at", toISO)
    .order("created_at", { ascending: false });

  const sends: SendRow[] = ((sendData as Record<string, unknown>[] | null) ?? []).map((r) => ({
    id: String(r.id),
    subject: String(r.subject ?? ""),
    sendKind: String(r.send_kind ?? "broadcast"),
    status: String(r.status ?? ""),
    recipientCount: Number(r.recipient_count ?? 0),
    deliveredCountAtSend: Number(r.delivered_count ?? 0),
    createdAt: String(r.created_at ?? ""),
    sentByEmail: (r.sent_by_email as string | null) ?? null,
  }));

  const broadcastIds = sends.filter((s) => s.sendKind !== "test").map((s) => s.id);

  let events: EventRow[] = [];
  if (broadcastIds.length > 0) {
    // Pull events for these campaigns (paged to be safe on big lists).
    const collected: Record<string, unknown>[] = [];
    const PAGE = 1000;
    let from = 0;
    // Supabase caps rows; page until short read.
     
    while (true) {
      const { data, error } = await admin
        .from("newsletter_email_events")
        .select(
          "newsletter_send_id, recipient_email, event_type, bounce_kind, machine_open, occurred_at",
        )
        .in("newsletter_send_id", broadcastIds)
        .order("occurred_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      collected.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    events = collected.map((r) => ({
      newsletterSendId: (r.newsletter_send_id as string | null) ?? null,
      recipientEmail: String(r.recipient_email ?? ""),
      eventType: String(r.event_type ?? "other") as EventType,
      bounceKind: (r.bounce_kind as "hard" | "soft" | null) ?? null,
      machineOpen: r.machine_open === true,
      occurredAt: String(r.occurred_at ?? ""),
    }));
  }

  return buildNewsletterStats(sends, events);
}
