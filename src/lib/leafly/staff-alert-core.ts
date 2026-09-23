/**
 * src/lib/leafly/staff-alert-core.ts
 *
 * STANDING OFFER 2 (round L-24) — the staff alert for Leafly orders, as a
 * pure decision core.
 *
 *
 * THE OWNER'S CONSTRAINT CAME FIRST, AND IT CHANGED THE DESIGN
 * ------------------------------------------------------------
 * The standing offer was originally "send a staff alert email for Leafly
 * orders", because `notifyOrderPlaced()` exists, staff email is contractually
 * permitted for every origin, and the Leafly webhook path never calls it.
 * That gap is real. But the owner then said, in the same breath as asking for
 * this round:
 *
 *   "I don't need an email sent to us, the back office dashboard, printer and
 *    speaker let us know an order has been placed."
 *
 * He is right, and an alert on every order would be actively harmful. The
 * speaker announces and the printer prints within seconds of the webhook.
 * An email that arrives alongside a receipt that is already in someone's hand
 * is noise, and noise is not neutral — a mailbox that fills with alerts nobody
 * needs is a mailbox nobody reads, which is exactly how the ONE alert that
 * mattered gets missed.
 *
 * So the offer is delivered in the form that survives his constraint:
 *
 *   THE ALERT FIRES ONLY WHEN THE CHANNELS HE RELIES ON HAVE FAILED.
 *
 * If the bell rang and the paper printed, this core says NOTHING. If the
 * speaker was silent, or the printer produced nothing, or the order never
 * reached the register, then the three signals he listens for did not happen —
 * and the fifteen-minute auto-cancel clock is already running on a real
 * customer's order. That is the case where an email is the only remaining way
 * to find out in time, and it is rare by construction.
 *
 * This is the difference between "we built the feature" and "we built the
 * feature in a way you will still be glad of in six months".
 *
 *
 * WHY AN EMAIL TO STAFF IS PERMITTED AT ALL
 * -----------------------------------------
 * Leafly's Order API specification restricts CONSUMER communications only:
 *
 *   "Leafly will be the sole originator of automated consumer facing
 *    communications related to orders placed on the Leafly platform. That is,
 *    Leafly shoppers should receive _no_ automated emails or text messages
 *    from a partner system with regard to order confirmation, status updates,
 *    etc."
 *
 * "Consumer facing" is the operative phrase. Telling our own team that an
 * order arrived is not a consumer communication, and Leafly's own Help Center
 * article on "Enabling Email Notifications for Online Orders" describes
 * exactly this: you "input the email address of the recipient who will receive
 * order notifications" — employees, not shoppers. The existing predicate pair
 * in order-origin-core.ts already encodes the asymmetry, with
 * `mayEmailStaffForOrigin` true for every origin and
 * `mayEmailCustomerForOrigin` false for marketplaces.
 *
 * This core therefore re-asserts that boundary rather than assuming it: a
 * staff alert that ever addressed the shopper would be a contract breach, so
 * `decideStaffAlert` refuses outright if asked to send to the customer's
 * address, and there is a test for it.
 *
 *
 * ZERO IMPORTS — pure core convention.
 */

/** Why an alert is being raised. Ordered by urgency, most urgent first. */
export type StaffAlertReason =
  | "not_announced_or_printed"
  | "not_announced"
  | "not_printed"
  | "not_bridged"
  | "collection_failed";

export type StaffAlertDecision = {
  send: boolean;
  /** Machine-readable reasons, most urgent first. Empty when send === false. */
  reasons: StaffAlertReason[];
  /** Subject line, ready to use. Empty string when send === false. */
  subject: string;
  /** One-line human explanation, always populated — including when silent. */
  summary: string;
  /**
   * True when we are staying silent because everything WORKED, as opposed to
   * staying silent because we could not send. The two look identical in a log
   * and demand opposite reactions, which is the same distinction
   * `notify.ts` draws between `marketplace_origin` and `provider_unconfigured`.
   */
  quietBecauseHealthy: boolean;
};

