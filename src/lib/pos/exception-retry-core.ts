/**
 * src/lib/pos/exception-retry-core.ts  (D178 · S1 "Sales always land")
 *
 * Owner: "if product left the shop and money was given to me in exchange,
 * there can be no manual exceptions." / "For the two sales that already
 * happened, they can be recorded as rung."
 *
 * PURE decisions behind making a register sale land even after it fell into
 * the Exceptions queue:
 *
 *   1. lineLoyaltyMinor / lineUnitGrams — every order_lines row carries the
 *      SAME keys. PostgREST bulk-inserts with the union of the rows' keys and
 *      sends NULL for a key a row lacks, so a key spread onto only SOME lines
 *      nulls it on the rest (the root cause of the stuck $40.90 loyalty sale:
 *      loyalty_discount_minor_units is NOT NULL DEFAULT 0).
 *
 *   2. classifyExceptionReason — what kind of exception is this, in plain
 *      English, and what may be done about it:
 *        system_fault  — our code or the network failed. Nobody did anything
 *                        wrong. Retried AUTOMATICALLY by the cron, and any
 *                        manager may press "Retry this sale".
 *        receipt_drift — the register charged what it charged from a menu
 *                        that changed underneath it (a discount rate, a
 *                        program switched off). The receipt is the truth:
 *                        the OWNER (or an admin) may press "Record as rung".
 *        legal_block   — the law says no (sales hours, recall, expired
 *                        edible, purchase limits, high-THC, medical card,
 *                        under-age). Never forced by software. Re-ring or
 *                        cancel; the exception stays for the record.
 *        needs_review  — anything else (a code already used, a drawer that
 *                        does not match, an order already built). A human
 *                        decides; retry is allowed for the owner.
 *
 *   3. specialRateVerdict — the "receipt is truth" rule for a special
 *      discount whose saved rate changed between the ring and the sync.
 *      A LOWER applied rate (the customer got LESS off than allowed — no
 *      money lost) is recorded as rung automatically, with an audit flag.
 *      A HIGHER applied rate (more off than the owner allows) is only
 *      recorded when the owner accepts it — the fraud-triangle guard, since
 *      every employee is a manager type.
 *
 *   4. retryDecision — may THIS row be retried by THIS kind of actor now.
 *
 *   5. replayCompletedAtIso — a replayed sale is dated when the money moved
 *      (the register's occurredAt), never the day someone pressed Retry, so
 *      CCRS SaleDate, the excise return and the books land on the right day.
 */

// ---------------------------------------------------------------------------
// 1. Uniform line keys
// ---------------------------------------------------------------------------

/** Per-unit loyalty reduction for one line; always a non-negative integer. */
export function lineLoyaltyMinor(hasRedemption: boolean, perUnit: number | null | undefined): number {
  if (!hasRedemption) return 0;
  if (typeof perUnit !== "number" || !Number.isFinite(perUnit) || perUnit <= 0) return 0;
  return Math.round(perUnit);
}

/** Per-unit grams for one line; null when unknown (never undefined). */
export function lineUnitGrams(grams: number | null | undefined): number | null {
  return typeof grams === "number" && Number.isFinite(grams) && grams > 0 ? grams : null;
}

/** True when every row has exactly the same key set (PostgREST bulk-safe). */
export function uniformLineKeys(rows: Record<string, unknown>[]): boolean {
  if (rows.length < 2) return true;
  const first = Object.keys(rows[0]).sort().join("|");
  return rows.every((r) => Object.keys(r).sort().join("|") === first);
}

// ---------------------------------------------------------------------------
// 2. Exception classification
// ---------------------------------------------------------------------------

export type ExceptionKind = "system_fault" | "receipt_drift" | "legal_block" | "needs_review";

export type ExceptionClass = {
  kind: ExceptionKind;
  /** One plain-English sentence for the Exceptions page. */
  plain: string;
  /** The cron may retry it without a person. */
  autoRetry: boolean;
  /** Any manager may press "Retry this sale". */
  managerRetry: boolean;
  /** The owner/admin may press "Record as rung" (accept the receipt). */
  ownerRecordAsRung: boolean;
};

const LEGAL_PATTERNS: RegExp[] = [
  /outside sales hours/i,
  /recall/i,
  /expired/i,
  /purchase limit|sales limit|over the limit|exceeds? .*limit|WAC 314-55-095/i,
  /high-THC|DOH/i,
  /under 21|underage|under-age|age verif/i,
  /recognition card .*(expired|invalid|not valid)|medical (card|authorization) .*(expired|invalid|not valid)/i,
];

