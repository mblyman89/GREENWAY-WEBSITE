/**
 * src/lib/promotions/promo-preview-core.ts  (R74 S28, owner round 12)
 *
 * Owner, round 12: "I like the bad product queue and preview before publishing
 * features. Please add those in this next round." The round 11 proposal:
 * "see every product, price and floor check for a promotion in advance, and
 * schedule it to go live automatically."
 *
 * PURE (no React, no DB, no env). Three pieces, each reusing a rule that
 * already exists rather than inventing a second one:
 *
 *  1. buildPromoPreview: every product the promotion would discount, with its
 *     price, the promotion's lowest possible price, the legal floor and a
 *     verdict. The verdicts come straight from the publish guard's own
 *     findBelowCost (promo-guard-core), so the preview can never disagree with
 *     the hard block: a row says "Blocks publish" exactly when Publish would
 *     refuse.
 *
 *  2. promoScheduleSummary: in plain English, when the promotion will actually
 *     be live once published. Mirrors isActiveNow (published-rules-core): a
 *     weekday deal runs on that store weekday; otherwise a dated deal runs
 *     inside its window; no weekday and no dates = every day.
 *
 *  3. Scheduling. Verified in the code, not assumed: the old "Schedule" status
 *     never went live (nothing reads status=scheduled; getPublishedPromotions
 *     reads only "published"). What DOES go live by itself is a PUBLISHED
 *     promotion whose start time is still ahead: every engine (website cart,
 *     register, menu badges) treats it as off until that moment. That is the
 *     pattern the Thursday planner already uses. So "Schedule" now means:
 *     run the same floor check now, then publish with the future start.
 *     scheduleGate decides whether a promotion can be scheduled.
 *
 *  4. parsePromoWindow: the form's Starts/Ends are datetime-local values with
 *     NO time zone ("2026-11-27T09:00"). PostgreSQL reads a timestamptz with no
 *     zone in the session TimeZone (PostgreSQL docs 8.5.1.3), and Supabase
 *     databases run in UTC (Supabase docs, "Managing timezones"), so 9:00 AM
 *     was being stored as 9:00 UTC (1-2 AM Pacific). They are now converted
 *     from Pacific (AGENTS rule 9) with the existing pacificLocalToUtc, and a
 *     value that is not a real date and time refuses the save (fail loud).
 */
import {
  findBelowCost,
  worstCasePriceMinorUnits,
  MERCH_TOKENS,
  type GuardProduct,
  type GuardRuleShape,
} from "./promo-guard-core";
import { costFloorMinorUnits } from "./discount-engine-core";
import { formatRunAt, pacificLocalToUtc, relativeFromNow } from "@/lib/cms/content-schedule-core";

// ---------------------------------------------------------------------------
// 1. Product preview
// ---------------------------------------------------------------------------

export type PreviewVerdict = "blocks" | "regular_below" | "no_cost" | "ok";

/** Display order: the rows that need action first. */
export const PREVIEW_VERDICTS: PreviewVerdict[] = ["blocks", "regular_below", "no_cost", "ok"];

export const VERDICT_LABEL: Record<PreviewVerdict, string> = {
  blocks: "Blocks publish",
  regular_below: "Already at or under the floor",
  no_cost: "No cost on file",
  ok: "OK",
};

export const VERDICT_MEANING: Record<PreviewVerdict, string> = {
  blocks:
    "The deepest this deal can go would sell it under the legal minimum built from its cost. Publish and Schedule refuse until it is fixed.",
  regular_below:
    "Its regular price is already at or under the legal minimum, so the register can give no discount on it. Fix the price.",
  no_cost:
    "No cost is on file, so the legal minimum cannot be checked. The register still clamps at the floor once a costed lot exists.",
  ok: "Even at the deepest discount this deal can give, the price stays above the legal minimum.",
};

export type PreviewRow = {
  key: string;
  name: string;
  brand: string;
  priceMinor: number;
  /** The promotion's lowest possible price for one unit (the guard's worst case). */
  lowestMinor: number;
  /** Legal minimum from the cost (0 when no cost). */
  floorMinor: number;
  costMinor: number | null;
  /** lowest - floor, only for costed rows (how much room is left). */
  headroomMinor: number | null;
  verdict: PreviewVerdict;
};

