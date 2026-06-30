/**
 * src/lib/reports/newsletter-stats-core.ts  (Slice 50)
 *
 * PURE aggregation logic for the newsletter statistics suite — no I/O, no
 * `server-only` — so it is tsx-testable. Turns raw engagement-event rows +
 * campaign send rows into per-campaign and aggregate stats with the rates the
 * owner asked for: opened, read, clicked, bounced (return-to-sender), rejected
 * as spam, unsubscribed, etc.
 *
 * Counting rules (the expert way):
 *   - Counts are by UNIQUE RECIPIENT per campaign, not raw event count. One
 *     person opening five times is one "open". Rates therefore never exceed
 *     100%.
 *   - "Real" opens exclude machine opens (Apple Mail Privacy Protection etc.).
 *     We also expose total opens so nothing is hidden.
 *   - Denominator for engagement rates is DELIVERED (industry standard). If we
 *     have no delivered signal for a campaign we fall back to the recorded
 *     recipient_count from newsletter_sends.
 *   - "Return to sender" = bounced (hard) + blocked (soft). We report bounced
 *     (hard) separately as the actionable "remove this address" number.
 */

export type EventType =
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "unsubscribed"
  | "delivery_delayed"
  | "failed"
  | "other";

export type EventRow = {
  newsletterSendId: string | null;
  recipientEmail: string;
  eventType: EventType;
  bounceKind: "hard" | "soft" | null;
  machineOpen: boolean;
  occurredAt: string;
};

export type SendRow = {
  id: string;
  subject: string;
  sendKind: string; // 'test' | 'broadcast'
  status: string;
  recipientCount: number;
  deliveredCountAtSend: number; // newsletter_sends.delivered_count (send-time)
  createdAt: string;
  sentByEmail: string | null;
};

export type CampaignStats = {
  sendId: string;
  subject: string;
  sentAt: string;
  recipients: number; // best-known audience size (delivered, else recipient_count)
  delivered: number;
  opened: number; // real (human) unique opens
  openedIncludingMachine: number;
  clicked: number;
  bounced: number; // hard bounces (return-to-sender, remove address)
  blocked: number; // soft bounces / blocked
  returnToSender: number; // bounced + blocked
  complained: number; // marked as spam ("rejected it")
  unsubscribed: number;
  failed: number;
  // rates (0..1), denominator = delivered (fallback recipient_count)
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  complaintRate: number;
  unsubscribeRate: number;
};

export type NewsletterStats = {
  campaigns: CampaignStats[];
  totals: {
    campaigns: number;
    recipients: number;
    delivered: number;
    opened: number;
    openedIncludingMachine: number;
    clicked: number;
    bounced: number;
    blocked: number;
    returnToSender: number;
    complained: number;
    unsubscribed: number;
    failed: number;
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    bounceRate: number;
    complaintRate: number;
    unsubscribeRate: number;
  };
};

function rate(numer: number, denom: number): number {
  if (denom <= 0) return 0;
  return numer / denom;
}

type Sets = {
  delivered: Set<string>;
  openedReal: Set<string>;
  openedAny: Set<string>;
  clicked: Set<string>;
  bounced: Set<string>;
  blocked: Set<string>;
  complained: Set<string>;
  unsubscribed: Set<string>;
  failed: Set<string>;
};

function newSets(): Sets {
  return {
    delivered: new Set(),
    openedReal: new Set(),
    openedAny: new Set(),
    clicked: new Set(),
    bounced: new Set(),
    blocked: new Set(),
    complained: new Set(),
    unsubscribed: new Set(),
    failed: new Set(),
  };
}

