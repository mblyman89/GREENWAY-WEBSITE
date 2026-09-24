/**
 * src/lib/leafly/auto-ack-sweep-core.ts  (SLICE L-33 — C7)
 *
 * THE SAFETY NET UNDER THE SAFETY NET.
 *
 * `autoAcknowledgeOnArrival()` presses the button the moment the webhook
 * lands, which handles every ordinary order. This file answers the harder
 * question: what happens to an order whose webhook NEVER LANDED?
 *
 * WHY THAT IS A REAL CASE AND NOT A HYPOTHETICAL
 * ----------------------------------------------
 * Leafly's own documented behaviour is the whole reason this slice exists:
 *
 *   "Orders are acknowledged as having been retrieved in whole by your system
 *    within fifteen minutes of receiving an order submission webhook. Any
 *    orders NOT ACKNOWLEDGED BY THIS DEADLINE WILL BE AUTO CANCELED."
 *
 * The arrival hook can only fire if the webhook arrives. A deploy, a cold
 * start that times out, a Supabase blip, or a Leafly-side delivery failure
 * during those fifteen minutes and the order is silently cancelled — and the
 * customer, who was told nothing by us because Leafly owns every customer
 * message, simply never hears back. That is the exact outcome the owner is
 * paying for this feature to prevent, so leaving it to the arrival hook alone
 * would be shipping the demo and calling it the product.
 *
 * WHAT THIS FILE IS AND IS NOT
 * ----------------------------
 * It is the SELECTION RULE, and nothing else: given a set of rows and the
 * current time, which orders should the sweeper act on, and in what order?
 * No I/O, no clock, no environment. The server half reads the rows and does
 * the acting; this half is the part that can be proven.
 *
 * Nothing here decides WHETHER auto-acknowledge is enabled — that is
 * `isAutoAcknowledgeEnabled` in auto-ack-core.ts, and it is checked by the
 * caller before a single row is read. One kill switch, one place.
 *
 * ── THE TWO WAYS THIS COULD BE BUILT WRONG ──────────────────────────────────
 *
 * 1. SWEEP EVERYTHING UNACKNOWLEDGED.
 *    Tempting, simple, and wrong. An order that arrived ninety seconds ago is
 *    being handled by the arrival hook right now; sweeping it races that hook
 *    and, worse, hides the bug if the hook is broken — the sweeper would paper
 *    over a permanently failing arrival path and nobody would ever know. So
 *    the sweeper deliberately waits (`SWEEP_GRACE_MS`) and reports what it
 *    caught, because a net that catches something is telling you the floor
 *    above it has a hole.
 *
 * 2. SWEEP ONLY WHAT IS ALREADY EXPIRED.
 *    Also wrong, in the direction that costs money. Once `acknowledgeBy` has
 *    passed, Leafly has already auto-cancelled; acknowledging then is shouting
 *    at a closed door. The sweeper must act BEFORE the deadline, which is what
 *    `SWEEP_DEADLINE_MARGIN_MS` is for.
 *
 * So the window is: old enough that the arrival hook has demonstrably failed,
 * young enough that acting still accomplishes something.
 */

/* ========================================================================== *
 * 1. THE WINDOW
 * ========================================================================== */

/**
 * How long after an order first appears before the sweeper will touch it.
 *
 * Two minutes. Chosen against measured facts rather than taste:
 *
 *   • The arrival path's own budget is bounded by `dbDeadline` and the
 *     webhook route's `maxDuration`, both of which are well under a minute.
 *     An order still unacknowledged after two minutes is not "in flight", it
 *     is a webhook that did not arrive or a hook that failed.
 *
 *   • Leafly retries failed webhook deliveries. Two minutes leaves room for a
 *     retry to succeed on its own, so the sweeper does not duplicate work
 *     that the ordinary path is about to do anyway.
 *
 *   • It is a small fraction of fifteen, so spending it costs almost none of
 *     the window it is protecting.
 */
export const SWEEP_GRACE_MS = 2 * 60 * 1000;

/**
 * How close to `acknowledgeBy` the sweeper gives up.
 *
 * Thirty seconds. Past this point the request would very likely land after
 * Leafly's deadline, and an acknowledgement that arrives late is not merely
 * useless — it is a write against an order Leafly has already cancelled.
 *
 * The margin is NOT zero on purpose. An HTTPS round trip to Leafly plus our
 * own database write is not instantaneous, and "we checked the clock and it
 * said we had four hundred milliseconds" is how a race is written.
 *
 * Orders past this point are reported as `expired` rather than dropped, so
 * the operator finds out an order was lost instead of it vanishing quietly.
 */
