/**
 * src/lib/pos/register-promo-day-core.ts  (D133, owner request 2026-11-02)
 *
 * PURE: which promotions the iPad register may price a sale with, RIGHT NOW.
 * No React, no DB, no server-only - unit-testable with tsx.
 *
 * WHAT WENT WRONG (production, Monday 2026-11-02): /api/pos/menu shipped only
 * the rules active at DOWNLOAD time. Register 2 downloaded its menu on Sunday,
 * kept the cached bundle overnight, and on Monday morning still applied
 * Sunday's 3-for-2 (8:14 AM, 9:44 AM) while Munchie Monday's 25% never applied.
 * Nothing on the device ever asked "is this still the right day?".
 *
 * THE FIX (owner: "enhance and harden the ipad registers and the promotions
 * logic to protect against this in the future"):
 *
 *  1. The bundle now carries EVERY published promotion with its schedule
 *     (`promoSchedule`), so the register chooses today's deals itself at
 *     pricing time, from the Pacific clock - the same rule the server and the
 *     website use (isActiveNow). A cached bundle stays correct across
 *     midnight and offline.
 *  2. A bundle WITHOUT the schedule (downloaded before this change) is only
 *     trusted on the Pacific day it was downloaded. On any later day its
 *     rules are NOT used (no deal is safer than yesterday's deal) and the
 *     register says so and refreshes.
 *  3. The register refreshes its menu by itself when the Pacific day changes
 *     and every few minutes while idle (shouldAutoRefreshMenu).
 *  4. Every sale records the Pacific day its deals were chosen for and the
 *     rule each line used; the sync compares them with the rules active when
 *     the sale happened (promoDayMismatch) and leaves a warning for the
 *     owner. It never blocks the sale - the customer already paid.
 */
import type { EngineRule } from "@/lib/promotions/discount-engine-core";
import { pacificDayKey, storeWeekday } from "@/lib/reports/timezone";

