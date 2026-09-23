import "server-only";

/**
 * src/lib/leafly/db-deadline.ts
 *
 * SLICE L-25 — the database half of "nothing may hang forever".
 *
 * ===========================================================================
 * WHAT THIS IS
 * ===========================================================================
 * `deadline-fetch.ts` is the network's bounded call site. This is the
 * database's. It exists because the acknowledge hang survived two fixes that
 * both, correctly, bounded the network — and the database was never bounded
 * at all.
 *
 * ── THE MEASUREMENT THAT JUSTIFIES IT ────────────────────────────────────
 * Against a real `node:http` server that accepts the connection and answers
 * nothing (`scripts/recon/supabase-hang-probe.mjs`):
 *
 *   [probe 1] UNBOUNDED (today's code): after 8006ms settled=false
 *                                       -> STILL HANGING
 *   [probe 2] BOUNDED (abortSignal 1500ms): after 1505ms
 *             -> returned an error value: TimeoutError: The operation was
 *                aborted due to timeout
 *
 * ===========================================================================
 * WHY THIS IS A SIGNAL FACTORY AND NOT A WRAPPER
 * ===========================================================================
 * The obvious shape is `withDbDeadline(op, () => query)` returning a result
 * object. That shape was rejected deliberately, for a reason worth recording.
 *
 * PostgREST query builders are thenables, not promises, and `.abortSignal()`
 * must be called ON THE BUILDER, before it is awaited. A wrapper that takes a
 * callback would receive the builder already-awaited (or would have to accept
 * a builder and re-type the entire PostgrestFilterBuilder generic chain,
 * which is how you end up with `any` in code that handles money).
 *
 * Far more importantly: a wrapper would have to decide what a timeout MEANS,
 * and it cannot know. Probe 2 proves an aborted query comes back through the
 * ordinary `{ data, error }` channel — so every existing `if (error)` branch
 * in this codebase already handles a deadline correctly the moment the signal
 * is attached. Nothing has to learn a new failure mode; nothing has to grow a
 * try/catch. Handing out a signal preserves that, and preserves each call
 * site's own, already-reviewed refusal wording.
 *
 * So: one function, which returns an `AbortSignal` carrying the right budget
 * for the named operation. The call site adds `.abortSignal(...)` and is
 * otherwise untouched.
 *
 * ===========================================================================
 * WHY NOT `AbortSignal.timeout()` DIRECTLY AT EVERY CALL SITE
 * ===========================================================================
 * Because then the budget is a magic number sprinkled through server files,
 * and the next person to add a query picks whichever number is nearest. The
 * budgets live in `db-deadline-core.ts`, are asserted in CI, and are summed
 * into a worst case that is proven to fit under the platform's limit. A bare
 * `AbortSignal.timeout(5000)` participates in none of that.
 */

import {
  dbTimeoutForOperation,
  type LeaflyDbOperation,
} from "./db-deadline-core";

/**
 * A signal that aborts when this operation's budget expires.
 *
 * Usage — note that `.abortSignal()` goes on the BUILDER, before the await:
 *
 *   const { data, error } = await admin
 *     .from("leafly_orders")
 *     .select("*")
 *     .eq("leafly_order_id", id)
 *     .abortSignal(dbDeadline("order_read"))
 *     .maybeSingle();
 *
 *   if (error) { ...the existing refusal path, unchanged... }
 *
 * A timeout arrives as `error`, exactly like any other database failure.
 */
export function dbDeadline(operation: LeaflyDbOperation): AbortSignal {
  return AbortSignal.timeout(dbTimeoutForOperation(operation));
}

/**
 * True when a PostgREST error is this module's deadline firing.
 *
 * ── WHY CALL SITES NEED TO TELL THE DIFFERENCE ───────────────────────────
 * "The database refused this write" and "we stopped waiting for the database"
 * demand different sentences. The first is usually a constraint or a
 * permission — a problem with the DATA, which retrying will not fix. The
 * second is a problem with REACHING the database, which retrying very well
 * might.
 *
 * On the acknowledge path that distinction is not academic. If we time out
 * reading the credentials, nothing was sent to Leafly and a retry is
 * completely safe. If we time out AFTER the POST, a retry is a second press
 * on a one-way door. Only a call site knows which side of the network call it
 * sits on, so this predicate reports the fact and lets the call site decide.
 *
 * Matches on the error NAME as well as the message because undici and the
 * DOM spell an abort differently depending on how the signal fired
 * (`AbortError` for a manual abort, `TimeoutError` for `AbortSignal.timeout`),
 * and a predicate that only knew one of them would silently miss half the
 * cases it exists to catch.
 *
 * ── WHY THE PARAMETER IS `unknown` AND NOT AN ERROR SHAPE ──────────────────
 * Because that is what a call site actually holds. A PostgREST `error` is a
 * well-typed object, but this predicate also gets used in `catch` blocks, and
 * a caught value in JavaScript is genuinely `unknown` — nothing stops a
 * dependency from throwing a string, a number, or null. Declaring a narrow
 * shape here would only push a cast out to every call site, and a cast is a
 * promise the compiler stops checking. Accepting `unknown` and narrowing once,
 * here, where it is tested, keeps that promise in one place.
 */
export function isDbDeadlineError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const record = error as { message?: unknown; name?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  return (
    /TimeoutError/i.test(message) ||
    /AbortError/i.test(message) ||
    /aborted due to timeout/i.test(message) ||
    /The user aborted a request/i.test(message)
  );
}
