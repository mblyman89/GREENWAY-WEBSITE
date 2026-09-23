/**
 * src/lib/supabase/query-deadline.ts
 *
 * SLICE L-25 — deadlines for the SHARED database calls that every server
 * action makes, regardless of which feature it belongs to.
 *
 * ===========================================================================
 * WHY THIS EXISTS SEPARATELY FROM `lib/leafly/db-deadline.ts`
 * ===========================================================================
 * It is a layering question, and getting it backwards would be a real
 * mistake rather than a stylistic one.
 *
 * `lib/leafly/db-deadline-core.ts` owns the LEAFLY budgets. It knows how
 * many times an acknowledge click reads credentials, what the Leafly
 * network worst case is, and how those sum against the platform ceiling.
 * That knowledge is genuinely Leafly's and belongs in Leafly's folder.
 *
 * But `lib/auth/session.ts` and `lib/auth/audit.ts` are underneath every
 * feature in this application — the POS, loyalty, medical, printing and
 * Leafly all sit on top of them. Having `lib/auth` import from `lib/leafly`
 * to get a timeout would point a dependency arrow from the foundation to
 * one of the things standing on it. The next person to delete or rename the
 * Leafly module would break authentication, which is an absurd blast radius
 * for a number.
 *
 * So the shared calls get their own budgets here, in the folder that owns
 * the database client itself. Two tables, two owners, no cycle.
 *
 * ── WHY THIS IS NOT "TWO SOURCES OF TRUTH" ────────────────────────────────
 * They budget different things and neither can derive the other. The Leafly
 * table answers "how long may an acknowledge click spend talking to Leafly
 * and our database, and does that fit under 300 seconds". This table
 * answers "how long may ANY request spend resolving who is logged in". A
 * single merged table would have to be imported by every feature to be
 * useful, which is the coupling this file exists to avoid.
 *
 * ===========================================================================
 * WHY THE NUMBERS ARE SMALL
 * ===========================================================================
 * These calls are on the hot path of every single page render and every
 * server action in the product. They are simple primary-key reads against
 * small tables. A healthy one returns in single-digit milliseconds, so a
 * multi-second ceiling is already thousands of times the normal case and is
 * a fault detector, not a performance budget.
 *
 * They are deliberately SHORTER than the Leafly budgets. A Leafly write can
 * legitimately be slow — it may be a multi-row insert of an order's lines.
 * Reading one staff profile by id cannot legitimately take five seconds, so
 * a shorter ceiling here costs nothing and detects a stall sooner.
 */

/** Resolving who is logged in. A primary-key read of one small row. */
export const SESSION_READ_TIMEOUT_MS = 5_000;

/**
 * Appending one audit row.
 *
 * ── WHY AN UNCHECKED WRITE STILL NEEDS A DEADLINE ─────────────────────────
 * `recordAudit` swallows its own errors on purpose, and its comment says
 * why: "never let audit failures break a user action". That is the right
 * policy and this deadline does not change it.
 *
 * But swallowing an ERROR and tolerating an infinite WAIT are different
 * things, and conflating them is how a best-effort write becomes a hang.
 * Today, if the audit insert never settles, the `await` in front of it
 * blocks the action forever — the try/catch never runs, because nothing
 * ever throws. The failure the catch block was written to absorb never
 * arrives. With a deadline the insert fails fast, the catch absorbs it
 * exactly as intended, and the user action proceeds.
 *
 * This matters specifically for the acknowledge path, where L-25 added an
 * audit write on the TIMEOUT branch. An unbounded audit insert there would
 * mean the code that reports a hang could itself hang.
 */
export const AUDIT_WRITE_TIMEOUT_MS = 5_000;

/**
 * A deadline signal for a shared database call.
 *
 * ── WHY A SIGNAL AND NOT A WRAPPER ────────────────────────────────────────
 * Same reasoning as the Leafly equivalent, and it is worth restating.
 * PostgREST returns an aborted query through the ordinary `{ data, error }`
 * channel rather than by throwing — measured, see
 * `scripts/recon/supabase-hang-probe.mjs`:
 *
 *   [probe 1] UNBOUNDED: after 8006ms settled=false -> STILL HANGING
 *   [probe 2] BOUNDED (abortSignal 1500ms): after 1505ms
 *             -> TimeoutError: The operation was aborted due to timeout
 *
 * Because the timeout arrives as an error VALUE, every existing `if (error)`
 * branch already handles it correctly the moment the signal is attached. No
 * call site has to learn a new failure mode or grow a try/catch. A wrapper
 * would have to re-type the whole PostgrestFilterBuilder generic chain to
 * preserve that, and would end up reaching for `any`.
 *
 * ── THE BUILDER-ORDER TRAP ────────────────────────────────────────────────
 * `.abortSignal()` is defined on the TRANSFORM builder — the object returned
 * by `.select()`, `.insert()`, `.update()` or `.delete()` — NOT on the query
 * builder returned by `.from()`. It must come after one of those. Written
 * directly on `.from(...)` it does not type-check, which is the good case;
 * the bad case is assuming it can go anywhere and never checking.
 */
export function queryDeadline(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}
