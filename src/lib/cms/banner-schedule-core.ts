/**
 * R54 Slice B — Banner schedule v2 (pure, shared by every banner area; R58 plan).
 *
 * Owner asks: an end date, repeats like "every Wednesday", a fallback banner
 * for when one expires and nobody updated it, and a calendar that warns when
 * two banners start on the same day.
 *
 * Rules:
 *  - start / end: ISO instants (null = open), the R47 behaviour.
 *  - days: weekdays the banner may show (empty = every day).
 *  - from / to: an optional daily time window "HH:MM" in store time. from > to
 *    wraps past midnight (e.g. 20:00–02:00). Missing = all day.
 *  - Weekday and clock are read in the STORE's time zone (America/Los_Angeles),
 *    not the visitor's or the server's (Vercel runs in UTC).
 *  - Fallback: handled by the caller. Fallback slides show only when no
 *    regular slide is live (see pickLiveWithFallback).
 */

export const STORE_TZ = "America/Los_Angeles";
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export type BannerSchedule = {
  start: string | null;
  end: string | null;
  days: Weekday[];
  from: string | null;
  to: string | null;
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function cleanDays(v: unknown): Weekday[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d as string)));
  const out = WEEKDAYS.filter((d) => set.has(d));
  return out.length === 7 ? [] : out; // all seven = every day = []
}

export function cleanHHMM(v: unknown): string | null {
  return typeof v === "string" && HHMM.test(v.trim()) ? v.trim() : null;
}

/** Store-local parts of an instant. */
export function storeParts(ms: number, tz = STORE_TZ): { date: string; weekday: Weekday; minutes: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const weekday = (p.weekday ?? "Mon").slice(0, 3).toLowerCase() as Weekday;
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function hasRepeat(s: Pick<BannerSchedule, "days" | "from" | "to">): boolean {
  return s.days.length > 0 || !!(s.from && s.to);
}

/** Is the banner allowed to show at this instant? Bad/missing values = open. */
export function isScheduleLiveAt(s: BannerSchedule | null | undefined, whenMs: number, tz = STORE_TZ): boolean {
  if (!s) return true;
  const st = s.start ? Date.parse(s.start) : NaN;
  const en = s.end ? Date.parse(s.end) : NaN;
  if (Number.isFinite(st) && whenMs < st) return false;
  if (Number.isFinite(en) && whenMs > en) return false;
  if (!hasRepeat(s)) return true;
  const here = storeParts(whenMs, tz);
  const from = s.from && s.to ? mins(s.from) : null;
  const to = s.from && s.to ? mins(s.to) : null;
  if (from === null || to === null || from === to) return s.days.length === 0 || s.days.includes(here.weekday);
  if (from < to) {
    return (s.days.length === 0 || s.days.includes(here.weekday)) && here.minutes >= from && here.minutes < to;
  }
  // Wraps midnight: the early-morning part belongs to the PREVIOUS day's run.
  if (here.minutes >= from) return s.days.length === 0 || s.days.includes(here.weekday);
  if (here.minutes < to) {
    const prev = WEEKDAYS[(WEEKDAYS.indexOf(here.weekday) + 6) % 7]!;
    return s.days.length === 0 || s.days.includes(prev);
  }
  return false;
}

/** Plain-English summary, e.g. "Every Wed · 07:00–23:00 · until Mar 3". */
export function describeSchedule(s: BannerSchedule, tz = STORE_TZ): string {
  const parts: string[] = [];
  parts.push(s.days.length ? `Every ${s.days.map((d) => WEEKDAY_LABEL[d]).join(", ")}` : "Every day");
  if (s.from && s.to && s.from !== s.to) parts.push(`${s.from}–${s.to}`);
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(iso));
  if (s.start && Number.isFinite(Date.parse(s.start))) parts.push(`from ${fmt(s.start)}`);
  if (s.end && Number.isFinite(Date.parse(s.end))) parts.push(`until ${fmt(s.end)}`);
  return parts.join(" · ");
}

/**
 * Fallback rule: regular banners that are live win. When none is live, the
 * fallback banners show (their own schedule is ignored, so a fallback can
 * never leave the carousel empty).
 */
export function pickLiveWithFallback<T>(items: readonly T[], isFallback: (t: T) => boolean, isLive: (t: T) => boolean): T[] {
  const regular = items.filter((t) => !isFallback(t) && isLive(t));
  return regular.length > 0 ? regular : items.filter((t) => isFallback(t));
}

// ── Calendar ────────────────────────────────────────────────────────────────

export type CalendarBanner = { id: string; label: string; schedule: BannerSchedule; fallback: boolean };
export type CalendarDay = {
  date: string; // YYYY-MM-DD (store-local)
  inMonth: boolean;
  isToday: boolean;
  live: { id: string; label: string }[];
  starts: { id: string; label: string }[];
  /** 2+ banners START this day (owner's warning). */
  startClash: boolean;
};

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(ymd: string): Weekday {
  const js = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sun
  return WEEKDAYS[(js + 6) % 7]!;
}

/** Does the banner show at any time on this store-local day? */
export function liveOnDay(s: BannerSchedule, ymd: string, tz = STORE_TZ): boolean {
  const st = s.start && Number.isFinite(Date.parse(s.start)) ? storeParts(Date.parse(s.start), tz).date : null;
  const en = s.end && Number.isFinite(Date.parse(s.end)) ? storeParts(Date.parse(s.end), tz).date : null;
  if (st && ymd < st) return false;
  if (en && ymd > en) return false;
  return s.days.length === 0 || s.days.includes(weekdayOf(ymd));
}

/** Only banners with some schedule appear on the calendar (always-on ones would fill every day). */
export function isScheduled(s: BannerSchedule): boolean {
  return !!(s.start || s.end) || hasRepeat(s);
}

