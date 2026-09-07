/**
 * src/lib/announcer/announcer-admin-core.ts
 *
 * SLICE 30 — what the back office SHOWS about the speakers.
 *
 * PURE. Takes rows and a timestamp, returns view models. No database, no React,
 * no clock of its own. The Announcer panel is the screen Michael will actually
 * look at when something is wrong, so every judgement it makes — is this
 * speaker healthy, what should I do about it, is the shop about to be silent —
 * is decided here where it can be proved, not inline in JSX where it cannot.
 *
 * DESIGN NOTE: WHY THERE IS A "SHOP-LEVEL" VERDICT
 * ------------------------------------------------
 * A per-device dot is not enough. The question that actually matters is "will I
 * hear the next order?", and that can be NO for reasons no single dot shows:
 * every speaker offline, the master switch off, quiet hours active right now,
 * or no speakers paired at all. summarizeShop() answers that one question in
 * one sentence, in plain English, with the fix attached.
 */
import {
  DEVICE_ONLINE_GRACE_SECONDS,
  deviceHealth,
  deviceHealthLabel,
  deviceNextAction,
  isWithinQuietHours,
  normalizeVolume,
  clockMinutesOf,
  type DeviceHealth,
} from "./announcer-core";

export type AdminDeviceRow = {
  id: string;
  name: string;
  enabled: boolean;
  volume: number | null | undefined;
  sound_id: string | null | undefined;
  custom_sound_path: string | null | undefined;
  last_seen_at: string | null | undefined;
  agent_info?: unknown;
};

export type AdminDeviceView = {
  id: string;
  name: string;
  enabled: boolean;
  health: DeviceHealth;
  /** "Online", "Not seen recently", ... — already human-readable. */
  healthLabel: string;
  /** What to DO about it, in plain English. Never empty. */
  nextAction: string;
  /** Green / amber / red / grey, for the dot. */
  tone: "good" | "warn" | "bad" | "idle";
  volume: number;
  /** "Chime", or the file name of a custom upload. */
  soundLabel: string;
  /** "2 minutes ago", "never". */
  lastSeenLabel: string;
  /** True when this device is deliberately switched off, not broken. */
  mutedByChoice: boolean;
};

/** How a device's dot should be coloured. Disabled is grey, not red: it is a choice. */
export function healthTone(health: DeviceHealth, enabled: boolean): AdminDeviceView["tone"] {
  if (!enabled) return "idle";
  if (health === "online") return "good";
  if (health === "stale") return "warn";
  return "bad";
}

/**
 * "3 minutes ago". Deliberately coarse — nobody needs "2m 47s", and a coarse
 * label does not flicker on every re-render.
 */
