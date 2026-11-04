/**
 * src/lib/pos/deferred-outbox-core.ts  (D170 O7/O8: send-later outbox)
 *
 * Owner, 2026-11-04: "so we can be fully operational while internet is
 * down ... Everything else should work though."
 *
 * Some register actions need no PIN and move no money, but must reach the
 * server eventually: flagging an item out of stock (B43) and an emailed
 * receipt (B30). Offline they used to refuse. Now they go into a small,
 * bounded outbox on the iPad (gw-pos-outbox) and are sent, oldest first, when
 * the internet returns. The rules:
 *
 *   - 2xx: delivered, removed.
 *   - 4xx: the server said no (e.g. the item left the menu). Kept in a short
 *     "could not send" list the register shows, never retried, never hidden.
 *   - throw / timeout / 5xx: retried with backoff (30 s doubling to 10 min).
 *   - Entries older than 7 days are given up on and shown as failed.
 *
 * Money and PIN actions never use this outbox: they go through the signed
 * sale-event queue, which the server re-judges at sync.
 *
 * Pure: no I/O. Self-tested below and registered in run-pure-selftests.ts.
 */

export const OUTBOX_VERSION = 1;
export const OUTBOX_MAX_PENDING = 200;
export const OUTBOX_MAX_FAILED = 30;
export const OUTBOX_BACKOFF_BASE_MS = 30_000;
export const OUTBOX_BACKOFF_MAX_MS = 10 * 60_000;
export const OUTBOX_GIVE_UP_AFTER_MS = 7 * 24 * 3600_000;

export type OutboxKind = "stock_flag" | "email_receipt" | "fix_and_sell";

/** Where each kind is delivered (the existing online endpoint, unchanged). */
export const OUTBOX_ENDPOINT: Record<OutboxKind, string> = {
  stock_flag: "/api/pos/stock-flag",
  email_receipt: "/api/pos/email-receipt",
  // D170 O9: a Fix & sell decided offline from the lot index; the route
  // writes the audit row that puts the lot on the Fix later page.
  fix_and_sell: "/api/pos/fix-and-sell",
};

export type OutboxEntry = {
  id: string;
  kind: OutboxKind;
  body: Record<string, unknown>;
  /** One line for the register ("Out of stock: Blue Dream 3.5g"). */
  label: string;
  createdAt: number;
  attempts: number;
  nextAt: number;
};

export type OutboxFailed = { id: string; kind: OutboxKind; label: string; reason: string; at: number };

export type Outbox = { v: number; pending: OutboxEntry[]; failed: OutboxFailed[] };

export function emptyOutbox(): Outbox {
  return { v: OUTBOX_VERSION, pending: [], failed: [] };
}

const KINDS: readonly OutboxKind[] = ["stock_flag", "email_receipt", "fix_and_sell"];

function isKind(v: unknown): v is OutboxKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** Parse stored text; anything unreadable degrades to empty (never throws). */
export function parseOutbox(raw: string | null | undefined): Outbox {
  if (!raw) return emptyOutbox();
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return emptyOutbox();
  }
  if (!o || typeof o !== "object" || (o as { v?: unknown }).v !== OUTBOX_VERSION) return emptyOutbox();
  const r = o as { pending?: unknown; failed?: unknown };
  const pending: OutboxEntry[] = [];
  const ids = new Set<string>();
  for (const e of Array.isArray(r.pending) ? r.pending : []) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    if (typeof x.id !== "string" || !x.id || ids.has(x.id) || !isKind(x.kind)) continue;
    if (!x.body || typeof x.body !== "object" || Array.isArray(x.body)) continue;
    if (typeof x.createdAt !== "number" || typeof x.attempts !== "number" || typeof x.nextAt !== "number") continue;
    ids.add(x.id);
    pending.push({
      id: x.id,
      kind: x.kind,
      body: x.body as Record<string, unknown>,
      label: typeof x.label === "string" ? x.label.slice(0, 160) : x.kind,
      createdAt: x.createdAt,
      attempts: Math.max(0, Math.floor(x.attempts)),
      nextAt: x.nextAt,
    });
    if (pending.length >= OUTBOX_MAX_PENDING) break;
  }
  const failed: OutboxFailed[] = [];
  for (const e of Array.isArray(r.failed) ? r.failed : []) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    if (typeof x.id !== "string" || !isKind(x.kind) || typeof x.reason !== "string" || typeof x.at !== "number") continue;
    failed.push({ id: x.id, kind: x.kind, label: typeof x.label === "string" ? x.label.slice(0, 160) : x.kind, reason: x.reason.slice(0, 300), at: x.at });
    if (failed.length >= OUTBOX_MAX_FAILED) break;
  }
  return { v: OUTBOX_VERSION, pending, failed };
}

/**
 * Add an entry. Refuses (returns ok:false, outbox unchanged) when full, so the
 * register can tell the budtender plainly instead of silently dropping it.
 * A stock flag for a product already waiting is not added twice.
 */
