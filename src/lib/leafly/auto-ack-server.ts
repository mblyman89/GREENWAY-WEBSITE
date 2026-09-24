/**
 * SLICE L-33 — AUTO-ACKNOWLEDGE: THE DOING
 * ============================================================================
 *
 * `auto-ack-core.ts` decides. This file acts on that decision and nothing
 * else. It is the only place in the codebase where an irreversible outbound
 * call to Leafly happens without a person having pressed anything, so it is
 * written to be boring, bounded and impossible to make loud.
 *
 * ── THE ONE RULE THAT OUTRANKS EVERYTHING HERE ─────────────────────────────
 *
 * THIS FUNCTION MAY NEVER THROW, AND MAY NEVER MAKE THE WEBHOOK RETURN
 * NON-200.
 *
 * Leafly retries a webhook it believes failed. A retry storm inside the
 * fifteen-minute acknowledgement window is one of the few ways to turn a
 * working integration into a cancelled customer order — the precise outcome
 * this whole slice exists to prevent. So every failure, including failures
 * nobody anticipated, comes back as a STRING NOTE on a successful return. The
 * outer `try/catch` is not defensive decoration; it is the contract.
 *
 * The existing arrival path already reasons this way, and says so:
 *
 *   "NON-FATAL BY CONSTRUCTION. This is wrapped and awaited inside its own
 *    try/catch: a webhook that returned non-200 would make Leafly retry and
 *    could end with a customer's order auto-cancelled."
 *
 * This file follows that rule rather than inventing a second policy.
 *
 * ── WHY IT IS AWAITED AND NOT FIRED AND FORGOTTEN ──────────────────────────
 *
 * The obvious instinct is to answer Leafly immediately and acknowledge in the
 * background. That is wrong on a serverless host: a function that has already
 * returned may be frozen before its background work runs, so the
 * acknowledgement would sometimes simply never happen — and it would fail
 * *silently*, which is the worst available property for the mechanism that
 * stops a customer's order being cancelled. `onLeaflyOrderArrived` is awaited
 * for exactly this reason (L-28). Same argument, higher stakes.
 */

import { acknowledgeLeaflyOrder } from "./order-ack-server";
import { markLeaflyOrderAcknowledged } from "./webhook-server";
import {
  decideAutoAcknowledge,
  isAutoAcknowledgeEnabled,
  LEAFLY_AUTO_ACK_ENV_VAR,
} from "./auto-ack-core";
// SLICE L-33 (C7) -- the sweeper's selection rule. Pure, no I/O, 3,657
// self-test assertions. Everything this file does about WHICH orders to
// sweep is decided there, not here.
import {
  planAutoAckSweep,
  SWEEP_MAX_PER_RUN,
  type SweepCandidate,
} from "./auto-ack-sweep-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { dbDeadline } from "./db-deadline";

/**
 * What happened, in a form the webhook can put in `notes` and a human can
 * read in a log.
 */
export type AutoAckOutcome = {
  /** True only when Leafly accepted the acknowledgement. */
  acknowledged: boolean;
  /** The decision code, or "error" when something threw. */
  code: string;
  /**
   * One sentence. Always present, never blank.
   *
   * A skip that says nothing is indistinguishable from a crash when you are
   * reading logs after the fact, and "why did this order not get
   * acknowledged?" is the exact question somebody will be asking.
   */
  summary: string;
};

/**
 * Record HOW the acknowledgement happened.
 *
 * Separate from `markLeaflyOrderAcknowledged` (which stamps the timestamp)
 * because that function is on the human path too and must not change
 * behaviour for it. This is additive, best-effort, and its failure is never
 * allowed to matter: the acknowledgement has already happened at Leafly by
 * the time this runs, and losing a provenance label is infinitely cheaper
 * than making the caller believe the acknowledgement failed.
 *
 * DEGRADES GRACEFULLY. `acknowledged_by_kind` only exists once migration 0230
 * is applied by hand (AGENTS rule 6). Until then this update fails with
 * "column does not exist", which is caught, noted, and dropped. The feature
 * itself does not depend on the column at all.
 */
