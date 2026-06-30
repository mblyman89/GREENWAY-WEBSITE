/**
 * src/lib/cms/email-events/normalize-core.ts  (Slice 50)
 *
 * PURE normalization logic — no I/O, no `server-only` imports — so it can be
 * unit-tested with tsx. Turns a raw Resend OR SendGrid webhook event into ONE
 * canonical shape that the stats layer understands. This is the seam that makes
 * the newsletter-stats suite provider-agnostic: add a provider, add a mapper,
 * everything downstream stays the same.
 *
 * Authoritative references used to build these mappers:
 *   - Resend webhook event types + payload:
 *       https://resend.com/docs/webhooks/event-types
 *       (type: "email.delivered" | "email.opened" | "email.clicked"
 *              | "email.bounced" | "email.complained" | "email.sent"
 *              | "email.delivery_delayed" | "email.failed";
 *        data: { email_id, from, to[], subject, tags?, ... }, created_at)
 *   - SendGrid Event Webhook (events POST as a JSON array; engagement +
 *       delivery events with sg_event_id (dedup), sg_message_id, timestamp,
 *       custom_args round-trip, bounce type hard/blocked, sg_machine_open).
 */

export type NormalizedEventType =
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

export type NormalizedEmailEvent = {
  provider: "resend" | "sendgrid";
  providerEventId: string;
  providerMessageId: string | null;
  newsletterSendId: string | null;
  recipientEmail: string;
  eventType: NormalizedEventType;
  occurredAt: string; // ISO 8601
  bounceKind: "hard" | "soft" | null;
  reason: string | null;
  url: string | null;
  machineOpen: boolean;
};

// The tag/custom_arg key we stamp on outgoing messages to correlate events back
// to a specific newsletter_sends row. Used by BOTH the send path and the
// mappers, so keep it in one place.
export const SEND_ID_TAG = "newsletter_send_id";
export const POST_ID_TAG = "post_id";

function lc(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function firstString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return null;
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

/**
 * Resend events look like:
 *   { type: "email.opened", created_at: "2024-...Z",
 *     data: { email_id, from, to: ["x@y.com"], subject,
 *             tags?: [{ name, value }] | Record<string,string>,
 *             bounce?: { type, subType, message }, click?: { link } } }
 *
 * `email_id` is the message id. We use the webhook's Svix message id as the
 * dedup key (passed in as svixId) because Resend's event payload has no event-
 * level id; if absent we synthesize a stable id from type+email_id+timestamp.
 */
export function mapResendEvent(
  raw: Record<string, unknown>,
  svixId: string | null,
): NormalizedEmailEvent | null {
  const type = lc(raw.type);
  if (!type.startsWith("email.")) return null;

  const data = (raw.data as Record<string, unknown> | undefined) ?? {};
  const recipientEmail = lc(firstString(data.to));
  if (!recipientEmail) return null;

  const emailId = typeof data.email_id === "string" ? data.email_id : null;
  const createdAt =
    typeof raw.created_at === "string" ? raw.created_at : new Date().toISOString();

  const { sendId } = readResendTags(data.tags);

  let eventType: NormalizedEventType = "other";
  let bounceKind: "hard" | "soft" | null = null;
  let reason: string | null = null;
  let url: string | null = null;

  switch (type) {
    case "email.sent":
      eventType = "sent";
      break;
    case "email.delivered":
      eventType = "delivered";
      break;
    case "email.opened":
      eventType = "opened";
      break;
    case "email.clicked": {
      eventType = "clicked";
      const click = data.click as Record<string, unknown> | undefined;
      url = (click && typeof click.link === "string" ? click.link : null) ?? null;
      break;
    }
    case "email.bounced": {
      eventType = "bounced";
      bounceKind = "hard"; // Resend email.bounced == permanent (return-to-sender)
      const bounce = data.bounce as Record<string, unknown> | undefined;
      reason =
        (bounce && typeof bounce.message === "string" ? bounce.message : null) ??
        (bounce && typeof bounce.subType === "string" ? bounce.subType : null);
      break;
    }
    case "email.complained":
      eventType = "complained";
      break;
    case "email.delivery_delayed":
      eventType = "delivery_delayed";
      bounceKind = "soft";
      break;
    case "email.failed":
      eventType = "failed";
      reason =
        typeof (data.failed as Record<string, unknown> | undefined)?.reason === "string"
          ? String((data.failed as Record<string, unknown>).reason)
          : null;
      break;
    default:
      eventType = "other";
  }

  const providerEventId =
    svixId ?? `resend:${type}:${emailId ?? recipientEmail}:${createdAt}`;

  return {
    provider: "resend",
    providerEventId,
    providerMessageId: emailId,
    newsletterSendId: sendId,
    recipientEmail,
    eventType,
    occurredAt: createdAt,
    bounceKind,
    reason,
    url,
    machineOpen: false, // Resend does not flag machine opens
  };
}

/** Resend tags can arrive as [{name,value}] or as a flat object. */
export function readResendTags(tags: unknown): { sendId: string | null; postId: string | null } {
  let sendId: string | null = null;
  let postId: string | null = null;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const name = lc((t as Record<string, unknown>)?.name);
      const value = (t as Record<string, unknown>)?.value;
      if (name === SEND_ID_TAG && typeof value === "string") sendId = value;
      if (name === POST_ID_TAG && typeof value === "string") postId = value;
    }
  } else if (tags && typeof tags === "object") {
    const obj = tags as Record<string, unknown>;
    if (typeof obj[SEND_ID_TAG] === "string") sendId = obj[SEND_ID_TAG] as string;
    if (typeof obj[POST_ID_TAG] === "string") postId = obj[POST_ID_TAG] as string;
  }
  return { sendId, postId };
}

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------