export const SWEEP_DEADLINE_MARGIN_MS = 30 * 1000;

/**
 * The most orders a single sweep will act on.
 *
 * A bound, not a capacity estimate. The sweeper runs inside a serverless
 * function with a hard wall-clock limit, and a run that is killed halfway
 * through is worse than a run that does ten and honestly says "more remain":
 * the killed run leaves no record of what it did or did not do.
 *
 * Ten is comfortably above Greenway's real arrival rate and comfortably below
 * anything that could exhaust the function's time budget, since each acted-on
 * order is one HTTPS call to Leafly plus two small writes.
 */
export const SWEEP_MAX_PER_RUN = 10;

/* ========================================================================== *
 * 2. THE SHAPES
 * ========================================================================== */

/**
 * The only four facts the selection rule needs.
 *
 * Deliberately NOT the database row type. A pure core that accepts the row
 * type acquires a dependency on the schema and then on the migration state,
 * and the next person to add a column has to think about this file. Four
 * primitives cannot rot.
 */
export type SweepCandidate = {
  /** Leafly's order id. The thing we would acknowledge. */
  leaflyOrderId: string | null | undefined;
  /** `acknowledged_at`. Non-null means somebody already did it. */
  acknowledgedAt: string | null | undefined;
  /**
   * `acknowledge_by` — LEAFLY'S OWN DEADLINE, as given to us on the submit
   * webhook and stored verbatim. Never recomputed as "first seen + 15", for
   * the reason recorded in the facts document: their clock is the one that
   * cancels the order, and a locally derived deadline that disagrees by even
   * a few seconds would have us stop trying while time remained.
   */
  acknowledgeBy: string | null | undefined;
  /** `first_seen_at`. When the row appeared, which is when the grace starts. */
  firstSeenAt: string | null | undefined;
  /** `leafly_status`, so an order that has already moved on is left alone. */
  leaflyStatus?: string | null | undefined;
};

/** Why a candidate was or was not selected. One value, always. */
export type SweepVerdict =
  /** Act on it. */
  | "sweep"
  /** Someone (or the arrival hook) already acknowledged it. */
  | "already_acknowledged"
  /** Too new — the arrival hook still owns it. */
  | "too_new"
  /** The deadline has passed or is too close to reach. Reported, not hidden. */
  | "expired"
  /** No usable id; there is nothing to acknowledge. */
  | "no_order_id"
  /** The order is finished, cancelled or otherwise no longer live. */
  | "not_live"
  /** We cannot tell — a missing or unparseable timestamp. Never guessed. */
  | "unknown_timing";

export type SweepDecision = {
  leaflyOrderId: string | null | undefined;
  verdict: SweepVerdict;
  /** Milliseconds until `acknowledgeBy`. Negative when it has passed. */
  msUntilDeadline: number | null;
  /** One sentence, for the operator. Never blank. */
  reason: string;
};

/**
 * Statuses that mean "this order is no longer waiting on us".
 *
 * A DENY-list, matching `decideAutoAcknowledge`. The posture is identical and
 * deliberate: an unrecognised status FAILS TOWARDS ACTING. If Leafly invents a
 * new status tomorrow, the worst case of acting is a duplicate acknowledgement
 * on an order that was already fine (which the idempotency check catches and
 * which the endpoint tolerates); the worst case of NOT acting is a real
 * customer's order auto-cancelling because we did not recognise a word.
 */
const SWEEP_FINISHED_STATUSES = new Set([
  "canceled",
  "cancelled",
  "completed",
  "rejected",
  "expired",
]);

/* ========================================================================== *
 * 3. THE RULE
 * ========================================================================== */

