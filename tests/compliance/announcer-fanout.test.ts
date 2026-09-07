/**
 * SLICE 29 — fan-out to the speakers.
 *
 * The self-tests inside announcer-fanout-core.ts cover the unit behaviour. This
 * file exists to pin the handful of behaviours that would cost Michael real
 * money or real trust if they silently regressed:
 *
 *   1. A new order reaches EVERY enabled speaker, not just the first one.
 *   2. A speaker is never handed a volume of 0 by accident.
 *   3. The message never leaks a customer's name or what they bought.
 *   4. Quiet hours are honoured for orders but never block a Test.
 *   5. Nothing in here can throw, because this runs on the checkout path.
 */
import { describe, expect, it } from "vitest";

import {
  planFanout,
  soundToColumn,
  summarizeFanout,
  type FanoutDevice,
  type FanoutSettings,
} from "@/lib/announcer/announcer-fanout-core";
import { BUILT_IN_SOUNDS, DEFAULT_VOLUME } from "@/lib/announcer/announcer-core";

const SETTINGS: FanoutSettings = {
  enabled: true,
  quiet_hours_enabled: false,
  quiet_start: "22:00",
  quiet_end: "08:00",
  default_sound_id: "chime",
  default_volume: 70,
};

function device(over: Partial<FanoutDevice> & { id: string }): FanoutDevice {
  return {
    enabled: true,
    volume: null,
    sound_id: null,
    custom_sound_path: null,
    ...over,
  };
}

/** The three speakers Michael actually described: office, sales floor, storage. */
const THREE_SPEAKERS: FanoutDevice[] = [
  device({ id: "office" }),
  device({ id: "sales-floor" }),
  device({ id: "storage" }),
];

function plan(devices: FanoutDevice[], settings: FanoutSettings, now: Date, isTest = false) {
  return planFanout({
    devices,
    settings,
    now,
    orderId: "order-uuid",
    orderNumber: "1042",
    isTest,
    availableCustomPaths: [],
  });
}

const MIDDAY = new Date("2025-06-10T19:00:00.000Z");

describe("announcer fan-out — every speaker hears it", () => {
  it("queues one row per enabled device, not just the first", () => {
    const result = plan(THREE_SPEAKERS, SETTINGS, MIDDAY);
    expect(result.inserts).toHaveLength(3);
    expect(result.inserts.map((r) => r.device_id).sort()).toEqual([
      "office",
      "sales-floor",
      "storage",
    ]);
  });

  it("gives each device its own row so one dead Pi cannot mute the others", () => {
    const result = plan(THREE_SPEAKERS, SETTINGS, MIDDAY);
    const ids = new Set(result.inserts.map((r) => r.device_id));
    expect(ids.size).toBe(result.inserts.length);
  });

  it("skips a disabled speaker but still serves the rest", () => {
    const devices = [...THREE_SPEAKERS, device({ id: "broken", enabled: false })];
    const result = plan(devices, SETTINGS, MIDDAY);
    expect(result.inserts).toHaveLength(3);
    expect(result.skipped.map((s) => s.deviceId)).toEqual(["broken"]);
  });

  it("records a reason for every skip so the log can explain the silence", () => {
    const result = plan([device({ id: "off", enabled: false })], SETTINGS, MIDDAY);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason.trim().length).toBeGreaterThan(0);
  });
});