const SYSTEM_FAULT_PATTERNS: RegExp[] = [
  /^Order lines insert failed/i,
  /^Order insert failed/i,
  /lookup failed/i,
  /could not be read|read failed/i,
  /fetch failed|network|timed? ?out|ECONNRESET|ETIMEDOUT|socket hang up|503|502|504/i,
  /^Unexpected processing error/i,
  /status write failed/i,
];

const DRIFT_PATTERNS: RegExp[] = [/discount rate changed/i, /discount program is turned OFF/i];

/** Parse "register applied 1500 bps; the saved rate is 2000 bps". */
export function parseRateDrift(reason: string): { appliedBps: number; savedBps: number } | null {
  const m = /applied (\d+) bps; the saved rate is (\d+) bps/i.exec(reason);
  if (!m) return null;
  return { appliedBps: Number(m[1]), savedBps: Number(m[2]) };
}

export function classifyExceptionReason(
  reason: string | null | undefined,
  ctx: { eventType: string; orderId: string | null } = { eventType: "sale", orderId: null },
): ExceptionClass {
  const r = (reason ?? "").trim();
  // An order already exists: finishing it blind could double-count. A person
  // completes or cancels the order itself; Retry would only trip the guard.
  if (ctx.orderId) {
    const legal = LEGAL_PATTERNS.some((p) => p.test(r));
    return {
      kind: legal ? "legal_block" : "needs_review",
      plain: legal
        ? "The law refused this sale after it was built. It cannot be forced. Re-ring it the legal way or cancel the order."
        : "An order was already built for this sale. Open the order, check it against the receipt, then complete or cancel it there.",
      autoRetry: false,
      managerRetry: false,
      ownerRecordAsRung: false,
    };
  }
  if (LEGAL_PATTERNS.some((p) => p.test(r))) {
    return {
      kind: "legal_block",
      plain: "The law says no to this sale. Software will never force it. Re-ring it the legal way, then mark this reviewed.",
      autoRetry: false,
      managerRetry: false,
      ownerRecordAsRung: false,
    };
  }
  if (DRIFT_PATTERNS.some((p) => p.test(r))) {
    const drift = parseRateDrift(r);
    const lower = drift ? drift.appliedBps <= drift.savedBps : false;
    return {
      kind: "receipt_drift",
      plain: lower
        ? "The register gave a smaller discount than today's setting. The customer paid; the receipt is the truth. This is recorded as rung automatically."
        : "The register used a discount setting that has since changed. The customer paid what the receipt says. Only the owner can record it as rung.",
      autoRetry: lower,
      managerRetry: lower,
      ownerRecordAsRung: true,
    };
  }
  if (SYSTEM_FAULT_PATTERNS.some((p) => p.test(r))) {
    return {
      kind: "system_fault",
      plain: "The system tripped, not your staff. It retries by itself; you can also press Retry this sale.",
      autoRetry: ctx.eventType === "sale" || ctx.eventType === "reversal" || ctx.eventType === "till_action",
      managerRetry: true,
      ownerRecordAsRung: false,
    };
  }
  return {
    kind: "needs_review",
    plain: "A person needs to look at this one. Read the reason, fix the cause, then retry or mark it reviewed.",
    autoRetry: false,
    managerRetry: false,
    ownerRecordAsRung: ctx.eventType === "sale",
  };
}

// ---------------------------------------------------------------------------
// 3. Special-discount rate drift — "the receipt is the truth"
// ---------------------------------------------------------------------------

export type RateVerdict =
  | { kind: "match" }
  | { kind: "as_rung"; appliedBps: number; savedBps: number; why: "lower_than_saved" | "owner_accepted" }
  | { kind: "refuse"; appliedBps: number; savedBps: number };

export function specialRateVerdict(appliedBps: number, savedBps: number, ownerAccepted: boolean): RateVerdict {
  if (appliedBps === savedBps) return { kind: "match" };
  if (appliedBps < savedBps) return { kind: "as_rung", appliedBps, savedBps, why: "lower_than_saved" };
  if (ownerAccepted) return { kind: "as_rung", appliedBps, savedBps, why: "owner_accepted" };
  return { kind: "refuse", appliedBps, savedBps };
}

