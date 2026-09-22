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
  /**
   * SLICE L-19 — WHY it was skipped. Required on every skip.
   *
   * "skipped" used to be one undifferentiated word covering five situations,
   * one of which (the provider being unconfigured) is a genuine fault and one
   * of which (a Leafly order) is a contractual REQUIREMENT. Because this
   * module treats skips as quiet, the fault was invisible: the owner placed a
   * real order, got no confirmation, and nothing anywhere said why.
   *
   * The type is `SkipReason` from `email-readiness-core.ts`, but it is spelled
   * as a plain string union here rather than imported, because this module is
   * depended on by the Leafly order contract core and adding an import would
   * couple two pure modules for no benefit. The compliance test asserts the
   * two lists are identical, so a drift fails CI.
   */
  skipReason?:
    | "provider_unconfigured"
    | "marketplace_origin"
    | "no_customer_address"
    | "no_staff_addresses"
    | "not_permitted";
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

/**
 * SLICE L-19 — the skip reasons that mean something is BROKEN.
 *
 * Deliberately a short, explicit list rather than "anything not on the safe
 * list", so that a reason added in future is quiet until somebody decides it
 * should not be. A new warning appearing by default is how alert fatigue
 * starts, and alert fatigue is what makes the real warning worthless.
 *
 * The authority for this classification is `email-readiness-core.ts`; the
 * compliance test asserts the two agree, so they cannot drift apart.
 */
const FAULT_SKIP_REASONS = ["provider_unconfigured", "no_staff_addresses"] as const;

function isFaultSkip(o: EmailSendOutcome): boolean {
  return (
    o.status === "skipped" &&
    (FAULT_SKIP_REASONS as readonly string[]).includes(o.skipReason ?? "")
  );
}

export function summarizeNotifyOutcomes(
  orderNumber: string,
  outcomes: EmailSendOutcome[],
): NotifySummary {
  const failures = outcomes.filter((o) => o.status === "failed");
  const sent = outcomes.filter((o) => o.status === "sent");

  if (failures.length === 0) {
    // SLICE L-19 — before deciding this was a quiet success, check whether the
    // silence was a FAULT. A skip with reason `provider_unconfigured` means no
    // email is going out at all; that used to look identical to a Leafly order,
    // where not emailing is contractually required. It no longer does.
    const faultSkips = outcomes.filter(isFaultSkip);
    if (faultSkips.length > 0) {
      const reasons = [...new Set(faultSkips.map((o) => o.skipReason))];
      const unconfigured = reasons.includes("provider_unconfigured");
      const note = unconfigured
        ? "⚠️ No confirmation email was sent for this order — the email provider is not " +
          "configured, so customers receive no confirmation and staff receive no alert. " +
          "Set BOTH RESEND_API_KEY and ORDER_EMAIL_FROM, then redeploy (one without the " +
          "other sends nothing). Treat this page as the only record of this order."
        : "⚠️ No staff alert email was sent for this order — no staff addresses are " +
          "configured. Set ORDER_STAFF_EMAILS so the team is told when an order arrives. " +
          "Treat this page as the only alert.";
      return {
        ok: false,
        // Not failures: nothing was attempted. The distinction matters to
        // anyone reading this object, so the list stays honest and the
        // NOTE is what carries the warning.
        failures: [],
        logLine: `[orders/notify] ${orderNumber}: NO EMAIL SENT — ${reasons.join(", ")}`,
        orderEventNote: note,
      };
    }

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

  // SLICE L-19 — this case REVERSED, on purpose.
  //
  // It used to assert "all skipped → silent, ok", and that assertion was the
  // bug wearing a green tick. The owner placed a real order, the provider was
  // unconfigured, both emails were skipped, and this module called it a quiet
  // success — so nothing was logged, nothing reached the timeline, and nothing
  // appeared on screen. The test passed. The customer got no email.
  {
    const s = summarizeNotifyOutcomes("GW-1", [
      { audience: "customer", status: "skipped", skipReason: "provider_unconfigured" },
      { audience: "staff", status: "skipped", skipReason: "provider_unconfigured" },
    ]);
    ok(!s.ok, "an unconfigured provider is NOT ok");
    ok(!!s.orderEventNote && s.orderEventNote.includes("not"), "unconfigured → timeline note");
    ok(!!s.orderEventNote && s.orderEventNote.includes("RESEND_API_KEY"), "note names the fix");
    ok(!!s.orderEventNote && s.orderEventNote.includes("ORDER_EMAIL_FROM"), "note names BOTH vars");
    ok(!!s.logLine && s.logLine.includes("NO EMAIL SENT"), "unconfigured → log line");
    ok(s.failures.length === 0, "nothing attempted is not a 'failure'");
  }

  // ...and the case it must NOT be confused with. A Leafly order skips the
  // customer email because Leafly is the sole originator of consumer order
  // communications. That is a contractual REQUIREMENT, and warning about it on
  // every marketplace order would teach staff to ignore the warning that
  // matters. This must stay completely silent.
  {
    const s = summarizeNotifyOutcomes("GW-1L", [
      { audience: "customer", status: "skipped", skipReason: "marketplace_origin" },
      { audience: "staff", status: "sent" },
    ]);
    ok(s.ok, "a Leafly order is still ok");
    ok(s.orderEventNote === null, "a Leafly order writes NO timeline note");
    ok(!!s.logLine && s.logLine.includes("staff"), "the staff send is still logged");
  }

  // A missing customer address is normal, not a fault.
  {
    const s = summarizeNotifyOutcomes("GW-1N", [
      { audience: "customer", status: "skipped", skipReason: "no_customer_address" },
      { audience: "staff", status: "sent" },
    ]);
    ok(s.ok && s.orderEventNote === null, "no address on file → silent, ok");
  }

  // No staff addresses IS a fault: an order arrives and the shop never hears.
  {
    const s = summarizeNotifyOutcomes("GW-1S", [
      { audience: "customer", status: "sent" },
      { audience: "staff", status: "skipped", skipReason: "no_staff_addresses" },
    ]);
    ok(!s.ok, "no staff addresses is not ok");
    ok(!!s.orderEventNote && s.orderEventNote.includes("ORDER_STAFF_EMAILS"), "note names the fix");
    ok(
      !!s.orderEventNote && !s.orderEventNote.includes("RESEND_API_KEY"),
      "...and does not blame the provider, which is working",
    );
  }

  // A skip with no reason at all stays quiet. Backwards compatible on purpose:
  // an unlabelled skip is not evidence of a fault, and inventing one would put
  // a warning on orders where nothing is wrong.
  {
    const s = summarizeNotifyOutcomes("GW-1U", [
      { audience: "customer", status: "skipped" },
      { audience: "staff", status: "skipped" },
    ]);
    ok(s.ok && s.orderEventNote === null, "an unlabelled skip stays quiet");
  }

  // A real failure still outranks a fault-skip: something was attempted and
  // broke, which is the more urgent and more specific diagnosis.
  {
    const s = summarizeNotifyOutcomes("GW-1F", [
      { audience: "customer", status: "skipped", skipReason: "no_staff_addresses" },
      { audience: "staff", status: "failed", detail: "HTTP 401" },
    ]);
    ok(!s.ok && s.failures.length === 1, "a real failure is still reported as a failure");
    ok(!!s.orderEventNote && s.orderEventNote.includes("FAILED"), "the failure note wins");
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