export type PromoPreview = {
  rows: PreviewRow[];
  counts: Record<PreviewVerdict, number>;
  total: number;
};

function isMerch(categories: string[]): boolean {
  return categories.some((c) => MERCH_TOKENS.includes(c.toLowerCase()));
}

/**
 * Every affected product with its verdict. Verdicts for flagged products are
 * taken from findBelowCost itself (the publish guard), so a "Blocks publish"
 * row is exactly a product that would block Publish.
 */
export function buildPromoPreview(shape: GuardRuleShape, affected: GuardProduct[]): PromoPreview {
  const findings = new Map(findBelowCost(shape, affected).map((f) => [f.key, f]));
  const counts: Record<PreviewVerdict, number> = { blocks: 0, regular_below: 0, no_cost: 0, ok: 0 };
  const rows: PreviewRow[] = [];
  const seen = new Set<string>();
  for (const p of affected) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const f = findings.get(p.key);
    const verdict: PreviewVerdict = !f
      ? "ok"
      : f.reason === "below_cost"
        ? "blocks"
        : f.reason === "regular_below_cost"
          ? "regular_below"
          : "no_cost";
    const lowestMinor = f ? f.worstCasePriceMinorUnits : worstCasePriceMinorUnits(shape, p.priceMinorUnits);
    const floorMinor = f ? f.floorMinorUnits : costFloorMinorUnits(p.costMinorUnits, isMerch(p.categories));
    const costMinor = p.costMinorUnits != null && p.costMinorUnits > 0 ? p.costMinorUnits : null;
    counts[verdict] += 1;
    rows.push({
      key: p.key,
      name: p.name,
      brand: p.brand,
      priceMinor: p.priceMinorUnits,
      lowestMinor,
      floorMinor,
      costMinor,
      headroomMinor: costMinor == null ? null : lowestMinor - floorMinor,
      verdict,
    });
  }
  const rank = (v: PreviewVerdict) => PREVIEW_VERDICTS.indexOf(v);
  rows.sort(
    (a, b) =>
      rank(a.verdict) - rank(b.verdict) ||
      (a.headroomMinor ?? 0) - (b.headroomMinor ?? 0) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
  return { rows, counts, total: rows.length };
}

