/**
 * tests/compliance/pin-throttle-core.test.ts (Task AN-8)
 *
 * Vitest mirror of the pure durable-PIN-throttle core: same 5-fails/60s →
 * 60s-lock policy as S-10, computed over a durable per-scope row.
 */
import { describe, expect, it } from "vitest";
import {
  THROTTLE_MAX_FAILURES,
  THROTTLE_WINDOW_MS,
  THROTTLE_LOCK_MS,
  TIMECLOCK_THROTTLE_SCOPE,
  deviceThrottleScope,
  emptyThrottleState,
  parseThrottleState,
  recordThrottleFailure,
  throttleBlockedMessage,
  __runPinThrottleCoreTests,
} from "@/lib/security/pin-throttle-core";

const T0 = 1_000_000_000;

describe("pin-throttle-core (AN-8)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runPinThrottleCoreTests()).not.toThrow();
  });

  it("policy constants match S-10", () => {
    expect(THROTTLE_MAX_FAILURES).toBe(5);
    expect(THROTTLE_WINDOW_MS).toBe(60_000);
    expect(THROTTLE_LOCK_MS).toBe(60_000);
  });

  it("locks after 5 failures in the window, then unlocks", () => {
    let s = emptyThrottleState();
    expect(throttleBlockedMessage(s, T0)).toBeNull();
    for (let i = 0; i < 5; i++) s = recordThrottleFailure(s, T0 + i * 1000);
    expect(throttleBlockedMessage(s, T0 + 5000)).toContain("Too many wrong PINs");
    expect(s.lockedUntilMs).toBe(T0 + 4000 + THROTTLE_LOCK_MS);
    expect(s.failureTimes).toEqual([]);
    expect(throttleBlockedMessage(s, T0 + 4000 + THROTTLE_LOCK_MS)).toBeNull();
  });

  it("failures age out of the 60s window", () => {
    let s = emptyThrottleState();
    for (let i = 0; i < 4; i++) s = recordThrottleFailure(s, T0 + i * 1000);
    s = recordThrottleFailure(s, T0 + 70_000);
    expect(throttleBlockedMessage(s, T0 + 70_001)).toBeNull();
    expect(s.failureTimes).toHaveLength(1);
  });

  it("parseThrottleState never trusts garbage", () => {
    // Non-array json → empty
    expect(parseThrottleState("nope", null, T0)).toEqual(emptyThrottleState());
    // Non-numbers and future timestamps dropped
    expect(
      parseThrottleState([T0 - 500, "x", null, {}, T0 + 999_999], null, T0).failureTimes,
    ).toEqual([T0 - 500]);
    // Malformed / expired / impossibly-far locks all ignored
    expect(parseThrottleState([], "garbage", T0).lockedUntilMs).toBeNull();
    expect(parseThrottleState([], new Date(T0 - 1).toISOString(), T0).lockedUntilMs).toBeNull();
    expect(
      parseThrottleState([], new Date(T0 + THROTTLE_LOCK_MS + 1000).toISOString(), T0).lockedUntilMs,
    ).toBeNull();
    // A legitimate in-window lock is honored
    expect(
      parseThrottleState([], new Date(T0 + 30_000).toISOString(), T0).lockedUntilMs,
    ).toBe(T0 + 30_000);
  });

  it("scope keys are per entry point", () => {
    expect(deviceThrottleScope("dev-1")).toBe("pos-device:dev-1");
    expect(deviceThrottleScope("dev-2")).not.toBe(deviceThrottleScope("dev-1"));
    expect(TIMECLOCK_THROTTLE_SCOPE).toBe("timeclock");
  });

  it("lock message counts down in whole seconds", () => {
    const s = { failureTimes: [], lockedUntilMs: T0 + 2500 };
    expect(throttleBlockedMessage(s, T0)).toContain("3 more seconds");
    expect(throttleBlockedMessage({ failureTimes: [], lockedUntilMs: T0 + 1000 }, T0)).toContain(
      "1 more second.",
    );
  });
});