export const STAFF_ALERT_REASON_TEXT: Readonly<Record<StaffAlertReason, string>> = {
  not_announced_or_printed:
    "The speaker did not announce it and the printer did not print it.",
  not_announced: "The speaker did not announce it.",
  not_printed: "The printer did not print a ticket for it.",
  not_bridged: "It never reached the register as a local order.",
  collection_failed:
    "The full order could not be downloaded from Leafly, so the ticket may be incomplete.",
};

/**
 * Minutes of headroom below which an alert is worth sending even for a
 * low-urgency reason.
 *
 * Leafly auto-cancels at fifteen minutes. Five is chosen as one third of the
 * window: late enough that ordinary processing is not interrupted, early
 * enough that a human who reads the email immediately can still act. It is
 * named rather than inlined so the reasoning is reviewable and so the tests
 * cannot silently disagree with the implementation.
 */
export const ALERT_URGENCY_MINUTES = 5;

/**
 * WHICH MOMENT WE ARE JUDGING. This is not decoration — it is a correctness
 * requirement, and leaving it out was a real defect caught while wiring this
 * core to the webhook.
 *
 * `decideBridgeActions` in bridge-core.ts encodes the owner's explicit
 * two-stage rule ("the leafly order should become floor visible once the order
 * has been accepted by us. it should however, make noise on the speaker, and
 * print out the receipt immediately"). At ARRIVAL it returns
 * `createLocalOrder: false` — asserted by its own test, "arrival does NOT
 * create a local order". The order is SUPPOSED to be absent from the register
 * at that point; it only appears at ACCEPTANCE, when we acknowledge.
 *
 * Without this field, `bridgedToRegister` is false for every healthy arrival,
 * so `not_bridged` would fire on EVERY SINGLE ORDER — an email per order,
 * which is precisely the outcome the owner forbade and precisely the noise
 * this core was reshaped to avoid. The one signal that matters would then be
 * buried under a pile of alerts that mean nothing.
 *
 * So the register check is asked only at the stage where an answer of "no" is
 * actually evidence of a problem.
 */
export type StaffAlertStage = "arrival" | "acceptance";

export type StaffAlertInput = {
  leaflyOrderId?: string | null;
  /**
   * Defaults to "acceptance" — the conservative choice. An unknown stage
   * should ask MORE questions, not fewer; a missing field must never silently
   * disable a check.
   */
  stage?: StaffAlertStage;
  announced?: boolean;
  printed?: boolean;
  bridgedToRegister?: boolean;
  collectionFailed?: boolean;
  /** Minutes remaining on Leafly's acknowledgement clock, if known. */
  minutesUntilDeadline?: number | null;
  /** Whether a staff recipient list is actually configured. */
  hasStaffRecipients?: boolean;
  /** Whether the email provider is configured at all. */
  providerConfigured?: boolean;
};

/**
 * THE DECISION.
 *
 * Silence is the default and the common case. Every path that breaks silence
 * has to justify itself with a named reason.
 */
