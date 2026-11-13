/**
 * src/lib/cms/this-week-feed-core.ts
 *
 * D237 N-4 (SOP-22 G-114, F-22-11): the "This week at Greenway" facts feed.
 * PURE: no I/O. The server reader (this-week-feed-server.ts) loads the rows;
 * this file decides what counts as "this week" and how it is grouped, and it
 * turns the feed into the fact lines the AI is allowed to use.
 *
 * Owner (D237): "I approve all from serious to small along with your
 * recommendations".
 *
 * Rules:
 *   - "Last week" = the 7 Pacific calendar days ending today (today included).
 *   - A lot's arrival day is its received_on (a Pacific date) when set; when it
 *     is unknown the row's Pacific creation day is used (same rule as
 *     vendor-menu-coverage-core lotReceivedDay). Destroyed lots are skipped.
 *   - Promotions: published only. "Running now" = a weekly deal, or a dated
 *     deal whose window includes now. "Coming up" = a dated deal that starts in
 *     the next 14 days. The deal wording is built from the promotion row, never
 *     typed by the AI (Q-22-8).
 *   - Calendar: US federal holidays, 4/20 and 7/10, and local events the
 *     owner adds, in the next 30 days.
 *   - Money is integer cents.
 */
import { pacificDayKey } from "../reports/timezone";

export const FEED_LOOKBACK_DAYS = 7;
export const FEED_PROMO_AHEAD_DAYS = 14;
export const FEED_CALENDAR_AHEAD_DAYS = 30;
export const BLOG_CALENDAR_KEY = "blog_calendar_events";
export const MAX_LOCAL_EVENTS = 60;

export type FeedVendor = { id: string; display_name: string; created_at: string | null };
export type FeedLot = {
  vendor_id: string | null;
  received_on: string | null;
  created_at: string | null;
  status: string | null;
  product_name: string | null;
  /** Human product type (already labelled by the server, e.g. via lotTypeLabel). */
  type_label: string | null;
};
export type FeedPromotion = {
  id: string;
  title: string;
  status: string;
  weekday: number | null;
  starts_at: string | null;
  ends_at: string | null;
  discount_type: string;
  discount_percent: number;
  discount_fixed: number;
  bonus_note: string | null;
  markdown_only: boolean;
};
export type LocalEvent = { date: string; name: string };

export type FreshDropGroup = { vendorId: string | null; vendorName: string; types: { type: string; lots: number }[]; lots: number };
export type FeedDeal = {
  id: string;
  title: string;
  when: string;
  offer: string;
  bonusNote: string | null;
  markdown: boolean;
  belowCost: number;
};
export type FeedDate = { date: string; name: string; kind: "holiday" | "cannabis" | "local" };