// ---------------------------------------------------------------------------
// 4. Retry decision
// ---------------------------------------------------------------------------

export const AUTO_RETRY_MAX_ATTEMPTS = 6;
export const AUTO_RETRY_BATCH_LIMIT = 10;

export type RetryMode = "retry" | "record_as_rung";
export type RetryActor = "cron" | "manager" | "owner";

export type RetryRowInput = {
  status: string;
  eventType: string;
  orderId: string | null;
  exceptionReason: string | null;
  resolvedAt: string | null;
  recoveryAttempts: number;
};

export type RetryDecision = { ok: true; cls: ExceptionClass } | { ok: false; reason: string };

export function retryDecision(row: RetryRowInput, mode: RetryMode, actor: RetryActor): RetryDecision {
  if (row.status !== "exception") {
    return { ok: false, reason: row.status === "processed" ? "This sale is already recorded." : "This event is still being processed. Wait a minute and reload." };
  }
  const cls = classifyExceptionReason(row.exceptionReason, { eventType: row.eventType, orderId: row.orderId });
  if (row.orderId) return { ok: false, reason: cls.plain };
  if (cls.kind === "legal_block") return { ok: false, reason: cls.plain };
  if (actor === "cron") {
    if (mode !== "retry") return { ok: false, reason: "The automatic retry never records a sale as rung." };
    if (row.resolvedAt) return { ok: false, reason: "Already reviewed by a person." };
    if (!cls.autoRetry) return { ok: false, reason: "Not an automatic-retry kind." };
    if (row.recoveryAttempts >= AUTO_RETRY_MAX_ATTEMPTS) {
      return { ok: false, reason: `Tried ${row.recoveryAttempts} times automatically. A person needs to press Retry.` };
    }
    return { ok: true, cls };
  }
  if (mode === "record_as_rung") {
    if (actor !== "owner") return { ok: false, reason: "Only the owner or an admin can record a sale as rung." };
    if (row.eventType !== "sale") return { ok: false, reason: "Only a register sale can be recorded as rung." };
    return { ok: true, cls };
  }
  // mode === "retry" by a person
  if (actor === "owner") return { ok: true, cls };
  if (!cls.managerRetry) {
    return { ok: false, reason: "This kind needs the owner. Ask Michael to look at it." };
  }
  return { ok: true, cls };
}

// ---------------------------------------------------------------------------
// 5. The date a replayed sale is filed under
// ---------------------------------------------------------------------------

/**
 * completed_at for a register sale: when the money moved. A timestamp in the
 * future (the drift check allows a small tolerance) or one that does not
 * parse falls back to now, so the row is never dated after it was written.
 */
