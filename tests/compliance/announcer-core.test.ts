/**
 * tests/compliance/announcer-core.test.ts
 *
 * SLICE 27 — vitest mirror for the online order announcer decision layer.
 *
 * The module carries its own self-tests and CI runs them through
 * scripts/compliance/run-pure-selftests.ts. This file exists for two reasons
 * beyond re-running them: it puts the announcer in the same suite as
 * everything else so a regression shows up in the ordinary test report, and it
 * pins the handful of behaviours that are load-bearing for the SHOP rather
 * than for the code — the ones where being wrong means somebody standing at
 * the counter never gets served.
 */
import { describe, it, expect } from "vitest";
import {
  __runAnnouncerCoreTests,
  ANNOUNCEMENT_TTL_SECONDS,
  BUILT_IN_SOUNDS,
  CLAIM_LEASE_SECONDS,
  DEFAULT_VOLUME,
  DEVICE_ONLINE_GRACE_SECONDS,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  POLL_HOLD_SECONDS,
  announcementText,
  deviceHealth,
  deviceNextAction,
  isClaimable,
  isWithinQuietHours,
  normalizeVolume,
  pairingCodeValidity,
  pollBackoffSeconds,
  resolveSound,
} from "../../src/lib/announcer/announcer-core";

const NOW = "2026-03-10T12:00:00.000Z";

describe("announcer-core embedded self-tests", () => {
  it("all pass", () => {
    const r = __runAnnouncerCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(150);
  });
});

describe("the platform constraint that shaped this design", () => {
  it("holds a poll well under the 60s serverless ceiling", () => {
    // The longest maxDuration in this repository is 60 (see
    // src/app/api/pos/sync/route.ts). Anything at or near that ceiling gets
    // truncated by the platform, and a truncated poll looks to the Pi exactly
    // like an outage. Better than 2x margin, on purpose.
    expect(POLL_HOLD_SECONDS).toBeLessThan(60);
    expect(POLL_HOLD_SECONDS * 2).toBeLessThan(60);
  });

  it("recovers from an outage in under a minute", () => {
    // Backoff must never grow into minutes. When the internet comes back, the
    // shop should start hearing orders again without anyone touching anything.
    for (let i = 1; i <= 200; i += 1) {
      expect(pollBackoffSeconds(i)).toBeLessThanOrEqual(30);
    }
  });
});

describe("the shop must never go silently deaf", () => {
  it("a deleted custom upload falls back to a real sound, not to silence", () => {
    const r = resolveSound({
      deviceSoundId: "chime",
      deviceCustomPath: "uploads/deleted.mp3",
      defaultSoundId: "bell",
      availableCustomPaths: [],
    });
    expect(r).toEqual({ kind: "built-in", id: "chime" });
  });

  it("resolves to a real sound even when every single input is junk", () => {
    const r = resolveSound({
      deviceSoundId: null,
      deviceCustomPath: null,
      defaultSoundId: null,
      availableCustomPaths: [],
    });
    expect(r.kind).toBe("built-in");
    expect(BUILT_IN_SOUNDS.some((s) => s.id === (r as { id: string }).id)).toBe(true);
  });

  it("a missing volume setting does not mute the speaker", () => {
    // Number(null) and Number("") are both 0 in JavaScript, which would mean a
    // muted speaker. This is the exact bug the self-tests caught during
    // development, so it gets pinned here too.
    for (const junk of [null, undefined, "", "   ", [], false, {}, "loud", Number.NaN]) {
      expect(normalizeVolume(junk)).toBe(DEFAULT_VOLUME);
    }
  });

  it("an unparseable quiet-hours setting fails OPEN and still announces", () => {
    // A missed order costs a customer. An unexpected chime costs nothing.
    expect(isWithinQuietHours({ nowMinutes: 180, startRaw: "garbage", endRaw: "08:00" })).toBe(false);
    expect(isWithinQuietHours({ nowMinutes: 180, startRaw: null, endRaw: null })).toBe(false);
  });
});

describe("overnight quiet hours", () => {
  const night = { startRaw: "21:00", endRaw: "08:00" } as const;

  it("is quiet across midnight", () => {
    expect(isWithinQuietHours({ nowMinutes: 1260, ...night })).toBe(true); // 21:00
    expect(isWithinQuietHours({ nowMinutes: 0, ...night })).toBe(true); // 00:00
    expect(isWithinQuietHours({ nowMinutes: 479, ...night })).toBe(true); // 07:59
  });

  it("is NOT quiet during business hours", () => {
    // If this ever flips, the shop stops hearing orders all day and the bug
    // looks like broken hardware. It is the single most expensive way this
    // feature can fail.
    for (const minutes of [480, 540, 720, 900, 1020, 1259]) {
      expect(isWithinQuietHours({ nowMinutes: minutes, ...night })).toBe(false);
    }
  });

  it("treats start === end as disabled rather than always-quiet", () => {
    for (const minutes of [0, 60, 600, 1200, 1439]) {
      expect(isWithinQuietHours({ nowMinutes: minutes, startRaw: "10:00", endRaw: "10:00" })).toBe(false);
    }
  });
});