describe("announcer fan-out — volume is never accidentally silent", () => {
  it("inherits the shop default when a device has no volume of its own", () => {
    const result = plan([device({ id: "a", volume: null })], SETTINGS, MIDDAY);
    expect(result.inserts[0]!.volume).toBe(70);
  });

  it("treats undefined the same as null rather than as zero", () => {
    const result = plan([device({ id: "a", volume: undefined })], SETTINGS, MIDDAY);
    expect(result.inserts[0]!.volume).toBe(70);
  });

  it("honours a real per-device volume", () => {
    const result = plan([device({ id: "a", volume: 35 })], SETTINGS, MIDDAY);
    expect(result.inserts[0]!.volume).toBe(35);
  });

  it("honours a deliberate shop default of 0 (muted on purpose is allowed)", () => {
    const result = plan(
      [device({ id: "a", volume: null })],
      { ...SETTINGS, default_volume: 0 },
      MIDDAY,
    );
    expect(result.inserts[0]!.volume).toBe(0);
  });

  it("falls back to the safe default when the shop default is junk", () => {
    const result = plan(
      [device({ id: "a", volume: null })],
      { ...SETTINGS, default_volume: Number.NaN },
      MIDDAY,
    );
    expect(result.inserts[0]!.volume).toBe(DEFAULT_VOLUME);
  });
});