/** One published promotion as the register needs it: the rule + when it runs. */
export type ScheduledPromoRule = {
  rule: EngineRule;
  /** 0 = Sunday ... 6 = Saturday; null = date window / always on. */
  weekday: number | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type PromoSchedule = {
  rules: ScheduledPromoRule[];
  /** ISO time the server built the schedule. */
  builtAt: string;
};

/** The parts of the menu bundle this module reads. */
export type PromoBundleLike = {
  rules: EngineRule[];
  promoSchedule?: PromoSchedule | null;
  fetchedAt?: string | null;
};

/** Same rule as published-rules-core isActiveNow, on the schedule shape. */
export function scheduledRuleActiveAt(s: ScheduledPromoRule, when: Date): boolean {
  if (s.weekday != null) return s.weekday === storeWeekday(when);
  if (!s.startsAt && !s.endsAt) return true;
  const t = when.getTime();
  const startsOk = !s.startsAt || new Date(s.startsAt).getTime() <= t;
  const endsOk = !s.endsAt || new Date(s.endsAt).getTime() >= t;
  return startsOk && endsOk;
}

export type RulesForSale = {
  rules: EngineRule[];
  /** Pacific day (YYYY-MM-DD) the rules were chosen for. */
  dayKey: string;
  /** schedule = chosen on-device; bundle = old bundle, same day; stale = old bundle, other day. */
  source: "schedule" | "bundle" | "stale";
  /** Plain-English problem to show the cashier, or null. */
  warning: string | null;
};

export const STALE_DEALS_WARNING =
  "Today's deals are not loaded on this register yet, so no daily deal is being applied. Connect to the internet and press Refresh menu (More menu).";

function isValidDate(d: Date): boolean {
  return Number.isFinite(d.getTime());
}

/** The promotions this register may use for a sale happening at `now`. */
export function rulesForSale(bundle: PromoBundleLike, now: Date): RulesForSale {
  const dayKey = pacificDayKey(now);
  const sched = bundle.promoSchedule;
  if (sched && Array.isArray(sched.rules)) {
    return {
      rules: sched.rules.filter((s) => s && s.rule && scheduledRuleActiveAt(s, now)).map((s) => s.rule),
      dayKey,
      source: "schedule",
      warning: null,
    };
  }
  const fetched = bundle.fetchedAt ? new Date(bundle.fetchedAt) : null;
  if (fetched && isValidDate(fetched) && pacificDayKey(fetched) === dayKey) {
    return { rules: Array.isArray(bundle.rules) ? bundle.rules : [], dayKey, source: "bundle", warning: null };
  }
  return { rules: [], dayKey, source: "stale", warning: STALE_DEALS_WARNING };
}

/** The bundle with `rules` replaced by the promotions active at `now`. */
export function withTodaysPromotions<B extends PromoBundleLike>(bundle: B, now: Date): B {
  const r = rulesForSale(bundle, now);
  return { ...bundle, rules: r.rules };
}

export const AUTO_MENU_REFRESH_MS = 10 * 60 * 1000;

export type AutoRefreshInput = {
  /** ISO time of the bundle download (null = no bundle yet). */
  fetchedAt: string | null;
  now: Date;
  online: boolean;
  /** A sale is open - never swap prices under the cashier. */
  saleActive: boolean;
  busy: boolean;
  intervalMs?: number;
};

/** Why the register should download its menu now, or null. */
export function shouldAutoRefreshMenu(i: AutoRefreshInput): "no_menu" | "day_changed" | "periodic" | null {
  if (!i.online || i.saleActive || i.busy) return null;
  if (!i.fetchedAt) return "no_menu";
  const fetched = new Date(i.fetchedAt);
  if (!isValidDate(fetched)) return "no_menu";
  if (pacificDayKey(fetched) !== pacificDayKey(i.now)) return "day_changed";
  const interval = i.intervalMs ?? AUTO_MENU_REFRESH_MS;
  if (i.now.getTime() - fetched.getTime() >= interval) return "periodic";
  return null;
}

// ---------------------------------------------------------------------------
// Sync-time check (server calls this with the rules active at occurredAt)
// ---------------------------------------------------------------------------

export type PromoMismatchInput = {
  occurredAt: string;
  /** Day the device chose its deals for (absent on older registers). */
  promoDayKey?: string | null;
  lines: { productName: string; promoRuleId?: string | null }[];
  /** Rule ids active when the sale happened (server truth). */
  activeRuleIds: string[];
  /** Titles for readable messages (rule id -> title), optional. */
  ruleTitles?: Record<string, string>;
};

export type PromoMismatchFinding =
  | { kind: "wrong_day"; deviceDay: string; saleDay: string; message: string }
  | { kind: "inactive_rule"; productName: string; ruleId: string; message: string };

export function promoDayMismatch(i: PromoMismatchInput): PromoMismatchFinding[] {
  const out: PromoMismatchFinding[] = [];
  const at = new Date(i.occurredAt);
  if (!isValidDate(at)) return out;
  const saleDay = pacificDayKey(at);
  if (typeof i.promoDayKey === "string" && i.promoDayKey && i.promoDayKey !== saleDay) {
    out.push({
      kind: "wrong_day",
      deviceDay: i.promoDayKey,
      saleDay,
      message: `The register priced this ${saleDay} sale with the deals for ${i.promoDayKey}.`,
    });
  }
  const active = new Set(i.activeRuleIds);
  for (const l of i.lines) {
    const id = typeof l.promoRuleId === "string" ? l.promoRuleId : "";
    if (!id || active.has(id)) continue;
    const title = i.ruleTitles?.[id] ?? "a promotion";
    out.push({
      kind: "inactive_rule",
      productName: l.productName,
      ruleId: id,
      message: `${l.productName} got ${title}, which was not running on ${saleDay}.`,
    });
  }
  return out;
}

export function summarizePromoMismatch(f: PromoMismatchFinding[]): string {
  if (f.length === 0) return "";
  const day = f.find((x) => x.kind === "wrong_day");
  const lines = f.filter((x) => x.kind === "inactive_rule").length;
  const parts: string[] = [];
  if (day) parts.push(day.message);
  if (lines) parts.push(`${lines} line${lines === 1 ? "" : "s"} used a deal that was not running that day.`);
  return parts.join(" ");
}

export const PROMO_MISMATCH_AUDIT_ACTION = "register.promo_day_mismatch";

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runRegisterPromoDayTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const check = (name: string, cond: boolean) => {
    if (cond) passed++;
    else failures.push(name);
  };
  const rule = (id: string): EngineRule => ({
    id,
    title: id,
    discountType: "percent",
    discountPercent: 25,
    discountFixed: 0,
    priority: 10,
    storewide: false,
    targetCategories: [],
    targetBrands: [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
  });
  const sun = { rule: rule("sun"), weekday: 0, startsAt: null, endsAt: null };
  const mon = { rule: rule("mon"), weekday: 1, startsAt: null, endsAt: null };
  const win = { rule: rule("win"), weekday: null, startsAt: "2026-11-02T20:00:00Z", endsAt: "2026-11-03T07:59:00Z" };
  const always = { rule: rule("always"), weekday: null, startsAt: null, endsAt: null };
  const schedule: PromoSchedule = { rules: [sun, mon, win, always], builtAt: "2026-11-01T18:00:00Z" };

  // Monday 2026-11-02 08:14 PT = 16:14Z (PST, UTC-8).
  const monMorning = new Date("2026-11-02T16:14:00Z");
  // Sunday 2026-11-01 11:30 PT = 19:30Z.
  const sunMidday = new Date("2026-11-01T19:30:00Z");
  // Sunday 23:59 PT = Monday 07:59Z (still Sunday in Pacific).
  const sunLate = new Date("2026-11-02T07:59:00Z");

  // 1. The production incident: a Sunday-downloaded bundle on Monday morning.
  {
    const r = rulesForSale({ rules: [sun.rule], promoSchedule: schedule, fetchedAt: "2026-11-01T18:00:00Z" }, monMorning);
    check("monday picks monday", r.rules.some((x) => x.id === "mon"));
    check("monday drops sunday", !r.rules.some((x) => x.id === "sun"));
    check("monday keeps always-on", r.rules.some((x) => x.id === "always"));
    check("window not started at 8:14", !r.rules.some((x) => x.id === "win"));
    check("source schedule", r.source === "schedule" && r.warning === null);
    check("day key monday", r.dayKey === "2026-11-02");
  }
  {
    const r = rulesForSale({ rules: [], promoSchedule: schedule }, sunMidday);
    check("sunday picks sunday", r.rules.map((x) => x.id).sort().join(",") === "always,sun");
  }
  {
    const r = rulesForSale({ rules: [], promoSchedule: schedule }, sunLate);
    check("23:59 PT is still sunday", r.rules.some((x) => x.id === "sun") && r.dayKey === "2026-11-01");
  }
  {
    const r = rulesForSale({ rules: [], promoSchedule: schedule }, new Date("2026-11-02T21:00:00Z"));
    check("window active inside", r.rules.some((x) => x.id === "win"));
  }
  // 2. Old bundle (no schedule): trusted same day only.
  {
    const same = rulesForSale({ rules: [sun.rule], fetchedAt: "2026-11-01T17:00:00Z" }, sunMidday);
    check("old bundle same day uses rules", same.source === "bundle" && same.rules.length === 1);
    const next = rulesForSale({ rules: [sun.rule], fetchedAt: "2026-11-01T17:00:00Z" }, monMorning);
    check("old bundle next day = no deals", next.source === "stale" && next.rules.length === 0);
    check("old bundle next day warns", next.warning === STALE_DEALS_WARNING);
    const none = rulesForSale({ rules: [sun.rule] }, monMorning);
    check("no fetchedAt = stale", none.source === "stale" && none.rules.length === 0);
    const bad = rulesForSale({ rules: [sun.rule], fetchedAt: "garbage" }, monMorning);
    check("bad fetchedAt = stale", bad.source === "stale");
  }
  // 3. withTodaysPromotions keeps every other field.
  {
    const b = { rules: [sun.rule], promoSchedule: schedule, fetchedAt: "2026-11-01T18:00:00Z", products: [1, 2] };
    const t = withTodaysPromotions(b, monMorning);
    check("with today keeps products", t.products.length === 2);
    check("with today swaps rules", t.rules.some((x) => x.id === "mon") && !t.rules.some((x) => x.id === "sun"));
    check("with today does not mutate", b.rules[0].id === "sun");
  }
  // 4. Auto refresh.
  {
    const base = { now: monMorning, online: true, saleActive: false, busy: false };
    check("refresh day changed", shouldAutoRefreshMenu({ ...base, fetchedAt: "2026-11-01T23:00:00Z" }) === "day_changed");
    check("refresh periodic", shouldAutoRefreshMenu({ ...base, fetchedAt: "2026-11-02T16:00:00Z" }) === "periodic");
    check("refresh fresh = null", shouldAutoRefreshMenu({ ...base, fetchedAt: "2026-11-02T16:10:00Z" }) === null);
    check("never mid-sale", shouldAutoRefreshMenu({ ...base, saleActive: true, fetchedAt: "2026-11-01T23:00:00Z" }) === null);
    check("never offline", shouldAutoRefreshMenu({ ...base, online: false, fetchedAt: "2026-11-01T23:00:00Z" }) === null);
    check("never while busy", shouldAutoRefreshMenu({ ...base, busy: true, fetchedAt: null }) === null);
    check("no menu", shouldAutoRefreshMenu({ ...base, fetchedAt: null }) === "no_menu");
    check("bad date = no menu", shouldAutoRefreshMenu({ ...base, fetchedAt: "x" }) === "no_menu");
  }
  // 5. Sync mismatch check.
  {
    const f = promoDayMismatch({
      occurredAt: monMorning.toISOString(),
      promoDayKey: "2026-11-01",
      lines: [
        { productName: "Gummies", promoRuleId: "sun" },
        { productName: "Chocolate", promoRuleId: "mon" },
        { productName: "Lighter" },
      ],
      activeRuleIds: ["mon", "always"],
      ruleTitles: { sun: "Ice Cream Sunday" },
    });
    check("mismatch wrong day", f.some((x) => x.kind === "wrong_day"));
    check("mismatch inactive line", f.filter((x) => x.kind === "inactive_rule").length === 1);
    check("mismatch names the deal", f.some((x) => x.message.includes("Ice Cream Sunday")));
    check("summary text", summarizePromoMismatch(f).includes("1 line used"));
    const ok = promoDayMismatch({
      occurredAt: monMorning.toISOString(),
      promoDayKey: "2026-11-02",
      lines: [{ productName: "Gummies", promoRuleId: "mon" }],
      activeRuleIds: ["mon"],
    });
    check("clean sale no findings", ok.length === 0 && summarizePromoMismatch(ok) === "");
    const legacy = promoDayMismatch({ occurredAt: monMorning.toISOString(), lines: [{ productName: "X" }], activeRuleIds: [] });
    check("legacy payload no findings", legacy.length === 0);
    const badAt = promoDayMismatch({ occurredAt: "nope", promoDayKey: "2026-11-01", lines: [], activeRuleIds: [] });
    check("bad occurredAt no findings", badAt.length === 0);
  }

  if (failures.length) {
    for (const f of failures) console.error(`register-promo-day-core FAIL: ${f}`);
  }
  return { passed, failed: failures.length };
}
