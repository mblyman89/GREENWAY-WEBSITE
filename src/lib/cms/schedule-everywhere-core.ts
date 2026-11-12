/**
 * D234 C-7 (SOP-11b G-102, G-103) — one schedule everywhere + "Preview as of".
 *
 * Owner answer Q-11-16: *"yes"* (Shop slides and type cards get repeats and
 * fallback, like home slides).
 *
 * Pure (no I/O, no React) so the Shop store, the type cards, the editors, the
 * calendar and the Schedule & Releases page all agree.
 *
 *  - Repeat fields (days, daily from/to) and the fallback tick are OPTIONAL and
 *    only stored when used, so every existing Shop slide and type card
 *    serializes byte-identically (cleanRepeat drops defaults).
 *  - scheduleOf() turns any item's fields into the shared BannerSchedule, so
 *    the live check is banner-schedule-core's isScheduleLiveAt everywhere.
 *  - previewAsOf() answers "what will be showing at this date and time?": it
 *    applies every scheduled change (and every release with a time) due before
 *    then, in time order, and then each item's own schedule and the fallback
 *    rule. Releases with no time yet are listed as not counted.
 */
import {
  cleanDays,
  cleanHHMM,
  isScheduleLiveAt,
  pickLiveWithFallback,
  type BannerSchedule,
  type CalendarBanner,
  type Weekday,
} from "./banner-schedule-core";
import { formatRunAt, pacificLocalToUtc } from "./content-schedule-core";

// ── Repeat fields ────────────────────────────────────────────────────────

export type RepeatFields = {
  /** Weekdays it may show (absent = every day). */
  scheduleDays?: Weekday[];
  /** Daily window "HH:MM" in store time; both or neither. */
  scheduleFrom?: string;
  scheduleTo?: string;
  /** Shows only when nothing else in its area is live. */
  fallback?: boolean;
};

/** Only the USED repeat fields (defaults dropped; half a window dropped). */
export function cleanRepeat(raw: unknown): RepeatFields {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: RepeatFields = {};
  const days = cleanDays(o.scheduleDays);
  if (days.length) out.scheduleDays = days;
  const from = cleanHHMM(o.scheduleFrom);
  const to = cleanHHMM(o.scheduleTo);
  if (from && to && from !== to) {
    out.scheduleFrom = from;
    out.scheduleTo = to;
  }
  if (o.fallback === true) out.fallback = true;
  return out;
}

/** Is any repeat field (or the fallback tick) in use? */
export function hasRepeatFields(r: RepeatFields | null | undefined): boolean {
  return !!r && (!!r.scheduleDays?.length || !!(r.scheduleFrom && r.scheduleTo) || r.fallback === true);
}

export type ScheduleFields = RepeatFields & {
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
};

/** Any item's schedule fields as the shared BannerSchedule. */
export function scheduleOf(f: ScheduleFields | null | undefined): BannerSchedule {
  return {
    start: f?.scheduleStart || null,
    end: f?.scheduleEnd || null,
    days: f?.scheduleDays ?? [],
    from: f?.scheduleFrom && f?.scheduleTo ? f.scheduleFrom : null,
    to: f?.scheduleFrom && f?.scheduleTo ? f.scheduleTo : null,
  };
}

/** Live at this instant (start/end, repeat days, daily window; store time). */
export function isLiveBySchedule(f: ScheduleFields | null | undefined, whenMs: number): boolean {
  return isScheduleLiveAt(scheduleOf(f), whenMs);
}

/** The visitor list: live regular items, or the fallback ones when none is live. */
export function pickLive<T>(items: readonly T[], fieldsOf: (t: T) => ScheduleFields | null | undefined, whenMs: number): T[] {
  return pickLiveWithFallback(items, (t) => fieldsOf(t)?.fallback === true, (t) => isLiveBySchedule(fieldsOf(t), whenMs));
}

/** A calendar entry for any scheduled item. */
export function calendarEntry(id: string, label: string, f: ScheduleFields | null | undefined): CalendarBanner {
  return { id, label, schedule: scheduleOf(f), fallback: f?.fallback === true };
}