export type ThisWeekFeed = {
  fromDay: string;
  toDay: string;
  newVendors: { id: string; name: string; addedOn: string }[];
  freshDrops: FreshDropGroup[];
  freshLotCount: number;
  runningNow: FeedDeal[];
  comingUp: FeedDeal[];
  vendorDays: FeedDeal[];
  calendar: FeedDate[];
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── day helpers (YYYY-MM-DD, Pacific) ─────────────────────────────────────────

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function isDay(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** The Pacific day a lot arrived, or null. */
export function arrivalDay(l: Pick<FeedLot, "received_on" | "created_at">): string | null {
  const rec = /^(\d{4}-\d{2}-\d{2})/.exec(String(l.received_on ?? ""));
  if (rec) return rec[1];
  if (!l.created_at || Number.isNaN(Date.parse(l.created_at))) return null;
  return pacificDayKey(l.created_at);
}

/** The lookback window [fromDay, toDay] for a given instant. */
export function feedWindow(nowIso: string): { fromDay: string; toDay: string } {
  const toDay = pacificDayKey(nowIso);
  return { fromDay: addDays(toDay, -(FEED_LOOKBACK_DAYS - 1)), toDay };
}

// ── deals ─────────────────────────────────────────────────────────────────────

function cents(n: number): string {
  const v = Math.max(0, Math.round(n));
  return `$${Math.floor(v / 100)}${v % 100 ? `.${String(v % 100).padStart(2, "0")}` : ""}`;
}

/** The offer, written from the promotion row (never by the AI). */
export function offerText(p: Pick<FeedPromotion, "discount_type" | "discount_percent" | "discount_fixed">): string {
  const pct = Number(p.discount_percent) || 0;
  const fixed = Math.round(Number(p.discount_fixed) || 0);
  if (p.discount_type === "percent" && pct > 0) return `${pct}% off`;
  if (p.discount_type === "fixed" && fixed > 0) return `${cents(fixed)} off`;
  if (pct > 0) return `${pct}% off`;
  if (fixed > 0) return `${cents(fixed)} off`;
  return "See the deal details";
}

function whenText(p: FeedPromotion): string {
  if (p.weekday != null && p.weekday >= 0 && p.weekday <= 6) return `Every ${WEEKDAY_NAMES[p.weekday]}`;
  const s = p.starts_at ? pacificDayKey(p.starts_at) : null;
  const e = p.ends_at ? pacificDayKey(p.ends_at) : null;
  if (s && e) return s === e ? s : `${s} to ${e}`;
  if (s) return `From ${s}`;
  if (e) return `Until ${e}`;
  return "Ongoing";
}

function toDeal(p: FeedPromotion, belowCost: Record<string, number>): FeedDeal {
  return {
    id: p.id,
    title: p.title,
    when: whenText(p),
    offer: offerText(p),
    bonusNote: p.bonus_note?.trim() || null,
    markdown: p.markdown_only,
    belowCost: Math.max(0, Math.round(belowCost[p.id] ?? 0)),
  };
}

export function classifyPromotions(
  promos: FeedPromotion[],
  nowIso: string,
  belowCost: Record<string, number> = {},
): { runningNow: FeedDeal[]; comingUp: FeedDeal[]; vendorDays: FeedDeal[] } {
  const now = Date.parse(nowIso);
  const ahead = now + FEED_PROMO_AHEAD_DAYS * 86_400_000;
  const runningNow: FeedDeal[] = [];
  const comingUp: FeedDeal[] = [];
  const vendorDays: FeedDeal[] = [];
  for (const p of promos) {
    if (p.status !== "published") continue;
    const s = p.starts_at ? Date.parse(p.starts_at) : null;
    const e = p.ends_at ? Date.parse(p.ends_at) : null;
    if (e != null && e < now) continue; // over
    const started = s == null || s <= now;
    const deal = toDeal(p, belowCost);
    if (started) runningNow.push(deal);
    else if (s != null && s <= ahead) comingUp.push(deal);
    else continue;
    if (p.markdown_only) vendorDays.push(deal);
  }
  const byWhen = (a: FeedDeal, b: FeedDeal) => a.when.localeCompare(b.when) || a.title.localeCompare(b.title);
  return { runningNow: runningNow.sort(byWhen), comingUp: comingUp.sort(byWhen), vendorDays: vendorDays.sort(byWhen) };
}

// ── calendar ─────────────────────────────────────────────────────────────────

/** n-th weekday (0=Sun) of a month; n = -1 means the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return ymd(year, month, day);
  }
  const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDate)).getUTCDay();
  return ymd(year, month, lastDate - ((last - weekday + 7) % 7));
}

export function calendarForYear(year: number): FeedDate[] {
  const h = (date: string, name: string): FeedDate => ({ date, name, kind: "holiday" });
  const c = (date: string, name: string): FeedDate => ({ date, name, kind: "cannabis" });
  return [
    h(ymd(year, 1, 1), "New Year's Day"),
    h(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day"),
    h(nthWeekday(year, 2, 1, 3), "Presidents' Day"),
    c(ymd(year, 4, 20), "4/20"),
    h(nthWeekday(year, 5, 1, -1), "Memorial Day"),
    h(ymd(year, 6, 19), "Juneteenth"),
    h(ymd(year, 7, 4), "Independence Day"),
    c(ymd(year, 7, 10), "7/10 (oil and concentrates day)"),
    h(nthWeekday(year, 9, 1, 1), "Labor Day"),
    h(nthWeekday(year, 10, 1, 2), "Indigenous Peoples' Day / Columbus Day"),
    h(ymd(year, 11, 11), "Veterans Day"),
    h(nthWeekday(year, 11, 4, 4), "Thanksgiving"),
    h(ymd(year, 12, 25), "Christmas Day"),
    h(ymd(year, 12, 31), "New Year's Eve"),
  ];
}

/** Clean the owner's local events (YYYY-MM-DD for one day, or MM-DD every year). */
export function normalizeLocalEvents(raw: unknown): LocalEvent[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: LocalEvent[] = [];
  for (const r of list) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const date = String(o.date ?? "").trim();
    const name = String(o.name ?? "").trim().slice(0, 80);
    if (!name) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && !/^\d{2}-\d{2}$/.test(date)) continue;
    const md = date.length === 5 ? date : date.slice(5);
    const [m, d] = md.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) continue;
    out.push({ date, name });
  }
  return out.slice(0, MAX_LOCAL_EVENTS);
}

