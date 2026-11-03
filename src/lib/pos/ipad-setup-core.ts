/**
 * src/lib/pos/ipad-setup-core.ts  (D142–D150 — iPad lockdown, setup checklist,
 * per-device health)
 *
 * Owner, 2026-11-03: "Let me know what I need to do on the iPad to make the
 * settings perfect for this to work. Add it to the back office, a checklist or
 * todo list or some enterprise grade method for making this simple, that we
 * can use to make sure the settings are correct. Add to this how I can pin the
 * app so nothing else can open, so it can't be closed. ... the ability to set
 * the correct settings and such to make the iPad behavior set in stone and
 * something only I can undo."
 *
 * PURE (no I/O). Four things live here:
 *   1. IPAD_SETUP_CHECKLIST — the per-iPad setup list (Guided Access, iPad
 *      settings, rebuild, offline drill). Items the app can VERIFY by itself
 *      carry a `verify` key; the back office shows the device's live answer
 *      next to the owner's tick, so a tick can never hide a wrong setting.
 *   2. The owner-only LOCKDOWN POLICY the registers enforce (keep the screen
 *      awake, what to do when Guided Access is off).
 *   3. The per-device HEALTH REPORT a register sends with every heartbeat
 *      (app fingerprint, queue depth, oldest unsent sale, native status), its
 *      sanitizer, and the verdict the back office shows.
 *   4. Checklist state (who ticked what, when) — normalise + toggle.
 */

import { sanitizeFingerprint } from "./register-fingerprint-core";

// ---------------------------------------------------------------------------
// 1. The checklist
// ---------------------------------------------------------------------------

/** Things the iPad app can measure about itself (native build only). */
export type VerifyKey = "guidedAccess" | "lowPowerOff" | "charging" | "versionCurrent" | "keepAwake" | "queueEmpty";

export type ChecklistSection = "lock" | "settings" | "app" | "hardware" | "drill";

export type ChecklistItem = {
  id: string;
  section: ChecklistSection;
  title: string;
  /** Exact taps / steps, plain English. */
  how: string;
  /** When present the device reports this live; the back office shows it. */
  verify?: VerifyKey;
};

export const CHECKLIST_SECTION_LABELS: Record<ChecklistSection, string> = {
  lock: "1. Pin the app (Guided Access): nothing else can open, the app cannot be closed",
  settings: "2. iPad settings",
  app: "3. Register app build",
  hardware: "4. Power, network and accessories",
  drill: "5. Offline drill (prove it works)",
};