/**
 * SendGrid posts an ARRAY of events. Each event:
 *   { email, timestamp (unix s), event, sg_event_id, sg_message_id,
 *     reason?, status?, type? ("bounce"|"blocked"), url?, sg_machine_open?,
 *     bounce_classification?, <custom_args round-tripped at top level> }
 */
export function mapSendgridEvent(raw: Record<string, unknown>): NormalizedEmailEvent | null {
  const recipientEmail = lc(raw.email);
  const event = lc(raw.event);
  if (!recipientEmail || !event) return null;

  const sgEventId = typeof raw.sg_event_id === "string" ? raw.sg_event_id : null;
  const sgMessageId = typeof raw.sg_message_id === "string" ? raw.sg_message_id : null;
  const ts = typeof raw.timestamp === "number" ? raw.timestamp : null;
  const occurredAt = ts ? new Date(ts * 1000).toISOString() : new Date().toISOString();

  // custom_args round-trip at the TOP LEVEL of the event payload.
  const sendId = typeof raw[SEND_ID_TAG] === "string" ? (raw[SEND_ID_TAG] as string) : null;

  let eventType: NormalizedEventType = "other";
  let bounceKind: "hard" | "soft" | null = null;
  let reason: string | null = typeof raw.reason === "string" ? raw.reason : null;
  let url: string | null = typeof raw.url === "string" ? raw.url : null;

  switch (event) {
    case "processed":
      eventType = "sent";
      break;
    case "delivered":
      eventType = "delivered";
      break;
    case "open":
      eventType = "opened";
      break;
    case "click":
      eventType = "clicked";
      break;
    case "bounce": {
      eventType = "bounced";
      // type: "bounce" => hard/permanent; "blocked" => soft/transient
      const bt = lc(raw.type);
      bounceKind = bt === "blocked" ? "soft" : "hard";
      if (!reason && typeof raw.bounce_classification === "string") {
        reason = raw.bounce_classification as string;
      }
      break;
    }
    case "blocked":
      eventType = "bounced";
      bounceKind = "soft";
      break;
    case "dropped":
      eventType = "failed";
      break;
    case "deferred":
      eventType = "delivery_delayed";
      bounceKind = "soft";
      break;
    case "spamreport":
      eventType = "complained";
      break;
    case "unsubscribe":
    case "group_unsubscribe":
      eventType = "unsubscribed";
      break;
    default:
      eventType = "other";
      url = null;
  }

  const machineOpen = raw.sg_machine_open === true || raw.sg_machine_open === "true";

  const providerEventId =
    sgEventId ?? `sendgrid:${event}:${recipientEmail}:${ts ?? occurredAt}`;

  return {
    provider: "sendgrid",
    providerEventId,
    providerMessageId: sgMessageId,
    newsletterSendId: sendId,
    recipientEmail,
    eventType,
    occurredAt,
    bounceKind,
    reason,
    url,
    machineOpen,
  };
}

