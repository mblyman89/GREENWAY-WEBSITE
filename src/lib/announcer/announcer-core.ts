/**
 * src/lib/announcer/announcer-core.ts
 *
 * SLICE 27 — the online order announcer, decision layer.
 *
 * PURE. No imports, no I/O, no clock of its own, no database, no network, no
 * Raspberry Pi. Every function here takes what it needs as an argument and
 * returns a value. That is what makes it possible to prove the shop's audio
 * rules are right without owning a speaker.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE ROUTES
 * ------------------------------------------------
 * The announcer has to answer a handful of questions correctly, forever:
 * is that speaker alive, should this order make a noise right now, which noise,
 * how loud, is this job still worth doing, and how long should the Pi wait
 * before asking again. Those are all decisions. Decisions belong in a pure
 * module with self-tests (house rule 5) so that a mutation to any one of them
 * fails loudly in CI instead of quietly at nine on a Saturday morning when the
 * sales floor stops hearing orders.
 *
 * THE GOVERNING BIAS
 * ------------------
 * When this module is unsure, it makes noise. A missed order costs the shop a
 * customer standing at the counter. An extra chime costs nothing. So every
 * ambiguous input in here resolves toward announcing, and the sound resolver
 * is structurally incapable of returning silence.
 */

// ============================================================================
// 1. DEVICE HEALTH
// ============================================================================
//
// A speaker reports in on a heartbeat. How long we tolerate hearing nothing
// before we say something is wrong is a judgement call, so it is written down
// once, here, with the reasoning attached.
//
// The Pi's long-poll holds for 25 seconds (section 7), so under healthy
// conditions we hear from it at least that often. 90 seconds is roughly three
// missed cycles: enough slack that one hiccup, one Wi-Fi roam, or one slow
// response does not turn the dot amber and scare somebody, but short enough
// that a genuinely dead speaker is visible on the page inside two minutes.

/** Seconds of silence we forgive before a device stops counting as online. */
export const DEVICE_ONLINE_GRACE_SECONDS = 90;

/**
 * Seconds of silence after which a device is not "probably hiccupping" but
 * "actually gone". Ten minutes is long enough that a router reboot or an
 * internet outage will usually have healed itself first, so red means red.
 */
export const DEVICE_STALE_SECONDS = 600;

export type DeviceHealth = "online" | "stale" | "offline" | "never-seen";

/**
 * How healthy is this device, given when it last checked in?
 *
 * `lastSeenIso` of null means the device is paired but has never once phoned
 * home — a distinct state from "was working, went quiet", because the fix is
 * completely different. Never-seen means the setup did not finish. Offline
 * means something that used to work has stopped.
 *
 * A last-seen timestamp in the future is treated as online rather than as an
 * error: clock skew between the Pi and the server is normal and is not the
 * shop's problem to debug.
 */
