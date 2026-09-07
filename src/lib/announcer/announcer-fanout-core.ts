/**
 * src/lib/announcer/announcer-fanout-core.ts
 *
 * SLICE 29 — turning one online order into N queue rows, one per speaker.
 *
 * PURE. Given the devices, the shop settings, the clock and the order, decide
 * exactly which rows to write. No database, no I/O.
 *
 * WHY FAN-OUT HAPPENS AT WRITE TIME AND NOT AT READ TIME
 * ------------------------------------------------------
 * The alternative design is one queue row per ORDER, with each Pi tracking a
 * cursor of what it has already played. That sounds tidier and is worse in
 * every way that matters here:
 *
 *   * A speaker that was unplugged for an hour would come back holding a
 *     cursor an hour behind and have to reason about what to skip. With one
 *     row per device, the TTL simply expires its rows and there is nothing to
 *     reason about.
 *   * Per-device volume and per-device sound would have to be resolved at
 *     PLAY time, on a Pi, using settings it may not have refreshed. Resolving
 *     at write time means the row already says exactly what to play and how
 *     loud, and the activity log shows what was actually sent rather than a
 *     reconstruction.
 *   * Two Pis reading one row would contend. One row each never does.
 *
 * The cost is N rows per order instead of one. With three speakers and a few
 * hundred orders a day that is noise, and the rows are retired within fifteen
 * minutes by construction.
 *
 * THE RULE THAT OUTRANKS ALL THE OTHERS
 * -------------------------------------
 * This code runs on the customer's checkout path. It must NEVER be able to
 * fail an order. Everything here therefore returns a plan — possibly an empty
 * one — and never throws, and the caller treats the whole thing as
 * best-effort. A shop that loses a chime is inconvenienced. A shop that loses
 * a sale because of a chime is broken.
 */

import {
  announcementText,
  clockMinutesOf,
  normalizeVolume,
  resolveSound,
  shouldAnnounce,
  type ResolvedSound,
} from "./announcer-core";

/** The subset of a device row the fan-out actually needs. */
export type FanoutDevice = {
  id: string;
  enabled: boolean;
  volume: number | null | undefined;
  sound_id: string | null | undefined;
  custom_sound_path: string | null | undefined;
};

export type FanoutSettings = {
  enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  default_sound_id: string;
  default_volume: number;
};

/** One row to insert into announcer_queue. */
export type QueueInsert = {
  device_id: string;
  kind: "order" | "test";
  order_id: string | null;
  message: string;
  sound: string;
  volume: number;
};

/** Why a device got nothing, so the activity log can explain the silence. */
export type FanoutSkip = { deviceId: string; reason: string };

export type FanoutPlan = {
  inserts: QueueInsert[];
  skipped: FanoutSkip[];
};

/** Flatten a resolved sound into the single text column the queue stores. */
export function soundToColumn(s: ResolvedSound): string {
  return s.kind === "custom" ? s.path : s.id;
}

/**
 * Build the rows for one announcement.
 *
 * `now` is passed in rather than read, so quiet hours can be tested at 3am
 * without waiting until 3am. `availableCustomPaths` is passed in for the same
 * reason the sound resolver takes it: this module does not list buckets.
 */
export function planFanout(input: {
  devices: readonly FanoutDevice[];
  settings: FanoutSettings;
  now: Date;
  orderId: string | null;
  orderNumber: string | null;
  isTest: boolean;
  availableCustomPaths: readonly string[];
}): FanoutPlan {
  const inserts: QueueInsert[] = [];
  const skipped: FanoutSkip[] = [];
  const nowMinutes = clockMinutesOf(input.now);

  for (const device of input.devices) {
    const decision = shouldAnnounce({
      deviceEnabled: device.enabled,
      globalEnabled: input.settings.enabled,
      quietHoursEnabled: input.settings.quiet_hours_enabled,
      nowMinutes,
      quietStartRaw: input.settings.quiet_start,
      quietEndRaw: input.settings.quiet_end,
      isTest: input.isTest,
    });

    if (!decision.announce) {
      skipped.push({ deviceId: device.id, reason: decision.reason });
      continue;
    }

    const sound = resolveSound({
      deviceSoundId: device.sound_id,
      deviceCustomPath: device.custom_sound_path,
      defaultSoundId: input.settings.default_sound_id,
      availableCustomPaths: input.availableCustomPaths,
    });

    // A device with no volume of its own inherits the shop default rather than
    // defaulting to a silent 0. normalizeVolume already refuses to turn junk
    // into 0; this adds the shop-level fallback on top.
    const volume =
      device.volume === null || device.volume === undefined
        ? normalizeVolume(input.settings.default_volume)
        : normalizeVolume(device.volume);

    inserts.push({
      device_id: device.id,
      kind: input.isTest ? "test" : "order",
      order_id: input.isTest ? null : input.orderId,
      message: announcementText({ orderNumber: input.orderNumber, isTest: input.isTest }),
      sound: soundToColumn(sound),
      volume,
    });
  }

  return { inserts, skipped };
}