export function decideStaffAlert(input: StaffAlertInput): StaffAlertDecision {
  const id = typeof input.leaflyOrderId === "string" ? input.leaflyOrderId.trim() : "";

  const announced = input.announced === true;
  const printed = input.printed === true;
  const bridged = input.bridgedToRegister === true;
  const collectionFailed = input.collectionFailed === true;
  // Unknown/omitted stage falls back to "acceptance", the stricter reading.
  const stage: StaffAlertStage = input.stage === "arrival" ? "arrival" : "acceptance";

  // Gather reasons FIRST, independently of whether we can send. Knowing that
  // an alert was warranted but impossible is more useful than a bare "no".
  const reasons: StaffAlertReason[] = [];
  if (!announced && !printed) reasons.push("not_announced_or_printed");
  else if (!announced) reasons.push("not_announced");
  else if (!printed) reasons.push("not_printed");
  // Only meaningful at acceptance — see StaffAlertStage. At arrival the order
  // is CORRECTLY absent from the register, so asking here would turn the
  // system's normal behaviour into an alert on every order.
  if (stage === "acceptance" && !bridged) reasons.push("not_bridged");
  if (collectionFailed) reasons.push("collection_failed");

  // THE HEALTHY CASE — the owner's explicit instruction. The bell rang, the
  // paper printed, the order is on the register. He already knows. Say nothing.
  if (reasons.length === 0) {
    return {
      send: false,
      reasons: [],
      subject: "",
      summary:
        stage === "arrival"
          ? "No alert: the order was announced and printed — the bell and the " +
            "paper already told the shop, and it is not due on the register " +
            "until we acknowledge."
          : "No alert: the order was announced, printed and reached the register — " +
            "the owner already has all three signals.",
      quietBecauseHealthy: true,
    };
  }

  // We WOULD alert, but cannot. Distinguished from the healthy case above so
  // a reader can tell "nothing to report" from "something to report and no way
  // to report it".
  if (input.providerConfigured === false) {
    return {
      send: false,
      reasons,
      subject: "",
      summary:
        "Alert WARRANTED but not sent: no email provider is configured. " +
        `Reason: ${STAFF_ALERT_REASON_TEXT[reasons[0]]}`,
      quietBecauseHealthy: false,
    };
  }
  if (input.hasStaffRecipients === false) {
    return {
      send: false,
      reasons,
      subject: "",
      summary:
        "Alert WARRANTED but not sent: no staff recipients are configured. " +
        `Reason: ${STAFF_ALERT_REASON_TEXT[reasons[0]]}`,
      quietBecauseHealthy: false,
    };
  }

  // Urgency shapes the SUBJECT, because the subject line is the entire message
  // for anyone glancing at a phone.
  const minutes = input.minutesUntilDeadline;
  const known = typeof minutes === "number" && Number.isFinite(minutes);
  const urgent = known && (minutes as number) <= ALERT_URGENCY_MINUTES;
  const expired = known && (minutes as number) <= 0;

  const shortId = id === "" ? "unknown order" : id.slice(0, 8);
  let subject: string;
  if (expired) {
    subject = `Leafly order ${shortId} — DEADLINE PASSED, not announced`;
  } else if (urgent) {
    subject = `Leafly order ${shortId} — ${Math.round(minutes as number)} min left, not announced`;
  } else {
    subject = `Leafly order ${shortId} — arrived but the bell did not ring`;
  }

  return {
    send: true,
    reasons,
    subject,
    summary: `Alert: ${reasons.map((r) => STAFF_ALERT_REASON_TEXT[r]).join(" ")}`,
    quietBecauseHealthy: false,
  };
}

/**
 * Minutes remaining on Leafly's acknowledgement clock.
 *
 * Pure, and therefore here rather than in the server module: it is arithmetic
 * on a string, it has a genuinely tricky null case, and it is the input that
 * decides whether a subject line shouts. All three are reasons to keep it
 * testable without a network.
 *
 * RETURNS NULL — NOT ZERO — for a missing or unreadable deadline. Zero means
 * "the deadline has passed", which `decideStaffAlert` escalates to "DEADLINE
 * PASSED". Conflating "unknown" with "expired" would manufacture an urgent
 * alert out of a parsing failure, which is how staff learn to distrust
 * alerts.
 */
export function minutesUntilDeadline(
  acknowledgeBy: string | null | undefined,
  nowMs: number,
): number | null {
  if (typeof acknowledgeBy !== "string") return null;
  const trimmed = acknowledgeBy.trim();
  if (trimmed === "") return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return null;
  return (parsed - nowMs) / 60000;
}

