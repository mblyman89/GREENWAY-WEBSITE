/**
 * R47 — Google store listing: editable weekly + holiday/special hours that
 * feed the LocalBusiness structured data (storeSchema in seo.ts).
 *
 * Michael, verbatim: "I only want google store listing, clicks and reports,
 * the image picker for the seo editor."
 *
 * Before R47 the hours Google read from the site were hard-coded (8 AM–11 PM
 * every day) and holiday hours could not be set at all. Google's
 * LocalBusiness docs:
 *   - openingHoursSpecification with dayOfWeek / opens / closes;
 *   - seasonal or holiday hours: validFrom + validThrough;
 *   - "closed all day": opens and closes both "00:00".
 *
 * Times are 24-hour "HH:MM" on the store's Pacific wall clock. WAC 314-55-147
 * only allows sales between 8:00 AM and midnight, so opening times before
 * 08:00 are refused and "closes at midnight" is written as "23:59".
 *
 * Pure: no server imports; self-tested.
 */

export const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export type DayHours = { day: WeekDay; closed: boolean; opens: string; closes: string };

export type SpecialHours = {
  id: string;
  /** "Thanksgiving", "Christmas Eve" — shown in the admin only. */
  label: string;
  /** YYYY-MM-DD, Pacific. */
  from: string;
  /** YYYY-MM-DD, Pacific (same as from for a single day). */
  through: string;
  closed: boolean;
  opens: string;
  closes: string;
};

export type StoreHours = { weekly: DayHours[]; special: SpecialHours[] };

export const MAX_SPECIAL_HOURS = 30;
/** WAC 314-55-147 earliest legal opening. */
export const EARLIEST_OPEN = "08:00";
/** Midnight, written the way schema.org/Google expect for a same-day close. */
export const LATEST_CLOSE = "23:59";

/** Today's hard-coded hours (8 AM–11 PM daily) — the default until edited. */
export const DEFAULT_STORE_HOURS: StoreHours = {
  weekly: WEEK_DAYS.map((day) => ({ day, closed: false, opens: "08:00", closes: "23:00" })),
  special: [],
};

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isHm(v: unknown): v is string {
  return typeof v === "string" && HM.test(v);
}

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = YMD.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** "24:00" / "00:00" as a closing time both mean midnight → "23:59". */
function normCloses(v: unknown): string | null {
  if (v === "24:00") return LATEST_CLOSE;
  if (!isHm(v)) return null;
  return v === "00:00" ? LATEST_CLOSE : v;
}

/** Problems with one open window, in plain English ("" = fine). */
export function hoursProblem(opens: string, closes: string): string {
  if (!isHm(opens)) return "Pick an opening time.";
  if (!isHm(closes)) return "Pick a closing time.";
  if (opens < EARLIEST_OPEN) return "Washington law (WAC 314-55-147) does not allow opening before 8:00 AM.";
  if (closes <= opens) return "Closing time must be after opening time (midnight is the latest).";
  return "";
}

/**
 * Normalise stored / posted JSON. Never throws. Bad days fall back to the
 * default for that day; bad holiday rows are dropped.
 */