export function deviceHealth(input: {
  lastSeenIso: string | null | undefined;
  nowIso: string;
}): DeviceHealth {
  if (typeof input.lastSeenIso !== "string" || input.lastSeenIso.trim() === "") {
    return "never-seen";
  }
  const last = Date.parse(input.lastSeenIso);
  const now = Date.parse(input.nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return "never-seen";

  const ageSeconds = (now - last) / 1000;
  if (ageSeconds < 0) return "online"; // clock skew, not a fault
  if (ageSeconds <= DEVICE_ONLINE_GRACE_SECONDS) return "online";
  if (ageSeconds <= DEVICE_STALE_SECONDS) return "stale";
  return "offline";
}

/** The words that go next to the dot. Plain English, no jargon. */
export function deviceHealthLabel(health: DeviceHealth): string {
  switch (health) {
    case "online":
      return "Online";
    case "stale":
      return "Not responding";
    case "offline":
      return "Offline";
    case "never-seen":
      return "Never connected";
  }
}

/**
 * What should a human actually DO about this device right now?
 *
 * A status dot that does not tell you the next step is decoration. This is the
 * one-line instruction that appears under the dot on the device card, and it is
 * deliberately the smallest useful action rather than a lecture.
 */
export function deviceNextAction(health: DeviceHealth): string {
  switch (health) {
    case "online":
      return "Nothing to do. Press Test if you want to hear it.";
    case "stale":
      return "Wait 2 minutes. If it stays here, check the Pi's power light and its network cable or Wi-Fi.";
    case "offline":
      return "Unplug the Pi's power for 10 seconds, plug it back in, and wait 2 minutes.";
    case "never-seen":
      return "Setup did not finish. Re-run the installer on the Pi and pair it again.";
  }
}

// ============================================================================
// 2. QUIET HOURS
// ============================================================================
//
// The shop does not want a chime at 3am while somebody is doing inventory, but
// it absolutely does want one at 9am. Quiet hours are stored as two clock
// strings, and the whole difficulty is that they legitimately wrap past
// midnight.

/**
 * Parse "HH:MM" into minutes-since-midnight, or null if it is not a valid
 * clock time. Returns null rather than throwing, because a bad value in the
 * settings table must degrade into "announce anyway", never into a crash that
 * silences the shop.
 */
export function parseClockMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(raw.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23) return null;
  if (min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is the given wall-clock minute inside the quiet window?
 *
 * Three behaviours worth stating out loud, because each one is a decision:
 *
 *   1. A window that wraps midnight (21:00 to 08:00) is TWO intervals, not one
 *      impossible one. This is the case that gets written wrong most often, so
 *      it is the case with the most self-tests below.
 *   2. start === end means quiet hours are OFF, not that the shop is silent
 *      around the clock. Both readings are defensible from the data; only one
 *      of them is recoverable by a confused owner at 9am.
 *   3. Anything unparseable is NOT quiet. Fail open. Make noise.
 */
export function isWithinQuietHours(input: {
  nowMinutes: number;
  startRaw: unknown;
  endRaw: unknown;
}): boolean {
  const start = parseClockMinutes(input.startRaw);
  const end = parseClockMinutes(input.endRaw);
  if (start === null || end === null) return false; // fail open
  if (start === end) return false; // disabled, not always-quiet

  if (start < end) {
    // Ordinary same-day window, e.g. 01:00 to 05:00.
    return input.nowMinutes >= start && input.nowMinutes < end;
  }
  // Wrapping window, e.g. 21:00 to 08:00: late tonight OR early tomorrow.
  return input.nowMinutes >= start || input.nowMinutes < end;
}

/** Minutes-since-midnight for a Date, in whatever zone that Date represents. */
export function clockMinutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// ============================================================================
// 3. THE ANNOUNCE DECISION
// ============================================================================

export type AnnounceDecision = {
  announce: boolean;
  /** Why. Shown in the activity log so a silent speaker is never a mystery. */
  reason: string;
};

/**
 * Should this device make a noise for this event?
 *
 * The reason string is not decoration. The single hardest thing to debug in a
 * system like this is "it didn't beep and I don't know why", so every path out
 * of this function names itself, and the back office writes that name into the
 * activity log.
 */
export function shouldAnnounce(input: {
  deviceEnabled: boolean;
  globalEnabled: boolean;
  quietHoursEnabled: boolean;
  nowMinutes: number;
  quietStartRaw: unknown;
  quietEndRaw: unknown;
  /** A Test press from the back office ignores quiet hours on purpose. */
  isTest: boolean;
}): AnnounceDecision {
  if (!input.globalEnabled) {
    return { announce: false, reason: "Announcer is turned off for the whole shop." };
  }
  if (!input.deviceEnabled) {
    return { announce: false, reason: "This speaker is turned off." };
  }
  if (input.isTest) {
    // A person is standing there pressing a button. Always answer them,
    // otherwise Test becomes useless during exactly the hours you most want
    // to verify the speaker works.
    return { announce: true, reason: "Test from the back office." };
  }
  if (
    input.quietHoursEnabled &&
    isWithinQuietHours({
      nowMinutes: input.nowMinutes,
      startRaw: input.quietStartRaw,
      endRaw: input.quietEndRaw,
    })
  ) {
    return { announce: false, reason: "Inside quiet hours." };
  }
  return { announce: true, reason: "New online order." };
}

// ============================================================================
// 4. VOLUME
// ============================================================================

export const DEFAULT_VOLUME = 70;

/**
 * Clamp an arbitrary stored value into 0..100.
 *
 * Garbage becomes DEFAULT_VOLUME rather than 0, for the same reason the sound
 * resolver never returns silence: a speaker at volume 0 looks identical to a
 * broken speaker from across the sales floor.
 */
export function normalizeVolume(raw: unknown): number {
  // Deliberately NOT `Number(raw)` on anything. Number(null) is 0 and
  // Number("") is 0, so the lazy version turns a missing setting into a MUTED
  // speaker — the precise failure this function exists to prevent. Only a real
  // number, or a non-empty string that parses as one, is accepted.
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    n = Number(raw.trim());
  } else {
    return DEFAULT_VOLUME;
  }
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  const rounded = Math.round(n);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

// ============================================================================
// 5. SOUND RESOLUTION
// ============================================================================

export type BuiltInSound = {
  id: string;
  label: string;
  /** One line telling the owner where this one actually belongs. */
  hint: string;
};

/**
 * The sounds that ship with the system. These exist so the shop is never
 * dependent on an upload having succeeded, and so a brand-new Pi makes a noise
 * the moment it is paired.
 */
export const BUILT_IN_SOUNDS: readonly BuiltInSound[] = [
  { id: "chime", label: "Chime", hint: "Soft two-tone. Good for the office." },
  { id: "bell", label: "Bell", hint: "Classic shop bell. Cuts through chatter." },
  { id: "ding", label: "Ding", hint: "Short and quiet. Least intrusive option." },
  { id: "alert", label: "Alert", hint: "Three rising tones. Hard to ignore." },
  { id: "cash", label: "Cash register", hint: "Fun one for the sales floor." },
  { id: "voice", label: "Spoken announcement", hint: "Says the order out loud." },
];

export function isBuiltInSound(id: unknown): boolean {
  return typeof id === "string" && BUILT_IN_SOUNDS.some((s) => s.id === id);
}

export type ResolvedSound =
  | { kind: "built-in"; id: string }
  | { kind: "custom"; path: string };

/**
 * Decide what this device will actually play.
 *
 * THE INVARIANT THIS FUNCTION EXISTS TO PROTECT: it can never resolve to
 * silence. If a device points at a custom upload and that upload has since
 * been deleted from the bucket, we fall back to the shop default, and if the
 * shop default is itself junk we fall back to the first built-in. A speaker
 * that plays nothing is indistinguishable from a speaker that is broken, and
 * nobody can tell those apart from twenty feet away.
 *
 * `availableCustomPaths` is passed in rather than looked up, because this
 * module is pure — the caller has already listed the bucket.
 */
export function resolveSound(input: {
  deviceSoundId: string | null | undefined;
  deviceCustomPath: string | null | undefined;
  defaultSoundId: string | null | undefined;
  availableCustomPaths: readonly string[];
}): ResolvedSound {
  const custom =
    typeof input.deviceCustomPath === "string" ? input.deviceCustomPath.trim() : "";
  if (custom !== "" && input.availableCustomPaths.includes(custom)) {
    return { kind: "custom", path: custom };
  }
  // Either no custom sound was chosen, or the one that was chosen is gone.
  if (isBuiltInSound(input.deviceSoundId)) {
    return { kind: "built-in", id: input.deviceSoundId as string };
  }
  if (isBuiltInSound(input.defaultSoundId)) {
    return { kind: "built-in", id: input.defaultSoundId as string };
  }
  return { kind: "built-in", id: BUILT_IN_SOUNDS[0].id };
}

// ============================================================================
// 6. PAIRING CODES
// ============================================================================

/**
 * No 0, O, 1, I, or L.
 *
 * These codes are read off a laptop screen and typed into a Pi, often by two
 * different people in two different rooms. Every character that can be
 * misheard or misread is removed rather than explained.
 */
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MINUTES = 60;

/** Render as XXXX-XXXX. Four-character groups are what people can hold. */
export function formatPairingCode(raw: string): string {
  const clean = normalizePairingCode(raw);
  if (clean.length !== PAIRING_CODE_LENGTH) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/**
 * Turn whatever a human typed into the canonical code: uppercase, no dashes,
 * no spaces. Someone will type it lowercase and someone will leave the dash
 * in, and neither of those is an error worth failing a setup over.
 */
export function normalizePairingCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export type PairingValidity =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Is this pairing code usable right now? Every failure names itself, because
 * "pairing failed" with no explanation is the single most frustrating thing a
 * setup can say to somebody standing in a storage room holding a Pi.
 */
export function pairingCodeValidity(input: {
  code: unknown;
  createdAtIso: string | null | undefined;
  consumedAtIso: string | null | undefined;
  nowIso: string;
}): PairingValidity {
  const code = normalizePairingCode(input.code);
  if (code.length !== PAIRING_CODE_LENGTH) {
    return { valid: false, reason: `Codes are ${PAIRING_CODE_LENGTH} characters. Check for a typo.` };
  }
  for (const ch of code) {
    if (!PAIRING_ALPHABET.includes(ch)) {
      return { valid: false, reason: `"${ch}" is not a character we use. Codes never contain 0, O, 1, I, or L.` };
    }
  }
  if (typeof input.consumedAtIso === "string" && input.consumedAtIso.trim() !== "") {
    return { valid: false, reason: "This code was already used. Generate a new one." };
  }
  if (typeof input.createdAtIso !== "string" || input.createdAtIso.trim() === "") {
    return { valid: false, reason: "We do not recognize this code. Generate a new one." };
  }
  const created = Date.parse(input.createdAtIso);
  const now = Date.parse(input.nowIso);
  if (!Number.isFinite(created) || !Number.isFinite(now)) {
    return { valid: false, reason: "We do not recognize this code. Generate a new one." };
  }
  const ageMinutes = (now - created) / 60000;
  if (ageMinutes > PAIRING_TTL_MINUTES) {
    return { valid: false, reason: `Codes expire after ${PAIRING_TTL_MINUTES} minutes. Generate a new one.` };
  }
  return { valid: true };
}

// ============================================================================
// 7. THE QUEUE
// ============================================================================

/**
 * How old an announcement may be and still be worth playing.
 *
 * This is the rule that stops a speaker which was unplugged over lunch from
 * coming back and shouting eleven stale orders at the sales floor. Stale news
 * is worse than no news: it teaches everyone to ignore the speaker.
 */
export const ANNOUNCEMENT_TTL_SECONDS = 900;

/**
 * How long a claim is held before the work becomes available again.
 *
 * This is a LEASE, not a delete. A Pi that claims a job and then loses power
 * mid-play does not swallow the announcement — the lease lapses and another
 * attempt happens. 60 seconds is comfortably longer than any real playback.
 */
export const CLAIM_LEASE_SECONDS = 60;

export type QueueRowState = {
  createdAtIso: string;
  claimedAtIso: string | null;
  deliveredAtIso: string | null;
};

/** Already played and acknowledged. Nothing more to do with it. */
export function isDelivered(row: QueueRowState): boolean {
  return typeof row.deliveredAtIso === "string" && row.deliveredAtIso.trim() !== "";
}

/** Too old to be worth playing. */
export function isExpiredAnnouncement(row: QueueRowState, nowIso: string): boolean {
  const created = Date.parse(row.createdAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(created) || !Number.isFinite(now)) return true;
  return (now - created) / 1000 > ANNOUNCEMENT_TTL_SECONDS;
}

/**
 * May a device pick this row up right now?
 *
 * Claimable means: not already done, not too old, and either never claimed or
 * claimed so long ago that the claimant has clearly died.
 */
export function isClaimable(row: QueueRowState, nowIso: string): boolean {
  if (isDelivered(row)) return false;
  if (isExpiredAnnouncement(row, nowIso)) return false;
  if (typeof row.claimedAtIso !== "string" || row.claimedAtIso.trim() === "") {
    return true;
  }
  const claimed = Date.parse(row.claimedAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(claimed) || !Number.isFinite(now)) return true;
  return (now - claimed) / 1000 > CLAIM_LEASE_SECONDS;
}

// ============================================================================
// 8. LONG-POLL TIMING
// ============================================================================

/**
 * How long the server holds a poll open before answering "nothing yet".
 *
 * The hard ceiling on this platform is 60 seconds (`maxDuration` in
 * src/app/api/pos/sync/route.ts is the longest in the repository). 25 seconds
 * is better than a 2x margin, which leaves room for TLS setup, a cold start,
 * and a slow mobile-hotspot uplink without ever brushing the ceiling. Holding
 * longer would shave a negligible amount of request overhead in exchange for
 * risking a truncated response, which is a bad trade.
 */
export const POLL_HOLD_SECONDS = 25;

/**
 * How long to wait after a FAILED poll, by consecutive failure count.
 *
 * Gentle at first, because most failures are a one-second blip. It tops out at
 * 30 seconds rather than backing off to minutes, because when the internet
 * comes back the shop should start hearing orders again within half a minute
 * without anyone touching anything.
 */
export const POLL_BACKOFF_SECONDS: readonly number[] = [1, 2, 5, 10, 20, 30];

export function pollBackoffSeconds(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) {
    return POLL_BACKOFF_SECONDS[0];
  }
  const idx = Math.min(Math.floor(consecutiveFailures) - 1, POLL_BACKOFF_SECONDS.length - 1);
  return POLL_BACKOFF_SECONDS[idx];
}

// ============================================================================
// 9. WHAT THE SPEAKER SAYS
// ============================================================================

/**
 * The spoken line for the "voice" sound.
 *
 * Short on purpose. This gets said out loud in a room with customers in it, so
 * it carries the fact and nothing else. It never includes a customer's name or
 * anything about what they bought — that is said across a sales floor and is
 * not ours to broadcast.
 */
export function announcementText(input: {
  orderNumber: string | null | undefined;
  isTest: boolean;
}): string {
  if (input.isTest) return "Announcer test. This speaker is working.";
  const num =
    typeof input.orderNumber === "string" && input.orderNumber.trim() !== ""
      ? input.orderNumber.trim()
      : "";
  if (num === "") return "New online order.";
  return `New online order. Number ${num}.`;
}

// ============================================================================
// 10. DEVICE NAMES
// ============================================================================

/**
 * Names people can actually pick without thinking, matching the rooms Michael
 * named: office, sales floor, storage.
 */
export const SUGGESTED_DEVICE_NAMES: readonly string[] = [
  "Office",
  "Sales Floor",
  "Storage",
  "Back Room",
  "Drive-Thru",
];

/**
 * Trim, collapse runs of whitespace, cap the length. Empty becomes a usable
 * placeholder rather than an empty card that nobody can tell apart from the
 * other empty card.
 */
export function normalizeDeviceName(raw: unknown): string {
  if (typeof raw !== "string") return "New Speaker";
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean === "") return "New Speaker";
  return clean.length > 40 ? clean.slice(0, 40).trim() : clean;
}

// ============================================================================
// SELF-TESTS
// ============================================================================

/**
 * Embedded self-tests (house rule 5). Registered in
 * scripts/compliance/run-pure-selftests.ts and mirrored in
 * tests/compliance/announcer-core.test.ts, so a self-test nothing invokes can
 * never become dead code wearing a green check.
 */
export function __runAnnouncerCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean): void => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`announcer-core FAIL: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown): void => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (!ok) console.error(`announcer-core FAIL: ${label} -> got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
    if (ok) passed += 1;
    else failed += 1;
  };

  const NOW = "2026-03-10T12:00:00.000Z";

  // ---- 1. device health -----------------------------------------------
  eq("health: never seen when null", deviceHealth({ lastSeenIso: null, nowIso: NOW }), "never-seen");
  eq("health: never seen when empty", deviceHealth({ lastSeenIso: "   ", nowIso: NOW }), "never-seen");
  eq("health: never seen when garbage", deviceHealth({ lastSeenIso: "not-a-date", nowIso: NOW }), "never-seen");
  eq("health: 0s ago is online", deviceHealth({ lastSeenIso: NOW, nowIso: NOW }), "online");
  eq(
    "health: 89s ago is online",
    deviceHealth({ lastSeenIso: "2026-03-10T11:58:31.000Z", nowIso: NOW }),
    "online",
  );
  eq(
    "health: exactly 90s ago is still online (boundary inclusive)",
    deviceHealth({ lastSeenIso: "2026-03-10T11:58:30.000Z", nowIso: NOW }),
    "online",
  );
  eq(
    "health: 91s ago is stale",
    deviceHealth({ lastSeenIso: "2026-03-10T11:58:29.000Z", nowIso: NOW }),
    "stale",
  );
  eq(
    "health: exactly 600s ago is still stale (boundary inclusive)",
    deviceHealth({ lastSeenIso: "2026-03-10T11:50:00.000Z", nowIso: NOW }),
    "stale",
  );
  eq(
    "health: 601s ago is offline",
    deviceHealth({ lastSeenIso: "2026-03-10T11:49:59.000Z", nowIso: NOW }),
    "offline",
  );
  eq(
    "health: an hour ago is offline",
    deviceHealth({ lastSeenIso: "2026-03-10T11:00:00.000Z", nowIso: NOW }),
    "offline",
  );
  eq(
    "health: future timestamp is online, not an error (clock skew)",
    deviceHealth({ lastSeenIso: "2026-03-10T12:05:00.000Z", nowIso: NOW }),
    "online",
  );
  // Every health state must have a label AND an action. A red dot with no
  // instruction is the exact failure this feature is supposed to prevent.
  for (const h of ["online", "stale", "offline", "never-seen"] as const) {
    check(`health label non-empty: ${h}`, deviceHealthLabel(h).length > 0);
    check(`health action non-empty: ${h}`, deviceNextAction(h).length > 0);
  }
  check("offline action tells you to power cycle", deviceNextAction("offline").toLowerCase().includes("unplug"));
  check("never-seen action mentions the installer", deviceNextAction("never-seen").toLowerCase().includes("installer"));

  // ---- 2. clock parsing -----------------------------------------------
  eq("clock: 00:00", parseClockMinutes("00:00"), 0);
  eq("clock: 09:30", parseClockMinutes("09:30"), 570);
  eq("clock: 9:30 single digit hour", parseClockMinutes("9:30"), 570);
  eq("clock: 23:59", parseClockMinutes("23:59"), 1439);
  eq("clock: trims whitespace", parseClockMinutes("  08:15  "), 495);
  eq("clock: rejects 24:00", parseClockMinutes("24:00"), null);
  eq("clock: rejects 12:60", parseClockMinutes("12:60"), null);
  eq("clock: rejects single-digit minutes", parseClockMinutes("12:5"), null);
  eq("clock: rejects empty", parseClockMinutes(""), null);
  eq("clock: rejects non-string", parseClockMinutes(930), null);
  eq("clock: rejects null", parseClockMinutes(null), null);
  eq("clock: rejects words", parseClockMinutes("noon"), null);
  eq("clockMinutesOf reads local hours+minutes", clockMinutesOf(new Date(2026, 2, 10, 14, 45)), 885);

  // ---- 3. quiet hours --------------------------------------------------
  // Same-day window 01:00-05:00.
  const day = { startRaw: "01:00", endRaw: "05:00" };
  check("quiet: 00:59 outside same-day window", !isWithinQuietHours({ nowMinutes: 59, ...day }));
  check("quiet: 01:00 inside (start inclusive)", isWithinQuietHours({ nowMinutes: 60, ...day }));
  check("quiet: 03:00 inside", isWithinQuietHours({ nowMinutes: 180, ...day }));
  check("quiet: 04:59 inside", isWithinQuietHours({ nowMinutes: 299, ...day }));
  check("quiet: 05:00 outside (end exclusive)", !isWithinQuietHours({ nowMinutes: 300, ...day }));
  check("quiet: 12:00 outside", !isWithinQuietHours({ nowMinutes: 720, ...day }));

  // Overnight window 21:00-08:00. This is the one that gets written wrong.
  const night = { startRaw: "21:00", endRaw: "08:00" };
  check("quiet overnight: 20:59 outside", !isWithinQuietHours({ nowMinutes: 1259, ...night }));
  check("quiet overnight: 21:00 inside (start inclusive)", isWithinQuietHours({ nowMinutes: 1260, ...night }));
  check("quiet overnight: 23:59 inside", isWithinQuietHours({ nowMinutes: 1439, ...night }));
  check("quiet overnight: 00:00 inside (across midnight)", isWithinQuietHours({ nowMinutes: 0, ...night }));
  check("quiet overnight: 03:00 inside", isWithinQuietHours({ nowMinutes: 180, ...night }));
  check("quiet overnight: 07:59 inside", isWithinQuietHours({ nowMinutes: 479, ...night }));
  check("quiet overnight: 08:00 outside (end exclusive)", !isWithinQuietHours({ nowMinutes: 480, ...night }));
  check("quiet overnight: 09:00 outside — SHOP IS OPEN", !isWithinQuietHours({ nowMinutes: 540, ...night }));
  check("quiet overnight: 12:00 outside", !isWithinQuietHours({ nowMinutes: 720, ...night }));
  check("quiet overnight: 17:00 outside", !isWithinQuietHours({ nowMinutes: 1020, ...night }));

  // start === end means OFF, not always-quiet.
  check(
    "quiet: start equals end means disabled at that minute",
    !isWithinQuietHours({ nowMinutes: 600, startRaw: "10:00", endRaw: "10:00" }),
  );
  check(
    "quiet: start equals end means disabled at other minutes too",
    !isWithinQuietHours({ nowMinutes: 60, startRaw: "10:00", endRaw: "10:00" }),
  );

  // Unparseable fails OPEN. Never silence the shop over a bad settings value.
  check("quiet: garbage start fails open", !isWithinQuietHours({ nowMinutes: 180, startRaw: "oops", endRaw: "08:00" }));
  check("quiet: garbage end fails open", !isWithinQuietHours({ nowMinutes: 180, startRaw: "21:00", endRaw: "oops" }));
  check("quiet: null start fails open", !isWithinQuietHours({ nowMinutes: 180, startRaw: null, endRaw: "08:00" }));
  check("quiet: both null fails open", !isWithinQuietHours({ nowMinutes: 180, startRaw: null, endRaw: null }));

  // ---- 4. the announce decision ---------------------------------------
  const base = {
    deviceEnabled: true,
    globalEnabled: true,
    quietHoursEnabled: true,
    nowMinutes: 180, // 03:00
    quietStartRaw: "21:00",
    quietEndRaw: "08:00",
    isTest: false,
  };
  check("announce: global off blocks", !shouldAnnounce({ ...base, globalEnabled: false }).announce);
  check("announce: device off blocks", !shouldAnnounce({ ...base, deviceEnabled: false }).announce);
  check("announce: inside quiet hours blocks", !shouldAnnounce(base).announce);
  check("announce: outside quiet hours announces", shouldAnnounce({ ...base, nowMinutes: 720 }).announce);
  check(
    "announce: quiet hours disabled announces at 3am",
    shouldAnnounce({ ...base, quietHoursEnabled: false }).announce,
  );
  check("announce: TEST beats quiet hours", shouldAnnounce({ ...base, isTest: true }).announce);
  check(
    "announce: TEST does NOT beat device disabled",
    !shouldAnnounce({ ...base, isTest: true, deviceEnabled: false }).announce,
  );
  check(
    "announce: TEST does NOT beat global disabled",
    !shouldAnnounce({ ...base, isTest: true, globalEnabled: false }).announce,
  );
  // Every path names itself so the activity log can explain a silent speaker.
  for (const variant of [
    base,
    { ...base, globalEnabled: false },
    { ...base, deviceEnabled: false },
    { ...base, nowMinutes: 720 },
    { ...base, isTest: true },
  ]) {
    check("announce: reason is always populated", shouldAnnounce(variant).reason.trim().length > 0);
  }

  // ---- 5. volume -------------------------------------------------------
  eq("volume: 0 stays 0", normalizeVolume(0), 0);
  eq("volume: 55 stays 55", normalizeVolume(55), 55);
  eq("volume: 100 stays 100", normalizeVolume(100), 100);
  eq("volume: -5 clamps to 0", normalizeVolume(-5), 0);
  eq("volume: 250 clamps to 100", normalizeVolume(250), 100);
  eq("volume: 71.6 rounds to 72", normalizeVolume(71.6), 72);
  eq("volume: numeric string parses", normalizeVolume("80"), 80);
  eq("volume: garbage becomes default not zero", normalizeVolume("loud"), DEFAULT_VOLUME);
  eq("volume: null becomes default not zero", normalizeVolume(null), DEFAULT_VOLUME);
  eq("volume: undefined becomes default not zero", normalizeVolume(undefined), DEFAULT_VOLUME);
  eq("volume: NaN becomes default not zero", normalizeVolume(Number.NaN), DEFAULT_VOLUME);
  // Number("") and Number([]) are both 0 in JavaScript. If this function ever
  // goes back to a bare Number() call, these four turn red instead of the
  // sales floor going quiet.
  eq("volume: empty string becomes default not zero", normalizeVolume(""), DEFAULT_VOLUME);
  eq("volume: whitespace becomes default not zero", normalizeVolume("   "), DEFAULT_VOLUME);
  eq("volume: empty array becomes default not zero", normalizeVolume([]), DEFAULT_VOLUME);
  eq("volume: boolean false becomes default not zero", normalizeVolume(false), DEFAULT_VOLUME);
  eq("volume: object becomes default not zero", normalizeVolume({}), DEFAULT_VOLUME);

  // ---- 6. sound resolution --------------------------------------------
  check("sounds: at least six built-ins ship", BUILT_IN_SOUNDS.length >= 6);
  check("sounds: every built-in has a hint", BUILT_IN_SOUNDS.every((s) => s.hint.trim().length > 0));
  check(
    "sounds: built-in ids are unique",
    new Set(BUILT_IN_SOUNDS.map((s) => s.id)).size === BUILT_IN_SOUNDS.length,
  );
  check("sounds: chime is recognized", isBuiltInSound("chime"));
  check("sounds: nonsense is not recognized", !isBuiltInSound("foghorn"));
  check("sounds: null is not recognized", !isBuiltInSound(null));

  eq(
    "sound: an available custom file wins",
    resolveSound({
      deviceSoundId: "chime",
      deviceCustomPath: "uploads/a.mp3",
      defaultSoundId: "bell",
      availableCustomPaths: ["uploads/a.mp3"],
    }),
    { kind: "custom", path: "uploads/a.mp3" },
  );
  eq(
    "sound: a DELETED custom file falls back to the device built-in, never silence",
    resolveSound({
      deviceSoundId: "chime",
      deviceCustomPath: "uploads/gone.mp3",
      defaultSoundId: "bell",
      availableCustomPaths: [],
    }),
    { kind: "built-in", id: "chime" },
  );
  eq(
    "sound: no custom chosen uses the device built-in",
    resolveSound({
      deviceSoundId: "alert",
      deviceCustomPath: null,
      defaultSoundId: "bell",
      availableCustomPaths: [],
    }),
    { kind: "built-in", id: "alert" },
  );
  eq(
    "sound: bad device sound falls through to the shop default",
    resolveSound({
      deviceSoundId: "foghorn",
      deviceCustomPath: null,
      defaultSoundId: "bell",
      availableCustomPaths: [],
    }),
    { kind: "built-in", id: "bell" },
  );
  eq(
    "sound: everything bad still yields a real sound",
    resolveSound({
      deviceSoundId: null,
      deviceCustomPath: null,
      defaultSoundId: null,
      availableCustomPaths: [],
    }),
    { kind: "built-in", id: BUILT_IN_SOUNDS[0].id },
  );
  eq(
    "sound: whitespace-only custom path is ignored",
    resolveSound({
      deviceSoundId: "ding",
      deviceCustomPath: "   ",
      defaultSoundId: "bell",
      availableCustomPaths: ["   "],
    }),
    { kind: "built-in", id: "ding" },
  );

  // ---- 7. pairing codes ------------------------------------------------
  check("pairing: alphabet excludes 0", !PAIRING_ALPHABET.includes("0"));
  check("pairing: alphabet excludes O", !PAIRING_ALPHABET.includes("O"));
  check("pairing: alphabet excludes 1", !PAIRING_ALPHABET.includes("1"));
  check("pairing: alphabet excludes I", !PAIRING_ALPHABET.includes("I"));
  check("pairing: alphabet excludes L", !PAIRING_ALPHABET.includes("L"));
  check("pairing: alphabet has no duplicates", new Set(PAIRING_ALPHABET).size === PAIRING_ALPHABET.length);
  eq("pairing: normalize uppercases", normalizePairingCode("abcd2345"), "ABCD2345");
  eq("pairing: normalize strips dashes", normalizePairingCode("ABCD-2345"), "ABCD2345");
  eq("pairing: normalize strips spaces", normalizePairingCode(" ABCD 2345 "), "ABCD2345");
  eq("pairing: normalize of non-string is empty", normalizePairingCode(null), "");
  eq("pairing: format inserts the dash", formatPairingCode("ABCD2345"), "ABCD-2345");
  eq("pairing: format is idempotent", formatPairingCode("ABCD-2345"), "ABCD-2345");
  eq("pairing: format of a short code is left alone", formatPairingCode("ABC"), "ABC");

  const created = "2026-03-10T11:30:00.000Z"; // 30 minutes before NOW
  eq(
    "pairing: fresh unused code is valid",
    pairingCodeValidity({ code: "ABCD2345", createdAtIso: created, consumedAtIso: null, nowIso: NOW }),
    { valid: true },
  );
  eq(
    "pairing: lowercase with a dash is still valid",
    pairingCodeValidity({ code: "abcd-2345", createdAtIso: created, consumedAtIso: null, nowIso: NOW }),
    { valid: true },
  );
  check(
    "pairing: wrong length is rejected",
    pairingCodeValidity({ code: "ABC", createdAtIso: created, consumedAtIso: null, nowIso: NOW }).valid === false,
  );
  check(
    "pairing: a code containing O is rejected",
    pairingCodeValidity({ code: "ABCO2345", createdAtIso: created, consumedAtIso: null, nowIso: NOW }).valid === false,
  );
  check(
    "pairing: an already-used code is rejected",
    pairingCodeValidity({ code: "ABCD2345", createdAtIso: created, consumedAtIso: NOW, nowIso: NOW }).valid === false,
  );
  check(
    "pairing: 59 minutes old is still valid",
    pairingCodeValidity({
      code: "ABCD2345",
      createdAtIso: "2026-03-10T11:01:00.000Z",
      consumedAtIso: null,
      nowIso: NOW,
    }).valid === true,
  );
  check(
    "pairing: 61 minutes old is expired",
    pairingCodeValidity({
      code: "ABCD2345",
      createdAtIso: "2026-03-10T10:59:00.000Z",
      consumedAtIso: null,
      nowIso: NOW,
    }).valid === false,
  );
  check(
    "pairing: unknown code is rejected",
    pairingCodeValidity({ code: "ABCD2345", createdAtIso: null, consumedAtIso: null, nowIso: NOW }).valid === false,
  );
  // Every rejection must explain itself.
  for (const bad of [
    { code: "ABC", createdAtIso: created, consumedAtIso: null, nowIso: NOW },
    { code: "ABCO2345", createdAtIso: created, consumedAtIso: null, nowIso: NOW },
    { code: "ABCD2345", createdAtIso: created, consumedAtIso: NOW, nowIso: NOW },
    { code: "ABCD2345", createdAtIso: null, consumedAtIso: null, nowIso: NOW },
  ]) {
    const v = pairingCodeValidity(bad);
    check("pairing: every rejection carries a reason", v.valid === false && v.reason.trim().length > 0);
  }

  // ---- 8. the queue ----------------------------------------------------
  const fresh: QueueRowState = { createdAtIso: NOW, claimedAtIso: null, deliveredAtIso: null };
  check("queue: a fresh unclaimed row is claimable", isClaimable(fresh, NOW));
  check("queue: a fresh row is not delivered", !isDelivered(fresh));
  check("queue: a fresh row is not expired", !isExpiredAnnouncement(fresh, NOW));

  const done: QueueRowState = { createdAtIso: NOW, claimedAtIso: NOW, deliveredAtIso: NOW };
  check("queue: a delivered row is not claimable", !isClaimable(done, NOW));
  check("queue: isDelivered sees it", isDelivered(done));

  const old: QueueRowState = {
    createdAtIso: "2026-03-10T11:40:00.000Z", // 20 minutes old
    claimedAtIso: null,
    deliveredAtIso: null,
  };
  check("queue: a 20-minute-old row is expired", isExpiredAnnouncement(old, NOW));
  check("queue: a 20-minute-old row is NOT claimable — no stale shouting", !isClaimable(old, NOW));

  const almost: QueueRowState = {
    createdAtIso: "2026-03-10T11:46:00.000Z", // 14 minutes old
    claimedAtIso: null,
    deliveredAtIso: null,
  };
  check("queue: a 14-minute-old row is still good", !isExpiredAnnouncement(almost, NOW));
  check("queue: a 14-minute-old row is still claimable", isClaimable(almost, NOW));

  const heldNow: QueueRowState = {
    createdAtIso: "2026-03-10T11:59:30.000Z",
    claimedAtIso: "2026-03-10T11:59:40.000Z", // 20s ago, lease is live
    deliveredAtIso: null,
  };
  check("queue: a live lease blocks a second claim", !isClaimable(heldNow, NOW));

  const lapsed: QueueRowState = {
    createdAtIso: "2026-03-10T11:57:00.000Z",
    claimedAtIso: "2026-03-10T11:58:00.000Z", // 120s ago, lease lapsed
    deliveredAtIso: null,
  };
  check("queue: a lapsed lease is reclaimable — a dead Pi cannot swallow work", isClaimable(lapsed, NOW));

  const garbage: QueueRowState = { createdAtIso: "nonsense", claimedAtIso: null, deliveredAtIso: null };
  check("queue: an unparseable row counts as expired", isExpiredAnnouncement(garbage, NOW));

  // ---- 9. poll timing --------------------------------------------------
  check("poll: hold is comfortably under the 60s platform ceiling", POLL_HOLD_SECONDS < 60);
  check("poll: hold leaves better than a 2x margin", POLL_HOLD_SECONDS * 2 < 60);
  check("poll: hold is long enough to be worth holding", POLL_HOLD_SECONDS >= 15);
  eq("poll: 0 failures backs off the minimum", pollBackoffSeconds(0), 1);
  eq("poll: 1st failure waits 1s", pollBackoffSeconds(1), 1);
  eq("poll: 2nd failure waits 2s", pollBackoffSeconds(2), 2);
  eq("poll: 3rd failure waits 5s", pollBackoffSeconds(3), 5);
  eq("poll: 6th failure waits 30s", pollBackoffSeconds(6), 30);
  eq("poll: 50th failure is capped at 30s, not minutes", pollBackoffSeconds(50), 30);
  eq("poll: negative failure count is treated as the first", pollBackoffSeconds(-3), 1);
  check(
    "poll: backoff never exceeds 30s so recovery is fast",
    POLL_BACKOFF_SECONDS.every((s) => s <= 30),
  );
  check(
    "poll: backoff is monotonically non-decreasing",
    POLL_BACKOFF_SECONDS.every((s, i) => i === 0 || s >= POLL_BACKOFF_SECONDS[i - 1]),
  );
  check("poll: lease outlasts any real playback", CLAIM_LEASE_SECONDS >= 30);
  check("poll: TTL is long enough to survive a short outage", ANNOUNCEMENT_TTL_SECONDS >= 300);

  // ---- 10. spoken text -------------------------------------------------
  eq("text: test line identifies itself", announcementText({ orderNumber: "A-101", isTest: true }), "Announcer test. This speaker is working.");
  eq("text: real order includes the number", announcementText({ orderNumber: "A-101", isTest: false }), "New online order. Number A-101.");
  eq("text: missing number still says something", announcementText({ orderNumber: null, isTest: false }), "New online order.");
  eq("text: blank number still says something", announcementText({ orderNumber: "   ", isTest: false }), "New online order.");
  check(
    "text: never leaks a customer name field it was not given",
    !announcementText({ orderNumber: "A-101", isTest: false }).toLowerCase().includes("customer"),
  );

  // ---- 11. device names ------------------------------------------------
  eq("name: plain name passes through", normalizeDeviceName("Office"), "Office");
  eq("name: trims", normalizeDeviceName("  Sales Floor  "), "Sales Floor");
  eq("name: collapses inner whitespace", normalizeDeviceName("Sales    Floor"), "Sales Floor");
  eq("name: empty becomes a usable placeholder", normalizeDeviceName(""), "New Speaker");
  eq("name: whitespace becomes a usable placeholder", normalizeDeviceName("     "), "New Speaker");
  eq("name: non-string becomes a usable placeholder", normalizeDeviceName(null), "New Speaker");
  check("name: caps at 40 characters", normalizeDeviceName("x".repeat(200)).length === 40);
  check("name: suggestions cover the rooms the owner named", SUGGESTED_DEVICE_NAMES.includes("Office"));
  check("name: suggestions include the sales floor", SUGGESTED_DEVICE_NAMES.includes("Sales Floor"));
  check("name: suggestions include storage", SUGGESTED_DEVICE_NAMES.includes("Storage"));

  return { passed, failed };
}