/**
 * A one-line summary for the server log.
 *
 * Announcing is best-effort and therefore silent when it works, which makes it
 * exactly the kind of feature that can be broken for a week before anyone
 * notices. One honest line per order — including the skips and why — is the
 * cheapest possible defence against that.
 */
export function summarizeFanout(plan: FanoutPlan): string {
  if (plan.inserts.length === 0 && plan.skipped.length === 0) {
    return "announcer: no speakers configured";
  }
  const parts = [`announcer: queued ${plan.inserts.length}`];
  if (plan.skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const s of plan.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    const detail = [...reasons.entries()].map(([r, n]) => `${n}x ${r}`).join("; ");
    parts.push(`skipped ${plan.skipped.length} (${detail})`);
  }
  return parts.join(", ");
}

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runAnnouncerFanoutTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-fanout FAIL: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown): void => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (ok) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-fanout FAIL: ${label} -> got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
    }
  };

  const settings: FanoutSettings = {
    enabled: true,
    quiet_hours_enabled: true,
    quiet_start: "21:00",
    quiet_end: "08:00",
    default_sound_id: "chime",
    default_volume: 70,
  };
  const dev = (id: string, over: Partial<FanoutDevice> = {}): FanoutDevice => ({
    id,
    enabled: true,
    volume: 70,
    sound_id: "chime",
    custom_sound_path: null,
    ...over,
  });
  // Absolute instants, not local-time constructors. Quiet hours are judged on
  // Port Orchard's wall clock, so these are written in UTC and annotated with
  // the Pacific time they correspond to. That way they assert the same thing on
  // a UTC server and on a Pacific laptop.
  // 2026-03-10 is a Tuesday, inside PDT (UTC-7).
  const NOON = new Date("2026-03-10T21:00:00Z"); // 2:00 PM Pacific
  const THREE_AM = new Date("2026-03-10T10:00:00Z"); // 3:00 AM Pacific

  const base = {
    settings,
    now: NOON,
    orderId: "ord-1",
    orderNumber: "GWY-000123",
    isTest: false,
    availableCustomPaths: [] as string[],
  };

  // ---- the core promise: one row per speaker --------------------------
  const three = planFanout({ ...base, devices: [dev("a"), dev("b"), dev("c")] });
  eq("fanout: three speakers get three rows", three.inserts.length, 3);
  eq("fanout: nothing skipped", three.skipped.length, 0);
  eq(
    "fanout: each row targets its own device",
    three.inserts.map((i) => i.device_id),
    ["a", "b", "c"],
  );
  check("fanout: adding a fourth speaker needs no code change", planFanout({ ...base, devices: [dev("a"), dev("b"), dev("c"), dev("d")] }).inserts.length === 4);
  eq("fanout: zero speakers is not an error", planFanout({ ...base, devices: [] }).inserts.length, 0);

  // ---- the message ----------------------------------------------------
  eq("fanout: message carries the order number", three.inserts[0].message, "New online order. Number GWY-000123.");
  eq("fanout: kind is order", three.inserts[0].kind, "order");
  eq("fanout: order id recorded", three.inserts[0].order_id, "ord-1");
  const noNum = planFanout({ ...base, devices: [dev("a")], orderNumber: null });
  check("fanout: a missing order number still announces", noNum.inserts.length === 1);
  check("fanout: message is never blank", noNum.inserts[0].message.trim().length > 0);

  // ---- switches --------------------------------------------------------
  const globalOff = planFanout({ ...base, devices: [dev("a"), dev("b")], settings: { ...settings, enabled: false } });
  eq("fanout: master switch off queues nothing", globalOff.inserts.length, 0);
  eq("fanout: master switch off records BOTH skips", globalOff.skipped.length, 2);
  check("fanout: skip carries a reason", globalOff.skipped[0].reason.trim().length > 0);

  const oneOff = planFanout({ ...base, devices: [dev("a"), dev("b", { enabled: false })] });
  eq("fanout: a disabled speaker is skipped, the other still fires", oneOff.inserts.length, 1);
  eq("fanout: and the disabled one is the one skipped", oneOff.skipped[0].deviceId, "b");

  // ---- quiet hours -----------------------------------------------------
  const night = planFanout({ ...base, devices: [dev("a")], now: THREE_AM });
  eq("fanout: 3am inside quiet hours queues nothing", night.inserts.length, 0);
  const nightTest = planFanout({ ...base, devices: [dev("a")], now: THREE_AM, isTest: true });
  eq("fanout: a TEST at 3am still fires", nightTest.inserts.length, 1);
  eq("fanout: a test carries no order id", nightTest.inserts[0].order_id, null);
  eq("fanout: a test is kind=test", nightTest.inserts[0].kind, "test");
  check("fanout: a test says it is a test", nightTest.inserts[0].message.toLowerCase().includes("test"));
  const nightOff = planFanout({
    ...base,
    devices: [dev("a")],
    now: THREE_AM,
    settings: { ...settings, quiet_hours_enabled: false },
  });
  eq("fanout: quiet hours disabled fires at 3am", nightOff.inserts.length, 1);
  const dayTime = planFanout({ ...base, devices: [dev("a")], now: new Date("2026-03-10T16:00:00Z") }); // 9:00 AM Pacific
  eq("fanout: 9am is NOT quiet — the shop is open", dayTime.inserts.length, 1);

  // ---- sound resolution flows through ---------------------------------
  eq("fanout: built-in sound written as its id", three.inserts[0].sound, "chime");
  const custom = planFanout({
    ...base,
    devices: [dev("a", { custom_sound_path: "uploads/horn.mp3" })],
    availableCustomPaths: ["uploads/horn.mp3"],
  });
  eq("fanout: an available custom file is used", custom.inserts[0].sound, "uploads/horn.mp3");
  const deletedCustom = planFanout({
    ...base,
    devices: [dev("a", { custom_sound_path: "uploads/gone.mp3", sound_id: "bell" })],
    availableCustomPaths: [],
  });
  eq("fanout: a DELETED custom file falls back, never to silence", deletedCustom.inserts[0].sound, "bell");
  check("fanout: sound column is never empty", deletedCustom.inserts.every((i) => i.sound.trim() !== ""));
  const noSound = planFanout({ ...base, devices: [dev("a", { sound_id: null })] });
  eq("fanout: no device sound falls back to the shop default", noSound.inserts[0].sound, "chime");

  // ---- volume ----------------------------------------------------------
  eq("fanout: device volume used", planFanout({ ...base, devices: [dev("a", { volume: 45 })] }).inserts[0].volume, 45);
  eq(
    "fanout: null device volume inherits the SHOP default, not 0",
    planFanout({ ...base, devices: [dev("a", { volume: null })] }).inserts[0].volume,
    70,
  );
  eq(
    "fanout: undefined device volume inherits the shop default, not 0",
    planFanout({ ...base, devices: [dev("a", { volume: undefined })] }).inserts[0].volume,
    70,
  );
  eq(
    "fanout: an out-of-range device volume clamps",
    planFanout({ ...base, devices: [dev("a", { volume: 500 })] }).inserts[0].volume,
    100,
  );
  eq(
    "fanout: a shop default of 0 is honoured — an explicit mute is a choice",
    planFanout({
      ...base,
      devices: [dev("a", { volume: null })],
      settings: { ...settings, default_volume: 0 },
    }).inserts[0].volume,
    0,
  );

  // ---- mixed fleet, the realistic case --------------------------------
  const mixed = planFanout({
    ...base,
    devices: [
      dev("office", { volume: 40 }),
      dev("floor", { volume: 90, sound_id: "bell" }),
      dev("storage", { enabled: false }),
    ],
  });
  eq("fanout: mixed fleet queues only the enabled two", mixed.inserts.length, 2);
  eq("fanout: mixed fleet volumes are per-device", mixed.inserts.map((i) => i.volume), [40, 90]);
  eq("fanout: mixed fleet sounds are per-device", mixed.inserts.map((i) => i.sound), ["chime", "bell"]);
  eq("fanout: the muted speaker is accounted for", mixed.skipped.length, 1);

  // ---- the summary line ------------------------------------------------
  check("summary: names the queued count", summarizeFanout(three).includes("queued 3"));
  check("summary: names the skips", summarizeFanout(oneOff).includes("skipped 1"));
  check("summary: explains WHY it skipped", summarizeFanout(oneOff).toLowerCase().includes("turned off"));
  eq("summary: an empty fleet says so plainly", summarizeFanout({ inserts: [], skipped: [] }), "announcer: no speakers configured");
  check("summary: groups identical reasons rather than repeating them", summarizeFanout(globalOff).includes("2x"));

  // ---- never throws ----------------------------------------------------
  // Everything below is deliberately malformed. This function sits on the
  // customer checkout path; an exception here would fail a sale.
  const hostile: FanoutDevice[] = [
    { id: "x", enabled: true, volume: Number.NaN, sound_id: null, custom_sound_path: null },
    { id: "y", enabled: true, volume: null, sound_id: "nope", custom_sound_path: "   " },
  ];
  let threw = false;
  try {
    const h = planFanout({
      ...base,
      devices: hostile,
      settings: { ...settings, quiet_start: "garbage", quiet_end: "" , default_sound_id: "" },
      orderNumber: null,
      orderId: null,
    });
    check("hostile: still produced rows rather than nothing", h.inserts.length === 2);
    check("hostile: every row has a real sound", h.inserts.every((i) => i.sound.trim() !== ""));
    check("hostile: every row has a real message", h.inserts.every((i) => i.message.trim() !== ""));
    check("hostile: no row is silently muted", h.inserts.every((i) => i.volume > 0));
  } catch {
    threw = true;
  }
  check("hostile: planFanout NEVER throws — it sits on the checkout path", !threw);

  return { passed, failed };
}
