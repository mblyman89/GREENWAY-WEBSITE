/**
 * banner-live-core — R58-S3. "Live" text boxes: countdown badges and auto
 * deal badges. Pure + self-tested (no React, no I/O).
 *
 * A text box gets an optional `live` setting; its `text` becomes a TEMPLATE
 * with tokens that fill in on the visitor's screen and keep ticking:
 *
 *   {left}   time left, friendly  ("2d 4h", "3h 12m", "12m 05s")
 *   {clock}  time left, clock     ("03:12:45", days prefix "2d 03:12:45")
 *   {offer}  the deal's offer line ("20% off", "Buy 2 get 1", "4 for 3")
 *   {deal}   the deal's name       ("Doobie Tuesday")
 *   {ends}   when it ends          ("Ends tonight", "Ends Sun 9:00 PM")
 *
 * Modes:
 *   countdown — to a date/time the owner picks, OR "end of today" (store
 *               time, Pacific) for daily deals. After it ends the box shows
 *               `expired` text, or disappears when that's empty.
 *   deal      — AUTO badge bound to the back office's published promotions:
 *               "today" = the best deal running right now, or one promotion
 *               by id. Offer/name/countdown come from the promotion itself,
 *               so editing a deal in /admin/promotions updates every banner.
 *               No running deal → the box hides (never advertises a dead deal).
 */
import type { PublishedRuleSnapshot } from "@/lib/promotions/published-rules-core";

export type LiveMode = "countdown" | "deal";
export type LiveText = {
  mode: LiveMode;
  /** countdown: ISO date-time to count to. Absent + `daily` → end of today. */
  to?: string;
  /** countdown: count to the end of the store's day (midnight Pacific). */
  daily?: true;
  /** deal: "today" (best running deal) or a promotion id. */
  promo?: string;
  /** Text after the countdown/deal ends; empty → hide the box. */
  expired?: string;
};

export const LIVE_TOKENS = ["{left}", "{clock}", "{offer}", "{deal}", "{ends}"] as const;
export const STORE_TZ = "America/Los_Angeles";

export const LIVE_PRESETS: { id: string; label: string; text: string; live: LiveText; hint: string }[] = [
  { id: "ends-tonight", label: "Ends tonight", text: "Ends in {left}", live: { mode: "countdown", daily: true }, hint: "Counts down to midnight (store time) every day" },
  { id: "countdown", label: "Countdown to a date", text: "Sale ends in {clock}", live: { mode: "countdown", expired: "" }, hint: "Pick the date & time below" },
  { id: "launch", label: "Launch / drop", text: "Drops in {left}", live: { mode: "countdown", expired: "Out now!" }, hint: "Shows “Out now!” when it hits zero" },
  { id: "deal-offer", label: "Today's deal (auto)", text: "{offer}", live: { mode: "deal", promo: "today" }, hint: "Fills in from Promotions — always today's deal" },
  { id: "deal-name", label: "Deal name + offer (auto)", text: "{deal} · {offer}", live: { mode: "deal", promo: "today" }, hint: "e.g. “Doobie Tuesday · 20% off”" },
  { id: "deal-ends", label: "Deal + countdown (auto)", text: "{offer} · ends in {left}", live: { mode: "deal", promo: "today" }, hint: "Counts down to when the deal ends" },
];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function normalizeLive(raw: unknown): LiveText | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.mode !== "countdown" && r.mode !== "deal") return undefined;
  const out: LiveText = { mode: r.mode };
  if (r.mode === "countdown") {
    if (typeof r.to === "string" && ISO_RE.test(r.to) && Number.isFinite(Date.parse(r.to))) out.to = r.to;
    if (r.daily === true || !out.to) out.daily = true;
    if (out.daily) delete out.to;
  } else {
    out.promo = typeof r.promo === "string" && r.promo.trim() ? r.promo.trim().slice(0, 64) : "today";
  }
  if (typeof r.expired === "string") out.expired = r.expired.slice(0, 80);
  return out;
}

/** Wall-clock parts in the store's time zone. */
function storeParts(now: Date): { wd: number; h: number; m: number; s: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday));
  return { wd, h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
}