async function stampAcknowledgedByKind(
  leaflyOrderId: string,
  kind: "auto" | "human",
): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("leafly_orders")
      .update({ acknowledged_by_kind: kind })
      .eq("leafly_order_id", leaflyOrderId)
      // SLICE L-25. Bounded like every other write on this path. An unbounded
      // wait here would hold the webhook open, and a webhook that does not
      // answer in time is a webhook Leafly retries.
      .abortSignal(dbDeadline("order_write"));
    if (error) {
      // Not surfaced as a failure. See the doc comment: by this point Leafly
      // has already accepted the acknowledgement.
      return `(provenance not recorded: ${error.message})`;
    }
    return null;
  } catch (err) {
    return `(provenance not recorded: ${err instanceof Error ? err.message : "unknown error"})`;
  }
}

/**
 * Read the two facts the decision depends on, from the row, authoritatively.
 *
 * ── WHY THIS READ EXISTS AT ALL ────────────────────────────────────────────
 *
 * The caller has just upserted this row and could simply hand the values down.
 * The first version of the call site did exactly that, passing
 * `acknowledgedAt: null` because the webhook had only just created the order.
 *
 * That was a bug, and an instructive one. Hard-coding the stamp to null does
 * not just risk staleness — it makes the duplicate-acknowledgement check in
 * `decideAutoAcknowledge` UNREACHABLE, because the input that would trigger it
 * can never arrive. The guard would have looked present in the code, passed
 * its unit tests, and protected nothing in production.
 *
 * The webhook handler does hold a duplicate guard keyed on the body hash, and
 * in the ordinary case it returns before we get here. It is not absolute
 * though: when the event-log write fails, the handler deliberately continues
 * (answering 200 rather than inviting a retry that could cost a real order),
 * and in that window two deliveries can both reach this point.
 *
 * So the state is read here, by the code that is about to act on it. One
 * authoritative reader, at the point of use.
 *
 * ── FAILING TOWARDS ACTING ─────────────────────────────────────────────────
 *
 * If the read fails we return nulls, which lets the acknowledgement proceed.
 * That is the deliberate direction: the cost of acting on a failed read is at
 * worst a duplicate acknowledgement, which Leafly answers with a 409 that we
 * record and which changes nothing about the order. The cost of NOT acting is
 * a real customer's order auto-cancelled fifteen minutes later. Those are not
 * comparable, so the tie is broken towards acting.
 *
 * `decideAcknowledgement` inside `acknowledgeLeaflyOrder` performs the same
 * check again against the snapshot it is given, so this is a first filter
 * rather than the only one.
 */
type AckStateRow = {
  acknowledged_at: string | null;
  leafly_status: string | null;
};

async function readAckState(
  leaflyOrderId: string,
): Promise<{ acknowledgedAt: string | null; leaflyStatus: string | null }> {
  const unknown = { acknowledgedAt: null, leaflyStatus: null };
  if (!isSupabaseServiceConfigured) return unknown;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_orders")
      .select("acknowledged_at, leafly_status")
      .eq("leafly_order_id", leaflyOrderId)
      // SLICE L-25. Bounded, like every other database call on the webhook
      // path. An unbounded read here would hold the webhook open, and a
      // webhook that does not answer is a webhook Leafly retries.
      //
      // Ordered `.abortSignal(...).maybeSingle<T>()` to match `loadBridgeRow`
      // in bridge-server.ts. The reverse order does not type-check, because
      // `maybeSingle` ends the builder chain.
      .abortSignal(dbDeadline("order_read"))
      .maybeSingle<AckStateRow>();
    if (error || !data) return unknown;
    return {
      acknowledgedAt: data.acknowledged_at ?? null,
      leaflyStatus: data.leafly_status ?? null,
    };
  } catch {
    return unknown;
  }
}

/**
 * Acknowledge an arriving order automatically, if the rule says to.
 *
 * @param input.eventType     the webhook event type.
 * @param input.leaflyOrderId the order id from the delivery.
 *
 * Deliberately does NOT take the order's state — it reads it. See
 * `readAckState` for why that is not an efficiency oversight.
 *
 * Returns an outcome. NEVER throws. NEVER rejects.
 */