function applyEvent(s: Sets, e: EventRow): void {
  const r = e.recipientEmail;
  switch (e.eventType) {
    case "delivered":
      s.delivered.add(r);
      break;
    case "opened":
      s.openedAny.add(r);
      if (!e.machineOpen) s.openedReal.add(r);
      break;
    case "clicked":
      s.clicked.add(r);
      break;
    case "bounced":
      if (e.bounceKind === "soft") s.blocked.add(r);
      else s.bounced.add(r);
      break;
    case "complained":
      s.complained.add(r);
      break;
    case "unsubscribed":
      s.unsubscribed.add(r);
      break;
    case "failed":
      s.failed.add(r);
      break;
    default:
      break;
  }
}

function statsFromSets(
  sendId: string,
  subject: string,
  sentAt: string,
  fallbackRecipients: number,
  s: Sets,
): CampaignStats {
  const delivered = s.delivered.size;
  const denom = delivered > 0 ? delivered : fallbackRecipients;
  const opened = s.openedReal.size;
  const clicked = s.clicked.size;
  const bounced = s.bounced.size;
  const blocked = s.blocked.size;
  const complained = s.complained.size;
  const unsubscribed = s.unsubscribed.size;
  return {
    sendId,
    subject,
    sentAt,
    recipients: denom,
    delivered,
    opened,
    openedIncludingMachine: s.openedAny.size,
    clicked,
    bounced,
    blocked,
    returnToSender: bounced + blocked,
    complained,
    unsubscribed,
    failed: s.failed.size,
    openRate: rate(opened, denom),
    clickRate: rate(clicked, denom),
    clickToOpenRate: rate(clicked, opened),
    bounceRate: rate(bounced + blocked, fallbackRecipients > 0 ? fallbackRecipients : denom),
    complaintRate: rate(complained, denom),
    unsubscribeRate: rate(unsubscribed, denom),
  };
}

/**
 * Build the full stats object. Only 'broadcast' sends are included (test sends
 * are excluded — they're noise). Events with no send id, or a send id we don't
 * recognize, are aggregated into TOTALS only (they still count) but cannot be
 * attributed to a specific campaign row.
 */
export function buildNewsletterStats(sends: SendRow[], events: EventRow[]): NewsletterStats {
  const broadcasts = sends.filter((s) => s.sendKind !== "test");
  const byId = new Map<string, SendRow>();
  for (const s of broadcasts) byId.set(s.id, s);

  const perCampaign = new Map<string, Sets>();
  for (const s of broadcasts) perCampaign.set(s.id, newSets());

  // Aggregate totals across ALL broadcast-attributable events.
  const totalSets = newSets();

  for (const e of events) {
    const sid = e.newsletterSendId;
    if (sid && perCampaign.has(sid)) {
      applyEvent(perCampaign.get(sid)!, e);
      applyEvent(totalSets, prefixed(e, sid));
    } else if (!sid) {
      // Uncorrelated event — count in totals using a synthetic recipient key so
      // it still contributes to aggregate rates without polluting a campaign.
      applyEvent(totalSets, e);
    }
    // events tagged to a non-broadcast/unknown send are ignored.
  }

  const campaigns: CampaignStats[] = broadcasts
    .map((s) =>
      statsFromSets(
        s.id,
        s.subject,
        s.createdAt,
        s.deliveredCountAtSend > 0 ? s.deliveredCountAtSend : s.recipientCount,
        perCampaign.get(s.id)!,
      ),
    )
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));

  const delivered = totalSets.delivered.size;
  const fallbackRecipients = broadcasts.reduce(
    (acc, s) => acc + (s.recipientCount || 0),
    0,
  );
  const denom = delivered > 0 ? delivered : fallbackRecipients;
  const opened = totalSets.openedReal.size;
  const clicked = totalSets.clicked.size;
  const bounced = totalSets.bounced.size;
  const blocked = totalSets.blocked.size;
  const complained = totalSets.complained.size;
  const unsubscribed = totalSets.unsubscribed.size;

  return {
    campaigns,
    totals: {
      campaigns: broadcasts.length,
      recipients: fallbackRecipients,
      delivered,
      opened,
      openedIncludingMachine: totalSets.openedAny.size,
      clicked,
      bounced,
      blocked,
      returnToSender: bounced + blocked,
      complained,
      unsubscribed,
      failed: totalSets.failed.size,
      openRate: rate(opened, denom),
      clickRate: rate(clicked, denom),
      clickToOpenRate: rate(clicked, opened),
      bounceRate: rate(bounced + blocked, fallbackRecipients > 0 ? fallbackRecipients : denom),
      complaintRate: rate(complained, denom),
      unsubscribeRate: rate(unsubscribed, denom),
    },
  };
}