export function normalizeStoreHours(raw: unknown): StoreHours {
  let src: unknown = raw;
  if (typeof src === "string") {
    try {
      src = JSON.parse(src);
    } catch {
      src = null;
    }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) {
    return { weekly: DEFAULT_STORE_HOURS.weekly.map((d) => ({ ...d })), special: [] };
  }
  const r = src as { weekly?: unknown; special?: unknown };
  const given = Array.isArray(r.weekly) ? (r.weekly as unknown[]) : [];
  const weekly: DayHours[] = WEEK_DAYS.map((day, i) => {
    const fallback = { ...DEFAULT_STORE_HOURS.weekly[i] };
    const row = given.find((g) => !!g && typeof g === "object" && (g as { day?: unknown }).day === day) as
      | Record<string, unknown>
      | undefined;
    if (!row) return fallback;
    const closed = row.closed === true;
    const opens = isHm(row.opens) ? row.opens : fallback.opens;
    const closes = normCloses(row.closes) ?? fallback.closes;
    if (!closed && hoursProblem(opens, closes)) return fallback;
    return { day, closed, opens, closes };
  });
  const special: SpecialHours[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(r.special) ? (r.special as unknown[]) : []) {
    if (special.length >= MAX_SPECIAL_HOURS) break;
    if (!g || typeof g !== "object") continue;
    const row = g as Record<string, unknown>;
    if (!isYmd(row.from)) continue;
    const from = row.from as string;
    const through = isYmd(row.through) && (row.through as string) >= from ? (row.through as string) : from;
    const closed = row.closed === true;
    const opens = isHm(row.opens) ? row.opens : "08:00";
    const closes = normCloses(row.closes) ?? "23:00";
    if (!closed && hoursProblem(opens, closes)) continue;
    let id = typeof row.id === "string" && /^[a-z0-9-]{1,40}$/i.test(row.id) ? row.id : `sh-${from}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    const label = typeof row.label === "string" ? row.label.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    special.push({ id, label, from, through, closed, opens, closes });
  }
  special.sort((a, b) => a.from.localeCompare(b.from) || a.through.localeCompare(b.through));
  return { weekly, special };
}

/** Same hours as the built-in default (nothing to store). */
export function isDefaultStoreHours(h: StoreHours): boolean {
  return JSON.stringify(normalizeStoreHours(h)) === JSON.stringify(normalizeStoreHours(DEFAULT_STORE_HOURS));
}

type Spec = {
  "@type": "OpeningHoursSpecification";
  dayOfWeek?: WeekDay[] | WeekDay;
  opens: string;
  closes: string;
  validFrom?: string;
  validThrough?: string;
};

/**
 * schema.org openingHoursSpecification. Weekly days with identical hours are
 * grouped; closed weekdays are left out (Google reads an unlisted day as
 * closed). Holiday rows that already ended (before `todayYmd`) are skipped.
 */
export function openingHoursSpecification(h: StoreHours, todayYmd: string): Spec[] {
  const out: Spec[] = [];
  const groups = new Map<string, WeekDay[]>();
  for (const d of h.weekly) {
    if (d.closed) continue;
    const k = `${d.opens}|${d.closes}`;
    const list = groups.get(k) ?? [];
    list.push(d.day);
    groups.set(k, list);
  }
  for (const [k, days] of groups) {
    const [opens, closes] = k.split("|");
    out.push({ "@type": "OpeningHoursSpecification", dayOfWeek: days, opens, closes });
  }
  for (const s of h.special) {
    if (isYmd(todayYmd) && s.through < todayYmd) continue;
    out.push({
      "@type": "OpeningHoursSpecification",
      opens: s.closed ? "00:00" : s.opens,
      closes: s.closed ? "00:00" : s.closes,
      validFrom: s.from,
      validThrough: s.through,
    });
  }
  return out;
}

/** "8:00 AM", "11:59 PM" → "Midnight". */
export function hmLabel(hm: string): string {
  if (!isHm(hm)) return hm;
  if (hm === LATEST_CLOSE) return "Midnight";
  const [h, m] = hm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Plain-English weekly summary ("Every day 8:00 AM – 11:00 PM"). */
export function weeklySummary(h: StoreHours): string {
  const open = h.weekly.filter((d) => !d.closed);
  if (open.length === 0) return "Closed every day";
  const same = open.every((d) => d.opens === open[0].opens && d.closes === open[0].closes);
  if (same && open.length === 7) return `Every day ${hmLabel(open[0].opens)} – ${hmLabel(open[0].closes)}`;
  return h.weekly
    .map((d) => `${d.day.slice(0, 3)} ${d.closed ? "closed" : `${hmLabel(d.opens)}–${hmLabel(d.closes)}`}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runStoreHoursCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[store-hours-core] FAIL: ${label}`);
    }
  };

  // defaults match the old hard-coded schema exactly
  const def = normalizeStoreHours(null);
  ok(def.weekly.length === 7 && def.special.length === 0, "default shape");
  const defSpec = openingHoursSpecification(def, "2026-01-01");
  ok(defSpec.length === 1, "default = one grouped spec");
  ok(JSON.stringify(defSpec[0].dayOfWeek) === JSON.stringify([...WEEK_DAYS]), "default all 7 days in order");
  ok(defSpec[0].opens === "08:00" && defSpec[0].closes === "23:00", "default 08:00-23:00");
  ok(isDefaultStoreHours(def), "default recognised");
  ok(normalizeStoreHours("not json").weekly[0].opens === "08:00", "bad json -> default");
  ok(normalizeStoreHours([]).weekly.length === 7, "array -> default");

  // validation
  ok(isHm("08:00") && isHm("23:59") && !isHm("24:00") && !isHm("8:00") && !isHm("12:60"), "isHm");
  ok(isYmd("2026-11-26") && !isYmd("2026-02-30") && !isYmd("2026-1-1") && !isYmd(5), "isYmd");
  ok(hoursProblem("07:30", "20:00").includes("8:00 AM"), "before 8am refused");
  ok(hoursProblem("10:00", "09:00") !== "", "close before open refused");
  ok(hoursProblem("10:00", "10:00") !== "", "zero-length refused");
  ok(hoursProblem("08:00", "23:59") === "", "8am-midnight ok");
  ok(hoursProblem("x", "23:00") === "Pick an opening time.", "bad open");

  // weekly edits
  const custom = normalizeStoreHours({
    weekly: [
      { day: "Sunday", closed: false, opens: "10:00", closes: "20:00" },
      { day: "Monday", closed: true, opens: "08:00", closes: "23:00" },
      { day: "Friday", closed: false, opens: "08:00", closes: "24:00" },
      { day: "Saturday", closed: false, opens: "06:00", closes: "23:00" },
    ],
  });
  ok(custom.weekly[6].opens === "10:00" && custom.weekly[6].closes === "20:00", "sunday edited");
  ok(custom.weekly[0].closed === true, "monday closed");
  ok(custom.weekly[4].closes === "23:59", "24:00 -> 23:59");
  ok(custom.weekly[5].opens === "08:00", "illegal saturday falls back to default");
  ok(!isDefaultStoreHours(custom), "custom not default");
  const cs = openingHoursSpecification(custom, "2026-01-01");
  ok(!cs.some((s) => Array.isArray(s.dayOfWeek) && s.dayOfWeek.includes("Monday")), "closed monday omitted");
  ok(cs.some((s) => Array.isArray(s.dayOfWeek) && s.dayOfWeek.length === 1 && s.dayOfWeek[0] === "Sunday" && s.opens === "10:00"), "sunday own spec");
  ok(cs.some((s) => Array.isArray(s.dayOfWeek) && s.dayOfWeek.includes("Friday") && s.closes === "23:59"), "friday midnight");
  ok(custom.weekly.map((d) => d.day).join() === WEEK_DAYS.join(), "weekly always Mon..Sun");

  // special hours
  const sp = normalizeStoreHours({
    special: [
      { id: "xmas", label: "  Christmas   Day ", from: "2026-12-25", through: "2026-12-25", closed: true },
      { label: "Thanksgiving", from: "2026-11-26", closed: false, opens: "10:00", closes: "18:00" },
      { label: "Old", from: "2025-07-04", through: "2025-07-04", closed: true },
      { label: "bad date", from: "2026-02-30", closed: true },
      { label: "illegal", from: "2026-10-31", closed: false, opens: "05:00", closes: "18:00" },
      { label: "backwards", from: "2026-12-31", through: "2026-12-01", closed: true },
      { id: "xmas", label: "dup id", from: "2027-12-25", closed: true },
    ],
  });
  ok(sp.special.length === 5, "bad rows dropped");
  ok(sp.special[0].label === "Old" && sp.special[1].label === "Thanksgiving", "sorted by date");
  ok(sp.special.find((s) => s.id === "xmas")?.label === "Christmas Day", "label cleaned");
  ok(sp.special.find((s) => s.label === "Thanksgiving")?.through === "2026-11-26", "through defaults to from");
  ok(sp.special.find((s) => s.label === "backwards")?.through === "2026-12-31", "backwards through -> from");
  ok(new Set(sp.special.map((s) => s.id)).size === sp.special.length, "ids unique");
  const ss = openingHoursSpecification(sp, "2026-11-01");
  const xmas = ss.find((s) => s.validFrom === "2026-12-25");
  ok(!!xmas && xmas.opens === "00:00" && xmas.closes === "00:00" && xmas.validThrough === "2026-12-25", "closed day = 00:00/00:00");
  ok(!xmas?.dayOfWeek, "holiday has no dayOfWeek");
  const tg = ss.find((s) => s.validFrom === "2026-11-26");
  ok(!!tg && tg.opens === "10:00" && tg.closes === "18:00", "special open hours");
  ok(!ss.some((s) => s.validFrom === "2025-07-04"), "past holiday skipped");
  ok(openingHoursSpecification(sp, "bad").some((s) => s.validFrom === "2025-07-04"), "no today -> keep all");
  const many = normalizeStoreHours({
    special: Array.from({ length: 40 }, (_, i) => ({ from: `2027-01-${String((i % 28) + 1).padStart(2, "0")}`, closed: true })),
  });
  ok(many.special.length === MAX_SPECIAL_HOURS, "special capped at 30");

  // labels
  ok(hmLabel("08:00") === "8:00 AM" && hmLabel("12:30") === "12:30 PM" && hmLabel("00:15") === "12:15 AM", "hmLabel");
  ok(hmLabel("23:59") === "Midnight", "midnight label");
  ok(weeklySummary(def) === "Every day 8:00 AM – 11:00 PM", "summary every day");
  ok(weeklySummary(custom).startsWith("Mon closed"), "summary per day");
  ok(
    weeklySummary(normalizeStoreHours({ weekly: WEEK_DAYS.map((day) => ({ day, closed: true, opens: "08:00", closes: "23:00" })) })) ===
      "Closed every day",
    "summary all closed",
  );

  return { passed, failed };
}