// ---------------------------------------------------------------------------
// 2. When will it be live?
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type ScheduleInput = {
  status: string;
  weekday: number | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type ScheduleState = "weekday" | "always_on" | "starts_later" | "running" | "ended";

export type ScheduleSummary = {
  state: ScheduleState;
  /** One plain sentence: when customers get this deal once it is published. */
  text: string;
  /** Things that will surprise the owner if not said out loud. */
  warnings: string[];
};

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export function promoScheduleSummary(p: ScheduleInput, nowIso: string): ScheduleSummary {
  const now = Date.parse(nowIso);
  const start = ms(p.startsAt);
  const end = ms(p.endsAt);
  const warnings: string[] = [];
  if (p.status === "scheduled") {
    warnings.push(
      "This promotion's status is Scheduled from before this change, and on its own that status never goes live. Press Schedule again (it needs a future start) or Publish.",
    );
  }
  if ((p.startsAt && start == null) || (p.endsAt && end == null)) {
    warnings.push("A start or end date could not be read. Open the Schedule section, set it again and save.");
  }

  if (p.weekday != null && p.weekday >= 0 && p.weekday <= 6) {
    if (start != null || end != null) {
      warnings.push(
        "This deal has a weekday AND dates. The website ignores dates on a weekday deal but the register honours them, so the two could disagree. Clear the dates or the weekday.",
      );
    }
    return { state: "weekday", text: `Runs every ${WEEKDAY_NAMES[p.weekday]} (store time) while it is published.`, warnings };
  }
  if (start == null && end == null) {
    return {
      state: "always_on",
      text: "No weekday and no dates: once published it runs every day until it is archived.",
      warnings,
    };
  }
  if (end != null && end < now) {
    warnings.push("Its end time has passed, so publishing it changes nothing for customers. Set new dates first.");
    return { state: "ended", text: `Ended ${formatRunAt(new Date(end).toISOString())}.`, warnings };
  }
  const until = end != null ? ` and stops ${formatRunAt(new Date(end).toISOString())}` : "";
  if (start != null && start > now) {
    const startIso = new Date(start).toISOString();
    return {
      state: "starts_later",
      text: `Goes live by itself ${formatRunAt(startIso)} (${relativeFromNow(startIso, nowIso)})${until}.`,
      warnings,
    };
  }
  return {
    state: "running",
    text: `Live as soon as it is published${end != null ? `, until ${formatRunAt(new Date(end).toISOString())}` : ""}.`,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 3. Can it be scheduled?
// ---------------------------------------------------------------------------

export type ScheduleGate = { ok: true; startsAt: string } | { ok: false; error: string };

/**
 * Schedule = publish now with a start time that is still ahead (every engine
 * keeps it off until then). Refused, with the reason, when that would not
 * actually be a scheduled go-live.
 */
export function scheduleGate(p: ScheduleInput, nowIso: string): ScheduleGate {
  if (p.status === "published") {
    return { ok: false, error: "Nothing was scheduled: it is already published. Its start time below decides when it is live." };
  }
  if (p.weekday != null) {
    return {
      ok: false,
      error: "Nothing was scheduled: a weekday deal runs every week and has no go-live time. Publish it, or clear the weekday and set Starts.",
    };
  }
  const start = ms(p.startsAt);
  if (start == null) {
    return { ok: false, error: "Nothing was scheduled: set Starts (Pacific time) in the Schedule section and save first." };
  }
  if (start <= Date.parse(nowIso)) {
    return {
      ok: false,
      error: "Nothing was scheduled: Starts is not in the future. Move Starts later and save, or press Publish to go live now.",
    };
  }
  const end = ms(p.endsAt);
  if (p.endsAt && end == null) {
    return { ok: false, error: "Nothing was scheduled: the end time could not be read. Set it again and save." };
  }
  if (end != null && end <= start) {
    return { ok: false, error: "Nothing was scheduled: Ends must be after Starts." };
  }
  return { ok: true, startsAt: new Date(start).toISOString() };
}

// ---------------------------------------------------------------------------
// 4. The form's Starts/Ends (Pacific wall time -> UTC)
// ---------------------------------------------------------------------------

export type PromoWindow = { ok: true; startsAt: string | null; endsAt: string | null } | { ok: false; error: string };

/**
 * Form Starts/Ends (datetime-local, Pacific) -> UTC ISO. Blank = no limit. A
 * value that is not a real date and time, or an end not after the start,
 * refuses the save with a plain reason (fail loud; never store a guess).
 */
export function parsePromoWindow(startsRaw: string, endsRaw: string): PromoWindow {
  const s = startsRaw.trim();
  const e = endsRaw.trim();
  const startsAt = s ? pacificLocalToUtc(s) : null;
  if (s && !startsAt) return { ok: false, error: `Nothing was saved: Starts "${s}" is not a real date and time.` };
  const endsAt = e ? pacificLocalToUtc(e) : null;
  if (e && !endsAt) return { ok: false, error: `Nothing was saved: Ends "${e}" is not a real date and time.` };
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { ok: false, error: "Nothing was saved: Ends must be after Starts." };
  }
  return { ok: true, startsAt, endsAt };
}

// ---------------------------------------------------------------------------
// Self-tests (pure).
// ---------------------------------------------------------------------------

export function __runPromoPreviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL promo-preview-core: ${name}`);
    }
  };

  const pct = (n: number): GuardRuleShape => ({ discountType: "percent", discountPercent: n, discountFixed: 0, config: {} });
  const prod = (key: string, price: number, cost: number | null, over: Partial<GuardProduct> = {}): GuardProduct => ({
    key,
    name: `N ${key}`,
    brand: "B",
    categories: ["flower"],
    priceMinorUnits: price,
    costMinorUnits: cost,
    ...over,
  });

  // Floors from the real rule (never re-derived here).
  const floor1000 = costFloorMinorUnits(1000, false);
  ok(floor1000 > 1000, "cannabis floor is above cost (tax-inclusive)");

  // 30% off: price P, lowest = round(P*0.7).
  const shape = pct(30);
  const okP = prod("ok", 10000, 1000); // lowest 7000, far above floor
  const blockP = prod("blk", Math.ceil(floor1000 / 0.7) - 200, 1000); // lowest under floor, regular above
  const regP = prod("reg", floor1000, 1000); // regular == floor
  const noCostP = prod("nc", 5000, null);
  const pv = buildPromoPreview(shape, [okP, blockP, regP, noCostP]);
  const by = (k: string) => pv.rows.find((r) => r.key === k)!;
  ok(pv.total === 4, "every affected product is a row");
  ok(by("ok").verdict === "ok", "ok verdict");
  ok(by("blk").verdict === "blocks", "below floor at worst case blocks");
  ok(by("reg").verdict === "regular_below", "regular at floor");
  ok(by("nc").verdict === "no_cost", "no cost");
  ok(pv.counts.blocks === 1 && pv.counts.ok === 1 && pv.counts.regular_below === 1 && pv.counts.no_cost === 1, "counts");
  ok(pv.rows.map((r) => r.verdict).join() === "blocks,regular_below,no_cost,ok", "rows sorted by what needs action first");
  ok(by("ok").lowestMinor === 7000, "lowest price = guard worst case");
  ok(by("ok").floorMinor === floor1000, "ok row carries the real floor");
  ok(by("ok").headroomMinor === 7000 - floor1000, "headroom = lowest - floor");
  ok(by("nc").headroomMinor === null && by("nc").floorMinor === 0 && by("nc").costMinor === null, "no-cost row has no floor/headroom");
  ok(by("blk").headroomMinor! < 0, "a blocking row has negative headroom");

  // Agreement with the publish guard: blocks <=> findBelowCost below_cost.
  const guardBlocks = findBelowCost(shape, [okP, blockP, regP, noCostP])
    .filter((f) => f.reason === "below_cost")
    .map((f) => f.key);
  ok(JSON.stringify(guardBlocks) === JSON.stringify(pv.rows.filter((r) => r.verdict === "blocks").map((r) => r.key)), "blocks == guard below_cost");

  // Exactly at the floor at worst case is NOT a block (guard: worst < floor).
  const exactPrice = Math.round(floor1000 / 0.7);
  const exact = buildPromoPreview(shape, [prod("x", exactPrice, 1000)]).rows[0];
  ok(exact.verdict === (Math.round(exactPrice * 0.7) < floor1000 ? "blocks" : "ok"), "boundary follows the guard (worst < floor)");

  // Merch floor uses the merch divisor.
  const merchFloor = costFloorMinorUnits(1000, true);
  const merchRow = buildPromoPreview(shape, [prod("m", 10000, 1000, { categories: ["accessories"] })]).rows[0];
  ok(merchRow.floorMinor === merchFloor && merchFloor !== floor1000, "merch floor");

  // Fixed amount off.
  const fixed: GuardRuleShape = { discountType: "fixed", discountPercent: 0, discountFixed: 500, config: {} };
  ok(buildPromoPreview(fixed, [prod("f", 3000, null)]).rows[0].lowestMinor === 2500, "fixed: lowest = price - amount");

  // Duplicate keys judged once; within OK, smallest headroom first.
  const dup = buildPromoPreview(shape, [prod("a", 10000, 1000), prod("a", 1, 1000)]);
  ok(dup.total === 1 && dup.rows[0].priceMinor === 10000, "duplicate key judged once (first wins)");
  const order = buildPromoPreview(shape, [prod("wide", 20000, 1000), prod("tight", 5000, 1000)]);
  ok(order.rows[0].key === "tight", "OK rows: closest to the floor first");
  ok(buildPromoPreview(shape, []).total === 0, "empty");

  // Schedule summary.
  const now = "2026-11-20T18:00:00.000Z"; // Fri Nov 20 2026 10:00 AM PT
  const base: ScheduleInput = { status: "draft", weekday: null, startsAt: null, endsAt: null };
  const wk = promoScheduleSummary({ ...base, weekday: 4 }, now);
  ok(wk.state === "weekday" && /every Thursday/.test(wk.text) && wk.warnings.length === 0, "weekday");
  const wkDates = promoScheduleSummary({ ...base, weekday: 4, startsAt: "2026-12-01T08:00:00.000Z" }, now);
  ok(wkDates.warnings.some((w) => /weekday AND dates/.test(w)), "weekday + dates warns");
  const always = promoScheduleSummary(base, now);
  ok(always.state === "always_on" && /every day/.test(always.text), "always on");
  const later = promoScheduleSummary({ ...base, startsAt: "2026-11-27T17:00:00.000Z", endsAt: "2026-11-30T07:59:00.000Z" }, now);
  ok(later.state === "starts_later", "starts later");
  ok(/Fri Nov 27, 2026 at 9:00 AM PT/.test(later.text) && /in 7 days/.test(later.text), "go-live time in Pacific");
  ok(/stops Sun Nov 29, 2026 at 11:59 PM PT/.test(later.text), "stop time in Pacific");
  const running = promoScheduleSummary({ ...base, startsAt: "2026-11-01T17:00:00.000Z" }, now);
  ok(running.state === "running" && /as soon as it is published/.test(running.text), "running");
  const ended = promoScheduleSummary({ ...base, endsAt: "2026-11-19T07:59:00.000Z" }, now);
  ok(ended.state === "ended" && ended.warnings.some((w) => /changes nothing/.test(w)), "ended warns");
  const legacy = promoScheduleSummary({ ...base, status: "scheduled" }, now);
  ok(legacy.warnings.some((w) => /never goes live/.test(w)), "old Scheduled status warns");
  const bad = promoScheduleSummary({ ...base, startsAt: "garbage" }, now);
  ok(bad.warnings.some((w) => /could not be read/.test(w)), "unreadable date warns");

  // Schedule gate.
  const future = { ...base, startsAt: "2026-11-27T17:00:00.000Z" };
  const g = scheduleGate(future, now);
  ok(g.ok && g.startsAt === "2026-11-27T17:00:00.000Z", "future start can be scheduled");
  ok(!scheduleGate({ ...future, status: "published" }, now).ok, "already published refused");
  ok(!scheduleGate({ ...future, weekday: 4 }, now).ok, "weekday deal refused");
  ok(!scheduleGate(base, now).ok, "no start refused");
  ok(!scheduleGate({ ...base, startsAt: now }, now).ok, "start == now refused");
  ok(!scheduleGate({ ...base, startsAt: "2026-11-20T17:00:00.000Z" }, now).ok, "past start refused");
  ok(!scheduleGate({ ...future, endsAt: "2026-11-27T17:00:00.000Z" }, now).ok, "end == start refused");
  ok(!scheduleGate({ ...future, endsAt: "nope" }, now).ok, "unreadable end refused");
  ok(scheduleGate({ ...future, endsAt: "2026-11-28T08:00:00.000Z" }, now).ok, "end after start ok");
  ok(scheduleGate({ ...future, status: "scheduled" }, now).ok, "old Scheduled status can be re-scheduled");

  // Window parsing (Pacific wall time -> UTC).
  const w = parsePromoWindow("2026-11-27T09:00", "2026-11-29T23:59");
  ok(w.ok && w.startsAt === "2026-11-27T17:00:00.000Z" && w.endsAt === "2026-11-30T07:59:00.000Z", "PST conversion");
  const summer = parsePromoWindow("2026-07-04T09:00", "");
  ok(summer.ok && summer.startsAt === "2026-07-04T16:00:00.000Z" && summer.endsAt === null, "PDT conversion, blank end");
  const blank = parsePromoWindow("", " ");
  ok(blank.ok && blank.startsAt === null && blank.endsAt === null, "blank = no limit");
  const badS = parsePromoWindow("2026-02-30T09:00", "");
  ok(!badS.ok && /Starts/.test(badS.error), "impossible start refused");
  const badE = parsePromoWindow("", "tomorrow");
  ok(!badE.ok && /Ends/.test(badE.error), "garbage end refused");
  const rev = parsePromoWindow("2026-11-27T09:00", "2026-11-27T09:00");
  ok(!rev.ok && /after Starts/.test(rev.error), "end not after start refused");

  return { passed, failed };
}
