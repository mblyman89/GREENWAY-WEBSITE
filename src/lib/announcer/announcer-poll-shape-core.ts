/**
 * Announcer poll SHAPE — how long to hold THIS poll, and how long to tell the
 * Pi to rest afterwards (USAGE-4).
 *
 * PURE. No clock, no I/O. Self-tested at the bottom, registered in
 * scripts/compliance/run-pure-selftests.ts and mirrored in
 * tests/compliance/announcer-poll-shape.test.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * Vercel bills a function's provisioned memory for the whole time a request is
 * in flight, including while it sleeps waiting on the database. The announcer
 * long-poll held every request open for POLL_HOLD_SECONDS (25) and the Pi came
 * straight back after a 10-second rest, so one 2 GB instance was in flight
 * about 72% of every day per speaker — roughly $11 a month each, around the
 * clock, whether or not the shop was open (scripts/recon/announcer-poll-cost-model.mjs).
 *
 * The hold was only ever there to keep the Pi from hammering the site. Agent
 * v1.2.0 (USAGE-1) honours `idleRestSeconds` and sleeps between empty polls,
 * so for THAT agent the server can answer at once and let the Pi do the
 * waiting on its own CPU, which costs nothing. The worst-case time from order
 * to chime is unchanged (rest + one request ≈ 11 s); the mean moves from
 * about 3.5 s to about 6 s; the Vercel bill for the speaker drops by roughly
 * ten dollars a month per Pi.
 *
 * WHY THE AGENT VERSION MATTERS
 * -----------------------------
 * Agent v1.1.0 (the first installer) ignores `idleRestSeconds` and reconnects
 * the instant a poll returns. Verified: `git show 1328fa57:pi-agent/greenway_announcer.py`
 * has no rest in `run()` after a successful poll. Answer that agent
 * immediately and it polls twice a second — 170,000 requests a day and a
 * Supabase egress bill that dwarfs the memory it saved. So the hold is
 * REMOVED only for agents known to rest, and kept exactly as it was for
 * everything else. Every agent version has sent `user-agent:
 * greenway-announcer/<AGENT_VERSION>` since the first release, so the header
 * is the honest signal. An absent or unparseable header is treated as legacy:
 * the safe default is the slow one.
 *
 * DISABLED SPEAKERS
 * -----------------
 * A speaker the owner has switched off can never be given work, so it is
 * asked to rest the maximum the agent will accept (30 s, MAX_IDLE_REST_SECONDS
 * in the agent). It still heartbeats well inside the 90 s online grace, so it
 * stays green — healthy, just muted.
 */

import {
  DEVICE_ONLINE_GRACE_SECONDS,
  POLL_HOLD_SECONDS,
  POLL_IDLE_REST_SECONDS,
} from "./announcer-core";
import { resolveHoldSeconds } from "./announcer-protocol-core";

/** The prefix every agent release has put in its User-Agent header. */
export const AGENT_USER_AGENT_PREFIX = "greenway-announcer/";

/** First agent that honours `idleRestSeconds` (USAGE-1). */
export const QUICK_POLL_MIN_AGENT_VERSION = "1.2.0";

/**
 * Hold for an agent that rests on its own. Zero: one immediate claim, then
 * answer. The check loop in the route still runs its first check at t=0, so
 * a queued announcement is still found on this poll.
 */
export const QUICK_POLL_HOLD_SECONDS = 0;

/**
 * Rest asked of a DISABLED speaker. Must not exceed the agent's clamp
 * (MAX_IDLE_REST_SECONDS = 30 in pi-agent/greenway_announcer.py) or the
 * agent silently rounds it down and the constant lies.
 */
export const DISABLED_IDLE_REST_SECONDS = 30;

/** Mirrors MAX_IDLE_REST_SECONDS in the agent; pinned here so a drift fails a test. */
export const AGENT_MAX_IDLE_REST_SECONDS = 30;

export type AgentVersion = readonly [number, number, number];

/**
 * "greenway-announcer/1.2.0" → [1, 2, 0]. Anything else → null.
 * Tolerates a suffix after the version (e.g. "greenway-announcer/1.2.0 (pi)")
 * but not a missing or partial version. Never throws.
 */
