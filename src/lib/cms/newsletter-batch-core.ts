/**
 * src/lib/cms/newsletter-batch-core.ts  (D237, SOP-22 N-2, G-112)
 *
 * Pure rules for the queued newsletter broadcast. No I/O.
 *
 * Owner, verbatim (D237): "I approve all from serious to small along with
 * your recommendations". The recommendation for F-22-3 was: one row per
 * address, Resend's batch endpoint (100 per call) with an Idempotency-Key per
 * batch, a worker that sends and resumes, a progress bar, "Retry failed", and
 * never a double send.
 *
 * Resend facts this file relies on (resend.com/docs/api-reference/emails/
 * send-batch-emails, read 2026-11-12): up to 100 emails per call; each
 * email may carry its own headers and tags; the Idempotency-Key header is
 * unique per request, at most 256 characters and kept for 24 hours; on success
 * `data[i]` is the email at index i of the request.
 */

/** Resend's batch limit. */
export const BATCH_SIZE = 100;
/** A batch that fails for a temporary reason (rate limit, 5xx, network) is retried this many times. */
export const MAX_TRIES = 3;
/** A worker that has not touched its send for this long is presumed dead; the next run takes over. */
export const LEASE_MS = 4 * 60 * 1000;
/** Pause between batch calls, under Resend's default rate limit. */
export const BATCH_PAUSE_MS = 600;
/** One worker run stops after this long so it always finishes inside the route's maxDuration. */
export const WORKER_BUDGET_MS = 60 * 1000;

export type RecipientRowStatus = "pending" | "sent" | "failed";
export type SendStatus = "queued" | "sending" | "sent" | "partial" | "failed";

/** Batch number for the i-th recipient (0-based). */
export function batchNoFor(index: number): number {
  return Math.floor(Math.max(0, index) / BATCH_SIZE);
}

/**
 * The Idempotency-Key for one batch call. The same send, batch and round
 * always give the same key, so a resumed or doubled worker cannot send that
 * batch twice within Resend's 24 hours. "Retry failed" raises the round, so a
 * deliberate retry is a new request.
 */
export function idempotencyKey(sendId: string, batchNo: number, round: number): string {
  return `gw-nl-${sendId}-b${batchNo}-r${round}`.slice(0, 256);
}

export type BatchOutcome =
  | { kind: "sent"; ids: (string | null)[] }
  | { kind: "retry"; error: string }
  | { kind: "failed"; error: string };

/**
 * What one batch call means for its rows. Resend validates a batch as a whole
 * by default (strict), so a batch is all sent or all not sent.
 *  - 2xx: every row sent; ids taken from data[i] (index-aligned).
 *  - 429, 409 (a concurrent request with the same key) or 5xx or a network
 *    error: temporary, try again later with the same key.
 *  - any other 4xx: the request itself is wrong; retrying will not help.
 */
export function interpretBatchResponse(
  httpStatus: number | null,
  body: unknown,
  count: number,
): BatchOutcome {
  const message = (() => {
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message?: unknown }).message;
      if (typeof m === "string" && m.trim()) return m.trim().slice(0, 300);
    }
    return null;
  })();
  if (httpStatus === null) return { kind: "retry", error: "Could not reach the email service." };
  if (httpStatus >= 200 && httpStatus < 300) {
    const data =
      body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
        ? ((body as { data: unknown[] }).data)
        : [];
    const ids: (string | null)[] = [];
    for (let i = 0; i < count; i++) {
      const d = data[i];
      const id = d && typeof d === "object" && typeof (d as { id?: unknown }).id === "string" ? (d as { id: string }).id : null;
      ids.push(id);
    }
    return { kind: "sent", ids };
  }
  if (httpStatus === 429 || httpStatus === 409 || httpStatus >= 500) {
    return { kind: "retry", error: message ?? `The email service said ${httpStatus}; it will try again.` };
  }
  return { kind: "failed", error: message ?? `The email service refused the batch (${httpStatus}).` };
}

/** After a temporary failure: keep the rows pending, or give up after MAX_TRIES. */
export function afterRetry(triesSoFar: number): { status: RecipientRowStatus; tries: number } {
  const tries = triesSoFar + 1;
  return { status: tries >= MAX_TRIES ? "failed" : "pending", tries };
}

/** The send's status from its row counts. */
export function sendStatusFrom(c: { pending: number; sent: number; failed: number }): SendStatus {
  if (c.pending > 0) return "sending";
  if (c.failed === 0) return "sent";
  if (c.sent === 0) return "failed";
  return "partial";
}

/** 0..100, whole numbers. Done rows (sent + failed) over the total. */
export function progressPercent(c: { pending: number; sent: number; failed: number }): number {
  const total = c.pending + c.sent + c.failed;
  if (total <= 0) return 0;
  return Math.min(100, Math.floor(((c.sent + c.failed) * 100) / total));
}

/** May this worker take the send? Free, or its lease is older than LEASE_MS. */
export function canClaim(claimedAtIso: string | null, nowMs: number): boolean {
  if (!claimedAtIso) return true;
  const t = Date.parse(claimedAtIso);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= LEASE_MS;
}

