/**
 * USAGE-4 — the announcer poll no longer holds a Vercel instance open for an
 * agent that rests on its own.
 *
 * What this pins, and why:
 *
 *   1. The pure module's own self-tests pass and are numerous (an empty suite
 *      has zero failures; rule 15 wants proof the tests can fail).
 *   2. The decision table: modern agent → hold 0; legacy/unknown agent → the
 *      classic POLL_HOLD_SECONDS; disabled speaker → hold 0, longest rest.
 *   3. The route actually USES the decision (a pure module nobody imports
 *      saves nothing) and reads the real `user-agent` header.
 *   4. The agent's clamp and User-Agent format, which the server now relies
 *      on, are what the Pi source really says.
 *   5. The selftest runner registers the module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEVICE_ONLINE_GRACE_SECONDS,
  POLL_HOLD_SECONDS,
  POLL_IDLE_REST_SECONDS,
} from "../../src/lib/announcer/announcer-core";
import {
  AGENT_MAX_IDLE_REST_SECONDS,
  AGENT_USER_AGENT_PREFIX,
  DISABLED_IDLE_REST_SECONDS,
  QUICK_POLL_HOLD_SECONDS,
  QUICK_POLL_MIN_AGENT_VERSION,
  __runAnnouncerPollShapeTests,
  agentRestsBetweenPolls,
  parseAgentVersion,
  resolvePollShape,
} from "../../src/lib/announcer/announcer-poll-shape-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const route = read("src/app/api/announcer/poll/route.ts");
const agent = read("pi-agent/greenway_announcer.py");
const served = read("public/announcer/greenway_announcer.py");
const runner = read("scripts/compliance/run-pure-selftests.ts");

describe("announcer-poll-shape-core self-tests", () => {
  it("pass, and there are many of them", () => {
    const r = __runAnnouncerPollShapeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(40);
  });
});

describe("the decision table", () => {
  const modern = `${AGENT_USER_AGENT_PREFIX}${QUICK_POLL_MIN_AGENT_VERSION}`;

  it("a modern agent is answered at once and told to rest", () => {
    const s = resolvePollShape({ userAgent: modern, requestedHold: undefined, enabled: true });
    expect(s).toEqual({ holdSeconds: 0, idleRestSeconds: POLL_IDLE_REST_SECONDS, reason: "quick" });
    expect(QUICK_POLL_HOLD_SECONDS).toBe(0);
  });

  it("a legacy agent (1.1.0) keeps the classic hold, because it does not rest", () => {
    const s = resolvePollShape({ userAgent: `${AGENT_USER_AGENT_PREFIX}1.1.0`, requestedHold: undefined, enabled: true });
    expect(s.holdSeconds).toBe(POLL_HOLD_SECONDS);
    expect(s.reason).toBe("legacy-hold");
  });

  it("an unknown or missing user-agent is treated as legacy — the slow default is the safe one", () => {
    for (const ua of [null, undefined, "", "python-requests/2.31.0", "curl/8.0", "greenway-printer/1.1.0"]) {
      expect(resolvePollShape({ userAgent: ua, requestedHold: undefined, enabled: true }).holdSeconds).toBe(POLL_HOLD_SECONDS);
      expect(agentRestsBetweenPolls(ua)).toBe(false);
    }
  });

  it("a disabled speaker is never held and rests the longest the agent accepts", () => {
    for (const ua of [modern, `${AGENT_USER_AGENT_PREFIX}1.1.0`, null]) {
      const s = resolvePollShape({ userAgent: ua, requestedHold: 25, enabled: false });
      expect(s.holdSeconds).toBe(0);
      expect(s.idleRestSeconds).toBe(DISABLED_IDLE_REST_SECONDS);
      expect(s.reason).toBe("disabled");
    }
  });

  it("future agent versions are treated as modern", () => {
    for (const v of ["1.2.1", "1.3.0", "1.10.0", "2.0.0"]) {
      expect(agentRestsBetweenPolls(`${AGENT_USER_AGENT_PREFIX}${v}`)).toBe(true);
    }
    // and 1.10.0 really is newer than 1.2.0 (numeric, not lexical)
    expect(parseAgentVersion(`${AGENT_USER_AGENT_PREFIX}1.10.0`)).toEqual([1, 10, 0]);
  });

  it("keeps every cycle inside the online grace so the dot cannot flicker", () => {
    expect(QUICK_POLL_HOLD_SECONDS + POLL_IDLE_REST_SECONDS + 15).toBeLessThan(DEVICE_ONLINE_GRACE_SECONDS);
    expect(QUICK_POLL_HOLD_SECONDS + DISABLED_IDLE_REST_SECONDS + 15).toBeLessThan(DEVICE_ONLINE_GRACE_SECONDS);
    expect(DISABLED_IDLE_REST_SECONDS).toBeLessThanOrEqual(AGENT_MAX_IDLE_REST_SECONDS);
  });
});

describe("the route really uses the decision", () => {
  it("imports resolvePollShape and feeds it the real user-agent header and the device's enabled flag", () => {
    expect(route).toMatch(/import \{ resolvePollShape \} from "@\/lib\/announcer\/announcer-poll-shape-core";/);
    expect(route).toMatch(/resolvePollShape\(\{\s*userAgent: req\.headers\.get\("user-agent"\),\s*requestedHold: b\.holdSeconds,\s*enabled: device\.enabled,\s*\}\)/);
    expect(route).toMatch(/const holdSeconds = shape\.holdSeconds;/);
  });

  it("both responses carry the shape's idleRestSeconds, not the bare constant", () => {
    const uses = route.match(/idleRestSeconds: shape\.idleRestSeconds,/g) ?? [];
    expect(uses.length).toBe(2);
    expect(route).not.toMatch(/idleRestSeconds: POLL_IDLE_REST_SECONDS,/);
  });

  it("the deadline check still runs the first claim immediately, so a zero hold is one claim, not none", () => {
    // The loop body must claim BEFORE testing the deadline; that is what makes
    // holdSeconds = 0 mean "one look" rather than "no look".
    const loopStart = route.indexOf("for (;;) {");
    const firstClaim = route.indexOf("await claimWork(device.id, limit)", loopStart);
    const deadlineTest = route.indexOf("if (Date.now() + CHECK_INTERVAL_MS >= deadline) break;", loopStart);
    expect(loopStart).toBeGreaterThan(-1);
    expect(firstClaim).toBeGreaterThan(loopStart);
    expect(deadlineTest).toBeGreaterThan(firstClaim);
  });

  it("still reports the protocol ceiling as pollHoldSeconds (the agent sizes its timeout from it)", () => {
    expect(route).toMatch(/pollHoldSeconds: POLL_HOLD_SECONDS,/);
  });
});

describe("the agent facts the server now relies on are true in the Pi source", () => {
  it("every agent sends user-agent greenway-announcer/<AGENT_VERSION>", () => {
    expect(agent).toContain('"user-agent": f"greenway-announcer/{AGENT_VERSION}"');
    expect(AGENT_USER_AGENT_PREFIX).toBe("greenway-announcer/");
  });

  it("the shipped agent is at least the version the quick shape requires", () => {
    const m = /^AGENT_VERSION = "(\d+\.\d+\.\d+)"/m.exec(agent);
    expect(m).not.toBeNull();
    expect(agentRestsBetweenPolls(`${AGENT_USER_AGENT_PREFIX}${m![1]}`)).toBe(true);
  });

  it("the agent's rest clamp matches the constant the server assumes", () => {
    const m = /^MAX_IDLE_REST_SECONDS = (\d+)/m.exec(agent);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(AGENT_MAX_IDLE_REST_SECONDS);
  });

  it("the agent's poll timeout still exceeds the classic hold (legacy path unchanged)", () => {
    const m = /^POLL_TIMEOUT_SECONDS = (\d+)/m.exec(agent);
    expect(Number(m![1])).toBeGreaterThan(POLL_HOLD_SECONDS);
  });

  it("the served copy is byte-identical to the source", () => {
    expect(served).toBe(agent);
  });
});

describe("the selftest runner registers the module", () => {
  it("imports and asserts a minimum count", () => {
    expect(runner).toMatch(/__runAnnouncerPollShapeTests\b.*announcer-poll-shape-core/);
    expect(runner).toMatch(/assertRan\("announcer-poll-shape-core", __runAnnouncerPollShapeTests\(\), 40\)/);
  });
});