/** Parse the "Local events" box: one "YYYY-MM-DD Name" or "MM-DD Name" per line. */
export function parseLocalEventsText(text: string): LocalEvent[] {
  const raw = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\s+(.+)$/.exec(line);
      return m ? { date: m[1], name: m[2] } : null;
    })
    .filter((x): x is LocalEvent => x !== null);
  return normalizeLocalEvents(raw);
}

export function upcomingDates(todayDay: string, local: LocalEvent[], aheadDays = FEED_CALENDAR_AHEAD_DAYS): FeedDate[] {
  const end = addDays(todayDay, aheadDays);
  const y = Number(todayDay.slice(0, 4));
  const all: FeedDate[] = [...calendarForYear(y), ...calendarForYear(y + 1)];
  for (const e of local) {
    if (e.date.length === 10) all.push({ date: e.date, name: e.name, kind: "local" });
    else {
      all.push({ date: `${y}-${e.date}`, name: e.name, kind: "local" });
      all.push({ date: `${y + 1}-${e.date}`, name: e.name, kind: "local" });
    }
  }
  return all
    .filter((d) => d.date >= todayDay && d.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// ── the feed ─────────────────────────────────────────────────────────────────

export function buildThisWeekFeed(input: {
  nowIso: string;
  vendors: FeedVendor[];
  lots: FeedLot[];
  promotions: FeedPromotion[];
  belowCost?: Record<string, number>;
  localEvents?: LocalEvent[];
}): ThisWeekFeed {
  const { fromDay, toDay } = feedWindow(input.nowIso);
  const inWindow = (d: string | null) => isDay(d) && d >= fromDay && d <= toDay;
  const vendorName = new Map(input.vendors.map((v) => [v.id, v.display_name]));

  const newVendors = input.vendors
    .map((v) => ({ id: v.id, name: v.display_name, addedOn: v.created_at ? pacificDayKey(v.created_at) : "" }))
    .filter((v) => inWindow(v.addedOn))
    .sort((a, b) => b.addedOn.localeCompare(a.addedOn) || a.name.localeCompare(b.name));

  const groups = new Map<string, FreshDropGroup>();
  let freshLotCount = 0;
  for (const l of input.lots) {
    if ((l.status ?? "").toLowerCase() === "destroyed") continue;
    if (!inWindow(arrivalDay(l))) continue;
    freshLotCount++;
    const key = l.vendor_id ?? "";
    const g = groups.get(key) ?? {
      vendorId: l.vendor_id,
      vendorName: (l.vendor_id && vendorName.get(l.vendor_id)) || "Vendor not set",
      types: [],
      lots: 0,
    };
    g.lots++;
    const type = (l.type_label ?? "").trim() || "Other";
    const t = g.types.find((x) => x.type === type);
    if (t) t.lots++;
    else g.types.push({ type, lots: 1 });
    groups.set(key, g);
  }
  const freshDrops = [...groups.values()]
    .map((g) => ({ ...g, types: g.types.sort((a, b) => b.lots - a.lots || a.type.localeCompare(b.type)) }))
    .sort((a, b) => b.lots - a.lots || a.vendorName.localeCompare(b.vendorName));

  const deals = classifyPromotions(input.promotions, input.nowIso, input.belowCost ?? {});
  return {
    fromDay,
    toDay,
    newVendors,
    freshDrops,
    freshLotCount,
    ...deals,
    calendar: upcomingDates(toDay, input.localEvents ?? []),
  };
}

/**
 * The fact lines handed to the AI. Only what is listed here may be used.
 * Deal lines carry the offer written from the promotion (Q-22-8); a deal with
 * a below-cost finding is left out so the AI never promotes it.
 */
export function feedFactLines(f: ThisWeekFeed): string[] {
  const out: string[] = [`Week: ${f.fromDay} to ${f.toDay} (Pacific).`];
  for (const v of f.newVendors) out.push(`New vendor: ${v.name} (added ${v.addedOn}).`);
  for (const g of f.freshDrops.slice(0, 12)) {
    out.push(`Fresh drop: ${g.vendorName}: ${g.types.map((t) => `${t.type} (${t.lots} lot${t.lots === 1 ? "" : "s"})`).join(", ")}.`);
  }
  for (const d of f.runningNow.filter((x) => x.belowCost === 0).slice(0, 12)) {
    out.push(`Deal running now: ${d.title}: ${d.offer}, ${d.when}${d.bonusNote ? ` (${d.bonusNote})` : ""}.`);
  }
  for (const d of f.comingUp.filter((x) => x.belowCost === 0).slice(0, 8)) {
    out.push(`Deal coming up: ${d.title}: ${d.offer}, ${d.when}${d.bonusNote ? ` (${d.bonusNote})` : ""}.`);
  }
  for (const c of f.calendar.slice(0, 8)) out.push(`Date ahead: ${c.date} ${c.name}.`);
  return out;
}

// ── self-test ────────────────────────────────────────────────────────────────

export function __runThisWeekFeedCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL this-week-feed-core: ${name}`);
    }
  };
  // Wed 2026-11-11 12:00 PST = 20:00Z
  const NOW = "2026-11-11T20:00:00.000Z";
  const w = feedWindow(NOW);
  ok("window to today", w.toDay === "2026-11-11");
  ok("window 7 days", w.fromDay === "2026-11-05");
  ok("addDays across month", addDays("2026-10-31", 1) === "2026-11-01");
  ok("addDays back across year", addDays("2026-01-01", -1) === "2025-12-31");

  ok("arrival uses received_on", arrivalDay({ received_on: "2026-11-09", created_at: "2026-01-01T00:00:00Z" }) === "2026-11-09");
  ok("arrival falls back to Pacific created day", arrivalDay({ received_on: null, created_at: "2026-11-10T05:00:00Z" }) === "2026-11-09");
  ok("arrival unknown", arrivalDay({ received_on: null, created_at: null }) === null);

  ok("offer percent", offerText({ discount_type: "percent", discount_percent: 20, discount_fixed: 0 }) === "20% off");
  ok("offer fixed cents", offerText({ discount_type: "fixed", discount_percent: 0, discount_fixed: 550 }) === "$5.50 off");
  ok("offer fixed whole", offerText({ discount_type: "fixed", discount_percent: 0, discount_fixed: 300 }) === "$3 off");
  ok("offer fallback", offerText({ discount_type: "bundle", discount_percent: 0, discount_fixed: 0 }) === "See the deal details");

  const P = (o: Partial<FeedPromotion>): FeedPromotion => ({
    id: "p", title: "T", status: "published", weekday: null, starts_at: null, ends_at: null,
    discount_type: "percent", discount_percent: 10, discount_fixed: 0, bonus_note: null, markdown_only: false, ...o,
  });
  const cls = classifyPromotions(
    [
      P({ id: "mon", title: "Monday edibles", weekday: 1 }),
      P({ id: "draft", status: "draft", weekday: 2 }),
      P({ id: "over", ends_at: "2026-11-01T00:00:00Z" }),
      P({ id: "win", title: "Fall sale", starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-30T08:00:00Z" }),
      P({ id: "soon", title: "Vendor day", starts_at: "2026-11-20T08:00:00Z", ends_at: "2026-11-21T07:59:00Z", markdown_only: true }),
      P({ id: "far", starts_at: "2027-01-20T08:00:00Z" }),
    ],
    NOW,
    { win: 2 },
  );
  ok("running: weekly + window", cls.runningNow.map((d) => d.id).sort().join(",") === "mon,win");
  ok("draft skipped", !cls.runningNow.some((d) => d.id === "draft"));
  ok("over skipped", !cls.runningNow.some((d) => d.id === "over"));
  ok("coming up within 14 days", cls.comingUp.map((d) => d.id).join(",") === "soon");
  ok("far skipped", !cls.comingUp.some((d) => d.id === "far"));
  ok("vendor day = markdown", cls.vendorDays.map((d) => d.id).join(",") === "soon");
  ok("weekly when text", cls.runningNow.find((d) => d.id === "mon")?.when === "Every Monday");
  ok("window when text", cls.runningNow.find((d) => d.id === "win")?.when === "2026-11-01 to 2026-11-30");
  ok("below cost carried", cls.runningNow.find((d) => d.id === "win")?.belowCost === 2);

  const cal = calendarForYear(2026);
  ok("MLK 2026", cal.some((d) => d.date === "2026-01-19" && d.name.startsWith("Martin")));
  ok("Memorial 2026 last Monday", cal.some((d) => d.date === "2026-05-25" && d.name === "Memorial Day"));
  ok("Labor 2026", cal.some((d) => d.date === "2026-09-07" && d.name === "Labor Day"));
  ok("Thanksgiving 2026", cal.some((d) => d.date === "2026-11-26" && d.name === "Thanksgiving"));
  ok("4/20 is cannabis", cal.some((d) => d.date === "2026-04-20" && d.kind === "cannabis"));
  ok("7/10 present", cal.some((d) => d.date === "2026-07-10"));

  const local = normalizeLocalEvents([
    { date: "11-28", name: "Small Business Saturday" },
    { date: "2026-11-14", name: "Port Orchard tree lighting" },
    { date: "13-01", name: "bad month" },
    { date: "2026-11-14", name: "" },
    "junk",
  ]);
  ok("local events cleaned", local.length === 2);
  const up = upcomingDates("2026-11-11", local);
  const parsed = parseLocalEventsText("12-05 Port Orchard tree lighting\n2026-11-14  Fall market\nno date here\n\n13-40 bad");
  ok("parse events text", parsed.length === 2 && parsed[0].name === "Port Orchard tree lighting" && parsed[1].date === "2026-11-14");
  ok("upcoming has Veterans Day today", up[0]?.date === "2026-11-11" && up[0].name === "Veterans Day");
  ok("upcoming has local one-off", up.some((d) => d.kind === "local" && d.date === "2026-11-14"));
  ok("upcoming has yearly local", up.some((d) => d.kind === "local" && d.date === "2026-11-28"));
  ok("upcoming stops at 30 days", up.every((d) => d.date <= "2026-12-11"));
  ok("year rollover", upcomingDates("2026-12-20", []).some((d) => d.date === "2027-01-01"));

  const feed = buildThisWeekFeed({
    nowIso: NOW,
    vendors: [
      { id: "v1", display_name: "Two Heads", created_at: "2026-11-08T18:00:00Z" },
      { id: "v2", display_name: "Old Farm", created_at: "2025-01-01T00:00:00Z" },
    ],
    lots: [
      { vendor_id: "v2", received_on: "2026-11-10", created_at: null, status: "active", product_name: "A", type_label: "Flower" },
      { vendor_id: "v2", received_on: "2026-11-06", created_at: null, status: "active", product_name: "B", type_label: "Flower" },
      { vendor_id: "v2", received_on: "2026-11-06", created_at: null, status: "active", product_name: "C", type_label: "Preroll" },
      { vendor_id: "v1", received_on: "2026-11-09", created_at: null, status: "active", product_name: "D", type_label: "" },
      { vendor_id: "v1", received_on: "2026-11-04", created_at: null, status: "active", product_name: "old", type_label: "Flower" },
      { vendor_id: "v1", received_on: "2026-11-09", created_at: null, status: "destroyed", product_name: "gone", type_label: "Flower" },
      { vendor_id: null, received_on: "2026-11-09", created_at: null, status: "active", product_name: "E", type_label: "Edible" },
    ],
    promotions: [P({ id: "mon", title: "Monday edibles", weekday: 1 }), P({ id: "bad", title: "Bad", weekday: 3 })],
    belowCost: { bad: 1 },
    localEvents: [],
  });
  ok("new vendor this week", feed.newVendors.length === 1 && feed.newVendors[0].name === "Two Heads");
  ok("fresh lot count excludes old + destroyed", feed.freshLotCount === 5);
  ok("groups sorted by lots", feed.freshDrops[0].vendorName === "Old Farm" && feed.freshDrops[0].lots === 3);
  ok("types grouped", feed.freshDrops[0].types[0].type === "Flower" && feed.freshDrops[0].types[0].lots === 2);
  ok("blank type is Other", feed.freshDrops.some((g) => g.vendorName === "Two Heads" && g.types[0].type === "Other"));
  ok("missing vendor named", feed.freshDrops.some((g) => g.vendorName === "Vendor not set"));

  const lines = feedFactLines(feed);
  ok("facts: week line", lines[0] === "Week: 2026-11-05 to 2026-11-11 (Pacific).");
  ok("facts: new vendor", lines.includes("New vendor: Two Heads (added 2026-11-08)."));
  ok("facts: drop line", lines.some((l) => l.startsWith("Fresh drop: Old Farm: Flower (2 lots), Preroll (1 lot)")));
  ok("facts: deal from promotion", lines.some((l) => l === "Deal running now: Monday edibles: 10% off, Every Monday."));
  ok("facts: below-cost deal left out", !lines.some((l) => l.includes("Bad")));
  return { passed, failed };
}
