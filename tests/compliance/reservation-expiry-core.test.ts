/**
 * tests/compliance/reservation-expiry-core.test.ts  (GW-028)
 *
 * Vitest mirror of the embedded self-tests plus targeted checks on the
 * 24h reservation-window policy the daily sweep enforces.
 */
import { describe, expect, it } from "vitest";
import {
  EXPIRABLE_STATUS,
  RESERVATION_SWEEP_ACTOR,
  RESERVATION_WINDOW_HOURS,
  computeReservationExpiresAt,
  isReservationExpired,
  reservationExpiryNote,
  shouldExpireOrder,
  __runReservationExpiryTests,
} from "@/lib/orders/reservation-expiry-core";

describe("reservation-expiry-core (GW-028)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runReservationExpiryTests()).not.toThrow();
  });

  it("the window is exactly 24 hours", () => {
    expect(RESERVATION_WINDOW_HOURS).toBe(24);
    const now = Date.parse("2026-05-01T12:00:00.000Z");
    expect(computeReservationExpiresAt(now)).toBe("2026-05-02T12:00:00.000Z");
  });

  it("only stale `new` orders expire — a human-owned order is never closed", () => {
    const now = Date.parse("2026-05-03T00:00:00.000Z");
    const past = "2026-05-01T00:00:00.000Z";
    expect(EXPIRABLE_STATUS).toBe("new");
    expect(shouldExpireOrder({ status: "new", reservation_expires_at: past }, now)).toBe(true);
    for (const status of ["acknowledged", "preparing", "ready", "completed", "cancelled", "no_show"]) {
      expect(shouldExpireOrder({ status, reservation_expires_at: past }, now)).toBe(false);
    }
  });

  it("fail-safe: broken timestamps never expire", () => {
    const now = Date.now();
    expect(isReservationExpired(null, now)).toBe(false);
    expect(isReservationExpired("garbage", now)).toBe(false);
    expect(shouldExpireOrder({ status: "new", reservation_expires_at: null }, now)).toBe(false);
  });

  it("the audit note and actor label tell the whole story", () => {
    const note = reservationExpiryNote("2026-05-02T12:00:00.000Z");
    expect(note).toContain("24-hour pickup window");
    expect(note).toContain("2026-05-02T12:00:00.000Z");
    expect(note).toContain("reopen it from the order page");
    expect(RESERVATION_SWEEP_ACTOR).toContain("reservation window sweep");
  });
});