/** Parse an ISO timestamp to epoch ms, or null. Never throws, never guesses. */
function parseMs(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Should the sweeper acknowledge this order?
 *
 * The check order is as deliberate as it is in `decideAutoAcknowledge`:
 *
 *   1. id        — without one there is no action to take, whatever else is true.
 *   2. already   — the cheapest and most common skip; also the idempotency guard.
 *   3. not live  — an order that moved on is not ours to touch.
 *   4. timing    — the expensive, and only genuinely interesting, question.
 *
 * Every branch returns a sentence. A sweeper that silently skips is a sweeper
 * nobody can debug at 9pm when an order has gone missing.
 */
export function decideSweepCandidate(
  candidate: SweepCandidate,
  nowMs: number,
): SweepDecision {
  const id =
    typeof candidate.leaflyOrderId === "string"
      ? candidate.leaflyOrderId.trim()
      : "";
  const deadlineMs = parseMs(candidate.acknowledgeBy);
  const msUntilDeadline = deadlineMs === null ? null : deadlineMs - nowMs;

  if (!id) {
    return {
      leaflyOrderId: candidate.leaflyOrderId,
      verdict: "no_order_id",
      msUntilDeadline,
      reason:
        "No Leafly order id on this row, so there is nothing to acknowledge. " +
        "Skipped without guessing at an identifier.",
    };
  }

  if (candidate.acknowledgedAt != null && String(candidate.acknowledgedAt).trim() !== "") {
    return {
      leaflyOrderId: id,
      verdict: "already_acknowledged",
      msUntilDeadline,
      reason:
        "Already acknowledged — the arrival hook or a person got there first. " +
        "The sweeper never presses a button twice.",
    };
  }

  const status = (candidate.leaflyStatus ?? "").trim().toLowerCase();
  if (status !== "" && SWEEP_FINISHED_STATUSES.has(status)) {
    return {
      leaflyOrderId: id,
      verdict: "not_live",
      msUntilDeadline,
      reason: `Order is '${status}' and no longer waiting on us. Nothing to do.`,
    };
  }

  const firstSeenMs = parseMs(candidate.firstSeenAt);
  if (firstSeenMs === null) {
    return {
      leaflyOrderId: id,
      verdict: "unknown_timing",
      msUntilDeadline,
      reason:
        "No usable first-seen time, so the grace period cannot be evaluated. " +
        "Reported rather than swept, because acting on an unknown age could " +
        "race the arrival hook, and guessing the age would be inventing data.",
    };
  }

  const ageMs = nowMs - firstSeenMs;
  if (ageMs < SWEEP_GRACE_MS) {
    return {
      leaflyOrderId: id,
      verdict: "too_new",
      msUntilDeadline,
      reason:
        `Only ${Math.max(0, Math.round(ageMs / 1000))}s old — the arrival hook ` +
        "still owns this order. Sweeping now would race it and would hide a " +
        "broken arrival path rather than reveal it.",
    };
  }

  if (deadlineMs === null) {
    // No deadline recorded. This is NOT treated as "expired" — an absent
    // deadline is an absence of information, not evidence of lateness, and
    // the order is demonstrably past its grace period with nobody having
    // acknowledged it. Acting is the safe direction: at worst we acknowledge
    // an order Leafly already cancelled, which changes nothing; at best we
    // save an order whose `acknowledgeBy` simply never got stored.
    return {
      leaflyOrderId: id,
      verdict: "sweep",
      msUntilDeadline: null,
      reason:
        "Past the grace period, unacknowledged, and no deadline was recorded. " +
        "Acknowledging anyway, because an unknown deadline is not a reason to " +
        "let a real order auto-cancel.",
    };
  }

  if (msUntilDeadline !== null && msUntilDeadline <= SWEEP_DEADLINE_MARGIN_MS) {
    return {
      leaflyOrderId: id,
      verdict: "expired",
      msUntilDeadline,
      reason:
        msUntilDeadline > 0
          ? `Only ${Math.round(msUntilDeadline / 1000)}s left before Leafly's ` +
            "deadline — too close to reach reliably. Reported so the loss is " +
            "visible rather than silent."
          : `Leafly's deadline passed ${Math.round(-msUntilDeadline / 1000)}s ` +
            "ago; this order has almost certainly been auto-cancelled already. " +
            "Reported, not hidden.",
    };
  }

  return {
    leaflyOrderId: id,
    verdict: "sweep",
    msUntilDeadline,
    reason:
      `Unacknowledged ${Math.round(ageMs / 1000)}s after arriving, with ` +
      `${Math.round((msUntilDeadline ?? 0) / 1000)}s still on Leafly's clock. ` +
      "The arrival hook did not do its job; acknowledging now.",
  };
}

/**
 * Apply the rule to a whole batch and order the work.
 *
 * SORTED BY DEADLINE, SOONEST FIRST, and this matters more than it looks.
 * `SWEEP_MAX_PER_RUN` means some runs will not get through everything they
 * selected; when that happens the orders left behind must be the ones with
 * the most time remaining, never the ones about to be cancelled. Sorting by
 * arrival order — the obvious default, and what an unsorted query returns —
 * would drop exactly the wrong ones.
 *
 * Returns everything, including the skips, because the count of skips and
 * their reasons is the diagnostic. A sweeper that returns only its actions
 * cannot tell you that it examined nine orders and declined all nine.
 */
export function planAutoAckSweep(
  candidates: readonly SweepCandidate[],
  nowMs: number,
  maxPerRun: number = SWEEP_MAX_PER_RUN,
): {
  /** Act on these, in this order. Never longer than `maxPerRun`. */
  toSweep: SweepDecision[];
  /** Selected but deferred to the next run because of the cap. */
  deferred: SweepDecision[];
  /** Everything not selected, with a reason each. */
  skipped: SweepDecision[];
  /** One line, safe to log and to show an operator. */
  summary: string;
} {
  const decisions = candidates.map((c) => decideSweepCandidate(c, nowMs));

  const selected = decisions.filter((d) => d.verdict === "sweep");
  const skipped = decisions.filter((d) => d.verdict !== "sweep");

  // Soonest deadline first. A null deadline sorts LAST among the selected:
  // it is being swept on the strength of its age alone, so it is the least
  // urgent of the urgent, and it must never displace an order with a real
  // clock running on it.
  selected.sort((a, b) => {
    const am = a.msUntilDeadline;
    const bm = b.msUntilDeadline;
    if (am === null && bm === null) return 0;
    if (am === null) return 1;
    if (bm === null) return -1;
    return am - bm;
  });

  const cap = Math.max(0, Math.floor(maxPerRun));
  const toSweep = selected.slice(0, cap);
  const deferred = selected.slice(cap);

  const expired = skipped.filter((d) => d.verdict === "expired").length;
  const parts = [
    `${candidates.length} unacknowledged order${candidates.length === 1 ? "" : "s"} examined`,
    `${toSweep.length} to acknowledge`,
  ];
  if (deferred.length > 0) {
    parts.push(`${deferred.length} deferred to the next run (cap ${cap})`);
  }
  if (expired > 0) {
    // Called out separately and unconditionally. This is the number that means
    // a customer's order was lost, and it must never be buried in "skipped".
    parts.push(`${expired} PAST SAVING — the deadline had already gone`);
  }
  parts.push(`${skipped.length - expired} skipped for ordinary reasons`);

  return { toSweep, deferred, skipped, summary: parts.join(", ") + "." };
}

/* ========================================================================== *
 * 4. SELF-TESTS
 * ========================================================================== */

/**
 * Exhaustive self-tests for the selection rule.
 *
 * Held to the same standard as auto-ack-core: this rule decides whether to
 * fire an IRREVERSIBLE action against a live order with no human present, on
 * a schedule, forever. The cost of a wrong `true` is a duplicate
 * acknowledgement; the cost of a wrong `false` is a cancelled sale and a
 * customer who never hears anything. Both are asserted here.
 */
export function __runLeaflyAutoAckSweepTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`  ✗ ${label}`);
    }
  };

  const NOW = Date.parse("2026-03-01T12:00:00.000Z");
  const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

  /** A healthy sweepable order: 5 minutes old, 10 minutes of clock left. */
  const base = (over: Partial<SweepCandidate> = {}): SweepCandidate => ({
    leaflyOrderId: "ord-1",
    acknowledgedAt: null,
    acknowledgeBy: iso(10 * 60 * 1000),
    firstSeenAt: iso(-5 * 60 * 1000),
    leaflyStatus: "pending",
    ...over,
  });

  // ── The happy path ───────────────────────────────────────────────────────
  ok(
    decideSweepCandidate(base(), NOW).verdict === "sweep",
    "an order that is past its grace period, unacknowledged, and still inside " +
      "Leafly's window IS swept — this is the entire point of the net",
  );
  ok(
    decideSweepCandidate(base(), NOW).reason.length > 20,
    "…and says why, in a sentence a human can read",
  );

  // ── Refusals ─────────────────────────────────────────────────────────────
  ok(
    decideSweepCandidate(base({ acknowledgedAt: iso(-60_000) }), NOW).verdict ===
      "already_acknowledged",
    "an acknowledged order is never acknowledged again",
  );
  ok(
    decideSweepCandidate(base({ leaflyOrderId: null }), NOW).verdict === "no_order_id",
    "a row with no Leafly id is skipped rather than acted on with a guess",
  );
  ok(
    decideSweepCandidate(base({ leaflyOrderId: "   " }), NOW).verdict === "no_order_id",
    "…and whitespace is not an id",
  );
  ok(
    decideSweepCandidate(base({ firstSeenAt: iso(-30_000) }), NOW).verdict === "too_new",
    "a 30-second-old order belongs to the ARRIVAL HOOK, not the sweeper — " +
      "sweeping it would race the hook and mask a broken arrival path",
  );
  ok(
    decideSweepCandidate(base({ firstSeenAt: iso(-SWEEP_GRACE_MS + 1) }), NOW).verdict ===
      "too_new",
    "the grace boundary is exclusive on the young side",
  );
  ok(
    decideSweepCandidate(base({ firstSeenAt: iso(-SWEEP_GRACE_MS) }), NOW).verdict ===
      "sweep",
    "…and inclusive the moment the grace period is exactly met",
  );

  // ── The deadline margin ──────────────────────────────────────────────────
  ok(
    decideSweepCandidate(base({ acknowledgeBy: iso(-60_000) }), NOW).verdict === "expired",
    "a deadline that has already passed is reported as expired, never swept — " +
      "Leafly has already auto-cancelled and the write would hit a closed door",
  );
  ok(
    decideSweepCandidate(base({ acknowledgeBy: iso(5_000) }), NOW).verdict === "expired",
    "5 seconds of clock is NOT enough to attempt an HTTPS round trip in; " +
      "the margin exists so we do not lose a race we chose to enter",
  );
  ok(
    decideSweepCandidate(base({ acknowledgeBy: iso(SWEEP_DEADLINE_MARGIN_MS) }), NOW)
      .verdict === "expired",
    "the margin boundary is inclusive on the dangerous side (<=), because a " +
      "boundary that rounds towards acting is a boundary that loses the race",
  );
  ok(
    decideSweepCandidate(base({ acknowledgeBy: iso(SWEEP_DEADLINE_MARGIN_MS + 1) }), NOW)
      .verdict === "sweep",
    "…and one millisecond more is swept — the rule is a threshold, not a mood",
  );
  ok(
    (decideSweepCandidate(base({ acknowledgeBy: iso(-60_000) }), NOW).msUntilDeadline ??
      0) < 0,
    "an expired decision carries a NEGATIVE msUntilDeadline, so a log reader " +
      "can see how badly it was missed rather than just that it was",
  );

  // ── Status ───────────────────────────────────────────────────────────────
  for (const s of ["canceled", "cancelled", "completed", "rejected", "expired"]) {
    ok(
      decideSweepCandidate(base({ leaflyStatus: s }), NOW).verdict === "not_live",
      `'${s}' is finished and is left alone`,
    );
    ok(
      decideSweepCandidate(base({ leaflyStatus: s.toUpperCase() }), NOW).verdict ===
        "not_live",
      `'${s}' is matched case-insensitively, as stored values sometimes vary`,
    );
  }
  ok(
    decideSweepCandidate(base({ leaflyStatus: "someNewLeaflyStatus" }), NOW).verdict ===
      "sweep",
    "AN UNRECOGNISED STATUS FAILS TOWARDS ACTING. If Leafly invents a status " +
      "tomorrow, a duplicate acknowledgement costs nothing and a missed one " +
      "costs a customer's order. This is a deny-list on purpose.",
  );
  ok(
    decideSweepCandidate(base({ leaflyStatus: null }), NOW).verdict === "sweep",
    "a null status is not an excuse to do nothing",
  );
  ok(
    decideSweepCandidate(base({ leaflyStatus: "" }), NOW).verdict === "sweep",
    "…nor is an empty one",
  );

  // ── Unparseable / absent timestamps ──────────────────────────────────────
  ok(
    decideSweepCandidate(base({ firstSeenAt: "not-a-date" }), NOW).verdict ===
      "unknown_timing",
    "an unparseable first-seen time yields 'unknown', never a guessed age",
  );
  ok(
    decideSweepCandidate(base({ firstSeenAt: null }), NOW).verdict === "unknown_timing",
    "…and so does a missing one",
  );
  ok(
    decideSweepCandidate(base({ acknowledgeBy: null }), NOW).verdict === "sweep",
    "a MISSING DEADLINE is swept, not skipped: absence of information is not " +
      "evidence of lateness, and the order is provably past its grace period " +
      "with nobody having acknowledged it",
  );
  ok(
    decideSweepCandidate(base({ acknowledgeBy: "garbage" }), NOW).msUntilDeadline === null,
    "an unparseable deadline reports null rather than NaN — NaN compares false " +
      "against everything and would have silently swept every order",
  );
  ok(
    !Number.isNaN(
      decideSweepCandidate(base({ acknowledgeBy: "garbage" }), NOW).msUntilDeadline ?? 0,
    ),
    "…asserted explicitly, because NaN is the classic way this rule breaks",
  );

  // ── Ordering: the property the cap depends on ────────────────────────────
  {
    const urgent = base({ leaflyOrderId: "urgent", acknowledgeBy: iso(60_000) });
    const relaxed = base({ leaflyOrderId: "relaxed", acknowledgeBy: iso(9 * 60_000) });
    const noDeadline = base({ leaflyOrderId: "no-deadline", acknowledgeBy: null });
    // Deliberately supplied in the WORST order — exactly what an unsorted
    // "oldest first" query would hand us.
    const plan = planAutoAckSweep([relaxed, noDeadline, urgent], NOW, 10);
    ok(plan.toSweep.length === 3, "all three are selected");
    ok(
      plan.toSweep[0]?.leaflyOrderId === "urgent",
      "THE SOONEST DEADLINE IS ACTED ON FIRST. With a per-run cap, the orders " +
        "left behind must be the ones with time to spare, never the ones about " +
        "to be cancelled.",
    );
    ok(
      plan.toSweep[2]?.leaflyOrderId === "no-deadline",
      "an order with no recorded deadline sorts LAST among the selected — it " +
        "is swept on age alone and must not displace a real running clock",
    );
    const capped = planAutoAckSweep([relaxed, noDeadline, urgent], NOW, 1);
    ok(
      capped.toSweep.length === 1 && capped.toSweep[0]?.leaflyOrderId === "urgent",
      "under a cap of one, the one that gets saved is the one closest to dying",
    );
    ok(
      capped.deferred.length === 2,
      "…and the rest are DEFERRED, not skipped and not silently dropped",
    );
    ok(
      capped.deferred.every((d) => d.verdict === "sweep"),
      "deferred decisions keep their 'sweep' verdict, so the next run does not " +
        "have to re-derive that they were wanted",
    );
  }

  // ── The cap itself ───────────────────────────────────────────────────────
  {
    const many = Array.from({ length: 25 }, (_, i) =>
      base({ leaflyOrderId: `ord-${i}`, acknowledgeBy: iso((i + 2) * 60_000) }),
    );
    const plan = planAutoAckSweep(many, NOW);
    ok(
      plan.toSweep.length === SWEEP_MAX_PER_RUN,
      "the default cap is enforced — a run that is killed halfway through is " +
        "worse than one that does ten and says so",
    );
    ok(
      plan.deferred.length === 25 - SWEEP_MAX_PER_RUN,
      "everything over the cap is accounted for, not lost",
    );
    ok(
      plan.toSweep.length + plan.deferred.length + plan.skipped.length === 25,
      "TOTALITY: every candidate appears in exactly one bucket. Nothing may " +
        "fall through the sweeper's own cracks.",
    );
    ok(
      planAutoAckSweep(many, NOW, 0).toSweep.length === 0,
      "a cap of zero acts on nothing — an effective kill switch for the sweep " +
        "alone, without touching arrival auto-acknowledge",
    );
    ok(
      planAutoAckSweep(many, NOW, 0).deferred.length === 25,
      "…and with a cap of zero everything is deferred, not discarded",
    );
    ok(
      planAutoAckSweep(many, NOW, -5).toSweep.length === 0,
      "a negative cap is clamped rather than producing a bizarre slice",
    );
  }

  // ── The summary line ─────────────────────────────────────────────────────
  {
    const empty = planAutoAckSweep([], NOW);
    ok(empty.toSweep.length === 0, "an empty sweep selects nothing");
    ok(
      empty.summary.length > 0,
      "…and STILL produces a summary. A silent run is indistinguishable from a " +
        "run that never happened, which is the bug this whole net exists for.",
    );
    ok(
      /0 unacknowledged/.test(empty.summary),
      "the empty summary states the count rather than implying it",
    );
    const withExpired = planAutoAckSweep(
      [base({ acknowledgeBy: iso(-60_000) }), base({ leaflyOrderId: "b" })],
      NOW,
    );
    ok(
      /PAST SAVING/.test(withExpired.summary),
      "AN EXPIRED ORDER IS SHOUTED ABOUT, not buried in a 'skipped' count. " +
        "That number means a real customer's order was lost.",
    );
    ok(
      !/PAST SAVING/.test(planAutoAckSweep([base()], NOW).summary),
      "…and the alarm is not raised when nothing was lost",
    );
    ok(
      planAutoAckSweep([base()], NOW).summary.endsWith("."),
      "the summary is a sentence",
    );
  }

  // ── Totality: every decision is one of the declared verdicts ─────────────
  {
    const VERDICTS: SweepVerdict[] = [
      "sweep",
      "already_acknowledged",
      "too_new",
      "expired",
      "no_order_id",
      "not_live",
      "unknown_timing",
    ];
    const seen = new Set<SweepVerdict>();
    let checked = 0;
    for (const id of ["ord-1", null, "", "  "]) {
      for (const ack of [null, iso(-60_000), ""]) {
        for (const by of [iso(10 * 60_000), iso(-60_000), null, "garbage", iso(5_000)]) {
          for (const seenAt of [iso(-5 * 60_000), iso(-30_000), null, "garbage"]) {
            for (const st of [null, "pending", "canceled", "brandNew", ""]) {
              const d = decideSweepCandidate(
                {
                  leaflyOrderId: id,
                  acknowledgedAt: ack,
                  acknowledgeBy: by,
                  firstSeenAt: seenAt,
                  leaflyStatus: st,
                },
                NOW,
              );
              checked += 1;
              seen.add(d.verdict);
              ok(
                VERDICTS.includes(d.verdict),
                `every input yields a DECLARED verdict (got '${d.verdict}')`,
              );
              ok(
                typeof d.reason === "string" && d.reason.trim().length > 0,
                "every decision carries a non-empty reason — a silent skip is " +
                  "an unanswerable support question",
              );
              ok(
                d.msUntilDeadline === null || Number.isFinite(d.msUntilDeadline),
                "msUntilDeadline is null or finite, never NaN",
              );
            }
          }
        }
      }
    }
    // Guards against a vacuous pass: if the loop were skipped, or if the rule
    // collapsed to a single verdict, every assertion above would still "pass".
    ok(checked === 4 * 3 * 5 * 4 * 5, `the totality matrix actually ran (${checked} cases)`);
    ok(
      seen.size >= 6,
      `the matrix exercises at least six distinct verdicts (saw ${seen.size}) — ` +
        "proof the rule genuinely branches rather than answering the same way",
    );
    ok(seen.has("sweep"), "…including the one that actually does something");
    ok(seen.has("expired"), "…and the one that means an order was lost");
  }

  // ── Constants: sanity relationships, not magic-number restatement ────────
  ok(
    SWEEP_GRACE_MS > 0 && SWEEP_GRACE_MS < 15 * 60 * 1000,
    "the grace period is positive and a fraction of Leafly's fifteen minutes — " +
      "spending it must not cost the window it protects",
  );
  ok(
    SWEEP_DEADLINE_MARGIN_MS > 0,
    "the deadline margin is NOT zero; 'we had four hundred milliseconds' is how " +
      "a race gets written",
  );
  ok(
    SWEEP_GRACE_MS + SWEEP_DEADLINE_MARGIN_MS < 15 * 60 * 1000,
    "grace plus margin leave a usable window inside Leafly's fifteen minutes — " +
      "otherwise the sweeper could never act at all and would pass its tests " +
      "while doing nothing",
  );
  ok(SWEEP_MAX_PER_RUN > 0, "the per-run cap permits work");

  if (failed === 0) {
    console.log(`leafly-auto-ack-sweep: ${passed} assertions passed, 0 failed`);
  } else {
    console.error(`leafly-auto-ack-sweep: ${passed} passed, ${failed} FAILED`);
  }
  return { passed, failed };
}