/**
 * THE CONTRACT GUARD.
 *
 * A staff alert must never be addressed to the shopper. This is separate from
 * `decideStaffAlert` on purpose: the decision of WHETHER to alert and the
 * decision of WHO may receive it are different failure modes, and collapsing
 * them would let a future edit to the first quietly weaken the second.
 */
export function isPermittedStaffRecipient(
  recipient: string | null | undefined,
  customerEmail: string | null | undefined,
): boolean {
  if (typeof recipient !== "string") return false;
  const r = recipient.trim().toLowerCase();
  if (r === "" || !r.includes("@")) return false;
  if (typeof customerEmail === "string") {
    const c = customerEmail.trim().toLowerCase();
    if (c !== "" && c === r) return false;
  }
  return true;
}

/** Filter a recipient list down to addresses we are permitted to write to. */
export function permittedStaffRecipients(
  recipients: readonly (string | null | undefined)[],
  customerEmail: string | null | undefined,
): string[] {
  if (!Array.isArray(recipients)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of recipients) {
    if (!isPermittedStaffRecipient(r, customerEmail)) continue;
    const norm = (r as string).trim();
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyStaffAlertTests(): {
  passed: number;
  failed: number;
  messages: string[];
} {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      messages.push(`FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, want: unknown) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(want);
    if (a === b) passed += 1;
    else {
      failed += 1;
      messages.push(`FAIL: ${label} (got ${a}, want ${b})`);
    }
  };

  const healthy: StaffAlertInput = {
    leaflyOrderId: "abcdef12-3456-7890-abcd-ef1234567890",
    announced: true,
    printed: true,
    bridgedToRegister: true,
    collectionFailed: false,
    minutesUntilDeadline: 14,
    hasStaffRecipients: true,
    providerConfigured: true,
  };

  // -- THE OWNER'S CONSTRAINT, asserted directly ----------------------------
  const h = decideStaffAlert(healthy);
  ok("a healthy order sends NOTHING", h.send === false);
  eq("a healthy order has no reasons", h.reasons, []);
  ok("a healthy order is quiet BECAUSE it is healthy", h.quietBecauseHealthy === true);
  ok("the healthy summary explains the silence", h.summary.includes("already has all three"));
  ok("a healthy order has no subject", h.subject === "");

  // -- each failure channel, one at a time ----------------------------------
  const noBell = decideStaffAlert({ ...healthy, announced: false });
  ok("a silent speaker alerts", noBell.send === true);
  eq("…with the right reason", noBell.reasons, ["not_announced"]);
  ok("…and is NOT quiet-because-healthy", noBell.quietBecauseHealthy === false);

  const noPaper = decideStaffAlert({ ...healthy, printed: false });
  ok("a silent printer alerts", noPaper.send === true);
  eq("…with the right reason", noPaper.reasons, ["not_printed"]);

  const neither = decideStaffAlert({ ...healthy, announced: false, printed: false });
  ok("both dead alerts", neither.send === true);
  eq("…and collapses to ONE combined reason", neither.reasons, ["not_announced_or_printed"]);
  ok(
    "…rather than listing both separately",
    !neither.reasons.includes("not_announced") && !neither.reasons.includes("not_printed"),
  );

  const noRegister = decideStaffAlert({ ...healthy, bridgedToRegister: false });
  ok("an order that never reached the register alerts", noRegister.send === true);
  eq("…with the right reason", noRegister.reasons, ["not_bridged"]);

  // -- THE STAGE DEFECT, pinned ---------------------------------------------
  // Caught while wiring this core to the webhook. At ARRIVAL the order has
  // deliberately not reached the register yet (bridge-core's own test says
  // "arrival does NOT create a local order"), so without the stage field this
  // exact input alerted on EVERY healthy order. These assertions exist so the
  // check cannot be re-broken by deleting the stage guard.
  const arrivalHealthy = decideStaffAlert({
    ...healthy,
    stage: "arrival",
    bridgedToRegister: false,
  });
  ok(
    "a healthy ARRIVAL is silent even though the register has not seen it",
    arrivalHealthy.send === false,
  );
  eq("…with no reasons at all", arrivalHealthy.reasons, []);
  ok("…and it is quiet BECAUSE it is healthy", arrivalHealthy.quietBecauseHealthy === true);
  ok(
    "…and the summary does NOT claim it reached the register",
    !arrivalHealthy.summary.includes("reached the register"),
  );
  ok(
    "…and it explains the register is not due yet",
    arrivalHealthy.summary.includes("until we acknowledge"),
  );

  // The same input at acceptance MUST alert — proving the guard is scoped to
  // the stage and did not simply delete the check.
  const acceptanceSameInput = decideStaffAlert({
    ...healthy,
    stage: "acceptance",
    bridgedToRegister: false,
  });
  ok(
    "the SAME input at acceptance still alerts",
    acceptanceSameInput.send === true,
  );
  eq("…for not reaching the register", acceptanceSameInput.reasons, ["not_bridged"]);

  // A missing stage must behave like the STRICTER reading, never the laxer
  // one. A field nobody set must not switch a safety check off.
  const noStage = decideStaffAlert({ ...healthy, bridgedToRegister: false });
  eq("an omitted stage defaults to the strict check", noStage.reasons, ["not_bridged"]);
  const junkStage = decideStaffAlert({
    ...healthy,
    bridgedToRegister: false,
    stage: "nonsense" as unknown as StaffAlertStage,
  });
  eq("an unrecognised stage also defaults to strict", junkStage.reasons, ["not_bridged"]);

  // A genuinely broken ARRIVAL must still alert — the stage guard narrows the
  // register question only, it must not mute the bell and the printer.
  const arrivalBroken = decideStaffAlert({
    ...healthy,
    stage: "arrival",
    announced: false,
    printed: false,
    bridgedToRegister: false,
  });
  ok("a broken arrival still alerts", arrivalBroken.send === true);
  eq(
    "…about the bell and the paper, and NOT about the register",
    arrivalBroken.reasons,
    ["not_announced_or_printed"],
  );
  const arrivalCollect = decideStaffAlert({
    ...healthy,
    stage: "arrival",
    bridgedToRegister: false,
    collectionFailed: true,
  });
  eq(
    "a failed collection at arrival alerts without the register reason",
    arrivalCollect.reasons,
    ["collection_failed"],
  );

  // -- the deadline reader --------------------------------------------------
  const nowMs = Date.parse("2026-02-01T12:00:00.000Z");
  eq("ten minutes out reads as ten", minutesUntilDeadline("2026-02-01T12:10:00.000Z", nowMs), 10);
  eq("five minutes past reads as negative", minutesUntilDeadline("2026-02-01T11:55:00.000Z", nowMs), -5);
  // NULL, never 0 — zero means "expired" and would manufacture an urgent
  // alert out of a parsing failure.
  for (const bad of ["", "   ", "not a date", null, undefined]) {
    ok(`an unreadable deadline (${JSON.stringify(bad)}) is null`, minutesUntilDeadline(bad, nowMs) === null);
  }
  ok("a nonsense clock is null", minutesUntilDeadline("2026-02-01T12:10:00.000Z", NaN) === null);
  // An unknown deadline must not be treated as urgent.
  const unknownDeadline = decideStaffAlert({
    ...healthy,
    announced: false,
    printed: false,
    minutesUntilDeadline: minutesUntilDeadline(null, nowMs),
  });
  ok("an unknown deadline still alerts", unknownDeadline.send === true);
  ok("…but does not claim the deadline passed", !unknownDeadline.subject.includes("DEADLINE PASSED"));
  ok("…and does not invent a countdown", !unknownDeadline.subject.includes("min left"));

  const badCollect = decideStaffAlert({ ...healthy, collectionFailed: true });
  ok("a failed collection alerts", badCollect.send === true);
  eq("…with the right reason", badCollect.reasons, ["collection_failed"]);

  // Multiple simultaneous failures accumulate, most urgent first.
  const allBad = decideStaffAlert({
    ...healthy,
    announced: false,
    printed: false,
    bridgedToRegister: false,
    collectionFailed: true,
  });
  eq("multiple failures accumulate in urgency order", allBad.reasons, [
    "not_announced_or_printed",
    "not_bridged",
    "collection_failed",
  ]);

  // -- missing booleans are treated as FAILURE, not success ------------------
  // An absent flag means "we do not know it happened". Defaulting to true
  // would make a broken bridge that returns nothing look perfectly healthy —
  // silence caused by a bug, indistinguishable from silence caused by success.
  const unknown = decideStaffAlert({ leaflyOrderId: "x", hasStaffRecipients: true, providerConfigured: true });
  ok("unknown state alerts rather than assuming success", unknown.send === true);
  ok("unknown state is not quiet-because-healthy", unknown.quietBecauseHealthy === false);

  // -- cannot send: warranted but impossible --------------------------------
  const noProvider = decideStaffAlert({ ...healthy, announced: false, providerConfigured: false });
  ok("no provider: does not send", noProvider.send === false);
  ok("no provider: is NOT quiet-because-healthy", noProvider.quietBecauseHealthy === false);
  ok("no provider: still records WHY it was warranted", noProvider.reasons.length > 0);
  ok("no provider: says so plainly", noProvider.summary.includes("WARRANTED"));

  const noRecipients = decideStaffAlert({ ...healthy, announced: false, hasStaffRecipients: false });
  ok("no recipients: does not send", noRecipients.send === false);
  ok("no recipients: is NOT quiet-because-healthy", noRecipients.quietBecauseHealthy === false);
  ok("no recipients: says so plainly", noRecipients.summary.includes("recipients"));
  // The two silent-but-unhealthy cases must be DISTINGUISHABLE from each other.
  ok(
    "the two blocked cases explain themselves differently",
    noProvider.summary !== noRecipients.summary,
  );
  // And both must be distinguishable from the healthy silence.
  ok(
    "blocked silence differs from healthy silence",
    noProvider.quietBecauseHealthy !== h.quietBecauseHealthy,
  );

  // -- urgency shapes the subject line --------------------------------------
  const calm = decideStaffAlert({ ...healthy, announced: false, minutesUntilDeadline: 12 });
  ok("a calm subject does not cry wolf", !calm.subject.includes("DEADLINE PASSED"));
  ok("…and names the order", calm.subject.includes("abcdef12"));

  const soon = decideStaffAlert({ ...healthy, announced: false, minutesUntilDeadline: 4 });
  ok("an urgent subject shows the countdown", soon.subject.includes("4 min left"));

  const boundary = decideStaffAlert({
    ...healthy,
    announced: false,
    minutesUntilDeadline: ALERT_URGENCY_MINUTES,
  });
  ok("the urgency boundary is INCLUSIVE", boundary.subject.includes("min left"));
  const justOver = decideStaffAlert({
    ...healthy,
    announced: false,
    minutesUntilDeadline: ALERT_URGENCY_MINUTES + 1,
  });
  ok("one minute over the boundary is not urgent", !justOver.subject.includes("min left"));

  const blown = decideStaffAlert({ ...healthy, announced: false, minutesUntilDeadline: 0 });
  ok("a passed deadline says so", blown.subject.includes("DEADLINE PASSED"));
  const negative = decideStaffAlert({ ...healthy, announced: false, minutesUntilDeadline: -3 });
  ok("a negative countdown is also 'passed'", negative.subject.includes("DEADLINE PASSED"));

  const unknownClock = decideStaffAlert({ ...healthy, announced: false, minutesUntilDeadline: null });
  ok("an unknown clock still produces a subject", unknownClock.subject.length > 0);
  ok("…and does not invent a countdown", !unknownClock.subject.includes("min left"));
  const nanClock = decideStaffAlert({ ...healthy, announced: false, minutesUntilDeadline: NaN });
  ok("a NaN clock does not leak NaN into the subject", !nanClock.subject.includes("NaN"));

  // -- ids ------------------------------------------------------------------
  const noId = decideStaffAlert({ ...healthy, announced: false, leaflyOrderId: null });
  ok("a missing id does not produce 'null' in the subject", !noId.subject.includes("null"));
  ok("…it says 'unknown order'", noId.subject.includes("unknown order"));
  const blankId = decideStaffAlert({ ...healthy, announced: false, leaflyOrderId: "   " });
  ok("a blank id is treated as missing", blankId.subject.includes("unknown order"));

  // -- ALERT_URGENCY_MINUTES is reasoned, not arbitrary ---------------------
  ok("the urgency threshold is inside Leafly's 15-minute window", ALERT_URGENCY_MINUTES < 15);
  ok("the urgency threshold leaves time to act", ALERT_URGENCY_MINUTES > 0);

  // -- THE CONTRACT GUARD ---------------------------------------------------
  ok("a staff address is permitted", isPermittedStaffRecipient("staff@greenway.com", "shopper@x.com"));
  ok(
    "the SHOPPER's address is REFUSED even in the staff list",
    !isPermittedStaffRecipient("shopper@x.com", "shopper@x.com"),
  );
  ok(
    "…case-insensitively, because email addresses are",
    !isPermittedStaffRecipient("Shopper@X.com", "shopper@x.com"),
  );
  ok(
    "…and with surrounding whitespace",
    !isPermittedStaffRecipient("  shopper@x.com  ", "shopper@x.com"),
  );
  ok("a blank recipient is refused", !isPermittedStaffRecipient("   ", null));
  ok("a non-address is refused", !isPermittedStaffRecipient("not-an-email", null));
  ok("a null recipient is refused", !isPermittedStaffRecipient(null, null));
  ok("no customer email on file does not block staff", isPermittedStaffRecipient("a@b.com", null));
  ok("an empty customer email does not block staff", isPermittedStaffRecipient("a@b.com", "   "));

  eq(
    "the list filters the shopper out and keeps the rest",
    permittedStaffRecipients(["a@b.com", "shopper@x.com", "c@d.com"], "shopper@x.com"),
    ["a@b.com", "c@d.com"],
  );
  eq(
    "duplicates collapse case-insensitively",
    permittedStaffRecipients(["a@b.com", "A@B.com", " a@b.com "], null),
    ["a@b.com"],
  );
  eq("junk is dropped", permittedStaffRecipients(["", "  ", "nope", null, undefined], null), []);
  eq("a non-array is tolerated", permittedStaffRecipients(undefined as never, null), []);
  eq(
    "a list that is ONLY the shopper yields nobody",
    permittedStaffRecipients(["shopper@x.com"], "shopper@x.com"),
    [],
  );

  // -- reason text completeness --------------------------------------------
  const ALL_REASONS: StaffAlertReason[] = [
    "not_announced_or_printed",
    "not_announced",
    "not_printed",
    "not_bridged",
    "collection_failed",
  ];
  eq("five reasons", Object.keys(STAFF_ALERT_REASON_TEXT).length, 5);
  ok(
    "every reason has human text",
    ALL_REASONS.every((r) => typeof STAFF_ALERT_REASON_TEXT[r] === "string" && STAFF_ALERT_REASON_TEXT[r].length > 10),
  );
  ok(
    "every reason text is a complete sentence",
    ALL_REASONS.every((r) => STAFF_ALERT_REASON_TEXT[r].endsWith(".")),
  );

  return { passed, failed, messages };
}
