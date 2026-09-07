/**
 * SLICE 30 — what the back office tells Michael about the speakers.
 *
 * The self-tests in announcer-admin-core.ts cover the unit behaviour. This file
 * pins the things that would make the panel LIE, which is worse than the panel
 * being broken:
 *
 *   1. Saying "you will hear the next order" when the shop is actually silent.
 *   2. Saying nothing is wrong when the master switch is off.
 *   3. Reporting a busy mid-afternoon as quiet hours (the Slice 29 bug class).
 *   4. Showing a problem without showing the fix.
 */
import { describe, expect, it } from "vitest";

import {
  healthTone,
  relativeTimeLabel,
  soundLabel,
  summarizeShop,
  toDeviceView,
  type AdminDeviceView,
} from "@/lib/announcer/announcer-admin-core";

const NOW_ISO = "2026-03-10T12:00:00.000Z";
const BUILT = [
  { id: "chime", label: "Chime" },
  { id: "bell", label: "Bell" },
];

function view(over: {
  id?: string;
  name?: string;
  enabled?: boolean;
  lastSeen?: string | null;
}): AdminDeviceView {
  return toDeviceView({
    row: {
      id: over.id ?? "d",
      name: over.name ?? "Room",
      enabled: over.enabled ?? true,
      volume: 70,
      sound_id: "chime",
      custom_sound_path: null,
      last_seen_at: over.lastSeen === undefined ? NOW_ISO : over.lastSeen,
    },
    nowIso: NOW_ISO,
    builtIns: BUILT,
    defaultSoundId: "chime",
    defaultVolume: 70,
  });
}

const NOON_PACIFIC = new Date("2026-03-10T19:00:00Z");

function shop(over: Partial<Parameters<typeof summarizeShop>[0]> = {}) {
  return summarizeShop({
    devices: [view({ id: "a" })],
    globalEnabled: true,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "08:00",
    now: NOON_PACIFIC,
    ...over,
  });
}

describe("announcer panel — the verdict never lies about silence", () => {
  it("promises sound only when a speaker is actually online and enabled", () => {
    expect(shop().willAnnounce).toBe(true);
  });

  it("does not promise sound when the master switch is off", () => {
    const v = shop({ globalEnabled: false });
    expect(v.willAnnounce).toBe(false);
    expect(v.tone).toBe("bad");
  });

  it("does not promise sound when every speaker is offline", () => {
    const v = shop({ devices: [view({ id: "a", lastSeen: "2026-03-01T00:00:00.000Z" })] });
    expect(v.willAnnounce).toBe(false);
  });

  it("does not promise sound when every speaker is switched off", () => {
    const v = shop({ devices: [view({ id: "a", enabled: false })] });
    expect(v.willAnnounce).toBe(false);
  });

  it("does not promise sound when there are no speakers at all", () => {
    const v = shop({ devices: [] });
    expect(v.willAnnounce).toBe(false);
  });

  it("still promises sound when one of several speakers is down", () => {
    const v = shop({
      devices: [view({ id: "a" }), view({ id: "b", lastSeen: "2026-03-01T00:00:00.000Z" })],
    });
    expect(v.willAnnounce).toBe(true);
    expect(v.tone).toBe("warn");
  });
});

describe("announcer panel — the master switch outranks everything", () => {
  it("names the switch even when every speaker is perfectly healthy", () => {
    const v = shop({ globalEnabled: false, devices: [view({ id: "a" }), view({ id: "b" })] });
    expect(v.headline.toLowerCase()).toContain("off");
    expect(v.fix.length).toBeGreaterThan(0);
  });
});

describe("announcer panel — quiet hours are judged on shop time", () => {
  it("REGRESSION: 3PM Pacific is never reported as quiet hours", () => {
    // 22:00Z in June is 3:00 PM Pacific. A server-local clock would call this
    // the start of a 22:00 quiet window and wrongly report the shop as silent.
    const v = shop({
      quietHoursEnabled: true,
      now: new Date("2026-06-10T22:00:00Z"),
    });
    expect(v.willAnnounce).toBe(true);
  });

  it("reports genuine late-night quiet hours", () => {
    // 06:00Z in June is 11:00 PM Pacific.
    const v = shop({ quietHoursEnabled: true, now: new Date("2026-06-11T06:00:00Z") });
    expect(v.willAnnounce).toBe(false);
    expect(v.tone).toBe("warn");
  });

  it("reassures that quiet hours are normal rather than alarming", () => {
    const v = shop({ quietHoursEnabled: true, now: new Date("2026-06-11T06:00:00Z") });
    expect(v.fix.toLowerCase()).toContain("normal");
  });
});