// ── Preview as of ────────────────────────────────────────────────────────

export const AS_OF_AREAS = ["Home carousel", "Shop banner", "Type cards"] as const;
export type AsOfArea = (typeof AS_OF_AREAS)[number];

export type AsOfItem = {
  /** Schedule target kind (carousel_slide, shop_slide) or "type_card". */
  kind: string;
  key: string;
  area: AsOfArea;
  label: string;
  /** Visible to the public right now (published and switched on). */
  enabled: boolean;
  fields: ScheduleFields | null;
  /** What a scheduled Publish would make live (the saved draft). */
  draftFields?: ScheduleFields | null;
  draftLabel?: string;
};

export type AsOfChange = {
  id: string;
  target_kind: string;
  target_key: string;
  target_label: string | null;
  action: "publish" | "unpublish";
  run_at: string | null;
  status: string;
  release_id: string | null;
};

export type AsOfRelease = { id: string; name: string; status: string; run_at: string | null };

export type AsOfApplied = { id: string; label: string; action: "publish" | "unpublish"; runAt: string; release: string | null };
export type AsOfEntry = { key: string; label: string; why: string };
export type AsOfAreaResult = { area: AsOfArea; live: AsOfEntry[]; hidden: AsOfEntry[]; usedFallback: boolean };
export type AsOfResult = {
  asOfIso: string;
  applied: AsOfApplied[];
  notCounted: { label: string; reason: string }[];
  areas: AsOfAreaResult[];
};

/** When a change will run, or null when it never will on its own. */
function effectiveRunAt(c: AsOfChange, releases: Map<string, AsOfRelease>): string | null {
  if (c.status !== "pending" && c.status !== "running" && c.status !== "held") return null;
  if (c.release_id) {
    const r = releases.get(c.release_id);
    if (!r || r.status === "cancelled" || r.status === "published") return c.status === "held" ? null : c.run_at;
    if (r.status === "scheduled" && r.run_at) return r.run_at;
    return c.status === "held" ? null : c.run_at;
  }
  return c.status === "held" ? null : c.run_at;
}

export function previewAsOf(
  items: readonly AsOfItem[],
  changes: readonly AsOfChange[],
  releases: readonly AsOfRelease[],
  nowMs: number,
  asOfMs: number,
): AsOfResult {
  const rel = new Map(releases.map((r) => [r.id, r]));
  const state = new Map(items.map((i) => [`${i.kind}|${i.key}`, { ...i }]));
  const applied: AsOfApplied[] = [];
  const notCounted: { label: string; reason: string }[] = [];
  const due: { c: AsOfChange; t: number; iso: string }[] = [];

  for (const c of changes) {
    const iso = effectiveRunAt(c, rel);
    const label = c.target_label || c.target_key;
    if (!iso) {
      const r = c.release_id ? rel.get(c.release_id) : undefined;
      if (c.status === "held" && r && r.status === "draft") notCounted.push({ label, reason: `In the release "${r.name}", which has no time yet.` });
      continue;
    }
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || t > asOfMs) continue;
    if (t <= nowMs && c.status !== "running") continue; // already ran (or overdue: the 5-minute clock runs it next)
    due.push({ c, t, iso });
  }
  due.sort((a, b) => a.t - b.t || a.c.id.localeCompare(b.c.id));

  for (const { c, iso } of due) {
    const r = c.release_id ? rel.get(c.release_id) : undefined;
    applied.push({ id: c.id, label: c.target_label || c.target_key, action: c.action, runAt: iso, release: r ? r.name : null });
    const item = state.get(`${c.target_kind}|${c.target_key}`);
    if (!item) continue;
    if (c.action === "publish") {
      item.enabled = true;
      if (item.draftFields !== undefined) item.fields = item.draftFields;
      if (item.draftLabel) item.label = item.draftLabel;
    } else {
      item.enabled = false;
    }
  }

  const areas: AsOfAreaResult[] = AS_OF_AREAS.map((area) => {
    const list = [...state.values()].filter((i) => i.area === area);
    const on = list.filter((i) => i.enabled);
    const live = pickLive(on, (i) => i.fields, asOfMs);
    const liveKeys = new Set(live.map((i) => i.key));
    const usedFallback = live.length > 0 && live.every((i) => i.fields?.fallback === true);
    const hidden: AsOfEntry[] = [];
    for (const i of list) {
      if (liveKeys.has(i.key)) continue;
      const why = !i.enabled
        ? "Switched off (not published or taken down)"
        : i.fields?.fallback === true
          ? "Fallback, not needed (something else is live)"
          : "Outside its own schedule";
      hidden.push({ key: i.key, label: i.label, why });
    }
    return {
      area,
      live: live.map((i) => ({ key: i.key, label: i.label, why: i.fields?.fallback === true ? "Fallback (nothing else is live)" : "Live" })),
      hidden,
      usedFallback,
    };
  });

  return { asOfIso: new Date(asOfMs).toISOString(), applied, notCounted, areas };
}