export function replayCompletedAtIso(occurredAtIso: string, nowMs: number): string {
  const t = Date.parse(occurredAtIso);
  if (!Number.isFinite(t) || t > nowMs) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runExceptionRetryTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`exception-retry-core: ${m}`);
    n += 1;
  };

  // 1. uniform keys
  ok(lineLoyaltyMinor(false, 300) === 0, "no redemption → 0");
  ok(lineLoyaltyMinor(true, undefined) === 0, "redemption, undiscounted line → 0 (never null)");
  ok(lineLoyaltyMinor(true, 300) === 300, "redemption line keeps its cut");
  ok(lineLoyaltyMinor(true, -5) === 0, "negative refused");
  ok(lineUnitGrams(3.5) === 3.5 && lineUnitGrams(undefined) === null && lineUnitGrams(0) === null, "grams null when unknown");
  const rows = [
    { a: 1, loyalty_discount_minor_units: lineLoyaltyMinor(true, 300) },
    { a: 2, loyalty_discount_minor_units: lineLoyaltyMinor(true, undefined) },
  ];
  ok(uniformLineKeys(rows), "mixed loyalty lines share keys");
  ok(!uniformLineKeys([{ a: 1, x: 1 }, { a: 2 }]), "the old spread shape is caught");

  // 2. classification
  const lines = classifyExceptionReason('Order lines insert failed: null value in column "loyalty_discount_minor_units"');
  ok(lines.kind === "system_fault" && lines.autoRetry && lines.managerRetry, "lines insert failure is a system fault");
  const vet = classifyExceptionReason(
    "The veteran discount rate changed (register applied 1500 bps; the saved rate is 2000 bps). Refresh the register's menu",
  );
  ok(vet.kind === "receipt_drift" && vet.autoRetry && vet.ownerRecordAsRung, "lower veteran rate auto-records as rung");
  const hi = classifyExceptionReason("The veteran discount rate changed (register applied 3000 bps; the saved rate is 2000 bps).");
  ok(hi.kind === "receipt_drift" && !hi.autoRetry && !hi.managerRetry && hi.ownerRecordAsRung, "higher rate needs the owner");
  const hours = classifyExceptionReason("Completion gate refused: Sale blocked outside sales hours.");
  ok(hours.kind === "legal_block" && !hours.autoRetry && !hours.ownerRecordAsRung, "hours never forced");
  ok(classifyExceptionReason("Sale blocked: recalled product").kind === "legal_block", "recall is legal");
  ok(classifyExceptionReason("Loyalty code ABC is redeemed — it was used").kind === "needs_review", "used code needs review");
  ok(
    classifyExceptionReason("Order lines insert failed", { eventType: "sale", orderId: "o1" }).kind === "needs_review",
    "order exists → review",
  );
  ok(parseRateDrift("applied 1500 bps; the saved rate is 2000 bps")?.savedBps === 2000, "drift parse");
  ok(parseRateDrift("nothing") === null, "drift parse miss");

  // 3. rate verdict
  ok(specialRateVerdict(2000, 2000, false).kind === "match", "same rate");
  const lo = specialRateVerdict(1500, 2000, false);
  ok(lo.kind === "as_rung" && lo.why === "lower_than_saved", "lower → as rung");
  ok(specialRateVerdict(3000, 2000, false).kind === "refuse", "higher → refuse");
  const acc = specialRateVerdict(3000, 2000, true);
  ok(acc.kind === "as_rung" && acc.why === "owner_accepted", "higher + owner → as rung");

  // 4. retry decision
  const base: RetryRowInput = {
    status: "exception",
    eventType: "sale",
    orderId: null,
    exceptionReason: "Order lines insert failed: x",
    resolvedAt: null,
    recoveryAttempts: 0,
  };
  ok(retryDecision(base, "retry", "cron").ok, "cron retries a fault");
  ok(!retryDecision({ ...base, recoveryAttempts: AUTO_RETRY_MAX_ATTEMPTS }, "retry", "cron").ok, "cron stops at cap");
  ok(!retryDecision({ ...base, resolvedAt: "2026-11-02T00:00:00Z" }, "retry", "cron").ok, "cron leaves reviewed rows");
  ok(!retryDecision(base, "record_as_rung", "cron").ok, "cron never records as rung");
  ok(!retryDecision({ ...base, status: "processed" }, "retry", "owner").ok, "processed refused");
  ok(!retryDecision({ ...base, orderId: "o" }, "retry", "owner").ok, "order exists refused");
  const hiRow = { ...base, exceptionReason: "discount rate changed (register applied 3000 bps; the saved rate is 2000 bps)" };
  ok(!retryDecision(hiRow, "retry", "manager").ok, "manager cannot push a higher rate");
  ok(!retryDecision(hiRow, "record_as_rung", "manager").ok, "manager cannot record as rung");
  ok(retryDecision(hiRow, "record_as_rung", "owner").ok, "owner can record as rung");
  ok(
    retryDecision({ ...base, exceptionReason: "Sale blocked outside sales hours" }, "record_as_rung", "owner").ok === false,
    "owner cannot force the law",
  );
  ok(
    retryDecision({ ...base, resolvedAt: "2026-11-02T00:00:00Z", exceptionReason: hiRow.exceptionReason }, "record_as_rung", "owner").ok,
    "owner can record a reviewed-but-never-rung sale",
  );
  ok(!retryDecision({ ...base, eventType: "punch", exceptionReason: "odd" }, "record_as_rung", "owner").ok, "only sales record as rung");

  // 5. dating
  const now = Date.parse("2026-11-05T20:00:00Z");
  ok(replayCompletedAtIso("2026-11-02T18:49:20.559Z", now) === "2026-11-02T18:49:20.559Z", "replay keeps the sale time");
  ok(replayCompletedAtIso("2026-11-06T00:00:00Z", now) === new Date(now).toISOString(), "future clamps to now");
  ok(replayCompletedAtIso("garbage", now) === new Date(now).toISOString(), "garbage → now");
  return { passed: n, failed: 0 };
}
