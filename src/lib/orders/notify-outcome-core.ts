/**
 * src/lib/orders/notify-outcome-core.ts  (GW-024 / GW-025 fix)
 *
 * PURE logic for what happens AFTER the order-placed notification emails are
 * attempted. The senders used to be a black box: `.catch(() => {})` at every
 * layer, no `res.ok` check on the Resend call — a bad API key, an unverified
 * from-address, or a rate limit looked exactly like success, forever.
 *
 * This module turns each send attempt into a structured outcome and decides:
 *   - the single log line for the Vercel function logs (diagnosable at 2am),
 *   - whether the order's back-office timeline should carry a visible
 *     warning note (staff alert failed = a pickup order nobody heard about,
 *     so the timeline itself must say so the next time anyone opens it).
 *
 * Deliberately conservative: "skipped" (not configured / no customer email)
 * is a normal, quiet state — only real FAILURES make noise.
 */

export type EmailAudience = "customer" | "staff";

export type EmailSendOutcome = {
  audience: EmailAudience;
  status: "sent" | "failed" | "skipped";
  /** For failures: HTTP status + a short response snippet, or the throw. */
  detail?: string;
};

export type NotifySummary = {
  /** True when nothing failed (all sent and/or legitimately skipped). */
  ok: boolean;
  /** Outcomes that actually failed (never includes skips). */
  failures: EmailSendOutcome[];
  /** One log line for the function logs; null when there is nothing to say. */
  logLine: string | null;
  /**
   * A human-readable warning for the order's back-office timeline, or null
   * when no note is warranted. Only a FAILED send earns a note — and a
   * failed STAFF alert leads, because that is the one that strands a
   * customer at the counter.
   */
  orderEventNote: string | null;
};

/** Compact “status + first bytes of the body” detail for a failed send. */
export function describeSendFailure(httpStatus: number, body: string): string {
  const snippet = (body ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  return `HTTP ${httpStatus}${snippet ? ` — ${snippet}` : ""}`;
}

export function summarizeNotifyOutcomes(
  orderNumber: string,
  outcomes: EmailSendOutcome[],
): NotifySummary {
  const failures = outcomes.filter((o) => o.status === "failed");
  const sent = outcomes.filter((o) => o.status === "sent");

  if (failures.length === 0) {
    return {
      ok: true,
      failures: [],
      logLine:
        sent.length > 0
          ? `[orders/notify] ${orderNumber}: ${sent.map((s) => s.audience).join(" + ")} email accepted by provider`
          : null,
      orderEventNote: null,
    };
  }

  const parts = failures.map((f) => `${f.audience} (${f.detail ?? "unknown error"})`);
  const logLine = `[orders/notify] ${orderNumber}: email FAILED for ${parts.join("; ")}`;

  const staffFailed = failures.some((f) => f.audience === "staff");
  const customerFailed = failures.some((f) => f.audience === "customer");
  let orderEventNote: string;
  if (staffFailed && customerFailed) {
    orderEventNote =
      "⚠️ Notification emails FAILED (staff alert AND customer confirmation). " +
      "Nobody was emailed about this order — treat this page as the only alert. " +
      "Check RESEND_API_KEY / ORDER_EMAIL_FROM / ORDER_STAFF_EMAILS if this repeats.";
  } else if (staffFailed) {
    orderEventNote =
      "⚠️ The staff new-order alert email FAILED to send — nobody was emailed about " +
      "this order. Treat this page as the only alert. Check the email settings " +
      "(RESEND_API_KEY / ORDER_STAFF_EMAILS) if this repeats.";
  } else {
    orderEventNote =
      "⚠️ The customer's confirmation email FAILED to send (the staff alert went out). " +
      "The customer has no email receipt — mention it at pickup. Check the email " +
      "settings if this repeats.";
  }

  return { ok: false, failures, logLine, orderEventNote };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runNotifyOutcomeCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // All quiet: everything skipped (provider not configured) → no noise.
  {
    const s = summarizeNotifyOutcomes("GW-1", [
      { audience: "customer", status: "skipped" },
      { audience: "staff", status: "skipped" },
    ]);
    ok(s.ok && s.logLine === null && s.orderEventNote === null, "all skipped → silent, ok");
  }

  // Happy path: sends log one confirmation line, no timeline note.
  {
    const s = summarizeNotifyOutcomes("GW-2", [
      { audience: "customer", status: "sent" },
      { audience: "staff", status: "sent" },
    ]);
    ok(s.ok && s.orderEventNote === null, "all sent → ok, no note");
    ok(!!s.logLine && s.logLine.includes("customer + staff"), "sent log names both audiences");
  }

  // Staff failure → loudest note (customer at the counter risk).
  {
    const s = summarizeNotifyOutcomes("GW-3", [
      { audience: "customer", status: "sent" },
      { audience: "staff", status: "failed", detail: "HTTP 401 — invalid api key" },
    ]);
    ok(!s.ok && s.failures.length === 1, "staff failure → not ok");
    ok(!!s.logLine && s.logLine.includes("FAILED") && s.logLine.includes("401"), "log carries the detail");
    ok(!!s.orderEventNote && s.orderEventNote.includes("staff new-order alert"), "note names the staff alert");
    ok(!!s.orderEventNote && s.orderEventNote.includes("only alert"), "note tells staff this page is the alert");
  }

  // Customer-only failure → softer note, mentions pickup.
  {
    const s = summarizeNotifyOutcomes("GW-4", [
      { audience: "customer", status: "failed", detail: "HTTP 422 — from not verified" },
      { audience: "staff", status: "sent" },
    ]);
    ok(!s.ok && !!s.orderEventNote && s.orderEventNote.includes("mention it at pickup"), "customer-failure note");
    ok(!!s.orderEventNote && s.orderEventNote.includes("staff alert went out"), "note says staff was alerted");
  }

  // Both failed → the everything-failed note.
  {
    const s = summarizeNotifyOutcomes("GW-5", [
      { audience: "customer", status: "failed", detail: "HTTP 429" },
      { audience: "staff", status: "failed", detail: "HTTP 429" },
    ]);
    ok(!s.ok && !!s.orderEventNote && s.orderEventNote.includes("staff alert AND customer confirmation"), "both-failed note");
    ok(!!s.orderEventNote && s.orderEventNote.includes("Nobody was emailed"), "both-failed note is blunt");
  }

  // Failure + skip: the skip stays out of the failure list.
  {
    const s = summarizeNotifyOutcomes("GW-6", [
      { audience: "customer", status: "skipped" },
      { audience: "staff", status: "failed", detail: "HTTP 500" },
    ]);
    ok(s.failures.length === 1 && s.failures[0].audience === "staff", "skips never counted as failures");
  }

  // describeSendFailure: compact, whitespace-collapsed, capped.
  ok(describeSendFailure(401, '{"message":"API key is invalid"}').startsWith("HTTP 401 — "), "failure detail shape");
  ok(describeSendFailure(500, "") === "HTTP 500", "empty body → status only");
  ok(describeSendFailure(422, "x\n\n  y").includes("x y"), "whitespace collapsed");
  ok(describeSendFailure(400, "a".repeat(500)).length < 220, "detail capped");

  console.log(`notify-outcome-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`notify-outcome-core self-tests: ${fail} failure(s)`);
}
