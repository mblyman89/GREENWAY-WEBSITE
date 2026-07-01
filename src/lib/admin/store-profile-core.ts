/**
 * store-profile-core.ts (Slice 63) — PURE, dependency-free logic for the
 * Store Profile settings section.
 *
 * The store profile is persisted in the EXISTING `site_settings` key/value
 * table (migration 0001: key text pk, value_json jsonb, label, updated_at …)
 * under a single well-known key. This module owns the shape, the defaults,
 * normalization, and light validation so the server layer and the UI share one
 * source of truth — and so it can be unit-tested with tsx (no server-only
 * imports).
 *
 * NO migration is required; site_settings already exists and is currently unused.
 */

/** The well-known site_settings key that holds the store profile. */
export const STORE_PROFILE_KEY = "store_profile";
export const STORE_PROFILE_LABEL = "Store profile";

/** Days of the week in display order. */
export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/** One day's hours. `closed` wins; otherwise open/close are "HH:MM" 24h. */
export type DayHours = {
  closed: boolean;
  open: string; // "HH:MM"
  close: string; // "HH:MM"
};

export type StoreProfile = {
  storeName: string;
  legalEntity: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  timezone: string;
  hours: Record<Weekday, DayHours>;
};

function defaultDay(): DayHours {
  return { closed: false, open: "09:00", close: "21:00" };
}