/** Epoch ms of the next store-time midnight. */
export function endOfStoreDay(now: Date): number {
  const { h, m, s } = storeParts(now);
  const left = 86400 - (h * 3600 + m * 60 + s);
  return now.getTime() - now.getMilliseconds() + left * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatLeft(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(s)}s`;
}

export function formatClock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${d > 0 ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(s)}`;
}

function endsLabel(end: number, now: Date): string {
  if (end - now.getTime() <= 0) return "Ended";
  if (end === endOfStoreDay(now)) return "Ends tonight";
  return `Ends ${new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(end))}`;
}

function running(s: PublishedRuleSnapshot, now: Date): boolean {
  if (s.weekday != null) return s.weekday === storeParts(now).wd;
  const t = now.getTime();
  if (s.startsAt && Date.parse(s.startsAt) > t) return false;
  if (s.endsAt && Date.parse(s.endsAt) < t) return false;
  return true;
}

/** When a running deal stops: its end date, or tonight for weekday deals. */
export function dealEndsAt(s: PublishedRuleSnapshot, now: Date): number | null {
  if (s.endsAt) return Date.parse(s.endsAt);
  if (s.weekday != null) return endOfStoreDay(now);
  return null; // always-on
}

/**
 * The deal a box shows. "today": dated flash sales first (they're the special
 * event), then weekday deals, then always-on; highest priority wins.
 */
export function pickDeal(snapshots: PublishedRuleSnapshot[], promo: string | undefined, now: Date): PublishedRuleSnapshot | null {
  const live = snapshots.filter((s) => running(s, now));
  if (promo && promo !== "today") return live.find((s) => s.id === promo || s.promoKey === promo) ?? null;
  const rank = (s: PublishedRuleSnapshot) => (s.startsAt || s.endsAt ? 2 : s.weekday != null ? 1 : 0);
  return live.slice().sort((a, b) => rank(b) - rank(a) || b.priority - a.priority)[0] ?? null;
}

export type LiveResult = { text: string; ended: boolean; /** ms until the next change worth re-rendering */ tick: number };

/**
 * Resolve a live box's text right now. `offerLabel` is injected (it lives in
 * the promotions core) so this module stays dependency-light and testable.
 */
export function resolveLive(
  template: string,
  live: LiveText,
  now: Date,
  snapshots: PublishedRuleSnapshot[],
  offerLabel: (s: PublishedRuleSnapshot) => string,
): LiveResult {
  let end: number | null = null;
  let deal: PublishedRuleSnapshot | null = null;
  if (live.mode === "countdown") end = live.daily || !live.to ? endOfStoreDay(now) : Date.parse(live.to);
  else {
    deal = pickDeal(snapshots, live.promo, now);
    if (!deal) return { text: live.expired ?? "", ended: true, tick: 60_000 };
    end = dealEndsAt(deal, now);
  }
  const left = end == null ? 0 : end - now.getTime();
  if (end != null && left <= 0) return { text: live.expired ?? "", ended: true, tick: 60_000 };
  const vars: Record<string, string> = {
    "{left}": end == null ? "" : formatLeft(left),
    "{clock}": end == null ? "" : formatClock(left),
    "{offer}": deal ? offerLabel(deal) || deal.title : "",
    "{deal}": deal ? deal.title : "",
    "{ends}": end == null ? "" : endsLabel(end, now),
  };
  const text = template.replace(/\{(left|clock|offer|deal|ends)\}/g, (k) => vars[k] ?? "").replace(/\s*·\s*$/, "").trim();
  const usesSeconds = /\{clock\}/.test(template) || (/\{left\}/.test(template) && left < 3600_000);
  return { text, ended: false, tick: usesSeconds ? 1000 : 30_000 };
}

/** Text shown while the page loads (before the visitor's clock is known). */
export function placeholderText(template: string): string {
  return template.replace(/\{clock\}/g, "00:00:00").replace(/\{left\}/g, "0h 00m").replace(/\{(offer|deal|ends)\}/g, "…");
}