export async function autoAcknowledgeOnArrival(input: {
  eventType: string | null | undefined;
  leaflyOrderId: string | null | undefined;
}): Promise<AutoAckOutcome> {
  try {
    // Read BEFORE deciding, but only once we have an id worth reading with.
    const idForRead = (input.leaflyOrderId ?? "").trim();
    const state =
      idForRead === ""
        ? { acknowledgedAt: null, leaflyStatus: null }
        : await readAckState(idForRead);

    const decision = decideAutoAcknowledge({
      eventType: input.eventType,
      leaflyOrderId: input.leaflyOrderId,
      acknowledgedAt: state.acknowledgedAt,
      leaflyStatus: state.leaflyStatus,
      // READ HERE, NOT IN THE CORE. The core stays pure so it can be proven
      // exhaustively in CI; the environment is an input to it, not a
      // dependency of it.
      autoAckEnvValue: process.env[LEAFLY_AUTO_ACK_ENV_VAR],
    });

    if (!decision.shouldAcknowledge) {
      return {
        acknowledged: false,
        code: decision.code,
        summary: decision.reason,
      };
    }

    const orderId = (input.leaflyOrderId ?? "").trim();

    // ── THE ACTUAL PRESS ───────────────────────────────────────────────────
    //
    // Routed through the SAME function the button uses, with `actor: "auto"`.
    //
    // WHY REUSE RATHER THAN WRITE A LEANER CALL: this path already carries
    // things that took several slices to get right and that an automatic
    // acknowledgement needs just as much as a manual one — the outbound
    // attempt ledger, the 401-retry-once rule, the bounded deadline, the
    // `acknowledged_at` stamp, and `onLeaflyOrderAccepted()`, which creates
    // the register order. A parallel implementation would have started life
    // missing most of that, and the missing pieces would only have shown up
    // in production.
    //
    // `actor: "auto"` is the whole of the owner's constraint. It suppresses
    // the L-14 `status=confirmed` push and nothing else, so the machine stops
    // the cancellation clock without making the store's business decision or
    // telling the shopper anything.
    const result = await acknowledgeLeaflyOrder({
      order: {
        leafly_order_id: orderId,
        leafly_status: state.leaflyStatus,
        acknowledged_at: state.acknowledgedAt,
      },
      actor: "auto",
      // Attributed in the ledger so the audit trail never implies a person
      // did this. `staffId` is a free-text attribution column on
      // `leafly_outbound_attempts`, not a foreign key.
      staffId: "auto-acknowledge",
    });

    if (!result.ok) {
      // A REFUSAL IS NOT AN ERROR. `decideAcknowledgement` refuses for good
      // reasons (already acknowledged, no integration key configured), and
      // those are ordinary conditions on a retried delivery.
      return {
        acknowledged: false,
        code: result.refused ? `refused:${result.code ?? "unknown"}` : "failed",
        summary: result.refused
          ? `Auto-acknowledge did not send: ${result.message}`
          : `Auto-acknowledge FAILED: ${result.message} — this order still needs ` +
            `acknowledging by hand before Leafly cancels it.`,
      };
    }

    // ── BELT AND BRACES ON THE STAMP ───────────────────────────────────────
    //
    // `acknowledgeLeaflyOrder` already stamps `acknowledged_at`, and tolerates
    // a failed stamp deliberately (the acknowledgement at Leafly succeeded and
    // must never invite a second press). On the HUMAN path that tolerance is
    // correct and sufficient: a person is looking at the screen.
    //
    // On the AUTOMATIC path an unstamped row is more dangerous, because the
    // next retried delivery would read `acknowledged_at = null`, decide the
    // order is unacknowledged, and send a SECOND acknowledgement — which
    // Leafly answers with a 409. So the stamp is re-asserted here. It is
    // idempotent (same column, same value) and its failure is still not fatal.
    const stamp = await markLeaflyOrderAcknowledged(orderId);
    const kindNote = await stampAcknowledgedByKind(orderId, "auto");

    const extras = [
      stamp.ok ? null : `(stamp warning: ${stamp.error})`,
      kindNote,
    ].filter((x): x is string => x !== null);

    return {
      acknowledged: true,
      code: "acknowledged",
      summary:
        `Auto-acknowledged ${orderId} on arrival. Leafly's cancellation clock ` +
        `is stopped. NOT confirmed — the shopper has not been told anything yet.` +
        (extras.length > 0 ? ` ${extras.join(" ")}` : ""),
    };
  } catch (err) {
    // THE CONTRACT. Nothing escapes. A thrown error here would propagate to
    // the webhook route, produce a non-200, and make Leafly retry — the one
    // outcome that can cost a real customer's order.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[leafly/auto-ack] ${input.leaflyOrderId}: threw:`, err);
    return {
      acknowledged: false,
      code: "error",
      summary:
        `Auto-acknowledge threw (${message}). This order has NOT been ` +
        `acknowledged — do it by hand before Leafly cancels it.`,
    };
  }
}