describe("the queue never shouts stale news", () => {
  it("refuses work older than the TTL", () => {
    // A speaker unplugged over lunch must not come back and announce eleven
    // orders that were collected an hour ago.
    const old = {
      createdAtIso: "2026-03-10T11:40:00.000Z",
      claimedAtIso: null,
      deliveredAtIso: null,
    };
    expect(isClaimable(old, NOW)).toBe(false);
  });

  it("still serves work inside the TTL", () => {
    const fresh = {
      createdAtIso: "2026-03-10T11:56:00.000Z",
      claimedAtIso: null,
      deliveredAtIso: null,
    };
    expect(isClaimable(fresh, NOW)).toBe(true);
  });

  it("lets a lapsed lease be reclaimed so a dead Pi cannot swallow an order", () => {
    const lapsed = {
      createdAtIso: "2026-03-10T11:57:00.000Z",
      claimedAtIso: "2026-03-10T11:58:00.000Z",
      deliveredAtIso: null,
    };
    expect(isClaimable(lapsed, NOW)).toBe(true);
  });

  it("respects a live lease so two Pis never double-play", () => {
    const held = {
      createdAtIso: "2026-03-10T11:59:30.000Z",
      claimedAtIso: "2026-03-10T11:59:40.000Z",
      deliveredAtIso: null,
    };
    expect(isClaimable(held, NOW)).toBe(false);
  });

  it("keeps the lease shorter than the TTL so retries can actually happen", () => {
    expect(CLAIM_LEASE_SECONDS).toBeLessThan(ANNOUNCEMENT_TTL_SECONDS);
  });
});

describe("every status tells a human what to do", () => {
  it("gives a non-empty next action for all four states", () => {
    for (const h of ["online", "stale", "offline", "never-seen"] as const) {
      expect(deviceNextAction(h).trim().length).toBeGreaterThan(0);
    }
  });

  it("distinguishes never-connected from went-quiet", () => {
    // Different fixes entirely: one means setup did not finish, the other
    // means something that worked has stopped.
    expect(deviceHealth({ lastSeenIso: null, nowIso: NOW })).toBe("never-seen");
    expect(deviceHealth({ lastSeenIso: "2026-03-10T10:00:00.000Z", nowIso: NOW })).toBe("offline");
    expect(deviceNextAction("never-seen")).not.toBe(deviceNextAction("offline"));
  });

  it("does not flag a device offline for one missed heartbeat", () => {
    // The Pi checks in about every POLL_HOLD_SECONDS. The grace window is
    // roughly three cycles so a single Wi-Fi roam does not scare anybody.
    expect(DEVICE_ONLINE_GRACE_SECONDS).toBeGreaterThan(POLL_HOLD_SECONDS * 2);
  });
});

describe("pairing codes survive being read across a room", () => {
  it("excludes every character pair people confuse", () => {
    for (const ch of ["0", "O", "1", "I", "L"]) {
      expect(PAIRING_ALPHABET.includes(ch)).toBe(false);
    }
  });

  it("accepts what a human actually types", () => {
    const created = "2026-03-10T11:30:00.000Z";
    for (const typed of ["ABCD2345", "abcd2345", "ABCD-2345", " abcd-2345 "]) {
      expect(
        pairingCodeValidity({ code: typed, createdAtIso: created, consumedAtIso: null, nowIso: NOW }).valid,
      ).toBe(true);
    }
  });

  it("explains every refusal instead of just saying no", () => {
    const created = "2026-03-10T11:30:00.000Z";
    const refusals = [
      { code: "ABC", createdAtIso: created, consumedAtIso: null, nowIso: NOW },
      { code: "ABCO2345", createdAtIso: created, consumedAtIso: null, nowIso: NOW },
      { code: "ABCD2345", createdAtIso: created, consumedAtIso: NOW, nowIso: NOW },
      { code: "ABCD2345", createdAtIso: "2026-03-10T10:00:00.000Z", consumedAtIso: null, nowIso: NOW },
    ];
    for (const r of refusals) {
      const v = pairingCodeValidity(r);
      expect(v.valid).toBe(false);
      if (!v.valid) expect(v.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("is eight characters", () => {
    expect(PAIRING_CODE_LENGTH).toBe(8);
  });
});

describe("what gets said out loud in a room with customers in it", () => {
  it("carries the order number and nothing else", () => {
    expect(announcementText({ orderNumber: "A-101", isTest: false })).toBe("New online order. Number A-101.");
  });

  it("still says something useful with no order number", () => {
    expect(announcementText({ orderNumber: null, isTest: false })).toBe("New online order.");
    expect(announcementText({ orderNumber: "  ", isTest: false })).toBe("New online order.");
  });

  it("makes a test obviously a test", () => {
    expect(announcementText({ orderNumber: "A-101", isTest: true }).toLowerCase()).toContain("test");
  });
});