export const IPAD_SETUP_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: "ga-enable",
    section: "lock",
    title: "Turn on Guided Access",
    how: "Settings → Accessibility → Guided Access → ON. Also turn ON \"Accessibility Shortcut\" (on the same screen) so a triple-click starts it.",
  },
  {
    id: "ga-passcode",
    section: "lock",
    title: "Set a Guided Access passcode only the owner knows",
    how: "Settings → Accessibility → Guided Access → Passcode Settings → Set Guided Access Passcode. Use a code DIFFERENT from the iPad's own passcode and every staff PIN. Turn Face ID / Touch ID for ending Guided Access OFF so nobody else can end it.",
  },
  {
    id: "ga-timelimit",
    section: "lock",
    title: "No time limit, display auto-lock set to Never",
    how: "Settings → Accessibility → Guided Access → Display Auto-Lock → Never. When you start a session, leave Time Limit OFF in Options.",
  },
  {
    id: "ga-start",
    section: "lock",
    title: "Start Guided Access inside the register app",
    how: "Open Greenway Point of Transaction → triple-click the top (or Home) button → Options: Sleep/Wake Button OFF, Volume Buttons OFF, Motion ON, Keyboards ON, Touch ON, Time Limit OFF → tap Start. To end it later: triple-click and enter YOUR passcode. Only you can undo it.",
    verify: "guidedAccess",
  },
  {
    id: "autolock",
    section: "settings",
    title: "Auto-Lock: Never",
    how: "Settings → Display & Brightness → Auto-Lock → Never. (The app also keeps the screen awake by itself when the owner's lockdown policy says so, below.)",
    verify: "keepAwake",
  },
  {
    id: "notifications",
    section: "settings",
    title: "Notifications and Focus: nothing pops up over a sale",
    how: "Settings → Focus → Do Not Disturb → ON with a schedule of all day, or turn off notifications for every app in Settings → Notifications. Turn OFF Show Previews.",
  },
  {
    id: "lowpower",
    section: "settings",
    title: "Low Power Mode OFF",
    how: "Settings → Battery → Low Power Mode → OFF. Low Power Mode slows background syncing and network checks.",
    verify: "lowPowerOff",
  },
  {
    id: "updates",
    section: "settings",
    title: "iPadOS automatic updates OFF (update on your schedule)",
    how: "Settings → General → Software Update → Automatic Updates → turn OFF \"iPadOS Updates\" (Download and Install). Update after close, then re-check this list.",
  },
  {
    id: "datetime",
    section: "settings",
    title: "Date & Time: Set Automatically, Pacific time",
    how: "Settings → General → Date & Time → Set Automatically ON, Time Zone Los Angeles. Sales limits, the promo day and receipts depend on the clock.",
  },
  {
    id: "bgrefresh",
    section: "settings",
    title: "Background App Refresh ON for the register app",
    how: "Settings → General → Background App Refresh → ON (Wi-Fi & Cellular Data), and ON for Greenway Point of Transaction.",
  },
  {
    id: "storage",
    section: "settings",
    title: "At least 5 GB free storage",
    how: "Settings → General → iPad Storage. Delete unused apps and photos if below 5 GB; offline sales and the menu are stored on the iPad.",
  },
  {
    id: "restrictions",
    section: "settings",
    title: "Screen Time: block app deletion and installs (owner passcode)",
    how: "Settings → Screen Time → Turn On → Lock Screen Time Settings (owner-only passcode) → Content & Privacy Restrictions ON → iTunes & App Store Purchases → Deleting Apps: Don't Allow, Installing Apps: Don't Allow.",
  },
  {
    id: "rebuild",
    section: "app",
    title: "Built from the newest code (lock screen says NEWEST VERSION — ALL GOOD)",
    how: "On the Mac: download the latest repo, then in Terminal in that folder run:  npm ci   then   REGISTER_API_BASE=\"https://greenwaywebsite1.vercel.app\" npm run register:build:ios   then open ios/App/App.xcworkspace in Xcode and Run on this iPad. The lock screen must show the GREEN banner. If it shows red or nothing, a step was missed.",
    verify: "versionCurrent",
  },
  {
    id: "paired",
    section: "app",
    title: "Paired to the right register, other test devices revoked",
    how: "Back office → Registers → POS devices: this iPad is bound to its register; revoke any device not physically at a counter (for example the old \"Test iPad\").",
  },
  {
    id: "power",
    section: "hardware",
    title: "Plugged in to power all day",
    how: "Keep the iPad on its charger at the counter. The app reports charging state here.",
    verify: "charging",
  },
  {
    id: "wifi",
    section: "hardware",
    title: "Store Wi-Fi: Auto-Join ON, Private Address OFF",
    how: "Settings → Wi-Fi → (i) next to the store network → Auto-Join ON, Private Wi-Fi Address OFF (a fixed address keeps the router from treating the iPad as a new device). Forget any guest or neighbor networks.",
  },
  {
    id: "bluetooth",
    section: "hardware",
    title: "Bluetooth ON; printer and scanner paired",
    how: "Settings → Bluetooth ON. In the register: printer setup shows the Star printer; the Socket scanner beeps and the register shows its scan.",
  },
  {
    id: "drill-offline",
    section: "drill",
    title: "Offline drill passed",
    how: "While unlocked: turn Wi-Fi OFF (Control Center is blocked in Guided Access; do this before starting it, or end the session briefly) → ring a $0.01-style test sale or a real sale → the top shows \"1 pending\" → turn Wi-Fi ON → within a minute it shows 0 pending and the sale appears in the back office. Note: unlocking with a PIN still needs the internet in this build.",
    verify: "queueEmpty",
  },
];