describe("announcer panel — every problem arrives with its fix", () => {
  it("gives a fix for every unhappy verdict", () => {
    const unhappy = [
      shop({ devices: [] }),
      shop({ globalEnabled: false }),
      shop({ devices: [view({ id: "a", enabled: false })] }),
      shop({ devices: [view({ id: "a", lastSeen: null })] }),
      shop({ quietHoursEnabled: true, now: new Date("2026-06-11T06:00:00Z") }),
    ];
    for (const v of unhappy) {
      expect(v.willAnnounce).toBe(false);
      expect(v.fix.trim().length).toBeGreaterThan(0);
      expect(v.headline.trim().length).toBeGreaterThan(0);
    }
  });

  it("offers no busywork when everything is healthy", () => {
    expect(shop().fix).toBe("");
  });

  it("gives every device card a next action, healthy or not", () => {
    const cards = [
      view({ id: "a" }),
      view({ id: "b", lastSeen: "2026-03-10T11:50:00.000Z" }),
      view({ id: "c", lastSeen: null }),
      view({ id: "d", enabled: false }),
    ];
    for (const c of cards) {
      expect(c.nextAction.trim().length).toBeGreaterThan(0);
      expect(c.healthLabel.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("announcer panel — a switched-off speaker is a choice, not a fault", () => {
  it("shows disabled as idle rather than red", () => {
    expect(healthTone("online", false)).toBe("idle");
    expect(healthTone("offline", false)).toBe("idle");
  });

  it("flags it so the card can say 'Switched off' instead of an error", () => {
    expect(view({ enabled: false }).mutedByChoice).toBe(true);
    expect(view({ enabled: true }).mutedByChoice).toBe(false);
  });

  it("does NOT count a switched-off speaker as online, even while it phones home", () => {
    // A Pi that is unplugged stops reporting, so "offline" and "switched off"
    // usually coincide. But a speaker disabled from the back office keeps
    // heartbeating perfectly — it just refuses to play. Counting it as online
    // would inflate "3 of 3 online" while the storage room sits silent.
    const v = shop({
      devices: [view({ id: "office", enabled: true }), view({ id: "storage", enabled: false })],
    });
    expect(v.onlineCount).toBe(1);
    expect(v.headline).toContain("1 speaker");
  });

  it("reports zero online when the only live speaker is switched off", () => {
    const v = shop({ devices: [view({ id: "storage", enabled: false })] });
    expect(v.onlineCount).toBe(0);
    expect(v.willAnnounce).toBe(false);
  });
});

describe("announcer panel — timestamps a person can read", () => {
  it("never shows a time in the future when a Pi clock runs fast", () => {
    expect(relativeTimeLabel("2026-03-10T12:30:00.000Z", NOW_ISO)).toBe("just now");
  });

  it("says never rather than an error for a device that has not called home", () => {
    expect(relativeTimeLabel(null, NOW_ISO)).toBe("never");
    expect(relativeTimeLabel("garbage", NOW_ISO)).toBe("never");
  });

  it("uses singular and plural correctly", () => {
    expect(relativeTimeLabel("2026-03-10T11:59:00.000Z", NOW_ISO)).toBe("1 minute ago");
    expect(relativeTimeLabel("2026-03-10T11:57:00.000Z", NOW_ISO)).toBe("3 minutes ago");
    expect(relativeTimeLabel("2026-03-10T11:00:00.000Z", NOW_ISO)).toBe("1 hour ago");
  });
});

describe("announcer panel — sound names a person recognises", () => {
  it("shows the file name for a custom upload, not a storage path", () => {
    expect(soundLabel(null, "announcer/2026/my air horn.mp3", BUILT, "chime")).toBe("my air horn.mp3");
  });

  it("falls back to the shop default rather than showing a blank", () => {
    expect(soundLabel(null, null, BUILT, "chime")).toBe("Chime");
    expect(soundLabel("unknown-id", null, BUILT, "also-unknown")).toBe("Shop default");
  });
});
