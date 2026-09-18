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

import {
  DEFAULT_ORDER_ORIGIN,
  ORIGIN_DEFAULT_SOUND_IDS,
  shouldAnnounceOrigin,
  type OrderOrigin,
} from "../orders/order-origin-core";

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
  /**
   * SLICE L-10 -- per-origin sound overrides, both optional.
   *
   * The owner asked for two things that look like one: sounds that differ by
   * where the order came from, AND the ability to upload his own. So each
   * origin can name a built-in id or point at an upload in the sound library,
   * and when it names neither, the origin core's default applies.
   *
   * These are optional on the type on purpose. `getAnnouncerSettings()` is
   * contractually unable to throw, and it reads a table that may predate the
   * L-10 migration; an optional field lets an older row keep announcing
   * instead of failing.
   */
  leafly_sound_id?: string | null;
  leafly_custom_sound_path?: string | null;
  greenway_sound_id?: string | null;
  greenway_custom_sound_path?: string | null;
};

/**
 * The shop-level built-in sound for one origin.
 *
 * Precedence, highest first:
 *   1. what the owner chose for THIS origin on the settings page
 *   2. for the website only, the long-standing shop-wide default
 *   3. the origin core's default for this origin
 *
 * Step 2 is what stops this change from being heard as a regression. Before
 * L-10 there was one `default_sound_id` and it meant "the sound this shop
 * makes for an online order". Every shop that has set it set it for website
 * orders, so the website keeps honouring it. Leafly deliberately does NOT
 * inherit it -- if it did, both origins would play the same sound and the
 * entire point of the feature would be lost on day one.
 */
export function originDefaultSoundId(
  settings: FanoutSettings,
  origin: OrderOrigin,
): string {
  const chosen =
    origin === "leafly"
      ? settings.leafly_sound_id
      : origin === "greenway"
        ? settings.greenway_sound_id
        : null;

  const clean = typeof chosen === "string" ? chosen.trim() : "";
  if (clean !== "") return clean;

  if (origin === "greenway") {
    const legacy =
      typeof settings.default_sound_id === "string" ? settings.default_sound_id.trim() : "";
    if (legacy !== "") return legacy;
  }

  return ORIGIN_DEFAULT_SOUND_IDS[origin];
}