export function checklistItem(id: string): ChecklistItem | null {
  return IPAD_SETUP_CHECKLIST.find((i) => i.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// 2. Owner-only lockdown policy (enforced by the register)
// ---------------------------------------------------------------------------

export type GuidedAccessRule = "off" | "warn" | "block";

export type IpadLockdownPolicy = {
  /** Keep the screen awake while the register app is open (native app only). */
  keepAwake: boolean;
  /**
   * What the lock screen does when Guided Access is OFF on the native app:
   * "off" = nothing; "warn" = bold red notice on the lock screen;
   * "block" = also refuse PIN unlock until Guided Access is back on.
   */
  guidedAccess: GuidedAccessRule;
  /** Days without a heartbeat before an ACTIVE device is flagged stale. */
  staleDeviceDays: number;
};

export const DEFAULT_LOCKDOWN_POLICY: IpadLockdownPolicy = {
  keepAwake: true,
  guidedAccess: "warn",
  staleDeviceDays: 3,
};

export function normalizeLockdownPolicy(raw: unknown): IpadLockdownPolicy {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ga = r.guidedAccess === "off" || r.guidedAccess === "warn" || r.guidedAccess === "block" ? r.guidedAccess : DEFAULT_LOCKDOWN_POLICY.guidedAccess;
  const days = typeof r.staleDeviceDays === "number" && Number.isFinite(r.staleDeviceDays) ? Math.round(r.staleDeviceDays) : DEFAULT_LOCKDOWN_POLICY.staleDeviceDays;
  return {
    keepAwake: typeof r.keepAwake === "boolean" ? r.keepAwake : DEFAULT_LOCKDOWN_POLICY.keepAwake,
    guidedAccess: ga,
    staleDeviceDays: Math.min(30, Math.max(1, days)),
  };
}

export function validateLockdownDraft(input: { keepAwake: unknown; guidedAccess: unknown; staleDeviceDays: unknown }):
  | { ok: true; policy: IpadLockdownPolicy }
  | { ok: false; error: string } {
  if (typeof input.keepAwake !== "boolean") return { ok: false, error: "Keep-awake must be on or off." };
  if (input.guidedAccess !== "off" && input.guidedAccess !== "warn" && input.guidedAccess !== "block") {
    return { ok: false, error: "Choose what happens when Guided Access is off." };
  }
  const n = Number(input.staleDeviceDays);
  if (!Number.isInteger(n) || n < 1 || n > 30) return { ok: false, error: "Stale-device days must be a whole number from 1 to 30." };
  return { ok: true, policy: { keepAwake: input.keepAwake, guidedAccess: input.guidedAccess, staleDeviceDays: n } };
}

/** Lock-screen rule. Browser registers (no native status) are never blocked. */
export function guidedAccessGate(policy: IpadLockdownPolicy, native: NativeStatus | null):
  | { show: false }
  | { show: true; block: boolean; headline: string; detail: string } {
  if (policy.guidedAccess === "off" || !native || native.guidedAccess !== false) return { show: false };
  const block = policy.guidedAccess === "block";
  return {
    show: true,
    block,
    headline: "GUIDED ACCESS IS OFF — THIS IPAD IS NOT LOCKED TO THE REGISTER",
    detail: block
      ? "The owner requires Guided Access. Unlock is paused until the owner turns it back on (triple-click the top button, Start)."
      : "Ask the owner to turn it on: triple-click the top button, then Start. Sales still work.",
  };
}

// ---------------------------------------------------------------------------
// 3. Device health report
// ---------------------------------------------------------------------------

/** What the native app can tell us about the iPad (null fields = unknown). */
export type NativeStatus = {
  guidedAccess: boolean | null;
  lowPowerMode: boolean | null;
  /** 0–1, or null when unknown. */
  batteryLevel: number | null;
  charging: boolean | null;
  keepAwake: boolean | null;
  systemVersion: string | null;
  appVersion: string | null;
  freeDiskMb: number | null;
};

export type DeviceHealthReport = {
  fingerprint: string | null;
  buildVersion: string | null;
  pending: number;
  oldestPendingAt: string | null;
  rejected: number;
  menuFetchedAt: string | null;
  storageOk: boolean | null;
  native: NativeStatus | null;
  /** Server-stamped receipt time (ISO). */
  reportedAt?: string;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length <= 40 && ISO_RE.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
}
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function shortText(v: unknown, max = 40): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[^\w .\-+()]/g, "").trim().slice(0, max);
  return t || null;
}
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100_000, Math.max(0, Math.round(v))) : 0;
}