/** 6-week month grid (Mon-first) for the month containing `monthOf` (YYYY-MM-DD). */
export function buildScheduleCalendar(banners: readonly CalendarBanner[], monthOf: string, todayYmd: string, tz = STORE_TZ): CalendarDay[] {
  const first = `${monthOf.slice(0, 7)}-01`;
  const lead = WEEKDAYS.indexOf(weekdayOf(first));
  const gridStart = addDays(first, -lead);
  const scheduled = banners.filter((b) => !b.fallback && isScheduled(b.schedule));
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const live = scheduled.filter((b) => liveOnDay(b.schedule, date, tz)).map(({ id, label }) => ({ id, label }));
    const starts = scheduled
      .filter((b) => b.schedule.start && Number.isFinite(Date.parse(b.schedule.start)) && storeParts(Date.parse(b.schedule.start), tz).date === date)
      .map(({ id, label }) => ({ id, label }));
    days.push({ date, inMonth: date.slice(0, 7) === first.slice(0, 7), isToday: date === todayYmd, live, starts, startClash: starts.length >= 2 });
  }
  return days;
}

export function __runBannerScheduleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("banner-schedule-core FAIL:", m);
    }
  };
  const base: BannerSchedule = { start: null, end: null, days: [], from: null, to: null };
  // 2026-01-14 is a Wednesday. 20:00 UTC = 12:00 PST (UTC-8 in January).
  const wedNoon = Date.parse("2026-01-14T20:00:00Z");
  const thuNoon = Date.parse("2026-01-15T20:00:00Z");
  ok(storeParts(wedNoon).weekday === "wed" && storeParts(wedNoon).minutes === 720, "store-local weekday/time (PST)");
  ok(storeParts(Date.parse("2026-01-15T06:00:00Z")).weekday === "wed", "06:00Z Thu is still Wed 22:00 in LA");
  ok(cleanDays(["wed", "xx", "mon", "wed"]).join() === "mon,wed", "days cleaned + ordered");
  ok(cleanDays([...WEEKDAYS]).length === 0, "all seven = every day");
  ok(cleanHHMM("07:30") === "07:30" && cleanHHMM("24:00") === null && cleanHHMM("7:30") === null, "HH:MM validated");
  ok(isScheduleLiveAt(null, wedNoon) && isScheduleLiveAt(base, wedNoon), "no schedule = live");
  const wed = { ...base, days: ["wed"] as Weekday[] };
  ok(isScheduleLiveAt(wed, wedNoon) && !isScheduleLiveAt(wed, thuNoon), "every Wednesday");
  const win = { ...wed, from: "07:00", to: "11:00" };
  ok(!isScheduleLiveAt(win, wedNoon), "outside daily window hidden");
  ok(isScheduleLiveAt({ ...wed, from: "11:00", to: "13:00" }, wedNoon), "inside daily window live");
  const night = { ...wed, from: "20:00", to: "02:00" };
  ok(isScheduleLiveAt(night, Date.parse("2026-01-15T09:00:00Z")), "Thu 01:00 LA belongs to Wed night run");
  ok(!isScheduleLiveAt(night, Date.parse("2026-01-16T09:00:00Z")), "Fri 01:00 LA not (Thu not chosen)");
  ok(!isScheduleLiveAt({ ...wed, end: "2026-01-01T00:00:00Z" }, wedNoon), "end date still wins");
  ok(!isScheduleLiveAt({ ...base, start: "2026-02-01T00:00:00Z" }, wedNoon), "before start hidden");
  ok(describeSchedule(win).startsWith("Every Wed · 07:00–11:00"), "describe");
  const items = [{ id: "a", fb: false, live: false }, { id: "f", fb: true, live: false }, { id: "b", fb: false, live: true }];
  ok(pickLiveWithFallback(items, (i) => i.fb, (i) => i.live).map((i) => i.id).join() === "b", "live regular wins, fallback hidden");
  ok(pickLiveWithFallback(items.slice(0, 2), (i) => i.fb, (i) => i.live).map((i) => i.id).join() === "f", "nothing live → fallback");
  ok(pickLiveWithFallback([{ id: "a", fb: false, live: false }], (i) => i.fb, (i) => i.live).length === 0, "no fallback → empty (caller keeps its default)");
  const cal = buildScheduleCalendar(
    [
      { id: "1", label: "A", schedule: { ...base, start: "2026-01-14T16:00:00Z" }, fallback: false },
      { id: "2", label: "B", schedule: { ...base, start: "2026-01-14T23:00:00Z", end: "2026-01-20T07:00:00Z" }, fallback: false },
      { id: "3", label: "Wed", schedule: wed, fallback: false },
      { id: "4", label: "Always", schedule: base, fallback: false },
      { id: "5", label: "FB", schedule: wed, fallback: true },
    ],
    "2026-01-10",
    "2026-01-14",
  );
  ok(cal.length === 42 && cal[0]!.date === "2025-12-29", "6-week Mon-first grid");
  const d14 = cal.find((d) => d.date === "2026-01-14")!;
  ok(d14.startClash && d14.starts.length === 2 && d14.isToday, "two starts same day → warning");
  ok(d14.live.map((x) => x.id).join() === "1,2,3", "always-on and fallback banners not on calendar");
  ok(!cal.find((d) => d.date === "2026-01-15")!.live.some((x) => x.id === "3"), "Wed-only not on Thu");
  ok(!cal.find((d) => d.date === "2026-01-21")!.live.some((x) => x.id === "2"), "after end not shown");
  ok(!cal.find((d) => d.date === "2026-01-13")!.live.some((x) => x.id === "1"), "before start not shown");
  return { passed, failed };
}