/* ========================================================================== *
 * THE SWEEPER  (SLICE L-33 — C7)
 *
 * Everything above runs when a webhook ARRIVES. This runs when one DIDN'T.
 *
 * WHY THE ARRIVAL HOOK IS NOT ENOUGH
 * ----------------------------------
 * `autoAcknowledgeOnArrival` is reached from the webhook route. If the
 * delivery never lands — a deploy window, a cold start that times out, a
 * Supabase blip, a Leafly-side delivery failure — the hook never runs, and
 * fifteen minutes later Leafly auto-cancels a real customer's order. Nobody
 * finds out, because Leafly owns every shopper-facing message and the shopper
 * is simply told it was cancelled.
 *
 * The owner asked for a feature so he would stop losing orders to a
 * fifteen-minute button. Shipping a version that still loses orders whenever a
 * webhook is dropped would be answering the letter of the request and missing
 * the point of it.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not confirm. It does not email. It does not decide anything: the
 * selection rule is `planAutoAckSweep` in auto-ack-sweep-core.ts (3,657
 * self-test assertions, no I/O), and the acknowledgement itself is the SAME
 * `autoAcknowledgeOnArrival` above, so a fix to one path is a fix to both.
 * There is exactly one piece of code in this system that presses this button.
 * ========================================================================== */

/** What a sweep run did, in a form a cron response and a log can both carry. */
export type AutoAckSweepResult = {
  /** How many orders were examined (after the query's own filters). */
  examined: number;
  /** How many were actually acknowledged by this run. */
  acknowledged: number;
  /** How many were selected but failed when acted on. */
  failed: number;
  /**
   * How many were already past saving. THE NUMBER THAT MATTERS: each one is a
   * customer's order that was auto-cancelled while we were not looking.
   */
  expired: number;
  /** Selected but left for the next run because of the per-run cap. */
  deferred: number;
  /** One line, safe to log and to show an operator. Never blank. */
  summary: string;
  /** Per-order detail, for the cron response body. Bounded by the cap. */
  details: Array<{ leaflyOrderId: string; outcome: string }>;
};

/**
 * How many unacknowledged rows the sweep query will read.
 *
 * Larger than `SWEEP_MAX_PER_RUN` on purpose. The core needs to SEE more than
 * it will ACT on, because the expired ones — the whole diagnostic value of
 * this exercise — are found among the rows we decline. A query limited to the
 * action cap would silently stop counting losses at ten.
 */
const SWEEP_QUERY_LIMIT = 50;

type SweepRow = {
  leafly_order_id: string | null;
  acknowledged_at: string | null;
  acknowledge_by: string | null;
  first_seen_at: string | null;
  leafly_status: string | null;
};

/**
 * Find unacknowledged orders whose arrival hook did not fire, and acknowledge
 * them before Leafly's deadline.
 *
 * @param now injectable clock. Defaults to the real one; tests pass their own
 *            rather than sleeping, because a test that waits two real minutes
 *            is a test that gets deleted.
 *
 * NEVER THROWS. Same contract as `autoAcknowledgeOnArrival`, for a different
 * reason: this one is called by a cron route, and a route that 500s gets
 * retried and alert-fatigued into being ignored.
 */