export function sanitizeNativeStatus(raw: unknown): NativeStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lvl = typeof r.batteryLevel === "number" && r.batteryLevel >= 0 && r.batteryLevel <= 1 ? Math.round(r.batteryLevel * 100) / 100 : null;
  const disk = typeof r.freeDiskMb === "number" && Number.isFinite(r.freeDiskMb) && r.freeDiskMb >= 0 ? Math.round(Math.min(r.freeDiskMb, 10_000_000)) : null;
  return {
    guidedAccess: boolOrNull(r.guidedAccess),
    lowPowerMode: boolOrNull(r.lowPowerMode),
    batteryLevel: lvl,
    charging: boolOrNull(r.charging),
    keepAwake: boolOrNull(r.keepAwake),
    systemVersion: shortText(r.systemVersion, 20),
    appVersion: shortText(r.appVersion, 30),
    freeDiskMb: disk,
  };
}

/** Bound + clean a client-sent report. Returns null for junk. Never throws. */
export function sanitizeDeviceHealthReport(raw: unknown): DeviceHealthReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    fingerprint: sanitizeFingerprint(r.fingerprint),
    buildVersion: shortText(r.buildVersion, 40),
    pending: count(r.pending),
    oldestPendingAt: isoOrNull(r.oldestPendingAt),
    rejected: count(r.rejected),
    menuFetchedAt: isoOrNull(r.menuFetchedAt),
    storageOk: boolOrNull(r.storageOk),
    native: sanitizeNativeStatus(r.native),
  };
}

export const DEVICE_HEALTH_KEY_PREFIX = "pos_device_health:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deviceHealthKey(deviceId: string): string | null {
  return UUID_RE.test(deviceId) ? `${DEVICE_HEALTH_KEY_PREFIX}${deviceId.toLowerCase()}` : null;
}