export function parseAgentVersion(userAgent: string | null | undefined): AgentVersion | null {
  if (typeof userAgent !== "string") return null;
  const ua = userAgent.trim();
  if (!ua.toLowerCase().startsWith(AGENT_USER_AGENT_PREFIX)) return null;
  const rest = ua.slice(AGENT_USER_AGENT_PREFIX.length);
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:$|[^\d.])/.exec(rest);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Standard three-part comparison. -1 if a < b, 0 if equal, 1 if a > b. */
export function compareAgentVersions(a: AgentVersion, b: AgentVersion): -1 | 0 | 1 {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

const MIN_QUICK = parseAgentVersion(AGENT_USER_AGENT_PREFIX + QUICK_POLL_MIN_AGENT_VERSION) as AgentVersion;

/**
 * Does this agent sleep for `idleRestSeconds` after an empty poll?
 * Unknown → false. The safe answer is the one that keeps the hold.
 */
export function agentRestsBetweenPolls(userAgent: string | null | undefined): boolean {
  const v = parseAgentVersion(userAgent);
  if (v === null) return false;
  return compareAgentVersions(v, MIN_QUICK) >= 0;
}

export type PollShapeReason = "disabled" | "quick" | "legacy-hold";

export type PollShape = {
  /** Seconds the route should hold this poll open looking for work. */
  holdSeconds: number;
  /** Seconds the agent should rest after an EMPTY answer. */
  idleRestSeconds: number;
  reason: PollShapeReason;
};

/**
 * Decide the shape of one poll.
 *
 *   disabled speaker  → no hold, longest rest the agent accepts
 *   agent ≥ 1.2.0     → no hold, normal rest (the Pi does the waiting)
 *   anything else     → the classic hold (the Pi does NOT rest, so the server must)
 *
 * `requestedHold` is the agent's optional `holdSeconds` body field; legacy
 * agents may still ask for a shorter hold and are honoured exactly as before.
 */
export function resolvePollShape(input: {
  userAgent: string | null | undefined;
  requestedHold: unknown;
  enabled: boolean;
}): PollShape {
  if (!input.enabled) {
    return { holdSeconds: 0, idleRestSeconds: DISABLED_IDLE_REST_SECONDS, reason: "disabled" };
  }
  if (agentRestsBetweenPolls(input.userAgent)) {
    return { holdSeconds: QUICK_POLL_HOLD_SECONDS, idleRestSeconds: POLL_IDLE_REST_SECONDS, reason: "quick" };
  }
  return {
    holdSeconds: resolveHoldSeconds(input.requestedHold),
    idleRestSeconds: POLL_IDLE_REST_SECONDS,
    reason: "legacy-hold",
  };
}

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runAnnouncerPollShapeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-poll-shape FAIL: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown): void => check(label, JSON.stringify(a) === JSON.stringify(b));

  // ---- version parsing ---------------------------------------------------
  eq("ua: 1.2.0 parses", parseAgentVersion("greenway-announcer/1.2.0"), [1, 2, 0]);
  eq("ua: 1.1.0 parses", parseAgentVersion("greenway-announcer/1.1.0"), [1, 1, 0]);
  eq("ua: 10.0.3 parses multi-digit", parseAgentVersion("greenway-announcer/10.0.3"), [10, 0, 3]);
  eq("ua: suffix after version is tolerated", parseAgentVersion("greenway-announcer/1.2.0 (Raspberry Pi)"), [1, 2, 0]);
  eq("ua: surrounding whitespace is tolerated", parseAgentVersion("  greenway-announcer/1.2.0  "), [1, 2, 0]);
  eq("ua: prefix is case-insensitive", parseAgentVersion("Greenway-Announcer/1.2.0"), [1, 2, 0]);
  check("ua: null is unknown", parseAgentVersion(null) === null);
  check("ua: undefined is unknown", parseAgentVersion(undefined) === null);
  check("ua: empty is unknown", parseAgentVersion("") === null);
  check("ua: python-requests default UA is unknown", parseAgentVersion("python-requests/2.31.0") === null);
  check("ua: a browser is unknown", parseAgentVersion("Mozilla/5.0") === null);
  check("ua: two-part version is unknown", parseAgentVersion("greenway-announcer/1.2") === null);
  check("ua: four-part version is unknown (1.2.0.1)", parseAgentVersion("greenway-announcer/1.2.0.1") === null);
  check("ua: missing version is unknown", parseAgentVersion("greenway-announcer/") === null);
  check("ua: non-numeric version is unknown", parseAgentVersion("greenway-announcer/latest") === null);
  check("ua: printer agent is NOT an announcer", parseAgentVersion("greenway-printer/1.1.0") === null);

  // ---- version comparison ------------------------------------------------
  eq("cmp: equal", compareAgentVersions([1, 2, 0], [1, 2, 0]), 0);
  eq("cmp: patch greater", compareAgentVersions([1, 2, 1], [1, 2, 0]), 1);
  eq("cmp: minor less", compareAgentVersions([1, 1, 9], [1, 2, 0]), -1);
  eq("cmp: major wins over minor", compareAgentVersions([2, 0, 0], [1, 9, 9]), 1);

  // ---- does the agent rest? ---------------------------------------------
  check("rests: 1.2.0 rests", agentRestsBetweenPolls("greenway-announcer/1.2.0"));
  check("rests: 1.2.1 rests", agentRestsBetweenPolls("greenway-announcer/1.2.1"));
  check("rests: 1.3.0 rests", agentRestsBetweenPolls("greenway-announcer/1.3.0"));
  check("rests: 2.0.0 rests", agentRestsBetweenPolls("greenway-announcer/2.0.0"));
  check("rests: 1.1.0 does NOT rest — it would spin", !agentRestsBetweenPolls("greenway-announcer/1.1.0"));
  check("rests: 1.0.0 does NOT rest", !agentRestsBetweenPolls("greenway-announcer/1.0.0"));
  check("rests: unknown agent is assumed NOT to rest", !agentRestsBetweenPolls(null));
  check("rests: python-requests default UA is assumed NOT to rest", !agentRestsBetweenPolls("python-requests/2.31.0"));

  // ---- the shape itself -------------------------------------------------
  const modern = "greenway-announcer/1.2.0";
  const legacy = "greenway-announcer/1.1.0";

  const quick = resolvePollShape({ userAgent: modern, requestedHold: undefined, enabled: true });
  eq("shape: modern agent gets no hold", quick.holdSeconds, QUICK_POLL_HOLD_SECONDS);
  eq("shape: modern agent gets the normal rest", quick.idleRestSeconds, POLL_IDLE_REST_SECONDS);
  eq("shape: modern agent reason is quick", quick.reason, "quick");
  check(
    "shape: modern agent ignores a requested hold (server does not wait for a Pi that rests)",
    resolvePollShape({ userAgent: modern, requestedHold: 25, enabled: true }).holdSeconds === 0,
  );

  const old = resolvePollShape({ userAgent: legacy, requestedHold: undefined, enabled: true });
  eq("shape: legacy agent keeps the classic hold", old.holdSeconds, POLL_HOLD_SECONDS);
  eq("shape: legacy agent reason is legacy-hold", old.reason, "legacy-hold");
  eq(
    "shape: legacy agent's shorter requested hold is still honoured",
    resolvePollShape({ userAgent: legacy, requestedHold: 10, enabled: true }).holdSeconds,
    10,
  );
  eq(
    "shape: legacy agent's longer requested hold is still capped",
    resolvePollShape({ userAgent: legacy, requestedHold: 300, enabled: true }).holdSeconds,
    POLL_HOLD_SECONDS,
  );
  eq(
    "shape: NO user-agent at all is treated as legacy",
    resolvePollShape({ userAgent: null, requestedHold: undefined, enabled: true }).holdSeconds,
    POLL_HOLD_SECONDS,
  );

  const off = resolvePollShape({ userAgent: modern, requestedHold: undefined, enabled: false });
  eq("shape: disabled speaker is not held", off.holdSeconds, 0);
  eq("shape: disabled speaker rests the maximum", off.idleRestSeconds, DISABLED_IDLE_REST_SECONDS);
  eq("shape: disabled reason", off.reason, "disabled");
  eq(
    "shape: disabled beats legacy — an old agent that is switched off is not held either",
    resolvePollShape({ userAgent: legacy, requestedHold: undefined, enabled: false }).holdSeconds,
    0,
  );

  // ---- the inequalities that keep the dot green ---------------------------
  check(
    "grace: disabled rest is within the agent's clamp, so the number is honest",
    DISABLED_IDLE_REST_SECONDS <= AGENT_MAX_IDLE_REST_SECONDS,
  );
  check(
    "grace: disabled cycle (rest + slow request) heartbeats inside the online grace",
    QUICK_POLL_HOLD_SECONDS + DISABLED_IDLE_REST_SECONDS + 15 < DEVICE_ONLINE_GRACE_SECONDS,
  );
  check(
    "grace: quick cycle heartbeats inside the online grace",
    QUICK_POLL_HOLD_SECONDS + POLL_IDLE_REST_SECONDS + 15 < DEVICE_ONLINE_GRACE_SECONDS,
  );
  check("cost: the quick hold is genuinely zero — no server-side waiting for a Pi that rests", QUICK_POLL_HOLD_SECONDS === 0);
  check(
    "latency: worst case for a modern agent is no worse than today (rest + request vs hold + rest)",
    QUICK_POLL_HOLD_SECONDS + POLL_IDLE_REST_SECONDS <= POLL_HOLD_SECONDS + POLL_IDLE_REST_SECONDS,
  );
  check(
    "egress: a quick poll does not reconnect faster than every 5 s (idle rest is long enough)",
    POLL_IDLE_REST_SECONDS >= 5,
  );

  return { passed, failed };
}
