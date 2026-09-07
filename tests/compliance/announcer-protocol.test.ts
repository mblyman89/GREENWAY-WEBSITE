/**
 * tests/compliance/announcer-protocol.test.ts
 *
 * SLICE 28 — vitest mirror for the Pi/site wire protocol.
 *
 * Beyond re-running the embedded self-tests, this file pins the behaviours
 * that keep a HEADLESS device debuggable. The Raspberry Pi is the one client
 * of this system nobody can open a browser and inspect; the only evidence
 * available when it misbehaves is what the server said to it. So the tests
 * below are mostly about the quality of refusals, not the happy path.
 */
import { describe, it, expect } from "vitest";
import {
  __runAnnouncerProtocolTests,
  DEVICE_ID_HEADER,
  DEVICE_KEY_HEADER,
  MAX_ACK_IDS,
  badRequest,
  parseAckRequest,
  parseCredentials,
  parseHeartbeatRequest,
  parsePairRequest,
  resolveHoldSeconds,
  resolveJobLimit,
  sanitizeAgentInfo,
  toJob,
  unauthorized,
  unavailable,
} from "../../src/lib/announcer/announcer-protocol-core";
import { POLL_HOLD_SECONDS } from "../../src/lib/announcer/announcer-core";

const UID = "0f9a1c2d-3e4b-4a5c-8d7e-6f5a4b3c2d1e";
const hdr = (m: Record<string, string>) => (n: string) => m[n] ?? null;

describe("announcer-protocol embedded self-tests", () => {
  it("all pass", () => {
    const r = __runAnnouncerProtocolTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(60);
  });
});

describe("a headless device must be diagnosable from its error alone", () => {
  it("distinguishes a missing id from a missing key", () => {
    // These are different physical problems. A missing id means the config
    // file was never written; a missing key means it was written but
    // truncated. The troubleshooting manual keys off exactly this difference,
    // so collapsing them into one message would break the manual.
    const noId = parseCredentials(hdr({ [DEVICE_KEY_HEADER]: "k" }));
    const noKey = parseCredentials(hdr({ [DEVICE_ID_HEADER]: UID }));
    expect(noId.ok).toBe(false);
    expect(noKey.ok).toBe(false);
    if (!noId.ok && !noKey.ok) expect(noId.error).not.toBe(noKey.error);
  });

  it("tells the agent whether retrying can ever help", () => {
    // Getting this wrong is how a device hammers a dead endpoint all night, or
    // conversely gives up on a two-second blip.
    expect(unauthorized("bad key").retryable).toBe(false);
    expect(badRequest("malformed").retryable).toBe(false);
    expect(unavailable("db down").retryable).toBe(true);
  });

  it("attaches a human instruction to the errors a human must fix", () => {
    expect((unauthorized("x").hint ?? "").length).toBeGreaterThan(0);
    expect((unavailable("x").hint ?? "").length).toBeGreaterThan(0);
  });
});

describe("the poll can never outlive the platform's function ceiling", () => {
  it("caps any hold the agent asks for", () => {
    // A request that outlives maxDuration is truncated, and a truncated
    // response looks to the agent exactly like an outage.
    for (const asked of [26, 60, 120, 100000]) {
      expect(resolveHoldSeconds(asked)).toBe(POLL_HOLD_SECONDS);
    }
    expect(resolveHoldSeconds(99999)).toBeLessThan(60);
  });

  it("honours a SHORTER hold, because a flaky uplink may want one", () => {
    expect(resolveHoldSeconds(5)).toBe(5);
    expect(resolveHoldSeconds(1)).toBe(1);
  });

  it("never refuses a poll over a badly phrased request", () => {
    for (const junk of [undefined, null, "twenty", {}, [], Number.NaN]) {
      expect(resolveHoldSeconds(junk)).toBeGreaterThan(0);
      expect(resolveJobLimit(junk)).toBeGreaterThan(0);
    }
  });
});