/** Device-id from a site_settings key, or null. */
export function deviceIdFromHealthKey(key: string): string | null {
  if (!key.startsWith(DEVICE_HEALTH_KEY_PREFIX)) return null;
  const id = key.slice(DEVICE_HEALTH_KEY_PREFIX.length);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/**
 * Should the server write this report? Skip identical reports inside the
 * throttle window so two iPads heart-beating every minute do not churn the
 * table; always write when anything meaningful changed.
 */
export function healthWriteDue(prev: DeviceHealthReport | null, next: DeviceHealthReport, nowMs: number, throttleMs = 5 * 60_000): boolean {
  if (!prev || !prev.reportedAt) return true;
  const age = nowMs - Date.parse(prev.reportedAt);
  if (!Number.isFinite(age) || age >= throttleMs) return true;
  const strip = (r: DeviceHealthReport) => JSON.stringify({ ...r, reportedAt: undefined, native: r.native ? { ...r.native, batteryLevel: undefined, freeDiskMb: undefined } : null });
  return strip(prev) !== strip(next);
}

export type DeviceCheck = { label: string; state: "ok" | "warn" | "bad" | "unknown"; text: string };

export type DeviceHealthVerdict = {
  overall: "ok" | "warn" | "bad";
  stale: boolean;
  version: "current" | "outdated" | "unknown";
  checks: DeviceCheck[];
  /** Which checklist items the device itself proves right now. */
  verified: Partial<Record<VerifyKey, boolean | null>>;
};

/** The back-office verdict for one ACTIVE device. Pure. */
export function deviceHealthVerdict(input: {
  status: "active" | "revoked";
  lastSeenAt: string | null;
  report: DeviceHealthReport | null;
  serverFingerprint: string | null;
  policy: IpadLockdownPolicy;
  nowMs: number;
}): DeviceHealthVerdict {
  const { report, policy, nowMs } = input;
  const checks: DeviceCheck[] = [];
  const seenMs = input.lastSeenAt ? Date.parse(input.lastSeenAt) : NaN;
  const stale = input.status === "active" && (!Number.isFinite(seenMs) || nowMs - seenMs > policy.staleDeviceDays * 86_400_000);
  if (input.status === "active") {
    checks.push(
      stale
        ? { label: "Heartbeat", state: "bad", text: `No contact for over ${policy.staleDeviceDays} day(s). If this iPad is not at a counter, revoke it on POS devices.` }
        : { label: "Heartbeat", state: "ok", text: "Talking to the server." },
    );
  }
  const server = sanitizeFingerprint(input.serverFingerprint);
  const app = report?.fingerprint ?? null;
  let version: DeviceHealthVerdict["version"] = "unknown";
  if (!report) {
    checks.push({ label: "App version", state: "warn", text: "Not reported yet. This iPad runs a build from before version reporting existed. Rebuild it." });
  } else if (!app) {
    checks.push({ label: "App version", state: "bad", text: "Built without a version fingerprint. Rebuild with npm run register:build:ios." });
  } else if (server && app === server) {
    version = "current";
    checks.push({ label: "App version", state: "ok", text: "Newest version." });
  } else if (server) {
    version = "outdated";
    checks.push({ label: "App version", state: "bad", text: `OUTDATED (iPad ${app.slice(0, 10)}, server ${server.slice(0, 10)}). Rebuild this iPad.` });
  } else {
    checks.push({ label: "App version", state: "unknown", text: "Server fingerprint unavailable on this deploy." });
  }
  if (report) {
    const oldest = report.oldestPendingAt ? Date.parse(report.oldestPendingAt) : NaN;
    const ageMin = Number.isFinite(oldest) ? Math.round((nowMs - oldest) / 60_000) : 0;
    if (report.pending === 0) checks.push({ label: "Unsent sales", state: "ok", text: "None waiting." });
    else
      checks.push({
        label: "Unsent sales",
        state: ageMin >= 15 ? "bad" : "warn",
        text: `${report.pending} waiting on the iPad${ageMin > 0 ? `, oldest ${ageMin} min` : ""}.`,
      });
    if (report.rejected > 0) checks.push({ label: "Rejected rows", state: "bad", text: `${report.rejected} held on the iPad; review at the register.` });
    if (report.storageOk === false) checks.push({ label: "Storage", state: "bad", text: "The iPad could not read part of its saved data." });
    const n = report.native;
    if (!n) {
      checks.push({ label: "iPad status", state: "unknown", text: "Not reported (browser register or older app build)." });
    } else {
      checks.push(
        n.guidedAccess === true
          ? { label: "Guided Access", state: "ok", text: "ON, app pinned." }
          : n.guidedAccess === false
            ? { label: "Guided Access", state: policy.guidedAccess === "off" ? "warn" : "bad", text: "OFF, the app can be closed." }
            : { label: "Guided Access", state: "unknown", text: "Unknown." },
      );
      if (n.lowPowerMode === true) checks.push({ label: "Low Power Mode", state: "warn", text: "ON. Turn it off in Settings → Battery." });
      if (n.charging === false) checks.push({ label: "Power", state: "warn", text: `On battery${n.batteryLevel !== null ? ` (${Math.round(n.batteryLevel * 100)}%)` : ""}. Plug it in.` });
      if (n.freeDiskMb !== null && n.freeDiskMb < 2048) checks.push({ label: "Storage space", state: "warn", text: `Only ${(n.freeDiskMb / 1024).toFixed(1)} GB free.` });
      if (policy.keepAwake && n.keepAwake === false) checks.push({ label: "Keep awake", state: "warn", text: "The screen may sleep. Set Auto-Lock to Never." });
    }
  }
  const worst = checks.some((c) => c.state === "bad") ? "bad" : checks.some((c) => c.state === "warn") ? "warn" : "ok";
  const n = report?.native ?? null;
  return {
    overall: worst,
    stale,
    version,
    checks,
    verified: {
      guidedAccess: n ? n.guidedAccess : null,
      lowPowerOff: n && n.lowPowerMode !== null ? !n.lowPowerMode : null,
      charging: n ? n.charging : null,
      keepAwake: n ? n.keepAwake : null,
      versionCurrent: version === "current" ? true : version === "outdated" || (report !== null && !app) ? false : null,
      queueEmpty: report ? report.pending === 0 : null,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Checklist state
// ---------------------------------------------------------------------------

export type CheckMark = { at: string; by: string };
/** deviceId -> itemId -> mark */
export type ChecklistState = Record<string, Record<string, CheckMark>>;

export function normalizeChecklistState(raw: unknown): ChecklistState {
  const out: ChecklistState = {};
  if (!raw || typeof raw !== "object") return out;
  const devices = (raw as { devices?: unknown }).devices;
  if (!devices || typeof devices !== "object") return out;
  for (const [deviceId, items] of Object.entries(devices as Record<string, unknown>)) {
    if (!UUID_RE.test(deviceId) || !items || typeof items !== "object") continue;
    const row: Record<string, CheckMark> = {};
    for (const [itemId, mark] of Object.entries(items as Record<string, unknown>)) {
      if (!checklistItem(itemId) || !mark || typeof mark !== "object") continue;
      const m = mark as Record<string, unknown>;
      const at = isoOrNull(m.at);
      if (at) row[itemId] = { at, by: typeof m.by === "string" ? m.by.slice(0, 120) : "" };
    }
    out[deviceId.toLowerCase()] = row;
  }
  return out;
}

export function applyChecklistToggle(
  state: ChecklistState,
  input: { deviceId: string; itemId: string; checked: boolean; by: string; at: string },
): { ok: true; state: ChecklistState } | { ok: false; error: string } {
  if (!UUID_RE.test(input.deviceId)) return { ok: false, error: "Unknown device." };
  if (!checklistItem(input.itemId)) return { ok: false, error: "Unknown checklist item." };
  const id = input.deviceId.toLowerCase();
  const row = { ...(state[id] ?? {}) };
  if (input.checked) row[input.itemId] = { at: input.at, by: input.by.slice(0, 120) };
  else delete row[input.itemId];
  return { ok: true, state: { ...state, [id]: row } };
}

/** Done / total for one device. An item the device DISPROVES live is not done. */
export function checklistProgress(marks: Record<string, CheckMark> | undefined, verified: Partial<Record<VerifyKey, boolean | null>>): {
  done: number;
  total: number;
  contradicted: string[];
} {
  let done = 0;
  const contradicted: string[] = [];
  for (const item of IPAD_SETUP_CHECKLIST) {
    const ticked = !!marks?.[item.id];
    const live = item.verify ? verified[item.verify] : null;
    if (ticked && live === false) contradicted.push(item.id);
    else if (ticked || live === true) done++;
  }
  return { done, total: IPAD_SETUP_CHECKLIST.length, contradicted };
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runIpadSetupTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`ipad-setup-core FAIL: ${label}`);
    }
  };
  const ids = IPAD_SETUP_CHECKLIST.map((i) => i.id);
  ok(new Set(ids).size === ids.length, "checklist ids unique");
  ok(IPAD_SETUP_CHECKLIST.some((i) => i.section === "lock" && /Guided Access/.test(i.title)), "Guided Access is on the list");
  ok(IPAD_SETUP_CHECKLIST.some((i) => i.verify === "versionCurrent"), "newest-version item is device-verified");
  ok(!IPAD_SETUP_CHECKLIST.some((i) => /\u2014/.test(i.how) && /--/.test(i.how)), "no stray double dashes");

  ok(JSON.stringify(normalizeLockdownPolicy(null)) === JSON.stringify(DEFAULT_LOCKDOWN_POLICY), "policy defaults");
  ok(normalizeLockdownPolicy({ staleDeviceDays: 999 }).staleDeviceDays === 30, "stale days clamped");
  ok(!validateLockdownDraft({ keepAwake: true, guidedAccess: "nope", staleDeviceDays: 3 }).ok, "bad GA rule refused");
  ok(!validateLockdownDraft({ keepAwake: true, guidedAccess: "warn", staleDeviceDays: 0 }).ok, "0 days refused");
  ok(validateLockdownDraft({ keepAwake: false, guidedAccess: "block", staleDeviceDays: "5" }).ok, "valid draft accepted");

  const nat = (ga: boolean | null) => sanitizeNativeStatus({ guidedAccess: ga })!;
  ok(!guidedAccessGate(DEFAULT_LOCKDOWN_POLICY, null).show, "browser register never gated");
  ok(!guidedAccessGate(DEFAULT_LOCKDOWN_POLICY, nat(true)).show, "GA on = no notice");
  const warn = guidedAccessGate(DEFAULT_LOCKDOWN_POLICY, nat(false));
  ok(warn.show && !warn.block, "warn policy shows, does not block");
  const blk = guidedAccessGate({ ...DEFAULT_LOCKDOWN_POLICY, guidedAccess: "block" }, nat(false));
  ok(blk.show && blk.block, "block policy blocks");
  ok(!guidedAccessGate({ ...DEFAULT_LOCKDOWN_POLICY, guidedAccess: "block" }, nat(null)).show, "unknown GA never blocks");

  ok(sanitizeDeviceHealthReport("x") === null && sanitizeDeviceHealthReport([]) === null, "junk report refused");
  const rep = sanitizeDeviceHealthReport({ fingerprint: "A".repeat(64), pending: -4, rejected: 1e9, oldestPendingAt: "nope", buildVersion: "<script>", native: { batteryLevel: 7 } })!;
  ok(rep.fingerprint === "a".repeat(64) && rep.pending === 0 && rep.rejected === 100_000 && rep.oldestPendingAt === null, "report bounded");
  ok(rep.buildVersion === "script" && rep.native!.batteryLevel === null, "text + battery cleaned");

  const dev = "11111111-2222-3333-4444-555555555555";
  ok(deviceHealthKey(dev) === `pos_device_health:${dev}` && deviceHealthKey("x") === null, "health key");
  ok(deviceIdFromHealthKey(`pos_device_health:${dev}`) === dev && deviceIdFromHealthKey("pos_x") === null, "key round-trip");

  const now = Date.parse("2026-11-03T12:00:00Z");
  const base = { ...rep, reportedAt: new Date(now - 60_000).toISOString() };
  ok(!healthWriteDue(base, { ...rep }, now), "identical report inside window skipped");
  ok(healthWriteDue(base, { ...rep, pending: 3 }, now), "changed report written");
  ok(healthWriteDue({ ...base, reportedAt: new Date(now - 6 * 60_000).toISOString() }, { ...rep }, now), "old report refreshed");

  const fp = "c".repeat(64);
  const good = deviceHealthVerdict({
    status: "active",
    lastSeenAt: new Date(now - 60_000).toISOString(),
    report: { ...rep, fingerprint: fp, rejected: 0, native: sanitizeNativeStatus({ guidedAccess: true, charging: true, keepAwake: true, lowPowerMode: false }) },
    serverFingerprint: fp,
    policy: DEFAULT_LOCKDOWN_POLICY,
    nowMs: now,
  });
  ok(good.overall === "ok" && good.version === "current" && !good.stale, "healthy device is ok");
  ok(good.verified.guidedAccess === true && good.verified.queueEmpty === true, "live verification exposed");
  const old = deviceHealthVerdict({ status: "active", lastSeenAt: "2026-10-01T00:00:00Z", report: null, serverFingerprint: fp, policy: DEFAULT_LOCKDOWN_POLICY, nowMs: now });
  ok(old.stale && old.overall === "bad", "stale device flagged");
  const out = deviceHealthVerdict({ status: "active", lastSeenAt: new Date(now).toISOString(), report: { ...rep, fingerprint: "d".repeat(64) }, serverFingerprint: fp, policy: DEFAULT_LOCKDOWN_POLICY, nowMs: now });
  ok(out.version === "outdated" && out.verified.versionCurrent === false, "outdated device flagged");
  const pend = deviceHealthVerdict({ status: "active", lastSeenAt: new Date(now).toISOString(), report: { ...rep, rejected: 0, pending: 2, oldestPendingAt: new Date(now - 20 * 60_000).toISOString() }, serverFingerprint: null, policy: DEFAULT_LOCKDOWN_POLICY, nowMs: now });
  ok(pend.checks.some((c) => c.label === "Unsent sales" && c.state === "bad"), "old unsent sales are bad");

  let st = normalizeChecklistState({ devices: { [dev]: { "ga-enable": { at: "2026-11-03T10:00:00Z", by: "m" }, bogus: { at: "2026-11-03T10:00:00Z" } }, "not-a-uuid": {} } });
  ok(Object.keys(st).length === 1 && Object.keys(st[dev]!).join() === "ga-enable", "state normalised");
  const t = applyChecklistToggle(st, { deviceId: dev, itemId: "autolock", checked: true, by: "m", at: "2026-11-03T11:00:00Z" });
  ok(t.ok && !!t.state[dev]!["autolock"], "toggle on");
  if (t.ok) st = t.state;
  const u = applyChecklistToggle(st, { deviceId: dev, itemId: "autolock", checked: false, by: "m", at: "x" });
  ok(u.ok && !u.state[dev]!["autolock"], "toggle off");
  ok(!applyChecklistToggle(st, { deviceId: dev, itemId: "nope", checked: true, by: "m", at: "x" }).ok, "unknown item refused");
  const prog = checklistProgress({ "ga-start": { at: "x", by: "m" } }, { guidedAccess: false, queueEmpty: true });
  ok(prog.contradicted.join() === "ga-start" && prog.done === 1, "tick contradicted by the device does not count; live proof counts");
  return { passed, failed };
}
