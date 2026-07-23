/**
 * src/lib/orders/reservation-expiry-core.ts  (GW-028)
 *
 * PURE policy for the website order "reservation window". Every website
 * order stores `reservation_expires_at` = placed + 24h; before this fix the
 * column was WRITTEN but never READ — orders never auto-expired and stale
 * `new` orders accumulated until staff cleaned them up by hand (and, until
 * GW-015, leaked into revenue).
 *
 * The rule this module pins down:
 *   - The window is 24 hours (advisory hold — inventory is only decremented
 *     at COMPLETION, so an expired order releases no stock; it just closes).
 *   - Only orders still at `new` auto-expire. Once staff acknowledge an
 *     order they own it — the daily sweep must never close an order a human
 *     is actively working (acknowledged / preparing / ready).
 *   - Expiry closes the order as `no_show` — the same terminal status a
 *     manual no-show uses, so reports, loyalty release, and the reversal
 *     path (no_show → new when the customer turns up) all behave
 *     identically for manual and automatic closures.
 *   - Corrupt or missing timestamps NEVER expire (fail-safe: when in doubt,
 *     leave the order for a human).
 *
 * No imports, no server-only — safe for client, server, and tests.
 */

/** The advisory reservation window, in hours. */
export const RESERVATION_WINDOW_HOURS = 24;

/** The only status the sweep may auto-expire. */
export const EXPIRABLE_STATUS = "new";

/** Compute the reservation expiry for an order placed at `nowMs`. */
export function computeReservationExpiresAt(nowMs: number): string {
  return new Date(nowMs + RESERVATION_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * Whether a reservation has expired as of `nowMs`. Null, missing, or
 * unparseable timestamps report NOT expired — a broken row must be left for
 * a human, never silently closed.
 */
export function isReservationExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (typeof expiresAt !== "string" || !expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t < nowMs;
}

/**
 * Whether the sweep may expire this order at all: correct status AND an
 * expired window. The status gate lives here (not just in the SQL filter)
 * so the policy is testable and cannot drift from the query.
 */
export function shouldExpireOrder(
  order: { status: string; reservation_expires_at: string | null },
  nowMs: number,
): boolean {
  return order.status === EXPIRABLE_STATUS && isReservationExpired(order.reservation_expires_at, nowMs);
}

/** Plain-English order_events note for an automatic expiry. */
export function reservationExpiryNote(expiresAt: string | null): string {
  const when = expiresAt ? ` (window ended ${expiresAt})` : "";
  return (
    `Auto-closed as no-show: the ${RESERVATION_WINDOW_HOURS}-hour pickup window passed` +
    `${when} and the order was never acknowledged. If the customer arrives, reopen it from the order page.`
  );
}

/** Actor label stamped on automatic expiries so the trail names the machine. */
export const RESERVATION_SWEEP_ACTOR = "system — reservation window sweep";

// ---------------------------------------------------------------------------
// Embedded self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReservationExpiryTests(): void {
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`reservation-expiry-core: ${label}`);
  };

  const now = Date.parse("2026-05-01T12:00:00.000Z");

  // window math: exactly +24h
  ok(
    computeReservationExpiresAt(now) === "2026-05-02T12:00:00.000Z",
    "computeReservationExpiresAt adds exactly 24h",
  );

  // expiry boundary: strictly BEFORE now expires; at/after does not
  ok(isReservationExpired("2026-05-01T11:59:59.999Z", now), "1ms past expires");
  ok(!isReservationExpired("2026-05-01T12:00:00.000Z", now), "exactly now does not expire");
  ok(!isReservationExpired("2026-05-02T12:00:00.000Z", now), "future does not expire");

  // fail-safe: null / empty / garbage never expire
  ok(!isReservationExpired(null, now), "null never expires");
  ok(!isReservationExpired(undefined, now), "undefined never expires");
  ok(!isReservationExpired("", now), "empty never expires");
  ok(!isReservationExpired("not-a-date", now), "garbage never expires");

  // status gate: ONLY `new` may expire
  const past = "2026-04-30T00:00:00.000Z";
  ok(shouldExpireOrder({ status: "new", reservation_expires_at: past }, now), "stale new expires");
  for (const s of ["acknowledged", "preparing", "ready", "completed", "cancelled", "no_show"]) {
    ok(!shouldExpireOrder({ status: s, reservation_expires_at: past }, now), `${s} never auto-expires`);
  }
  ok(!shouldExpireOrder({ status: "new", reservation_expires_at: null }, now), "new with null window stays");

  // constants + note pinned
  ok(RESERVATION_WINDOW_HOURS === 24, "window is 24h");
  ok(EXPIRABLE_STATUS === "new", "only new expires");
  const note = reservationExpiryNote(past);
  ok(note.includes("24-hour pickup window") && note.includes(past), "note names window + timestamp");
  ok(reservationExpiryNote(null).includes("24-hour pickup window"), "note works without timestamp");
  ok(RESERVATION_SWEEP_ACTOR.includes("system"), "actor label names the machine");
}