export const DEFAULT_STORE_PROFILE: StoreProfile = {
  storeName: "Greenway Cannabis",
  legalEntity: "",
  phone: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  city: "Port Orchard",
  state: "WA",
  zip: "",
  timezone: "America/Los_Angeles",
  hours: {
    monday: defaultDay(),
    tuesday: defaultDay(),
    wednesday: defaultDay(),
    thursday: defaultDay(),
    friday: defaultDay(),
    saturday: defaultDay(),
    sunday: { closed: false, open: "10:00", close: "20:00" },
  },
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** "HH:MM" validator/normalizer. Returns a valid time or the fallback. */
export function normalizeTime(v: unknown, fallback = "09:00"): string {
  const s = str(v).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return fallback;
  let h = Number(m[1]);
  let min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return fallback;
  if (h < 0) h = 0;
  if (h > 23) h = 23;
  if (min < 0) min = 0;
  if (min > 59) min = 59;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function normalizeDay(raw: unknown): DayHours {
  const r = (raw ?? {}) as Record<string, unknown>;
  const closed = r.closed === true || r.closed === "true" || r.closed === "on";
  const open = normalizeTime(r.open, "09:00");
  const close = normalizeTime(r.close, "21:00");
  return { closed, open, close };
}

/** Coerce ANY stored/incoming value into a complete, valid StoreProfile. */
export function normalizeStoreProfile(raw: unknown): StoreProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawHours = (r.hours ?? {}) as Record<string, unknown>;
  const hours = {} as Record<Weekday, DayHours>;
  for (const d of WEEKDAYS) {
    hours[d] = normalizeDay(rawHours[d] ?? DEFAULT_STORE_PROFILE.hours[d]);
  }
  return {
    storeName: str(r.storeName).trim() || DEFAULT_STORE_PROFILE.storeName,
    legalEntity: str(r.legalEntity).trim(),
    phone: str(r.phone).trim(),
    email: str(r.email).trim(),
    addressLine1: str(r.addressLine1).trim(),
    addressLine2: str(r.addressLine2).trim(),
    city: str(r.city).trim(),
    state: str(r.state).trim().toUpperCase().slice(0, 2),
    zip: str(r.zip).trim(),
    timezone: str(r.timezone).trim() || DEFAULT_STORE_PROFILE.timezone,
    hours,
  };
}

export type ValidationResult = { ok: boolean; errors: string[] };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Light, non-blocking validation. Empty optional fields are fine. */
export function validateStoreProfile(p: StoreProfile): ValidationResult {
  const errors: string[] = [];
  if (!p.storeName.trim()) errors.push("Store name is required.");
  if (p.email && !EMAIL_RE.test(p.email)) errors.push("Email address doesn't look valid.");
  if (p.state && p.state.length !== 2) errors.push("State should be a 2-letter code (e.g. WA).");
  if (p.zip && !/^\d{5}(-\d{4})?$/.test(p.zip)) errors.push("ZIP should be 5 digits (or ZIP+4).");
  for (const d of WEEKDAYS) {
    const h = p.hours[d];
    if (!h.closed && h.open >= h.close) {
      errors.push(`${WEEKDAY_LABEL[d]} closing time must be after the opening time.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Human-readable one-line summary of the week's hours (for the hub card). */
export function summarizeHours(p: StoreProfile): string {
  const openDays = WEEKDAYS.filter((d) => !p.hours[d].closed);
  if (openDays.length === 0) return "No open days set";
  const first = p.hours[openDays[0]];
  const uniform = openDays.every(
    (d) => p.hours[d].open === first.open && p.hours[d].close === first.close,
  );
  if (uniform && openDays.length === 7) {
    return `Open daily ${to12h(first.open)}–${to12h(first.close)}`;
  }
  return `${openDays.length} day${openDays.length === 1 ? "" : "s"} open`;
}

/** Convert "HH:MM" 24h to a compact 12h label ("9:00 AM"). */
export function to12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

/** Build a StoreProfile from flat form fields (used by the server action). */
export function storeProfileFromForm(get: (k: string) => string): StoreProfile {
  const hours = {} as Record<Weekday, DayHours>;
  for (const d of WEEKDAYS) {
    hours[d] = {
      closed: get(`hours.${d}.closed`) === "on" || get(`hours.${d}.closed`) === "true",
      open: normalizeTime(get(`hours.${d}.open`), "09:00"),
      close: normalizeTime(get(`hours.${d}.close`), "21:00"),
    };
  }
  return normalizeStoreProfile({
    storeName: get("storeName"),
    legalEntity: get("legalEntity"),
    phone: get("phone"),
    email: get("email"),
    addressLine1: get("addressLine1"),
    addressLine2: get("addressLine2"),
    city: get("city"),
    state: get("state"),
    zip: get("zip"),
    timezone: get("timezone"),
    hours,
  });
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable)
// ---------------------------------------------------------------------------

export function __runStoreProfileTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed += 1;
  };

  // normalizeTime
  assert(normalizeTime("9:5") === "09:00", "bad minutes -> fallback? actually 9:5 invalid");
  assert(normalizeTime("09:05") === "09:05", "valid time");
  assert(normalizeTime("25:99") === "23:59", "clamps to max");
  assert(normalizeTime("", "10:00") === "10:00", "empty -> fallback");
  assert(normalizeTime("7:30") === "07:30", "pads hour");

  // to12h
  assert(to12h("00:00") === "12:00 AM", "midnight");
  assert(to12h("12:00") === "12:00 PM", "noon");
  assert(to12h("13:30") === "1:30 PM", "afternoon");
  assert(to12h("09:00") === "9:00 AM", "morning");

  // normalizeStoreProfile defaults + coercion
  const p = normalizeStoreProfile({ state: "wa", storeName: "  Greenway  " });
  assert(p.state === "WA", "state uppercased");
  assert(p.storeName === "Greenway", "name trimmed");
  assert(p.timezone === "America/Los_Angeles", "tz default");
  assert(WEEKDAYS.every((d) => typeof p.hours[d].open === "string"), "all days present");

  const empty = normalizeStoreProfile(null);
  assert(empty.storeName === DEFAULT_STORE_PROFILE.storeName, "null -> defaults");

  // validation
  assert(validateStoreProfile(DEFAULT_STORE_PROFILE).ok, "defaults valid");
  const bad = normalizeStoreProfile({ storeName: "X", email: "nope", zip: "12", state: "WAA" });
  const vr = validateStoreProfile(bad);
  assert(!vr.ok, "bad profile invalid");
  assert(vr.errors.some((e) => e.includes("Email")), "flags email");
  assert(vr.errors.some((e) => e.includes("ZIP")), "flags zip");

  const closeBad = normalizeStoreProfile({
    storeName: "X",
    hours: { monday: { closed: false, open: "20:00", close: "09:00" } },
  });
  assert(!validateStoreProfile(closeBad).ok, "close before open invalid");

  const closedOk = normalizeStoreProfile({
    storeName: "X",
    hours: { monday: { closed: true, open: "20:00", close: "09:00" } },
  });
  const closedDayHasNoError = !validateStoreProfile(closedOk).errors.some((e) =>
    e.toLowerCase().includes("monday"),
  );
  assert(closedDayHasNoError, "closed day skips open/close check");

  // summarizeHours
  const uniform = normalizeStoreProfile({
    storeName: "X",
    hours: Object.fromEntries(
      WEEKDAYS.map((d) => [d, { closed: false, open: "08:00", close: "20:00" }]),
    ),
  });
  assert(summarizeHours(uniform).startsWith("Open daily"), "uniform 7-day summary");

  const someClosed = normalizeStoreProfile({
    storeName: "X",
    hours: {
      ...Object.fromEntries(WEEKDAYS.map((d) => [d, { closed: true, open: "08:00", close: "20:00" }])),
      monday: { closed: false, open: "08:00", close: "20:00" },
    },
  });
  assert(summarizeHours(someClosed) === "1 day open", "single open day");

  // storeProfileFromForm
  const form: Record<string, string> = {
    storeName: "Greenway",
    state: "wa",
    "hours.monday.closed": "on",
    "hours.tuesday.open": "10:00",
    "hours.tuesday.close": "18:00",
  };
  const fp = storeProfileFromForm((k) => form[k] ?? "");
  assert(fp.hours.monday.closed === true, "form closed parsed");
  assert(fp.hours.tuesday.open === "10:00", "form open parsed");
  assert(fp.state === "WA", "form state normalized");

  return { passed };
}