export function addToOutbox(
  box: Outbox,
  entry: { id: string; kind: OutboxKind; body: Record<string, unknown>; label: string },
  nowMs: number,
): { ok: true; box: Outbox; duplicate: boolean } | { ok: false; error: string } {
  if (entry.kind === "stock_flag") {
    const pid = entry.body.productId;
    if (box.pending.some((p) => p.kind === "stock_flag" && p.body.productId === pid)) return { ok: true, box, duplicate: true };
  }
  if (entry.kind === "fix_and_sell") {
    const code = String(entry.body.code ?? "").toLowerCase();
    if (box.pending.some((p) => p.kind === "fix_and_sell" && String(p.body.code ?? "").toLowerCase() === code)) {
      return { ok: true, box, duplicate: true };
    }
  }
  if (box.pending.length >= OUTBOX_MAX_PENDING) {
    return { ok: false, error: `This iPad already has ${OUTBOX_MAX_PENDING} items waiting to send. Reconnect first.` };
  }
  const e: OutboxEntry = { ...entry, label: entry.label.slice(0, 160), createdAt: nowMs, attempts: 0, nextAt: nowMs };
  return { ok: true, box: { ...box, pending: [...box.pending, e] }, duplicate: false };
}

/** Entries due now, oldest first (one flush sends at most `limit`). */
export function dueOutboxEntries(box: Outbox, nowMs: number, limit = 10): OutboxEntry[] {
  return box.pending.filter((p) => p.nextAt <= nowMs).slice(0, limit);
}