export function __runBannerLiveTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL banner-live-core: ${m}`);
    }
  };
  ok(normalizeLive(null) === undefined && normalizeLive({ mode: "x" }) === undefined, "rejects junk");
  ok(JSON.stringify(normalizeLive({ mode: "countdown" })) === '{"mode":"countdown","daily":true}', "countdown w/o date → daily");
  const iso = "2030-01-02T03:04:00.000Z";
  ok(normalizeLive({ mode: "countdown", to: iso })!.to === iso && !normalizeLive({ mode: "countdown", to: iso })!.daily, "countdown keeps date");
  ok(normalizeLive({ mode: "deal" })!.promo === "today" && normalizeLive({ mode: "deal", promo: " p1 " })!.promo === "p1", "deal promo default");
  ok(formatLeft(2 * 86400e3 + 4 * 3600e3) === "2d 4h" && formatLeft(3 * 3600e3 + 12 * 60e3) === "3h 12m" && formatLeft(65e3) === "1m 05s", "formatLeft");
  ok(formatClock(3 * 3600e3 + 62e3) === "03:01:02" && formatClock(86400e3 + 1e3) === "1d 00:00:01" && formatClock(-5) === "00:00:00", "formatClock");
  // 2030-06-05 12:00 Pacific (PDT, UTC-7) = 19:00Z → 12h to midnight.
  const noon = new Date("2030-06-05T19:00:00.000Z");
  ok(endOfStoreDay(noon) - noon.getTime() === 12 * 3600e3, "end of store day (Pacific)");
  const snap = (o: Partial<PublishedRuleSnapshot>): PublishedRuleSnapshot => ({ id: "x", promoKey: null, title: "Deal", description: null, discountType: "percent", discountPercent: 20, discountFixed: 0, perItemSale: false, bonusNote: null, weekday: null, startsAt: null, endsAt: null, priority: 0, storewide: true, targetCategories: [], targetBrands: [], targetProductKeys: [], excludeCategories: [], excludeBrands: [], excludeProductKeys: [], config: {}, ...o });
  // 2030-06-05 is a Wednesday (3).
  const wed = snap({ id: "w", title: "Wax Wednesday", weekday: 3, priority: 5 });
  const tue = snap({ id: "t", title: "Doobie Tuesday", weekday: 2, priority: 9 });
  const flash = snap({ id: "f", title: "Flash", startsAt: "2030-06-05T00:00:00Z", endsAt: "2030-06-06T00:00:00Z" });
  const off = (s: PublishedRuleSnapshot) => `${s.discountPercent}% off`;
  ok(pickDeal([wed, tue], "today", noon)?.id === "w", "today picks the running weekday deal");
  ok(pickDeal([wed, tue, flash], "today", noon)?.id === "f", "flash sale outranks weekday deal");
  ok(pickDeal([wed, tue], "t", noon) === null, "bound deal not running → none");
  const r = resolveLive("{deal} · {offer} · ends in {left}", { mode: "deal", promo: "today" }, noon, [wed], off);
  ok(r.text === "Wax Wednesday · 20% off · ends in 12h 00m" && !r.ended && r.tick === 30_000, `deal text: ${r.text}`);
  ok(resolveLive("{offer}", { mode: "deal", promo: "today" }, noon, [tue], off).ended, "no deal → ended (hidden)");
  const c = resolveLive("Ends in {clock}", { mode: "countdown", to: "2030-06-05T19:00:05.000Z" }, noon, [], off);
  ok(c.text === "Ends in 00:00:05" && c.tick === 1000, "countdown clock ticks per second");
  const e = resolveLive("Drops in {left}", { mode: "countdown", to: "2030-06-05T18:00:00.000Z", expired: "Out now!" }, noon, [], off);
  ok(e.ended && e.text === "Out now!", "expired text");
  ok(resolveLive("{ends}", { mode: "countdown", daily: true }, noon, [], off).text === "Ends tonight", "ends tonight label");
  ok(placeholderText("{offer} · {clock}") === "… · 00:00:00", "placeholder");
  return { passed, failed };
}