describe("one bad row must not silence the shop", () => {
  const good = {
    id: 7,
    kind: "order",
    message: "New online order.",
    sound: "chime",
    volume: 80,
    created_at: "2026-03-10T12:00:00.000Z",
  };

  it("skips a malformed row instead of throwing", () => {
    for (const junk of [null, undefined, "x", 5, {}, { id: 1 }]) {
      expect(() => toJob(junk)).not.toThrow();
    }
  });

  it("keeps the good rows when one row in a batch is bad", () => {
    const rows = [good, null, { ...good, id: 8 }];
    const jobs = rows.map(toJob).filter((j) => j !== null);
    expect(jobs).toHaveLength(2);
  });

  it("repairs a job rather than dropping it where it safely can", () => {
    // Missing sound and bad volume are recoverable; an empty message is not,
    // because a job that says nothing is worse than no job at all.
    expect(toJob({ ...good, sound: "" })?.sound).toBe("chime");
    expect(toJob({ ...good, volume: "loud" })?.volume).toBe(70);
    expect(toJob({ ...good, message: "   " })).toBeNull();
  });

  it("never lets a rogue volume through", () => {
    expect(toJob({ ...good, volume: 9999 })?.volume).toBe(100);
    expect(toJob({ ...good, volume: -9999 })?.volume).toBe(0);
  });
});

describe("acks are forgiving because agents retry them", () => {
  it("treats an empty ack as success", () => {
    const r = parseAckRequest({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.played).toEqual([]);
      expect(r.request.failed).toEqual([]);
    }
  });

  it("degrades a wrong-typed field instead of refusing the whole ack", () => {
    const r = parseAckRequest({ played: "nope", failed: 5 });
    expect(r.ok).toBe(true);
  });

  it("always records SOME reason for a failure", () => {
    // An activity log entry that says a job failed but not why is the thing
    // that makes a support call impossible.
    const r = parseAckRequest({ failed: [{ id: "1" }, { id: "2", reason: "" }] });
    expect(r.ok).toBe(true);
    if (r.ok) for (const f of r.request.failed) expect(f.reason.trim().length).toBeGreaterThan(0);
  });

  it("bounds the request body", () => {
    const r = parseAckRequest({
      played: Array.from({ length: 10000 }, (_, i) => String(i)),
      failed: Array.from({ length: 10000 }, (_, i) => ({ id: String(i), reason: "x" })),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.played.length).toBe(MAX_ACK_IDS);
      expect(r.request.failed.length).toBe(MAX_ACK_IDS);
    }
  });
});

describe("self-reported agent info is never trusted", () => {
  it("drops nested structures entirely", () => {
    expect(sanitizeAgentInfo({ a: { deep: true }, b: [1, 2], c: "ok" })).toEqual({ c: "ok" });
  });

  it("bounds both the key count and the value length", () => {
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, "x".repeat(1000)]));
    const out = sanitizeAgentInfo(big);
    expect(Object.keys(out).length).toBeLessThanOrEqual(20);
    for (const v of Object.values(out)) expect(String(v).length).toBeLessThanOrEqual(200);
  });

  it("never throws on hostile input", () => {
    for (const junk of [null, undefined, "x", 5, [], [[]], { a: undefined }]) {
      expect(() => sanitizeAgentInfo(junk)).not.toThrow();
    }
  });
});

describe("pairing is strict about the code and lenient about everything else", () => {
  it("accepts the code however a human typed it", () => {
    for (const typed of ["ABCD2345", "abcd2345", "ABCD-2345", " abcd 2345 "]) {
      const r = parsePairRequest({ code: typed });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.request.code).toBe("ABCD2345");
    }
  });

  it("refuses a wrong-length code with an actionable message", () => {
    const r = parsePairRequest({ code: "ABC" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("announcer page");
  });

  it("does not require agent info", () => {
    expect(parsePairRequest({ code: "ABCD2345" }).ok).toBe(true);
  });
});

describe("a heartbeat is never refused", () => {
  it("accepts any body at all", () => {
    for (const junk of [null, undefined, "x", 5, [], {}]) {
      expect(() => parseHeartbeatRequest(junk)).not.toThrow();
      expect(parseHeartbeatRequest(junk).agentInfo).toBeDefined();
    }
  });
});