describe("announcer fan-out — a speaker in a public room says nothing private", () => {
  it("never includes a customer name or product in the message", () => {
    const result = planFanout({
      devices: THREE_SPEAKERS,
      settings: SETTINGS,
      now: MIDDAY,
      orderId: "order-uuid",
      orderNumber: "1042",
      isTest: false,
      availableCustomPaths: [],
    });
    for (const row of result.inserts) {
      expect(row.message.toLowerCase()).not.toContain("jane");
      expect(row.message.toLowerCase()).not.toContain("gram");
      expect(row.message.toLowerCase()).not.toContain("ounce");
      expect(row.message.toLowerCase()).not.toContain("$");
    }
  });

  it("always produces a non-empty message", () => {
    const result = plan(THREE_SPEAKERS, SETTINGS, MIDDAY);
    for (const row of result.inserts) {
      expect(row.message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("announcer fan-out — quiet hours", () => {
  const QUIET: FanoutSettings = { ...SETTINGS, quiet_hours_enabled: true };
  // Absolute instants. 06:30Z in June is 11:30 PM Pacific — genuinely late in
  // Port Orchard, and inside a 22:00 -> 08:00 window.
  const LATE = new Date("2025-06-11T06:30:00.000Z");

  it("silences a real order inside the overnight window", () => {
    const result = planFanout({
      devices: THREE_SPEAKERS,
      settings: QUIET,
      now: LATE,
      orderId: "o",
      orderNumber: "1",
      isTest: false,
      availableCustomPaths: [],
    });
    expect(result.inserts).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
  });

  it("REGRESSION: a 3PM Pacific order is never muted by overnight quiet hours", () => {
    // 22:00Z is 3:00 PM Pacific in June. Read as UTC it is exactly the start of
    // the quiet window, so a server-local clock would mute a mid-afternoon
    // order and nobody would find out until a customer was left waiting.
    const result = planFanout({
      devices: THREE_SPEAKERS,
      settings: QUIET,
      now: new Date("2025-06-10T22:00:00.000Z"),
      orderId: "o",
      orderNumber: "1042",
      isTest: false,
      availableCustomPaths: [],
    });
    expect(result.inserts).toHaveLength(3);
  });

  it("REGRESSION: quiet hours stay correct across the daylight-saving switch", () => {
    // Same 22:00Z instant in January is 2:00 PM Pacific — also mid-business-day.
    const winter = planFanout({
      devices: THREE_SPEAKERS,
      settings: QUIET,
      now: new Date("2025-01-10T22:00:00.000Z"),
      orderId: "o",
      orderNumber: "1",
      isTest: false,
      availableCustomPaths: [],
    });
    expect(winter.inserts).toHaveLength(3);
  });

  it("lets a Test through even when a real order would be silenced", () => {
    const asTest = planFanout({
      devices: THREE_SPEAKERS,
      settings: QUIET,
      now: new Date(LATE.getTime()),
      orderId: null,
      orderNumber: null,
      isTest: true,
      availableCustomPaths: [],
    });
    expect(asTest.inserts).toHaveLength(3);
  });

  it("marks test rows as kind=test with no order attached", () => {
    const result = plan(THREE_SPEAKERS, SETTINGS, MIDDAY, true);
    for (const row of result.inserts) {
      expect(row.kind).toBe("test");
      expect(row.order_id).toBeNull();
    }
  });

  it("marks real rows as kind=order and keeps the order id", () => {
    const result = plan(THREE_SPEAKERS, SETTINGS, MIDDAY, false);
    for (const row of result.inserts) {
      expect(row.kind).toBe("order");
      expect(row.order_id).toBe("order-uuid");
    }
  });
});

describe("announcer fan-out — the master switch", () => {
  it("silences everything when the shop toggle is off", () => {
    const result = plan(THREE_SPEAKERS, { ...SETTINGS, enabled: false }, MIDDAY);
    expect(result.inserts).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
  });

  it("does not let a Test override the master off switch", () => {
    const result = plan(THREE_SPEAKERS, { ...SETTINGS, enabled: false }, MIDDAY, true);
    expect(result.inserts).toHaveLength(0);
  });
});

describe("announcer fan-out — sound resolution never yields silence", () => {
  it("always writes a non-empty sound column", () => {
    const devices = [
      device({ id: "a", sound_id: "bell" }),
      device({ id: "b", sound_id: null }),
      device({ id: "c", sound_id: "does-not-exist" }),
      device({ id: "d", custom_sound_path: "deleted/file.mp3" }),
    ];
    const result = plan(devices, SETTINGS, MIDDAY);
    expect(result.inserts).toHaveLength(4);
    for (const row of result.inserts) {
      expect(row.sound.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses an available custom file when the device points at one", () => {
    const result = planFanout({
      devices: [device({ id: "a", custom_sound_path: "sounds/mine.mp3" })],
      settings: SETTINGS,
      now: MIDDAY,
      orderId: "o",
      orderNumber: "1",
      isTest: false,
      availableCustomPaths: ["sounds/mine.mp3"],
    });
    expect(result.inserts[0]!.sound).toBe("sounds/mine.mp3");
  });

  it("soundToColumn flattens a built-in to its id", () => {
    expect(soundToColumn({ kind: "built-in", id: BUILT_IN_SOUNDS[0]!.id })).toBe(
      BUILT_IN_SOUNDS[0]!.id,
    );
  });
});

describe("announcer fan-out — cannot break a customer's checkout", () => {
  it("returns an empty plan for an empty shop rather than throwing", () => {
    const result = plan([], SETTINGS, MIDDAY);
    expect(result.inserts).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("survives hostile device rows without throwing", () => {
    const hostile = [
      { id: "", enabled: true, volume: null, sound_id: null, custom_sound_path: null },
      {
        id: "x",
        enabled: true,
        volume: "loud" as unknown as number,
        sound_id: 42 as unknown as string,
        custom_sound_path: {} as unknown as string,
      },
    ] as FanoutDevice[];
    expect(() => plan(hostile, SETTINGS, MIDDAY)).not.toThrow();
  });

  it("survives hostile settings without throwing", () => {
    const hostile = {
      enabled: true,
      quiet_hours_enabled: true,
      quiet_start: "not-a-time",
      quiet_end: "",
      default_sound_id: "",
      default_volume: "x" as unknown as number,
    } as FanoutSettings;
    expect(() => plan(THREE_SPEAKERS, hostile, MIDDAY)).not.toThrow();
  });

  it("summarizeFanout produces a line even when nothing happened", () => {
    expect(summarizeFanout({ inserts: [], skipped: [] })).toContain("no speakers");
  });

  it("summarizeFanout counts the skips and names the reasons", () => {
    const result = plan(
      [...THREE_SPEAKERS, device({ id: "off", enabled: false })],
      SETTINGS,
      MIDDAY,
    );
    const line = summarizeFanout(result);
    expect(line).toContain("queued 3");
    expect(line).toContain("skipped 1");
  });
});