/** Parse a SendGrid webhook body (always an array) into normalized events. */
export function mapSendgridBatch(body: unknown): NormalizedEmailEvent[] {
  if (!Array.isArray(body)) return [];
  const out: NormalizedEmailEvent[] = [];
  for (const item of body) {
    if (item && typeof item === "object") {
      const ev = mapSendgridEvent(item as Record<string, unknown>);
      if (ev) out.push(ev);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx) — pure, no I/O.
// ---------------------------------------------------------------------------

export function __runNormalizeTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };

  // Resend opened with array tags
  const r1 = mapResendEvent(
    {
      type: "email.opened",
      created_at: "2024-05-01T10:00:00.000Z",
      data: {
        email_id: "msg-1",
        to: ["Person@Example.com"],
        tags: [
          { name: "newsletter_send_id", value: "send-123" },
          { name: "post_id", value: "post-9" },
        ],
      },
    },
    "svix-abc",
  );
  assert(r1 !== null, "resend opened parsed");
  assert(r1!.eventType === "opened", "resend opened type");
  assert(r1!.recipientEmail === "person@example.com", "resend email lowercased");
  assert(r1!.newsletterSendId === "send-123", "resend send tag read");
  assert(r1!.providerEventId === "svix-abc", "resend dedup uses svix id");
  assert(r1!.providerMessageId === "msg-1", "resend message id");

  // Resend bounced => hard
  const r2 = mapResendEvent(
    {
      type: "email.bounced",
      created_at: "2024-05-01T10:05:00.000Z",
      data: { email_id: "m2", to: ["x@y.com"], bounce: { message: "mailbox not found" } },
    },
    "svix-2",
  );
  assert(r2!.eventType === "bounced" && r2!.bounceKind === "hard", "resend bounce hard");
  assert(r2!.reason === "mailbox not found", "resend bounce reason");

  // Resend clicked carries url; tags as flat object
  const r3 = mapResendEvent(
    {
      type: "email.clicked",
      created_at: "2024-05-01T10:06:00.000Z",
      data: {
        email_id: "m3",
        to: ["c@d.com"],
        click: { link: "https://greenway/x" },
        tags: { newsletter_send_id: "send-77" },
      },
    },
    "svix-3",
  );
  assert(r3!.eventType === "clicked" && r3!.url === "https://greenway/x", "resend click url");
  assert(r3!.newsletterSendId === "send-77", "resend flat-object tag");

  // SendGrid batch: open (machine), bounce (hard), click, spamreport
  const sg = mapSendgridBatch([
    {
      email: "A@B.com",
      timestamp: 1714557600,
      event: "open",
      sg_event_id: "ev-1",
      sg_message_id: "sm-1",
      sg_machine_open: true,
      newsletter_send_id: "send-55",
    },
    {
      email: "z@z.com",
      timestamp: 1714557601,
      event: "bounce",
      type: "bounce",
      sg_event_id: "ev-2",
      reason: "550 no such user",
    },
    { email: "z@z.com", timestamp: 1714557602, event: "click", sg_event_id: "ev-3", url: "https://g/y" },
    { email: "s@s.com", timestamp: 1714557603, event: "spamreport", sg_event_id: "ev-4" },
    { email: "d@d.com", timestamp: 1714557604, event: "dropped", sg_event_id: "ev-5", reason: "bounced address" },
  ]);
  assert(sg.length === 5, "sendgrid batch length");
  assert(sg[0].eventType === "opened" && sg[0].machineOpen === true, "sg machine open");
  assert(sg[0].newsletterSendId === "send-55", "sg custom_arg send id");
  assert(sg[0].provider === "sendgrid", "sg provider tag");
  assert(sg[1].eventType === "bounced" && sg[1].bounceKind === "hard", "sg hard bounce");
  assert(sg[2].eventType === "clicked" && sg[2].url === "https://g/y", "sg click url");
  assert(sg[3].eventType === "complained", "sg spamreport => complained");
  assert(sg[4].eventType === "failed", "sg dropped => failed");

  // Unknown event types map to "other" and are dropped from rate math upstream.
  const other = mapSendgridEvent({ email: "e@e.com", event: "weird", sg_event_id: "ev-x" });
  assert(other!.eventType === "other", "sg unknown => other");

   
  console.log("normalize-core: all tests passed");
}