/** The ?asof= value (Pacific datetime-local) as epoch ms, or null. */
export function parseAsOf(v: unknown): number | null {
  const iso = pacificLocalToUtc(v);
  return iso ? Date.parse(iso) : null;
}

/** "Fri Nov 27, 2026 at 9:00 AM PT" for the preview heading. */
export function asOfHeading(ms: number): string {
  return `The website as of ${formatRunAt(new Date(ms).toISOString())}`;
}

// ── Self-test ────────────────────────────────────────────────────────────

export function __runScheduleEverywhereCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("schedule-everywhere-core FAIL:", m);
    }
  };
  // repeat fields
  ok(Object.keys(cleanRepeat({})).length === 0 && Object.keys(cleanRepeat(null)).length === 0, "nothing set = nothing stored");
  ok(Object.keys(cleanRepeat({ scheduleDays: [], fallback: false, scheduleFrom: "09:00" })).length === 0, "defaults + half window dropped");
  const r = cleanRepeat({ scheduleDays: ["fri", "xx", "wed"], scheduleFrom: "16:00", scheduleTo: "21:00", fallback: true });
  ok(r.scheduleDays?.join() === "wed,fri" && r.scheduleFrom === "16:00" && r.scheduleTo === "21:00" && r.fallback === true, "repeat cleaned");
  ok(!cleanRepeat({ scheduleFrom: "10:00", scheduleTo: "10:00" }).scheduleFrom, "zero-length window dropped");
  ok(hasRepeatFields(r) && !hasRepeatFields({}) && !hasRepeatFields(null), "hasRepeatFields");
  // schedule + live (2026-01-14 is a Wednesday; 20:00Z = 12:00 PST)
  const wedNoon = Date.parse("2026-01-14T20:00:00Z");
  const thuNoon = Date.parse("2026-01-15T20:00:00Z");
  ok(isLiveBySchedule(null, wedNoon) && isLiveBySchedule({}, wedNoon), "no schedule = live");
  ok(isLiveBySchedule({ scheduleDays: ["wed"] }, wedNoon) && !isLiveBySchedule({ scheduleDays: ["wed"] }, thuNoon), "every Wednesday");
  ok(!isLiveBySchedule({ scheduleFrom: "16:00", scheduleTo: "21:00" }, wedNoon), "outside daily window");
  ok(!isLiveBySchedule({ scheduleEnd: "2026-01-01T00:00:00Z" }, wedNoon), "end date honoured");
  ok(scheduleOf({ scheduleFrom: "09:00" }).from === null, "half window ignored");
  // fallback rule
  const items = [
    { id: "a", f: { scheduleEnd: "2026-01-01T00:00:00Z" } as ScheduleFields },
    { id: "fb", f: { fallback: true } as ScheduleFields },
  ];
  ok(pickLive(items, (i) => i.f, wedNoon).map((i) => i.id).join() === "fb", "fallback when nothing live");
  ok(pickLive([...items, { id: "b", f: {} }], (i) => i.f, wedNoon).map((i) => i.id).join() === "b", "regular wins over fallback");
  ok(calendarEntry("x", "X", { fallback: true, scheduleDays: ["mon"] }).fallback && calendarEntry("x", "X", null).schedule.days.length === 0, "calendar entry");
  // preview as of
  const now = Date.parse("2026-11-20T20:00:00Z");
  const fri = Date.parse("2026-11-27T20:00:00Z"); // Fri noon PT
  const asItems: AsOfItem[] = [
    { kind: "shop_slide", key: "s1", area: "Shop banner", label: "Everyday", enabled: true, fields: { scheduleEnd: "2026-11-25T00:00:00Z" } },
    { kind: "shop_slide", key: "s2", area: "Shop banner", label: "Black Friday (draft)", enabled: false, fields: null, draftFields: { scheduleDays: ["fri"] }, draftLabel: "Black Friday" },
    { kind: "shop_slide", key: "s3", area: "Shop banner", label: "Fallback", enabled: true, fields: { fallback: true } },
    { kind: "carousel_slide", key: "h1", area: "Home carousel", label: "Home", enabled: true, fields: null },
    { kind: "type_card", key: "t1", area: "Type cards", label: "Flower", enabled: true, fields: { scheduleDays: ["mon"] } },
  ];
  const changes: AsOfChange[] = [
    { id: "c1", target_kind: "shop_slide", target_key: "s2", target_label: "Black Friday", action: "publish", run_at: null, status: "pending", release_id: "R1" },
    { id: "c2", target_kind: "carousel_slide", target_key: "h1", target_label: "Home", action: "unpublish", run_at: "2026-11-30T20:00:00Z", status: "pending", release_id: null },
    { id: "c3", target_kind: "faq_item", target_key: "q", target_label: "Hours?", action: "publish", run_at: null, status: "held", release_id: "R2" },
    { id: "c4", target_kind: "page_section", target_key: "p", target_label: "Promo", action: "publish", run_at: "2026-11-21T20:00:00Z", status: "pending", release_id: null },
    { id: "c5", target_kind: "page_section", target_key: "p", target_label: "Old", action: "publish", run_at: "2026-11-01T20:00:00Z", status: "done", release_id: null },
  ];
  const releases: AsOfRelease[] = [
    { id: "R1", name: "Black Friday", status: "scheduled", run_at: "2026-11-27T08:00:00Z" },
    { id: "R2", name: "Winter", status: "draft", run_at: null },
  ];
  const res = previewAsOf(asItems, changes, releases, now, fri);
  ok(res.applied.map((a) => a.id).join() === "c4,c1", "applied in time order; future + done skipped");
  ok(res.applied[1]?.release === "Black Friday" && res.applied[1]?.runAt === "2026-11-27T08:00:00Z", "release time used");
  ok(res.notCounted.length === 1 && res.notCounted[0]!.reason.includes("Winter"), "untimed release listed");
  const shop = res.areas.find((a) => a.area === "Shop banner")!;
  ok(shop.live.map((e) => e.label).join() === "Black Friday" && !shop.usedFallback, "published draft + its repeat used");
  ok(shop.hidden.some((h) => h.key === "s1" && h.why.startsWith("Outside")) && shop.hidden.some((h) => h.key === "s3" && h.why.startsWith("Fallback")), "hidden reasons");
  ok(res.areas.find((a) => a.area === "Home carousel")!.live.length === 1, "home unpublish after as-of not applied");
  ok(res.areas.find((a) => a.area === "Type cards")!.live.length === 0, "type card off on Friday");
  const sat = previewAsOf(asItems, changes, releases, now, Date.parse("2026-11-28T20:00:00Z"));
  const shopSat = sat.areas.find((a) => a.area === "Shop banner")!;
  ok(shopSat.usedFallback && shopSat.live[0]?.key === "s3", "fallback when nothing else live");
  ok(parseAsOf("2026-11-27T12:00") === fri && parseAsOf("nope") === null, "asof parsed as Pacific");
  ok(asOfHeading(fri).includes("Fri Nov 27, 2026"), "heading");
  return { passed, failed };
}