/** The shop-level custom upload for one origin, or null when there is none. */
export function originDefaultCustomPath(
  settings: FanoutSettings,
  origin: OrderOrigin,
): string | null {
  const chosen =
    origin === "leafly"
      ? settings.leafly_custom_sound_path
      : origin === "greenway"
        ? settings.greenway_custom_sound_path
        : null;
  const clean = typeof chosen === "string" ? chosen.trim() : "";
  return clean === "" ? null : clean;
}

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
  /**
   * SLICE L-10. Where the order came from. Optional because every call site
   * that predates Leafly means the website, and silently changing what those
   * announce would be worse than requiring the parameter.
   */
  origin?: OrderOrigin;
}): FanoutPlan {
  const inserts: QueueInsert[] = [];
  const skipped: FanoutSkip[] = [];
  const nowMinutes = clockMinutesOf(input.now);
  const origin: OrderOrigin = input.origin ?? DEFAULT_ORDER_ORIGIN;

  // An in-store register sale must not ring the shop's own doorbell: the
  // customer is already standing at the counter. That rule is not restated
  // here -- `shouldAnnounceOrigin` in the origin core owns it (rule 11).
  // A test bypasses it, because pressing Test is an explicit request for a
  // noise and must work from any page.
  if (!input.isTest && !shouldAnnounceOrigin(origin)) {
    return {
      inserts: [],
      skipped: input.devices.map((d) => ({
        deviceId: d.id,
        reason: `origin ${origin} does not announce`,
      })),
    };
  }

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

    // SLICE L-10. The shop-wide default is now per-origin, so a Leafly order
    // and a website order are distinguishable by ear. A device that names its
    // own sound still wins -- that is a deliberate per-speaker override and
    // `resolveSound` already owns that precedence.
    const sound = resolveSound({
      deviceSoundId: device.sound_id,
      deviceCustomPath: device.custom_sound_path,
      defaultSoundId: originDefaultSoundId(input.settings, origin),
      defaultCustomPath: originDefaultCustomPath(input.settings, origin),
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
      message: announcementText({
        orderNumber: input.orderNumber,
        isTest: input.isTest,
        origin,
      }),
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

/**
 * The same outcome, written for the person who just pressed the button.
 *
 * THE REAL FAILURE THIS COMES FROM
 * --------------------------------
 * A shop owner pressed "Test all speakers" and reported that it "does nothing,
 * it hangs". Nothing was broken in the action itself: it queued the sound and
 * returned. But the button returns void, has no pending state, and the panel
 * said nothing afterwards -- so pressing it produced NO visible change at all.
 *
 * On top of that, the Pi sits on a long-poll of up to POLL_HOLD_SECONDS, so
 * even when everything works the chime can be ~25 seconds behind the click.
 *
 * Silence for 25 seconds after pressing a button is indistinguishable from a
 * hang. So the panel must say what happened AND set the expectation about the
 * wait. summarizeFanout() stays as it is -- it is written for a server log.
 */
export function describeTestOutcome(input: {
  queued: number;
  skipped: number;
  ok: boolean;
  holdSeconds: number;
}): string {
  const { queued, skipped, ok, holdSeconds } = input;

  if (!ok) {
    return "Could not send the test. Nothing was queued - check the speaker list below.";
  }
  if (queued === 0 && skipped === 0) {
    return "There are no speakers paired yet, so there was nothing to test.";
  }
  if (queued === 0) {
    const what = skipped === 1 ? "The one speaker" : `All ${skipped} speakers`;
    return `${what} were skipped, so nothing will play. The reason is on the speaker cards below.`;
  }

  const noun = queued === 1 ? "speaker" : "speakers";
  const lead = `Test sent to ${queued} ${noun}.`;
  // The wait is the whole reason this felt broken, so it is always stated.
  const wait = `Listen for up to ${holdSeconds} seconds - speakers check in on a ${holdSeconds}-second cycle.`;
  if (skipped > 0) {
    return `${lead} ${skipped} skipped. ${wait}`;
  }
  return `${lead} ${wait}`;
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

  // ---- what the person who pressed the button is told -------------------
  // The bug these exist for: pressing Test produced NO visible change, and the
  // chime can be ~25s behind the click, so it read as a hang. Every branch must
  // therefore say something, and the happy path must state the wait.
  const outcome = (queued: number, skipped: number, ok = true, holdSeconds = 25) =>
    describeTestOutcome({ queued, skipped, ok, holdSeconds });

  check("test message: is never blank, whatever happened", [
    outcome(3, 0),
    outcome(1, 0),
    outcome(0, 2),
    outcome(0, 1),
    outcome(0, 0),
    outcome(0, 0, false),
  ].every((m) => m.trim().length > 0));

  // The wait is the whole point. If a test ever queued something without
  // warning about the delay, the original complaint comes straight back.
  check("test message: a queued test ALWAYS warns about the wait", outcome(3, 0).includes("25 seconds"));
  check("test message: a queued test says how many speakers", outcome(3, 0).includes("3 speakers"));
  check("test message: one speaker is not called '1 speakers'", outcome(1, 0).includes("1 speaker.") && !outcome(1, 0).includes("1 speakers"));
  check("test message: the hold seconds are real, not hardcoded", outcome(1, 0, true, 9).includes("9 seconds") && !outcome(1, 0, true, 9).includes("25"));
  check("test message: partial success reports BOTH numbers", outcome(2, 1).includes("2 speakers") && outcome(2, 1).includes("1 skipped"));

  // Queueing nothing is the case most likely to be misread as success. None of
  // these may claim a sound is coming.
  const nothingComing = [outcome(0, 2), outcome(0, 1), outcome(0, 0), outcome(0, 0, false)];
  check("test message: when nothing was queued it never promises a sound", nothingComing.every((m) => !m.includes("Test sent")));
  check("test message: all-skipped says nothing will play", outcome(0, 3).includes("nothing will play"));
  check("test message: all-skipped points at where the reason is", outcome(0, 3).includes("speaker cards below"));
  check("test message: a single skipped speaker is not called 'All 1 speakers'", !outcome(0, 1).includes("All 1"));
  check("test message: no speakers paired says exactly that", outcome(0, 0).includes("no speakers paired"));
  check("test message: an outright failure is never dressed up as success", outcome(0, 0, false).startsWith("Could not send"));
  check("test message: failure outranks the counts it was given", describeTestOutcome({ queued: 5, skipped: 0, ok: false, holdSeconds: 25 }).startsWith("Could not send"));

  // ========================================================================
  // SLICE L-10 -- PER-ORIGIN SOUND AND THE REGISTER'S SILENCE
  // ========================================================================
  // The owner's requirement: "I want the sound to be connected to our sound
  // library, so we can upload custom sounds to play for each type ... you can
  // set it to fall back to one of the other sounds that is not the same as
  // the fallback one for our online orders noise."

  const originBase = { ...base, devices: [dev("a", { sound_id: null })] };
  const soundOf = (plan: FanoutPlan): string => plan.inserts[0]?.sound ?? "";

  // The headline requirement, asserted on the real plan rather than on the
  // resolver in isolation: the two origins must not sound the same.
  const leaflyPlan = planFanout({ ...originBase, origin: "leafly" });
  const sitePlan = planFanout({ ...originBase, origin: "greenway" });
  check("L-10: a Leafly order and a website order queue different sounds", soundOf(leaflyPlan) !== soundOf(sitePlan));
  check("L-10: both still queue exactly one row", leaflyPlan.inserts.length === 1 && sitePlan.inserts.length === 1);
  // Pinned BY NAME. "different from each other" alone would still pass if both
  // silently became the wrong sound.
  eq("L-10: Leafly falls back to the bell", soundOf(leaflyPlan), "bell");
  eq("L-10: the website keeps the shop-wide default it always had", soundOf(sitePlan), "chime");

  // Back-compatibility: every caller written before L-10 omits `origin`.
  // If the default ever flipped to leafly, website orders would change sound
  // for every existing shop without anyone touching a setting.
  eq("L-10: omitting origin behaves exactly like the website", soundOf(planFanout(originBase)), soundOf(sitePlan));

  // The owner's explicit ask: the Leafly fallback must not be the website's.
  check(
    "L-10: the two built-in fallbacks are genuinely different ids",
    originDefaultSoundId({ ...settings, default_sound_id: "chime" }, "leafly") !==
      originDefaultSoundId({ ...settings, default_sound_id: "chime" }, "greenway"),
  );

  // Owner picks a built-in for Leafly on the settings page.
  eq(
    "L-10: a chosen built-in for Leafly is used",
    soundOf(planFanout({ ...originBase, origin: "leafly", settings: { ...settings, leafly_sound_id: "alert" } })),
    "alert",
  );
  // ... and it must not bleed into website orders.
  eq(
    "L-10: choosing a Leafly sound does not change website orders",
    soundOf(planFanout({ ...originBase, origin: "greenway", settings: { ...settings, leafly_sound_id: "alert" } })),
    "chime",
  );

  // THE SOUND LIBRARY. A custom upload chosen for an origin plays shop-wide.
  eq(
    "L-10: a custom upload for Leafly plays when the file exists",
    soundOf(planFanout({
      ...originBase,
      origin: "leafly",
      settings: { ...settings, leafly_custom_sound_path: "sounds/leafly.mp3" },
      availableCustomPaths: ["sounds/leafly.mp3"],
    })),
    "sounds/leafly.mp3",
  );
  // THE INVARIANT THAT MATTERS MOST: an upload the owner deleted must never
  // become silence. This is the case that actually happens in a real shop.
  eq(
    "L-10: a DELETED custom upload falls back to the origin built-in, never silence",
    soundOf(planFanout({
      ...originBase,
      origin: "leafly",
      settings: { ...settings, leafly_custom_sound_path: "sounds/gone.mp3" },
      availableCustomPaths: [],
    })),
    "bell",
  );
  // A custom upload outranks a chosen built-in for the same origin.
  eq(
    "L-10: the upload wins over the built-in for the same origin",
    soundOf(planFanout({
      ...originBase,
      origin: "leafly",
      settings: { ...settings, leafly_sound_id: "alert", leafly_custom_sound_path: "sounds/leafly.mp3" },
      availableCustomPaths: ["sounds/leafly.mp3"],
    })),
    "sounds/leafly.mp3",
  );
  // But a speaker that names its own sound keeps it -- a per-device override
  // is a deliberate act and outranks a shop-wide origin setting.
  eq(
    "L-10: a per-speaker sound still outranks the origin setting",
    soundOf(planFanout({
      ...base,
      devices: [dev("a", { sound_id: "ding" })],
      origin: "leafly",
      settings: { ...settings, leafly_custom_sound_path: "sounds/leafly.mp3" },
      availableCustomPaths: ["sounds/leafly.mp3"],
    })),
    "ding",
  );

  // THE SPOKEN LINE travels too, or the `voice` sound says the wrong thing.
  check(
    "L-10: the queued message names Leafly",
    (leaflyPlan.inserts[0]?.message ?? "").includes("Leafly"),
  );
  check(
    "L-10: the website message does NOT name Leafly",
    !(sitePlan.inserts[0]?.message ?? "").includes("Leafly"),
  );

  // THE REGISTER MUST NOT RING. The customer is already at the counter.
  const registerPlan = planFanout({ ...originBase, origin: "register" });
  eq("L-10: a register sale queues nothing", registerPlan.inserts.length, 0);
  eq("L-10: and says why, per speaker", registerPlan.skipped.length, 1);
  check(
    "L-10: the skip reason names the origin",
    (registerPlan.skipped[0]?.reason ?? "").includes("register"),
  );
  // NON-VACUITY: the same devices and settings DO announce for a pickup
  // origin, so the assertion above is about the origin and not about a
  // fixture that was never going to announce anyway.
  check("L-10: the same devices DO announce for a pickup origin", leaflyPlan.inserts.length === 1);

  // Pressing Test must work from anywhere, including a register screen.
  check(
    "L-10: a TEST still fires even for a non-announcing origin",
    planFanout({ ...originBase, origin: "register", isTest: true }).inserts.length === 1,
  );

  // Origin must never be able to override the master switch or quiet hours --
  // it sits underneath them, not above.
  eq(
    "L-10: origin cannot defeat the master off switch",
    planFanout({ ...originBase, origin: "leafly", settings: { ...settings, enabled: false } }).inserts.length,
    0,
  );
  eq(
    "L-10: origin cannot defeat quiet hours",
    planFanout({ ...originBase, origin: "leafly", now: THREE_AM }).inserts.length,
    0,
  );

  // Hostile settings: junk in the per-origin fields must degrade to the
  // built-in, never to an empty `sound` column the Pi would fail to play.
  for (const junk of ["", "   ", null, undefined] as const) {
    check(
      `L-10: junk leafly_sound_id (${JSON.stringify(junk)}) still resolves to a real sound`,
      soundOf(planFanout({
        ...originBase,
        origin: "leafly",
        settings: { ...settings, leafly_sound_id: junk as string | null },
      })).trim() !== "",
    );
  }
  // An older settings row that predates the L-10 migration has none of the
  // new fields at all. It must keep announcing.
  const legacyRow = {
    enabled: true,
    quiet_hours_enabled: true,
    quiet_start: "21:00",
    quiet_end: "08:00",
    default_sound_id: "chime",
    default_volume: 70,
  } as FanoutSettings;
  eq(
    "L-10: a pre-migration settings row still announces Leafly orders",
    soundOf(planFanout({ ...originBase, origin: "leafly", settings: legacyRow })),
    "bell",
  );

  return { passed, failed };
}
