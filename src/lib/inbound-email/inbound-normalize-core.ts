/**
 * src/lib/inbound-email/inbound-normalize-core.ts  (Slice 99)
 *
 * PURE, provider-agnostic normalization of an INBOUND email (the vendor_intake@
 * mailbox) into ONE shape, regardless of which provider forwards it. No I/O, no
 * SDK, no `server-only` — unit-testable with tsx.
 *
 * The mailbox is a Google (Workspace/Gmail) address; delivery to our webhook is
 * via one of two providers, chosen by env `INBOUND_EMAIL_PROVIDER`:
 *
 *   - "resend"  — Resend Inbound. Posts JSON (Svix-signed like Resend's event
 *                 webhooks). Shape: { type: "email.received"|"inbound.email"...,
 *                 data: { from, to[], subject, text, html, attachments[] } }.
 *                 Each attachment: { filename, content_type, content (base64) }.
 *                 Ref: https://resend.com/docs (Inbound / receiving email).
 *   - "sendgrid"— SendGrid Inbound Parse. Posts multipart/form-data with fields
 *                 from,to,subject,text,html,attachments (count),
 *                 attachment-info (JSON map), and file parts attachment1..N.
 *                 Ref: https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
 *
 * SendGrid can't send file bytes as JSON, so its route pre-extracts the form and
 * hands us a plain object; we normalize both to the SAME NormalizedInboundEmail.
 *
 * DRAFTS-ONLY: normalization does not commit anything — the parsed attachment is
 * later run through the vendor intake parser + summarizeIntakeForReview for a
 * human to validate.
 */

export type InboundProvider = "resend" | "sendgrid";

export type NormalizedAttachment = {
  filename: string | null;
  contentType: string | null;
  /** Raw decoded text content when the attachment is text/json (else null). */
  text: string | null;
  /** Base64 content when provided (binary-safe); may be null for form parts. */
  base64: string | null;
};

export type NormalizedInboundEmail = {
  provider: InboundProvider;
  from: string;
  /** All recipient addresses, lowercased. */
  to: string[];
  subject: string;
  receivedAt: string; // ISO 8601
  attachments: NormalizedAttachment[];
};

function lc(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Split a raw "to" value (string or array; comma/semicolon separated) → lowercased addrs. */
export function parseRecipients(v: unknown): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    // Extract the address from "Name <addr@x>" or bare "addr@x".
    const m = s.match(/<([^>]+)>/);
    const addr = (m ? m[1] : s).trim().toLowerCase();
    if (addr && addr.includes("@")) out.push(addr);
  };
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string") item.split(/[,;]/).forEach(push);
      else if (item && typeof item === "object") {
        const e = (item as Record<string, unknown>).email ?? (item as Record<string, unknown>).address;
        if (typeof e === "string") push(e);
      }
    }
  } else if (typeof v === "string") {
    v.split(/[,;]/).forEach(push);
  }
  return [...new Set(out)];
}

/** Best-effort base64 → utf8 text (Node Buffer). Returns null if it doesn't decode. */
function base64ToText(b64: string | null): string | null {
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function looksTextual(contentType: string | null, filename: string | null): boolean {
  const ct = lc(contentType);
  const fn = lc(filename);
  return (
    ct.includes("json") ||
    ct.includes("text") ||
    ct.includes("csv") ||
    ct.includes("xml") ||
    /\.(json|csv|txt|xml)$/.test(fn)
  );
}

/** Normalize a Resend Inbound (JSON) payload. Returns null if it isn't an inbound email. */
export function normalizeResendInbound(raw: Record<string, unknown>): NormalizedInboundEmail | null {
  const type = lc(raw.type);
  // Accept the received/inbound event; tolerate a bare data object with no type.
  if (type && !type.includes("inbound") && !type.includes("received") && !type.startsWith("email.")) {
    // still allow if it has a data.from — some payloads omit a helpful type
    const d = raw.data as Record<string, unknown> | undefined;
    if (!d || !d.from) return null;
  }
  const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
  const from = str(data.from);
  const to = parseRecipients(data.to);
  if (!from && to.length === 0) return null;

  const rawAtts = Array.isArray(data.attachments) ? data.attachments : [];
  const attachments: NormalizedAttachment[] = rawAtts
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => {
      const filename = (typeof a.filename === "string" ? a.filename : (typeof a.name === "string" ? a.name : null));
      const contentType = typeof a.content_type === "string" ? a.content_type : (typeof a.contentType === "string" ? a.contentType : null);
      const base64 = typeof a.content === "string" ? a.content : (typeof a.base64 === "string" ? a.base64 : null);
      const text = looksTextual(contentType, filename) ? base64ToText(base64) : null;
      return { filename, contentType, text, base64 };
    });

  const receivedAt =
    typeof raw.created_at === "string"
      ? raw.created_at
      : typeof data.created_at === "string"
        ? data.created_at
        : new Date().toISOString();

  return {
    provider: "resend",
    from: from.trim(),
    to,
    subject: str(data.subject),
    receivedAt,
    attachments,
  };
}

/**
 * Normalize a SendGrid Inbound Parse payload. The webhook route pre-extracts the
 * multipart form into a plain object:
 *   { from, to, subject, text, html, "attachment-info": <json string|obj>,
 *     attachments: [ { filename, type, content: <base64>, text? } ] }
 * We accept that already-collected attachment array (the route reads the file
 * parts) so this core stays pure/testable. Returns null if not an email.
 */