// To keep recipient uniqueness correct in TOTALS across campaigns, namespace
// the recipient by send id so the same address in two campaigns counts twice
// in aggregate (each campaign is a separate audience touch).
function prefixed(e: EventRow, sid: string): EventRow {
  return { ...e, recipientEmail: `${sid}::${e.recipientEmail}` };
}

// ---------------------------------------------------------------------------
// Self-tests (tsx)
// ---------------------------------------------------------------------------

export function __runNewsletterStatsTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };

  const sends: SendRow[] = [
    {
      id: "s1",
      subject: "May Drop",
      sendKind: "broadcast",
      status: "sent",
      recipientCount: 100,
      deliveredCountAtSend: 100,
      createdAt: "2024-05-01T00:00:00.000Z",
      sentByEmail: "boss@greenway",
    },
    {
      id: "t1",
      subject: "Test",
      sendKind: "test",
      status: "sent",
      recipientCount: 1,
      deliveredCountAtSend: 1,
      createdAt: "2024-05-02T00:00:00.000Z",
      sentByEmail: "boss@greenway",
    },
  ];

  const ev = (
    sid: string | null,
    email: string,
    eventType: EventType,
    extra?: Partial<EventRow>,
  ): EventRow => ({
    newsletterSendId: sid,
    recipientEmail: email,
    eventType,
    bounceKind: extra?.bounceKind ?? null,
    machineOpen: extra?.machineOpen ?? false,
    occurredAt: "2024-05-01T01:00:00.000Z",
  });

  const events: EventRow[] = [
    ev("s1", "a@x.com", "delivered"),
    ev("s1", "b@x.com", "delivered"),
    ev("s1", "c@x.com", "delivered"),
    ev("s1", "a@x.com", "opened"),
    ev("s1", "a@x.com", "opened"), // dup open -> still 1
    ev("s1", "b@x.com", "opened", { machineOpen: true }), // machine open -> not "real"
    ev("s1", "a@x.com", "clicked"),
    ev("s1", "d@x.com", "bounced", { bounceKind: "hard" }),
    ev("s1", "e@x.com", "bounced", { bounceKind: "soft" }),
    ev("s1", "f@x.com", "complained"),
    ev("s1", "g@x.com", "unsubscribed"),
    // test send event must be ignored
    ev("t1", "boss@x.com", "opened"),
  ];

  const stats = buildNewsletterStats(sends, events);
  assert(stats.campaigns.length === 1, "only broadcast campaign included");
  const c = stats.campaigns[0];
  assert(c.delivered === 3, "delivered unique = 3");
  assert(c.opened === 1, "real opens = 1 (machine excluded)");
  assert(c.openedIncludingMachine === 2, "opens incl machine = 2");
  assert(c.clicked === 1, "clicks = 1");
  assert(c.bounced === 1, "hard bounce = 1");
  assert(c.blocked === 1, "soft/blocked = 1");
  assert(c.returnToSender === 2, "return-to-sender = bounced+blocked");
  assert(c.complained === 1, "complaints = 1");
  assert(c.unsubscribed === 1, "unsubs = 1");
  assert(Math.abs(c.openRate - 1 / 3) < 1e-9, "open rate = opened/delivered");
  assert(Math.abs(c.clickToOpenRate - 1) < 1e-9, "ctr-to-open = clicked/opened");

  assert(stats.totals.campaigns === 1, "totals campaigns");
  assert(stats.totals.opened === 1, "totals real opens");

   
  console.log("newsletter-stats-core: all tests passed");
}