/** Plain words for the progress line. */
export function progressLine(c: { pending: number; sent: number; failed: number }): string {
  const total = c.pending + c.sent + c.failed;
  const pct = progressPercent(c);
  const failed = c.failed > 0 ? `, ${c.failed} failed` : "";
  return `Sending: ${c.sent} of ${total} sent${failed} (${pct}%). You can leave this page; it keeps going.`;
}

/** The 0362 table is not there yet (migration not applied): fall back to the old one-request send. */
export function isMissingRecipientsTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const m = String(err.message ?? "");
  return /newsletter_send_recipients/.test(m) && /(does not exist|schema cache|could not find)/i.test(m);
}

export const RETRY_FAILED_MESSAGE =
  "The failed addresses are queued again. Only those addresses get the email; everyone who already has it is skipped.";

export function __runNewsletterBatchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, c: boolean) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL newsletter-batch-core: ${name}`);
    }
  };

  ok("batch size is Resend's 100", BATCH_SIZE === 100);
  ok("index 0 batch 0", batchNoFor(0) === 0);
  ok("index 99 batch 0", batchNoFor(99) === 0);
  ok("index 100 batch 1", batchNoFor(100) === 1);
  ok("index 250 batch 2", batchNoFor(250) === 2);
  ok("negative clamps", batchNoFor(-5) === 0);

  const k = idempotencyKey("abc", 3, 0);
  ok("key stable", k === idempotencyKey("abc", 3, 0));
  ok("key differs by batch", k !== idempotencyKey("abc", 4, 0));
  ok("key differs by round", k !== idempotencyKey("abc", 3, 1));
  ok("key differs by send", k !== idempotencyKey("abd", 3, 0));
  ok("key <= 256", idempotencyKey("x".repeat(400), 1, 1).length === 256);

  const s = interpretBatchResponse(200, { data: [{ id: "a" }, { id: "b" }] }, 2);
  ok("2xx sent", s.kind === "sent");
  ok("2xx ids aligned", s.kind === "sent" && s.ids[0] === "a" && s.ids[1] === "b");
  const short = interpretBatchResponse(200, { data: [{ id: "a" }] }, 2);
  ok("missing id is null", short.kind === "sent" && short.ids[1] === null);
  ok("429 retry", interpretBatchResponse(429, {}, 1).kind === "retry");
  ok("409 retry", interpretBatchResponse(409, {}, 1).kind === "retry");
  ok("503 retry", interpretBatchResponse(503, {}, 1).kind === "retry");
  ok("network retry", interpretBatchResponse(null, null, 1).kind === "retry");
  const bad = interpretBatchResponse(422, { message: "Invalid from" }, 1);
  ok("422 failed", bad.kind === "failed");
  ok("422 message kept", bad.kind === "failed" && bad.error === "Invalid from");

  ok("retry 1 pending", afterRetry(0).status === "pending" && afterRetry(0).tries === 1);
  ok("retry 2 pending", afterRetry(1).status === "pending");
  ok("retry 3 gives up", afterRetry(2).status === "failed" && afterRetry(2).tries === 3);

  ok("pending -> sending", sendStatusFrom({ pending: 1, sent: 5, failed: 0 }) === "sending");
  ok("all sent", sendStatusFrom({ pending: 0, sent: 5, failed: 0 }) === "sent");
  ok("none sent", sendStatusFrom({ pending: 0, sent: 0, failed: 5 }) === "failed");
  ok("some failed", sendStatusFrom({ pending: 0, sent: 4, failed: 1 }) === "partial");

  ok("pct 0 total", progressPercent({ pending: 0, sent: 0, failed: 0 }) === 0);
  ok("pct half", progressPercent({ pending: 50, sent: 40, failed: 10 }) === 50);
  ok("pct floors", progressPercent({ pending: 2, sent: 1, failed: 0 }) === 33);
  ok("pct done", progressPercent({ pending: 0, sent: 3, failed: 0 }) === 100);

  const now = Date.parse("2026-11-12T12:00:00Z");
  ok("free claim", canClaim(null, now));
  ok("fresh lease blocks", !canClaim("2026-11-12T11:59:00Z", now));
  ok("stale lease frees", canClaim("2026-11-12T11:55:00Z", now));
  ok("bad date frees", canClaim("nope", now));

  ok("line words", progressLine({ pending: 10, sent: 90, failed: 0 }).startsWith("Sending: 90 of 100 sent (90%)"));
  ok("line failed", progressLine({ pending: 0, sent: 9, failed: 1 }).includes("1 failed"));
  ok("budget under route maxDuration", WORKER_BUDGET_MS < 120_000);
  ok("missing table 42P01", isMissingRecipientsTable({ code: "42P01" }));
  ok("missing table cache", isMissingRecipientsTable({ message: "Could not find the table 'public.newsletter_send_recipients' in the schema cache" }));
  ok("other error is not missing", !isMissingRecipientsTable({ code: "23505", message: "duplicate key" }));
  ok("null is not missing", !isMissingRecipientsTable(null));

  return { passed, failed };
}