export function outboxBackoffMs(attempts: number): number {
  return Math.min(OUTBOX_BACKOFF_MAX_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export type OutboxAttempt =
  | { kind: "delivered" }
  | { kind: "refused"; status: number; reason: string }
  | { kind: "retry"; reason: string };

/** Classify one delivery attempt (the shell does the fetch). */
export function classifyOutboxAttempt(input: { threw: boolean; status: number | null; error?: string | null }): OutboxAttempt {
  if (input.threw || input.status === null) return { kind: "retry", reason: "network" };
  if (input.status >= 200 && input.status < 300) return { kind: "delivered" };
  if (input.status >= 500 || input.status === 429 || input.status === 408) return { kind: "retry", reason: `server ${input.status}` };
  return { kind: "refused", status: input.status, reason: (input.error ?? `The server refused it (${input.status}).`).slice(0, 300) };
}

/** Apply the result of one attempt to the outbox. */
export function settleOutboxEntry(box: Outbox, id: string, result: OutboxAttempt, nowMs: number): Outbox {
  const e = box.pending.find((p) => p.id === id);
  if (!e) return box;
  const rest = box.pending.filter((p) => p.id !== id);
  const fail = (reason: string): Outbox => ({
    v: OUTBOX_VERSION,
    pending: rest,
    failed: [{ id: e.id, kind: e.kind, label: e.label, reason, at: nowMs }, ...box.failed].slice(0, OUTBOX_MAX_FAILED),
  });
  if (result.kind === "delivered") return { ...box, pending: rest };
  if (result.kind === "refused") return fail(result.reason);
  if (nowMs - e.createdAt > OUTBOX_GIVE_UP_AFTER_MS) return fail("Could not be sent for 7 days; given up. Do it again from the back office.");
  const attempts = e.attempts + 1;
  return { ...box, pending: box.pending.map((p) => (p.id === id ? { ...p, attempts, nextAt: nowMs + outboxBackoffMs(attempts) } : p)) };
}

export function dismissOutboxFailed(box: Outbox, id: string): Outbox {
  return { ...box, failed: box.failed.filter((f) => f.id !== id) };
}

/** The register's one-line status, or null when there is nothing to say. */
export function outboxStatusLine(box: Outbox): string | null {
  const p = box.pending.length;
  const f = box.failed.length;
  if (!p && !f) return null;
  const parts: string[] = [];
  if (p) parts.push(`${p} waiting to send (stock flags, emailed receipts)`);
  if (f) parts.push(`${f} could not be sent`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runDeferredOutboxCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`deferred-outbox-core FAIL: ${label}`);
    }
  };
  const now = 1_800_000_000_000;
  ok(parseOutbox(null).pending.length === 0 && parseOutbox("x{").pending.length === 0, "unreadable -> empty");
  ok(parseOutbox(JSON.stringify({ v: 2, pending: [] })).pending.length === 0, "wrong version -> empty");

  const a = addToOutbox(emptyOutbox(), { id: "1", kind: "stock_flag", body: { productId: "p1", reason: "not_found" }, label: "Out of stock: A" }, now);
  ok(a.ok && a.box.pending.length === 1 && !a.duplicate, "add");
  if (!a.ok) return { passed, failed: failed + 1 };
  const dup = addToOutbox(a.box, { id: "2", kind: "stock_flag", body: { productId: "p1", reason: "damaged" }, label: "x" }, now);
  ok(dup.ok && dup.duplicate && dup.box.pending.length === 1, "same product flag not added twice");
  const b = addToOutbox(a.box, { id: "3", kind: "email_receipt", body: { email: "a@b.co", receipt: {} }, label: "Receipt to a@b.co" }, now + 1);
  ok(b.ok && b.box.pending.length === 2, "email added");
  if (!b.ok) return { passed, failed: failed + 1 };
  const round = parseOutbox(JSON.stringify(b.box));
  ok(round.pending.length === 2 && round.pending[1].kind === "email_receipt", "round trip");
  ok(parseOutbox(JSON.stringify({ v: 1, pending: [{ id: "z", kind: "void", body: {}, createdAt: 1, attempts: 0, nextAt: 1 }], failed: [] })).pending.length === 0, "unknown kind dropped (money never rides this outbox)");

  const full: Outbox = { v: 1, pending: Array.from({ length: OUTBOX_MAX_PENDING }, (_, i) => ({ id: `f${i}`, kind: "email_receipt" as const, body: {}, label: "", createdAt: now, attempts: 0, nextAt: now })), failed: [] };
  const over = addToOutbox(full, { id: "n", kind: "email_receipt", body: {}, label: "" }, now);
  ok(!over.ok && /already has 200/.test(over.ok ? "" : over.error), "full outbox refuses plainly");

  ok(dueOutboxEntries(b.box, now).length === 1 && dueOutboxEntries(b.box, now + 1).length === 2, "due oldest first");

  ok(classifyOutboxAttempt({ threw: true, status: null }).kind === "retry", "throw retries");
  ok(classifyOutboxAttempt({ threw: false, status: 503 }).kind === "retry", "5xx retries");
  ok(classifyOutboxAttempt({ threw: false, status: 429 }).kind === "retry", "429 retries");
  ok(classifyOutboxAttempt({ threw: false, status: 200 }).kind === "delivered", "2xx delivered");
  const r404 = classifyOutboxAttempt({ threw: false, status: 404, error: "Item not found" });
  ok(r404.kind === "refused" && r404.reason === "Item not found", "4xx refused with the server reason");

  let box = settleOutboxEntry(b.box, "1", { kind: "retry", reason: "network" }, now + 10);
  ok(box.pending[0].attempts === 1 && box.pending[0].nextAt === now + 10 + OUTBOX_BACKOFF_BASE_MS, "backoff 30 s");
  ok(outboxBackoffMs(20) === OUTBOX_BACKOFF_MAX_MS, "backoff capped");
  box = settleOutboxEntry(box, "1", { kind: "delivered" }, now + 20);
  ok(box.pending.length === 1 && box.pending[0].id === "3", "delivered removed");
  box = settleOutboxEntry(box, "3", r404, now + 30);
  ok(box.pending.length === 0 && box.failed.length === 1 && box.failed[0].reason === "Item not found", "refused goes to failed, kept visible");
  ok(outboxStatusLine(box) === "1 could not be sent", "status line");
  ok(outboxStatusLine(emptyOutbox()) === null, "quiet when empty");
  ok(dismissOutboxFailed(box, "3").failed.length === 0, "dismiss");

  const old = addToOutbox(emptyOutbox(), { id: "o", kind: "stock_flag", body: { productId: "q" }, label: "Q" }, now);
  if (old.ok) {
    const gone = settleOutboxEntry(old.box, "o", { kind: "retry", reason: "network" }, now + OUTBOX_GIVE_UP_AFTER_MS + 1);
    ok(gone.pending.length === 0 && /7 days/.test(gone.failed[0]?.reason ?? ""), "gives up after 7 days, visibly");
  }
  // D170 O9: an offline Fix & sell rides the outbox to /api/pos/fix-and-sell.
  ok(OUTBOX_ENDPOINT.fix_and_sell === "/api/pos/fix-and-sell", "fix & sell posts to the fix-and-sell route");
  const fx = addToOutbox(emptyOutbox(), { id: "fx1", kind: "fix_and_sell", body: { code: "ABC123", employeeName: "Sam" }, label: "Fix & sell: A" }, now);
  ok(fx.ok && fx.box.pending.length === 1 && !fx.duplicate, "a fix & sell is queued");
  if (fx.ok) {
    const fxDup = addToOutbox(fx.box, { id: "fx2", kind: "fix_and_sell", body: { code: "abc123", employeeName: "Sam" }, label: "x" }, now);
    ok(fxDup.ok && fxDup.duplicate && fxDup.box.pending.length === 1, "the same package code is not queued twice (any case)");
    ok(parseOutbox(JSON.stringify(fx.box)).pending[0]?.kind === "fix_and_sell", "a queued fix & sell survives a round trip");
  }
  return { passed, failed };
}
