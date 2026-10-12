/**
 * R46-S1: SCHEDULED PUBLISH / UNPUBLISH for the website editors. PURE (no I/O).
 *
 * The owner asked for the editor to be "topped off" with enterprise features.
 * Every serious CMS ships this: Sanity "Scheduled drafts" and "Content
 * Releases", Contentful "Scheduled actions" (publish or unpublish an entry at
 * a date and time), Storyblok "Releases". The shape is the same everywhere:
 *
 *   - a row that says "do ACTION to THING at TIME";
 *   - a worker that wakes up on a schedule, finds the rows that are due, and
 *     runs the SAME publish function the Publish button runs;
 *   - a visible list of what is coming up, each item cancellable.
 *
 * What this file decides (everything the cron needs to be correct):
 *   - which things can be scheduled and which actions each allows;
 *   - turning the Pacific wall clock the owner typed into a UTC instant
 *     (AGENTS rule 9: Pacific is the business clock), snapped UP to the
 *     5-minute grid the cron runs on, so "9:00 AM" really runs at 9:00;
 *   - which rows are due, in what order, and which "running" rows were
 *     abandoned by a killed run and may be retried;
 *   - plain-English labels for the editor and the schedule page.
 *
 * The cron (src/app/api/cron/content-schedule/route.ts) and the server runner
 * (content-schedule-server.ts) only do I/O around these decisions.
 */
import { pacificParts, pacificWallTimeToUtcISO } from "../reports/timezone";

// ---------------------------------------------------------------------------
// What can be scheduled
// ---------------------------------------------------------------------------

export const SCHEDULE_TARGET_KINDS = [
  "carousel_slide", // home page carousel (home_carousel_slides)
  "shop_slide", //     Shop page banner (shop_carousel_slides)
  "page_section", //   page builder sections (page_sections)
  "faq_item", //       FAQ questions (faq_items)
  "content_block", //  page wording blocks (content_blocks) - publish only
] as const;
export type ScheduleTargetKind = (typeof SCHEDULE_TARGET_KINDS)[number];

export const SCHEDULE_ACTIONS = ["publish", "unpublish"] as const;
export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