export function relativeTimeLabel(iso: string | null | undefined, nowIso: string): string {
  if (typeof iso !== "string" || iso.trim() === "") return "never";
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "never";

  const seconds = Math.floor((now - then) / 1000);
  // Clock skew: a Pi whose clock runs fast reports a last-seen in the future.
  // Kept explicit even though a negative value would already fall through the
  // `< 10` branch below and produce the same string. Mutation testing flagged
  // this line as removable for exactly that reason; it stays because the next
  // person to reorder these branches would otherwise reintroduce "in 30
  // minutes" as a last-seen label without any test noticing.
  if (seconds < 0) return "just now";
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** Turn a stored sound value into something a person recognises. */
export function soundLabel(
  soundId: string | null | undefined,
  customPath: string | null | undefined,
  builtIns: readonly { id: string; label: string }[],
  defaultSoundId: string,
): string {
  if (typeof customPath === "string" && customPath.trim() !== "") {
    const parts = customPath.split("/");
    return parts[parts.length - 1] || "Custom sound";
  }
  const id = typeof soundId === "string" && soundId.trim() !== "" ? soundId : defaultSoundId;
  const match = builtIns.find((b) => b.id === id);
  return match ? match.label : "Shop default";
}

export function toDeviceView(input: {
  row: AdminDeviceRow;
  nowIso: string;
  builtIns: readonly { id: string; label: string }[];
  defaultSoundId: string;
  defaultVolume: number;
}): AdminDeviceView {
  const health = deviceHealth({ lastSeenIso: input.row.last_seen_at ?? null, nowIso: input.nowIso });
  const enabled = input.row.enabled !== false;
  const volume =
    input.row.volume === null || input.row.volume === undefined
      ? normalizeVolume(input.defaultVolume)
      : normalizeVolume(input.row.volume);

  return {
    id: input.row.id,
    name: typeof input.row.name === "string" && input.row.name.trim() !== "" ? input.row.name : "Unnamed speaker",
    enabled,
    health,
    healthLabel: deviceHealthLabel(health),
    nextAction: deviceNextAction(health),
    tone: healthTone(health, enabled),
    volume,
    soundLabel: soundLabel(input.row.sound_id, input.row.custom_sound_path, input.builtIns, input.defaultSoundId),
    lastSeenLabel: relativeTimeLabel(input.row.last_seen_at, input.nowIso),
    mutedByChoice: !enabled,
  };
}

export type ShopVerdict = {
  /** Will the next online order actually make a noise somewhere? */
  willAnnounce: boolean;
  /** One sentence, plain English. */
  headline: string;
  /** What to do about it, when there is something to do. Empty when all good. */
  fix: string;
  tone: "good" | "warn" | "bad";
  onlineCount: number;
  totalCount: number;
};

/**
 * Answer the only question that matters: will I hear the next order?
 *
 * Ordered by how badly the shop is broken, most severe first, so the headline
 * always names the real problem rather than a symptom of it.
 */
export function summarizeShop(input: {
  devices: readonly AdminDeviceView[];
  globalEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  now: Date;
}): ShopVerdict {
  const total = input.devices.length;
  const online = input.devices.filter((d) => d.health === "online" && d.enabled).length;

  if (total === 0) {
    return {
      willAnnounce: false,
      headline: "No speakers are set up yet.",
      fix: 'Press "Add a speaker" to pair your first Raspberry Pi. It takes about five minutes.',
      tone: "warn",
      onlineCount: 0,
      totalCount: 0,
    };
  }

  if (!input.globalEnabled) {
    return {
      willAnnounce: false,
      headline: "Announcements are turned OFF for the whole shop.",
      fix: 'Switch "Announce new orders" back on below. Nothing else is wrong.',
      tone: "bad",
      onlineCount: online,
      totalCount: total,
    };
  }

  const quietNow = isWithinQuietHours({
    nowMinutes: clockMinutesOf(input.now),
    startRaw: input.quietStart,
    endRaw: input.quietEnd,
  });
  if (input.quietHoursEnabled && quietNow) {
    return {
      willAnnounce: false,
      headline: "Quiet hours are active right now, so orders will not make a sound.",
      fix: "This is normal overnight. Change the quiet hours below if it is wrong.",
      tone: "warn",
      onlineCount: online,
      totalCount: total,
    };
  }

  const enabledDevices = input.devices.filter((d) => d.enabled);
  if (enabledDevices.length === 0) {
    return {
      willAnnounce: false,
      headline: "Every speaker is switched off.",
      fix: "Turn at least one speaker back on using its toggle below.",
      tone: "bad",
      onlineCount: 0,
      totalCount: total,
    };
  }

  if (online === 0) {
    return {
      willAnnounce: false,
      headline: "No speaker is currently online, so nobody will hear the next order.",
      fix: "Check that each Pi is plugged in and that its network cable or Wi-Fi is connected. Unplug it for ten seconds and plug it back in.",
      tone: "bad",
      onlineCount: 0,
      totalCount: total,
    };
  }

  if (online < enabledDevices.length) {
    const missing = enabledDevices.length - online;
    return {
      willAnnounce: true,
      headline: `You will hear the next order, but ${missing} speaker${missing === 1 ? " is" : "s are"} not responding.`,
      fix: "The rooms below with an amber or red dot are silent. Check power and network on those.",
      tone: "warn",
      onlineCount: online,
      totalCount: total,
    };
  }

  return {
    willAnnounce: true,
    headline: `All ${online} speaker${online === 1 ? "" : "s"} online. You will hear the next order.`,
    fix: "",
    tone: "good",
    onlineCount: online,
    totalCount: total,
  };
}

/** How often the panel should refresh itself, in seconds. */
export const ADMIN_REFRESH_SECONDS = 15;

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runAnnouncerAdminTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-admin-core FAIL: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown): void => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (ok) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-admin-core FAIL: ${label} -> got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
    }
  };

  const NOW = "2026-03-10T12:00:00.000Z";
  const BUILT = [
    { id: "chime", label: "Chime" },
    { id: "bell", label: "Bell" },
  ];

  // ---- tone ------------------------------------------------------------
  eq("tone: online+enabled is good", healthTone("online", true), "good");
  eq("tone: stale is warn", healthTone("stale", true), "warn");
  eq("tone: offline is bad", healthTone("offline", true), "bad");
  eq("tone: never-seen is bad", healthTone("never-seen", true), "bad");
  eq("tone: disabled is idle even when online", healthTone("online", false), "idle");
  eq("tone: disabled is idle even when offline", healthTone("offline", false), "idle");

  // ---- relative time ---------------------------------------------------
  eq("time: null is never", relativeTimeLabel(null, NOW), "never");
  eq("time: empty is never", relativeTimeLabel("   ", NOW), "never");
  eq("time: garbage is never", relativeTimeLabel("not-a-date", NOW), "never");
  eq("time: same instant is just now", relativeTimeLabel(NOW, NOW), "just now");
  eq("time: 30s", relativeTimeLabel("2026-03-10T11:59:30.000Z", NOW), "30 seconds ago");
  eq("time: 1 minute singular", relativeTimeLabel("2026-03-10T11:59:00.000Z", NOW), "1 minute ago");
  eq("time: 5 minutes", relativeTimeLabel("2026-03-10T11:55:00.000Z", NOW), "5 minutes ago");
  eq("time: 1 hour singular", relativeTimeLabel("2026-03-10T11:00:00.000Z", NOW), "1 hour ago");
  eq("time: 3 hours", relativeTimeLabel("2026-03-10T09:00:00.000Z", NOW), "3 hours ago");
  eq("time: 1 day singular", relativeTimeLabel("2026-03-09T12:00:00.000Z", NOW), "1 day ago");
  eq("time: 4 days", relativeTimeLabel("2026-03-06T12:00:00.000Z", NOW), "4 days ago");
  // A Pi with a slightly fast clock must never show "in 5 minutes".
  eq("time: future clamps to just now", relativeTimeLabel("2026-03-10T12:05:00.000Z", NOW), "just now");

  // ---- sound labels ----------------------------------------------------
  eq("sound: known built-in", soundLabel("bell", null, BUILT, "chime"), "Bell");
  eq("sound: null falls back to shop default", soundLabel(null, null, BUILT, "chime"), "Chime");
  eq("sound: custom shows the file name", soundLabel(null, "sounds/my horn.mp3", BUILT, "chime"), "my horn.mp3");
  eq("sound: custom wins over built-in", soundLabel("bell", "sounds/x.wav", BUILT, "chime"), "x.wav");
  eq("sound: unknown id degrades gracefully", soundLabel("nope", null, BUILT, "zzz"), "Shop default");

  // ---- device view -----------------------------------------------------
  const view = toDeviceView({
    row: { id: "d1", name: "Sales Floor", enabled: true, volume: null, sound_id: "bell", custom_sound_path: null, last_seen_at: NOW },
    nowIso: NOW,
    builtIns: BUILT,
    defaultSoundId: "chime",
    defaultVolume: 70,
  });
  eq("view: name passes through", view.name, "Sales Floor");
  eq("view: online", view.health, "online");
  eq("view: tone good", view.tone, "good");
  eq("view: inherits default volume", view.volume, 70);
  eq("view: sound label", view.soundLabel, "Bell");
  check("view: next action is never empty", view.nextAction.trim().length > 0);
  check("view: health label is never empty", view.healthLabel.trim().length > 0);

  const unnamed = toDeviceView({
    row: { id: "d2", name: "  ", enabled: true, volume: 30, sound_id: null, custom_sound_path: null, last_seen_at: null },
    nowIso: NOW,
    builtIns: BUILT,
    defaultSoundId: "chime",
    defaultVolume: 70,
  });
  eq("view: blank name gets a placeholder", unnamed.name, "Unnamed speaker");
  eq("view: never seen", unnamed.health, "never-seen");
  eq("view: own volume respected", unnamed.volume, 30);
  eq("view: last seen never", unnamed.lastSeenLabel, "never");

  // A device disabled on purpose is not an alarm.
  const off = toDeviceView({
    row: { id: "d3", name: "Storage", enabled: false, volume: 50, sound_id: "chime", custom_sound_path: null, last_seen_at: NOW },
    nowIso: NOW,
    builtIns: BUILT,
    defaultSoundId: "chime",
    defaultVolume: 70,
  });
  eq("view: disabled is idle", off.tone, "idle");
  check("view: disabled is flagged as a choice", off.mutedByChoice);

  // ---- shop verdict ----------------------------------------------------
  const onlineView = (id: string): AdminDeviceView =>
    toDeviceView({
      row: { id, name: id, enabled: true, volume: 70, sound_id: "chime", custom_sound_path: null, last_seen_at: NOW },
      nowIso: NOW,
      builtIns: BUILT,
      defaultSoundId: "chime",
      defaultVolume: 70,
    });
  const offlineView = (id: string): AdminDeviceView =>
    toDeviceView({
      row: { id, name: id, enabled: true, volume: 70, sound_id: "chime", custom_sound_path: null, last_seen_at: "2026-03-09T00:00:00.000Z" },
      nowIso: NOW,
      builtIns: BUILT,
      defaultSoundId: "chime",
      defaultVolume: 70,
    });

  const NOON_PACIFIC = new Date("2026-03-10T19:00:00Z"); // 12:00 PDT
  const baseShop = {
    globalEnabled: true,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "08:00",
    now: NOON_PACIFIC,
  };

  const empty = summarizeShop({ ...baseShop, devices: [] });
  check("shop: no devices does not announce", !empty.willAnnounce);
  check("shop: no devices tells you to pair one", empty.fix.toLowerCase().includes("add a speaker"));

  const allGood = summarizeShop({ ...baseShop, devices: [onlineView("a"), onlineView("b")] });
  check("shop: all online announces", allGood.willAnnounce);
  eq("shop: all online is good tone", allGood.tone, "good");
  eq("shop: counts online", allGood.onlineCount, 2);
  eq("shop: no fix needed when healthy", allGood.fix, "");

  const masterOff = summarizeShop({ ...baseShop, globalEnabled: false, devices: [onlineView("a")] });
  check("shop: master off does not announce", !masterOff.willAnnounce);
  check("shop: master off names the switch", masterOff.headline.toLowerCase().includes("off"));
  // Master off must outrank a healthy device list.
  eq("shop: master off is the headline even when devices are fine", masterOff.tone, "bad");

  const allOffline = summarizeShop({ ...baseShop, devices: [offlineView("a"), offlineView("b")] });
  check("shop: all offline does not announce", !allOffline.willAnnounce);
  check("shop: all offline tells you to check power", allOffline.fix.toLowerCase().includes("plug"));

  const partial = summarizeShop({ ...baseShop, devices: [onlineView("a"), offlineView("b")] });
  check("shop: partial still announces", partial.willAnnounce);
  eq("shop: partial is a warning", partial.tone, "warn");
  check("shop: partial says how many are missing", partial.headline.includes("1 speaker"));

  // 06:00Z is 11PM Pacific — genuinely inside 22:00->08:00.
  const quiet = summarizeShop({
    ...baseShop,
    quietHoursEnabled: true,
    now: new Date("2026-03-11T06:00:00Z"),
    devices: [onlineView("a")],
  });
  check("shop: quiet hours does not announce", !quiet.willAnnounce);
  check("shop: quiet hours reassures this is normal", quiet.fix.toLowerCase().includes("normal"));

  // THE REGRESSION GUARD: mid-afternoon must never be reported as quiet.
  const afternoon = summarizeShop({
    ...baseShop,
    quietHoursEnabled: true,
    now: new Date("2026-06-10T22:00:00Z"), // 3PM Pacific
    devices: [onlineView("a")],
  });
  check("shop: 3PM Pacific is NOT quiet hours", afternoon.willAnnounce);

  const allDisabled = summarizeShop({
    ...baseShop,
    devices: [
      toDeviceView({
        row: { id: "z", name: "z", enabled: false, volume: 70, sound_id: "chime", custom_sound_path: null, last_seen_at: NOW },
        nowIso: NOW,
        builtIns: BUILT,
        defaultSoundId: "chime",
        defaultVolume: 70,
      }),
    ],
  });
  check("shop: every speaker switched off does not announce", !allDisabled.willAnnounce);
  check("shop: switched off tells you to toggle one on", allDisabled.fix.toLowerCase().includes("turn at least one"));
  eq("shop: a switched-off speaker counts as zero online", allDisabled.onlineCount, 0);

  // A speaker disabled from the back office keeps heartbeating — it is online
  // in the network sense but will not make a sound. Counting it would inflate
  // "2 of 2 online" while one room sits silent, which is exactly the kind of
  // lie this panel exists to prevent.
  const oneOffOneOn = summarizeShop({
    ...baseShop,
    devices: [
      onlineView("office"),
      toDeviceView({
        row: { id: "storage", name: "Storage", enabled: false, volume: 70, sound_id: "chime", custom_sound_path: null, last_seen_at: NOW },
        nowIso: NOW,
        builtIns: BUILT,
        defaultSoundId: "chime",
        defaultVolume: 70,
      }),
    ],
  });
  eq("shop: healthy-but-disabled speaker is not counted online", oneOffOneOn.onlineCount, 1);
  check("shop: one live speaker still announces", oneOffOneOn.willAnnounce);
  check("shop: headline reports the true count", oneOffOneOn.headline.includes("1 speaker"));

  check("refresh interval is sane", ADMIN_REFRESH_SECONDS > 0 && ADMIN_REFRESH_SECONDS <= DEVICE_ONLINE_GRACE_SECONDS);

  return { passed, failed };
}