export function normalizeSendgridInbound(raw: Record<string, unknown>): NormalizedInboundEmail | null {
  const from = str(raw.from);
  const to = parseRecipients(raw.to);
  if (!from && to.length === 0) return null;

  const rawAtts = Array.isArray(raw.attachments) ? raw.attachments : [];
  const attachments: NormalizedAttachment[] = rawAtts
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => {
      const filename = typeof a.filename === "string" ? a.filename : (typeof a.name === "string" ? a.name : null);
      const contentType = typeof a.type === "string" ? a.type : (typeof a.contentType === "string" ? a.contentType : null);
      const base64 = typeof a.content === "string" ? a.content : null;
      const providedText = typeof a.text === "string" ? a.text : null;
      const text = providedText ?? (looksTextual(contentType, filename) ? base64ToText(base64) : null);
      return { filename, contentType, text, base64 };
    });

  return {
    provider: "sendgrid",
    from: from.trim(),
    to,
    subject: str(raw.subject),
    receivedAt: new Date().toISOString(),
    attachments,
  };
}

/** Dispatch by provider. PURE. */
export function normalizeInboundEmail(
  provider: InboundProvider,
  raw: Record<string, unknown>,
): NormalizedInboundEmail | null {
  return provider === "sendgrid" ? normalizeSendgridInbound(raw) : normalizeResendInbound(raw);
}

/**
 * Is this email addressed to the configured intake mailbox? Case-insensitive.
 * Accepts a match on the local-part too (e.g. "vendor_intake") so the check works
 * across the store's own domain. PURE.
 */
export function isForIntakeMailbox(email: NormalizedInboundEmail, mailbox: string): boolean {
  const target = mailbox.trim().toLowerCase();
  if (!target) return false;
  const localPart = target.includes("@") ? target.split("@")[0] : target;
  return email.to.some((addr) => addr === target || addr.split("@")[0] === localPart);
}

/** The JSON/CSV/text attachments that could be a vendor manifest. PURE. */
export function manifestCandidates(email: NormalizedInboundEmail): NormalizedAttachment[] {
  return email.attachments.filter(
    (a) => a.text != null || looksTextual(a.contentType, a.filename),
  );
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx). Pure — no I/O.
// ---------------------------------------------------------------------------
export function __runInboundNormalizeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  const jsonManifest = JSON.stringify({ manifest_number: "M-1", lines: [] });
  const b64 = Buffer.from(jsonManifest, "utf8").toString("base64");

  // Resend inbound normalizes.
  const resend = normalizeResendInbound({
    type: "inbound.email",
    created_at: "2025-06-16T10:00:00Z",
    data: {
      from: "Acme Farms <sales@acme.com>",
      to: ["vendor_intake@greenway.com"],
      subject: "Transfer manifest",
      attachments: [{ filename: "manifest.json", content_type: "application/json", content: b64 }],
    },
  });
  ok(resend !== null, "resend normalizes");
  ok(resend?.provider === "resend", "resend provider");
  ok(resend?.from === "Acme Farms <sales@acme.com>", "resend from preserved");
  ok(resend?.to[0] === "vendor_intake@greenway.com", "resend recipient parsed");
  ok(resend?.attachments.length === 1, "resend one attachment");
  ok(resend?.attachments[0].text === jsonManifest, "resend attachment decoded to text");

  // SendGrid inbound normalizes to the SAME shape.
  const sg = normalizeSendgridInbound({
    from: "sales@acme.com",
    to: "Vendor Intake <vendor_intake@greenway.com>, ap@greenway.com",
    subject: "Manifest",
    attachments: [{ filename: "manifest.json", type: "application/json", content: b64 }],
  });
  ok(sg !== null, "sendgrid normalizes");
  ok(sg?.provider === "sendgrid", "sendgrid provider");
  ok(sg?.to.length === 2, "sendgrid two recipients");
  ok(sg?.to.includes("vendor_intake@greenway.com") === true, "sendgrid recipient extracted from display name");
  ok(sg?.attachments[0].text === jsonManifest, "sendgrid attachment decoded");

  // Dispatch.
  ok(normalizeInboundEmail("resend", { data: { from: "x@y.com", to: ["a@b.com"] } }) !== null, "dispatch resend");
  ok(normalizeInboundEmail("sendgrid", { from: "x@y.com", to: "a@b.com" }) !== null, "dispatch sendgrid");

  // Recipient targeting.
  ok(isForIntakeMailbox(resend!, "vendor_intake@greenway.com") === true, "mailbox exact match");
  ok(isForIntakeMailbox(resend!, "vendor_intake") === true, "mailbox local-part match");
  ok(isForIntakeMailbox(resend!, "someone_else@greenway.com") === false, "mailbox non-match ignored");

  // Manifest candidates.
  ok(manifestCandidates(resend!).length === 1, "manifest candidate found");

  // Non-email payloads → null.
  ok(normalizeResendInbound({ type: "email.delivered", data: {} }) === null, "non-inbound (no from) → null");
  ok(normalizeSendgridInbound({}) === null, "empty sendgrid → null");

  // Recipient parser edge cases.
  ok(parseRecipients("a@b.com, c@d.com; e@f.com").length === 3, "parseRecipients multi");
  ok(parseRecipients([{ email: "g@h.com" }])[0] === "g@h.com", "parseRecipients object form");
  ok(parseRecipients("not-an-email").length === 0, "parseRecipients rejects non-address");

  if (failed === 0) console.log(`inbound-normalize-core: all ${passed} tests passed`);
  return { passed, failed };
}