export const SCHEDULE_STATUSES = ["pending", "running", "done", "failed", "cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** Human names, used on the schedule page and in audit notes. */
export const TARGET_KIND_LABEL: Record<ScheduleTargetKind, string> = {
  carousel_slide: "Home carousel slide",
  shop_slide: "Shop banner slide",
  page_section: "Page section",
  faq_item: "FAQ question",
  content_block: "Page wording",
};

/**
 * Content blocks have no on/off switch (no `enabled` column), so they can only
 * be scheduled to publish. Everything else is hidden from the public by
 * turning it off (public RLS shows status='published' AND enabled=true).
 */
export function actionsFor(kind: ScheduleTargetKind): readonly ScheduleAction[] {
  return kind === "content_block" ? ["publish"] : SCHEDULE_ACTIONS;
}

export function isTargetKind(v: unknown): v is ScheduleTargetKind {
  return typeof v === "string" && (SCHEDULE_TARGET_KINDS as readonly string[]).includes(v);
}
export function isScheduleAction(v: unknown): v is ScheduleAction {
  return typeof v === "string" && (SCHEDULE_ACTIONS as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,159}$/i;

/** Row ids are uuids; content blocks are addressed by their block_key. */
export function isValidTargetKey(kind: ScheduleTargetKind, key: unknown): key is string {
  if (typeof key !== "string") return false;
  return kind === "content_block" ? BLOCK_KEY_RE.test(key) : UUID_RE.test(key);
}

// ---------------------------------------------------------------------------
// Time: Pacific wall clock -> UTC, on the cron's 5-minute grid
// ---------------------------------------------------------------------------

/** The cron runs every 5 minutes (vercel.json, pinned by tests). */
export const SCHEDULE_GRID_MINUTES = 5;
/** How far ahead a schedule may be set (a little over a year, for holidays). */
export const SCHEDULE_MAX_DAYS_AHEAD = 400;
/** A "running" row older than this was abandoned by a killed run. */
export const SCHEDULE_STALE_RUNNING_MS = 10 * 60_000;
/** A row is tried at most this many times, then marked failed. */
export const SCHEDULE_MAX_ATTEMPTS = 3;
/** Rows handled per tick (each is a couple of small queries). */
export const SCHEDULE_MAX_PER_TICK = 25;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * "2026-11-27T09:00" typed in an <input type="datetime-local"> (Pacific) ->
 * UTC ISO. Null for anything that is not a real date and time. Seconds are
 * dropped. The DST gap (2:00-2:59 on the spring-forward Sunday) resolves the
 * way timezone.ts resolves it; that hour is never a business hour.
 */
export function pacificLocalToUtc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return pacificWallTimeToUtcISO(`${m[1]}-${m[2]}-${m[3]}`, { h, m: mi, s: 0, ms: 0 });
}

/** Round an instant UP to the next 5-minute mark (exact marks stay put). */
export function snapUpToGrid(iso: string): string {
  const t = Date.parse(iso);
  const step = SCHEDULE_GRID_MINUTES * 60_000;
  const whole = Math.floor(t / 60_000) * 60_000; // drop seconds/ms
  const base = whole < t ? whole + 60_000 : whole;
  return new Date(Math.ceil(base / step) * step).toISOString();
}

/** An instant as the value a datetime-local input shows (Pacific, to the minute). */
export function utcToPacificLocal(iso: string): string {
  const p = pacificParts(new Date(iso));
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

/** Default for a new schedule: one hour from now, on the grid, Pacific. */
export function defaultRunAtLocal(nowIso: string): string {
  return utcToPacificLocal(snapUpToGrid(new Date(Date.parse(nowIso) + 3_600_000).toISOString()));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri Nov 27, 2026 at 9:00 AM PT" - deterministic, no locale dependence. */
export function formatRunAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "-";
  const p = pacificParts(new Date(t));
  // Weekday of the PACIFIC calendar date (not the UTC one).
  const wd = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const h12 = p.hour % 12 || 12;
  const mer = p.hour >= 12 ? "PM" : "AM";
  return `${wd} ${MONTHS[p.month - 1]} ${p.day}, ${p.year} at ${h12}:${String(p.minute).padStart(2, "0")} ${mer} PT`;
}

/** "in 3 days", "in 2 hours", "in 15 minutes", "now", "5 minutes ago". */
export function relativeFromNow(iso: string, nowIso: string): string {
  const diff = Date.parse(iso) - Date.parse(nowIso);
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  let txt: string;
  if (mins < 1) return "now";
  if (mins < 60) txt = `${mins} minute${mins === 1 ? "" : "s"}`;
  else if (mins < 60 * 48) {
    const h = Math.round(mins / 60);
    txt = `${h} hour${h === 1 ? "" : "s"}`;
  } else {
    const d = Math.round(mins / 1440);
    txt = `${d} day${d === 1 ? "" : "s"}`;
  }
  return diff >= 0 ? `in ${txt}` : `${txt} ago`;
}

// ---------------------------------------------------------------------------
// Validating a new schedule
// ---------------------------------------------------------------------------

export type ScheduleInput = {
  kind: unknown;
  key: unknown;
  action: unknown;
  runAtLocal: unknown;
};

export type ValidSchedule = {
  kind: ScheduleTargetKind;
  key: string;
  action: ScheduleAction;
  /** UTC ISO, on the 5-minute grid. */
  runAt: string;
  /** True when the time was moved forward to the next 5-minute mark. */
  snapped: boolean;
};

export function validateScheduleInput(
  input: ScheduleInput,
  nowIso: string,
): { ok: true; value: ValidSchedule } | { ok: false; error: string } {
  if (!isTargetKind(input.kind)) return { ok: false, error: "That item can't be scheduled." };
  const kind = input.kind;
  if (!isValidTargetKey(kind, input.key)) return { ok: false, error: "That item can't be found." };
  if (!isScheduleAction(input.action)) return { ok: false, error: "Choose Publish or Unpublish." };
  if (!actionsFor(kind).includes(input.action))
    return { ok: false, error: `${TARGET_KIND_LABEL[kind]} can only be scheduled to publish.` };
  const exact = pacificLocalToUtc(input.runAtLocal);
  if (!exact) return { ok: false, error: "Pick a date and time." };
  const runAt = snapUpToGrid(exact);
  const now = Date.parse(nowIso);
  if (Date.parse(runAt) <= now)
    return { ok: false, error: "That time has already passed. Pick a time in the future, or use the Publish button to go live now." };
  if (Date.parse(runAt) - now > SCHEDULE_MAX_DAYS_AHEAD * 86_400_000)
    return { ok: false, error: `Pick a time within ${SCHEDULE_MAX_DAYS_AHEAD} days.` };
  return {
    ok: true,
    value: { kind, key: input.key as string, action: input.action, runAt, snapped: runAt !== new Date(exact).toISOString() },
  };
}

// ---------------------------------------------------------------------------
// The cron's decisions
// ---------------------------------------------------------------------------

export type ScheduleRowLite = {
  id: string;
  status: ScheduleStatus | string;
  run_at: string;
  created_at?: string | null;
  claimed_at?: string | null;
  attempts?: number | null;
};

/**
 * A "running" row whose claim is older than SCHEDULE_STALE_RUNNING_MS was
 * left behind by a run that was killed. Publishing is idempotent (it copies
 * the saved draft onto the live columns), so trying again is safe.
 */
export function isStaleRunning(row: ScheduleRowLite, nowIso: string): boolean {
  if (row.status !== "running") return false;
  const c = row.claimed_at ? Date.parse(row.claimed_at) : NaN;
  if (Number.isNaN(c)) return true;
  return Date.parse(nowIso) - c >= SCHEDULE_STALE_RUNNING_MS;
}

/**
 * The rows to work on this tick, oldest due first (ties: the one created
 * first, so "publish at 9" then "unpublish at 9" run in the order they were
 * set). Pending rows that are due, plus abandoned running rows.
 */
export function selectDue<T extends ScheduleRowLite>(rows: readonly T[], nowIso: string, limit = SCHEDULE_MAX_PER_TICK): T[] {
  const now = Date.parse(nowIso);
  return rows
    .filter((r) => (r.status === "pending" && Date.parse(r.run_at) <= now) || isStaleRunning(r, nowIso))
    .sort((a, b) => {
      const d = Date.parse(a.run_at) - Date.parse(b.run_at);
      if (d !== 0) return d;
      return Date.parse(a.created_at ?? a.run_at) - Date.parse(b.created_at ?? b.run_at);
    })
    .slice(0, Math.max(0, limit));
}

/** After a failure: try again next tick, or give up after SCHEDULE_MAX_ATTEMPTS. */
export function statusAfterFailure(attemptsSoFar: number): "pending" | "failed" {
  return attemptsSoFar >= SCHEDULE_MAX_ATTEMPTS ? "failed" : "pending";
}

/** Plain sentence for the editor: "Will publish Fri Nov 27 ... (in 3 days)". */
export function describeSchedule(action: ScheduleAction, runAt: string, nowIso: string): string {
  const verb = action === "publish" ? "Goes live" : "Comes down";
  return `${verb} ${formatRunAt(runAt)} (${relativeFromNow(runAt, nowIso)})`;
}

/** Truncate a label for lists. */
export function shortLabel(s: string | null | undefined, max = 60): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(untitled)";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runContentScheduleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) passed++;
    else {
      failed++;
      console.error(`content-schedule-core: ${name}: got ${g}, want ${w}`);
    }
  };

  // Kinds / actions
  eq("kinds", SCHEDULE_TARGET_KINDS.length, 5);
  eq("block publish only", actionsFor("content_block"), ["publish"]);
  eq("slide both", actionsFor("carousel_slide"), ["publish", "unpublish"]);
  eq("isTargetKind bad", isTargetKind("blog_post"), false);
  eq("isScheduleAction bad", isScheduleAction("delete"), false);
  eq("uuid key ok", isValidTargetKey("faq_item", "0b8f3c1e-1d2a-4c3b-9a8e-123456789abc"), true);
  eq("uuid key bad", isValidTargetKey("faq_item", "home.hero.title"), false);
  eq("block key ok", isValidTargetKey("content_block", "home.hero.title"), true);
  eq("block key bad", isValidTargetKey("content_block", "x; drop"), false);

  // Pacific -> UTC (PST = UTC-8, PDT = UTC-7)
  eq("PST 9am", pacificLocalToUtc("2026-11-27T09:00"), "2026-11-27T17:00:00.000Z");
  eq("PDT 9am", pacificLocalToUtc("2026-07-04T09:00"), "2026-07-04T16:00:00.000Z");
  eq("with seconds", pacificLocalToUtc("2026-07-04T09:00:30"), "2026-07-04T16:00:00.000Z");
  eq("feb 30", pacificLocalToUtc("2026-02-30T09:00"), null);
  eq("hour 24", pacificLocalToUtc("2026-02-03T24:00"), null);
  eq("garbage", pacificLocalToUtc("tomorrow"), null);
  eq("non-string", pacificLocalToUtc(42), null);
  // Fall back night 2026-11-01: 1:30 AM happens twice; either answer is a real instant.
  const fb = pacificLocalToUtc("2026-11-01T01:30");
  eq("fall-back resolves", fb === "2026-11-01T08:30:00.000Z" || fb === "2026-11-01T09:30:00.000Z", true);

  // Grid
  eq("snap exact", snapUpToGrid("2026-11-27T17:00:00.000Z"), "2026-11-27T17:00:00.000Z");
  eq("snap up", snapUpToGrid("2026-11-27T17:01:00.000Z"), "2026-11-27T17:05:00.000Z");
  eq("snap seconds", snapUpToGrid("2026-11-27T17:05:01.000Z"), "2026-11-27T17:10:00.000Z");
  eq("snap 4", snapUpToGrid("2026-11-27T17:04:00.000Z"), "2026-11-27T17:05:00.000Z");

  // Round trip + formatting
  eq("to local PST", utcToPacificLocal("2026-11-27T17:00:00.000Z"), "2026-11-27T09:00");
  eq("to local PDT", utcToPacificLocal("2026-07-04T16:00:00.000Z"), "2026-07-04T09:00");
  eq("default +1h", defaultRunAtLocal("2026-11-27T17:02:00.000Z"), "2026-11-27T10:05");
  eq("format PST", formatRunAt("2026-11-27T17:00:00.000Z"), "Fri Nov 27, 2026 at 9:00 AM PT");
  // 11:30 PM Pacific on Jul 3 is already Jul 4 in UTC: weekday must be Friday Jul 3.
  eq("format pacific weekday", formatRunAt("2026-07-04T06:30:00.000Z"), "Fri Jul 3, 2026 at 11:30 PM PT");
  eq("format noon", formatRunAt("2026-07-04T19:00:00.000Z"), "Sat Jul 4, 2026 at 12:00 PM PT");
  eq("format midnight", formatRunAt("2026-07-04T07:00:00.000Z"), "Sat Jul 4, 2026 at 12:00 AM PT");
  eq("format bad", formatRunAt("nope"), "-");
  const now = "2026-11-27T17:00:00.000Z";
  eq("rel 15m", relativeFromNow("2026-11-27T17:15:00.000Z", now), "in 15 minutes");
  eq("rel 1m", relativeFromNow("2026-11-27T17:01:00.000Z", now), "in 1 minute");
  eq("rel 3h", relativeFromNow("2026-11-27T20:00:00.000Z", now), "in 3 hours");
  eq("rel 3d", relativeFromNow("2026-11-30T17:00:00.000Z", now), "in 3 days");
  eq("rel past", relativeFromNow("2026-11-27T16:55:00.000Z", now), "5 minutes ago");
  eq("rel now", relativeFromNow(now, now), "now");

  // Validation
  const id = "0b8f3c1e-1d2a-4c3b-9a8e-123456789abc";
  const ok = validateScheduleInput({ kind: "carousel_slide", key: id, action: "publish", runAtLocal: "2026-11-28T09:00" }, now);
  eq("valid", ok.ok && ok.value.runAt, "2026-11-28T17:00:00.000Z");
  eq("valid not snapped", ok.ok && ok.value.snapped, false);
  const sn = validateScheduleInput({ kind: "carousel_slide", key: id, action: "publish", runAtLocal: "2026-11-28T09:02" }, now);
  eq("snapped", sn.ok && sn.value.runAt, "2026-11-28T17:05:00.000Z");
  eq("snapped flag", sn.ok && sn.value.snapped, true);
  eq("past", validateScheduleInput({ kind: "faq_item", key: id, action: "publish", runAtLocal: "2026-11-27T08:00" }, now).ok, false);
  eq("now exact is past", validateScheduleInput({ kind: "faq_item", key: id, action: "publish", runAtLocal: "2026-11-27T09:00" }, now).ok, false);
  eq("2 min ahead snaps ok", validateScheduleInput({ kind: "faq_item", key: id, action: "publish", runAtLocal: "2026-11-27T09:02" }, now).ok, true);
  eq("too far", validateScheduleInput({ kind: "faq_item", key: id, action: "publish", runAtLocal: "2028-11-27T09:00" }, now).ok, false);
  eq("block unpublish refused", validateScheduleInput({ kind: "content_block", key: "home.hero.title", action: "unpublish", runAtLocal: "2026-11-28T09:00" }, now).ok, false);
  eq("block publish ok", validateScheduleInput({ kind: "content_block", key: "home.hero.title", action: "publish", runAtLocal: "2026-11-28T09:00" }, now).ok, true);
  eq("bad kind", validateScheduleInput({ kind: "x", key: id, action: "publish", runAtLocal: "2026-11-28T09:00" }, now).ok, false);
  eq("bad key", validateScheduleInput({ kind: "shop_slide", key: "nope", action: "publish", runAtLocal: "2026-11-28T09:00" }, now).ok, false);
  eq("bad action", validateScheduleInput({ kind: "shop_slide", key: id, action: "delete", runAtLocal: "2026-11-28T09:00" }, now).ok, false);
  eq("no time", validateScheduleInput({ kind: "shop_slide", key: id, action: "publish", runAtLocal: "" }, now).ok, false);

  // Due selection
  const rows: ScheduleRowLite[] = [
    { id: "late", status: "pending", run_at: "2026-11-27T16:55:00.000Z", created_at: "2026-11-01T00:00:00.000Z" },
    { id: "future", status: "pending", run_at: "2026-11-27T17:05:00.000Z" },
    { id: "b", status: "pending", run_at: "2026-11-27T17:00:00.000Z", created_at: "2026-11-02T00:00:00.000Z" },
    { id: "a", status: "pending", run_at: "2026-11-27T17:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z" },
    { id: "done", status: "done", run_at: "2026-11-27T16:00:00.000Z" },
    { id: "cancel", status: "cancelled", run_at: "2026-11-27T16:00:00.000Z" },
    { id: "live-run", status: "running", run_at: "2026-11-27T16:50:00.000Z", claimed_at: "2026-11-27T16:58:00.000Z" },
    { id: "stale-run", status: "running", run_at: "2026-11-27T16:40:00.000Z", claimed_at: "2026-11-27T16:45:00.000Z" },
  ];
  eq("due order", selectDue(rows, now).map((r) => r.id), ["stale-run", "late", "a", "b"]);
  eq("due limit", selectDue(rows, now, 2).map((r) => r.id), ["stale-run", "late"]);
  eq("due limit 0", selectDue(rows, now, 0).length, 0);
  eq("stale no claim", isStaleRunning({ id: "x", status: "running", run_at: now, claimed_at: null }, now), true);
  eq("stale pending false", isStaleRunning({ id: "x", status: "pending", run_at: now }, now), false);
  eq("retry 1", statusAfterFailure(1), "pending");
  eq("retry 2", statusAfterFailure(2), "pending");
  eq("give up 3", statusAfterFailure(3), "failed");

  // Labels
  eq("describe", describeSchedule("publish", "2026-11-27T17:15:00.000Z", now), "Goes live Fri Nov 27, 2026 at 9:15 AM PT (in 15 minutes)");
  eq("describe down", describeSchedule("unpublish", "2026-11-27T20:00:00.000Z", now), "Comes down Fri Nov 27, 2026 at 12:00 PM PT (in 3 hours)");
  eq("short empty", shortLabel("  "), "(untitled)");
  eq("short trunc", shortLabel("abcdefghij", 5), "abcd…");

  return { passed, failed };
}