export async function sweepUnacknowledgedLeaflyOrders(
  now: Date = new Date(),
): Promise<AutoAckSweepResult> {
  const nothing = (summary: string): AutoAckSweepResult => ({
    examined: 0,
    acknowledged: 0,
    failed: 0,
    expired: 0,
    deferred: 0,
    summary,
    details: [],
  });

  try {
    // ── The kill switch, checked ONCE, before any I/O ────────────────────
    //
    // The same switch that governs arrival. One flag, both paths: an owner who
    // turns auto-acknowledge off and finds the machine still pressing the
    // button on a schedule would be right to never trust the switch again.
    if (!isAutoAcknowledgeEnabled(process.env[LEAFLY_AUTO_ACK_ENV_VAR])) {
      return nothing(
        `Sweep skipped: ${LEAFLY_AUTO_ACK_ENV_VAR} is switched off, so the ` +
          `machine presses nothing — on arrival or on a schedule.`,
      );
    }

    if (!isSupabaseServiceConfigured) {
      return nothing(
        "Sweep skipped: the Supabase service role is not configured, so the " +
          "unacknowledged orders cannot be read.",
      );
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("leafly_orders")
      .select(
        "leafly_order_id, acknowledged_at, acknowledge_by, first_seen_at, leafly_status",
      )
      // The partial index added in 0225 and widened in 0230 covers exactly
      // this predicate, so the query stays cheap however many orders the shop
      // has taken over its lifetime.
      .is("acknowledged_at", null)
      // Soonest deadline first, so that even if the limit truncates the read,
      // what survives is the urgent end. The core sorts again — this is not
      // redundant, it decides WHICH ROWS ARE READ AT ALL.
      .order("acknowledge_by", { ascending: true, nullsFirst: false })
      .limit(SWEEP_QUERY_LIMIT)
      .abortSignal(dbDeadline("order_read"));

    if (error) {
      return nothing(
        `Sweep could not read unacknowledged orders: ${error.message}. No ` +
          `orders were acknowledged by this run.`,
      );
    }

    const rows = (data ?? []) as unknown as SweepRow[];
    const candidates: SweepCandidate[] = rows.map((r) => ({
      leaflyOrderId: r.leafly_order_id,
      acknowledgedAt: r.acknowledged_at,
      acknowledgeBy: r.acknowledge_by,
      firstSeenAt: r.first_seen_at,
      leaflyStatus: r.leafly_status,
    }));

    const plan = planAutoAckSweep(candidates, now.getTime(), SWEEP_MAX_PER_RUN);
    const expired = plan.skipped.filter((d) => d.verdict === "expired").length;

    let acknowledged = 0;
    let failed = 0;
    const details: Array<{ leaflyOrderId: string; outcome: string }> = [];

    // SEQUENTIAL, NOT PARALLEL, AND ON PURPOSE.
    //
    // Each iteration is an outbound HTTPS request to Leafly. Firing ten at
    // once would burst a third party's rate limiter on behalf of a shop that
    // takes a handful of orders an hour, and the failure mode of being rate
    // limited here is the exact failure this function exists to prevent. Ten
    // sequential calls fit inside the route's budget with room to spare.
    for (const decision of plan.toSweep) {
      const id = (decision.leaflyOrderId ?? "").trim();
      if (!id) continue;
      // Reuses the arrival path verbatim, including its re-read of the row.
      // That re-read is what makes the sweep safe against a webhook that
      // lands in the middle of this loop: the order gets acknowledged once,
      // by whichever path reaches it first, and the other says
      // "already_acknowledged" and moves on.
      const outcome = await autoAcknowledgeOnArrival({
        eventType: "order_submit",
        leaflyOrderId: id,
      });
      if (outcome.acknowledged) acknowledged += 1;
      else if (outcome.code !== "already_acknowledged") failed += 1;
      details.push({ leaflyOrderId: id, outcome: outcome.summary });
    }

    // The expired count leads the summary when it is non-zero. Everything else
    // in this line is housekeeping; that number is the one that means the shop
    // lost money, and burying it under "3 acknowledged, 12 skipped" is how a
    // metric gets ignored for a year.
    const alarm =
      expired > 0
        ? `⚠ ${expired} order${expired === 1 ? "" : "s"} were already past ` +
          `Leafly's deadline and could not be saved. `
        : "";

    return {
      examined: candidates.length,
      acknowledged,
      failed,
      expired,
      deferred: plan.deferred.length,
      summary:
        alarm +
        `Sweep: ${plan.summary} ${acknowledged} acknowledged, ${failed} failed.` +
        (acknowledged > 0
          ? ` Each one is an order whose arrival webhook did NOT do its job — ` +
            `worth investigating, not just worth catching.`
          : ""),
      details,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[leafly/auto-ack-sweep] threw:", err);
    return nothing(`Sweep threw (${message}). No orders were acknowledged.`);
  }
}
