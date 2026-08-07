/**
 * src/lib/promotions/thursday-planner-core.ts  (PR-P6)
 *
 * THURSDAY BRAND-SALE MULTI-WEEK PLANNER — the pure brain.
 *
 * Builds on PR-P5's one-click Thursday sale. Instead of setting one recurring
 * Thursday deal (which runs forever until you change it), the planner lets the
 * owner queue a DIFFERENT brand for each of the next several Thursdays. Each
 * week becomes its OWN one-off, DATE-WINDOWED promotion (weekday=null, a
 * starts/ends window covering exactly that one Pacific Thursday). Because the
 * discount engine's isActiveNow() treats a dated promotion as live only inside
 * its window, each week's deal turns on that Thursday and turns itself OFF at
 * end of day — so next week's brand takes over automatically. No manual
 * cleanup, and no risk of last week's brand lingering on sale.
 *
 * PURE by design (NO "server-only", NO DB): it only computes dates and
 * transforms/validates, so it runs in the tsx self-test harness and vitest.
 * The server action does the actual (draft) creation with all publish-time
 * CCRS guards intact — a planned week is created as a DRAFT, never auto-live.
 *
 * All date math is anchored to America/Los_Angeles (store time) via the
 * reports/timezone helpers, so "next Thursday" and the on/off window match the
 * store's wall clock and never drift on a UTC host.
 */
import {
  clampGuidedPercent,
  GUIDED_PERCENT_MIN,
} from "./guided-promotion-core";
import {
  addPacificDays,
  pacificToday,
  pacificWallTimeToUtcISO,
} from "@/lib/reports/timezone";

/** Thursday = 4 (0=Sun … 6=Sat), matching storeWeekday()/Date.getUTCDay(). */
export const THURSDAY_INDEX = 4;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Weekday (0=Sun..6=Sat) of a Pacific YYYY-MM-DD label (pure calendar math). */
function weekdayOfYmd(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/**
 * The next `count` Thursdays as Pacific YYYY-MM-DD labels, starting from the
 * upcoming Thursday. If `fromYmd` itself is a Thursday it is INCLUDED as the
 * first entry (today's Thursday is still schedulable). Deterministic; pass an
 * explicit `fromYmd` in tests.
 */
export function upcomingThursdays(count: number, fromYmd: string = pacificToday()): string[] {
  const n = Math.max(0, Math.min(52, Math.floor(count)));
  if (n === 0) return [];
  // Days until (or on) the next Thursday.
  const todayWd = weekdayOfYmd(fromYmd);
  const delta = (THURSDAY_INDEX - todayWd + 7) % 7; // 0 when today is Thursday
  const first = addPacificDays(fromYmd, delta);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(addPacificDays(first, i * 7));
  }
  return out;
}

/** The precise UTC on/off window for a single Pacific Thursday date. */
export function thursdayWindowUtc(ymd: string): { startsAtUtc: string; endsAtUtc: string } {
  return {
    startsAtUtc: pacificWallTimeToUtcISO(ymd, "start"),
    endsAtUtc: pacificWallTimeToUtcISO(ymd, "end"),
  };
}

/** Human label for a Pacific YYYY-MM-DD, e.g. "Aug 13". */
export function humanThursdayLabel(ymd: string): string {
  const [, mo, d] = ymd.split("-").map(Number);
  const m = MONTHS[mo - 1] ?? "?";
  return `${m} ${d}`;
}

/** One planned week the owner filled in on the planner. */
export type PlannedWeek = {
  /** Pacific YYYY-MM-DD of the Thursday. */
  ymd: string;
  /** Brand names picked for this week (as typed). */
  brands: string[];
  /** Percent off for this week; falls back to the plan default when ≤0. */
  percent?: number | null;
};

/** A ready-to-create DRAFT promotion for a single scheduled Thursday. */
export type PlannedDraft = {
  ymd: string;
  label: string;
  title: string;
  discountPercent: number;
  startsAtUtc: string;
  endsAtUtc: string;
  /** Canonical brand names (validated against the live menu). */
  brands: string[];
};

export type PlannedResult = {
  drafts: PlannedDraft[];
  /** Weeks that were skipped (no valid brand) or otherwise adjusted. */
  warnings: string[];
  /** Count of weeks with at least one valid brand → a draft. */
  scheduledCount: number;
  /** Count of weeks skipped entirely. */
  skippedCount: number;
};

function resolveBrands(
  picked: string[],
  menuBrands: string[],
): { valid: string[]; dropped: string[] } {
  const byLower = new Map<string, string>();
  for (const b of menuBrands) {
    const key = b.trim().toLowerCase();
    if (key) byLower.set(key, b);
  }
  const valid: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of picked) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const canonical = byLower.get(trimmed.toLowerCase());
    if (canonical) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        valid.push(canonical);
      }
    } else if (!dropped.includes(trimmed)) {
      dropped.push(trimmed);
    }
  }
  return { valid, dropped };
}

function titleFor(brands: string[], percent: number, label: string): string {
  const base = `Top Shelf Thursday (${label})`;
  if (brands.length === 1) return `${base} — ${brands[0]} ${percent}% off`;
  if (brands.length === 2) return `${base} — ${brands[0]} & ${brands[1]} ${percent}% off`;
  return `${base} — ${brands.length} brands ${percent}% off`;
}

/**
 * Turn a multi-week plan into ready-to-create DRAFTS, one per week that has at
 * least one brand on the live menu. Fail-safe: unknown brands are dropped (and
 * reported); a week with no valid brand is skipped (and reported); percents are
 * clamped to the guided range. Only Thursday dates are honoured (a non-Thursday
 * ymd is skipped with a warning — the UI only ever supplies Thursdays).
 */
export function buildPlannedPromotions(
  plan: PlannedWeek[],
  menuBrands: string[],
  defaultPercent: number,
): PlannedResult {
  const warnings: string[] = [];
  const drafts: PlannedDraft[] = [];
  const fallback = clampGuidedPercent(defaultPercent);
  let skipped = 0;

  for (const week of plan) {
    const label = humanThursdayLabel(week.ymd);

    if (weekdayOfYmd(week.ymd) !== THURSDAY_INDEX) {
      warnings.push(`${label} isn't a Thursday and was skipped.`);
      skipped++;
      continue;
    }

    const { valid, dropped } = resolveBrands(week.brands ?? [], menuBrands);
    if (dropped.length) {
      warnings.push(`${label}: skipped unknown brand(s): ${dropped.join(", ")}.`);
    }
    if (valid.length === 0) {
      // A week with nothing valid is simply left unscheduled — not an error.
      skipped++;
      continue;
    }

    const rawPercent = week.percent != null && week.percent > 0 ? week.percent : fallback;
    const percent = clampGuidedPercent(rawPercent);
    if (week.percent != null && week.percent > 0 && percent !== Math.round(week.percent)) {
      warnings.push(`${label}: percent adjusted to ${percent}% (allowed ${GUIDED_PERCENT_MIN}–90%).`);
    }

    const { startsAtUtc, endsAtUtc } = thursdayWindowUtc(week.ymd);
    drafts.push({
      ymd: week.ymd,
      label,
      title: titleFor(valid, percent, label),
      discountPercent: percent,
      startsAtUtc,
      endsAtUtc,
      brands: valid,
    });
  }

  if (drafts.length === 0) {
    warnings.push("No weeks were scheduled — pick at least one brand for at least one Thursday.");
  }

  return { drafts, warnings, scheduledCount: drafts.length, skippedCount: skipped };
}

// ---------------------------------------------------------------------------
// Embedded pure self-tests (run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------

export function __runThursdayPlannerTests(): { passed: number; failed: number } {
  const failures: string[] = [];
  let passed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed++;
    else failures.push(name);
  };

  const MENU = ["Fairwinds", "Avitas", "Dama", "Top Shelf Co"];

  // 1. upcomingThursdays: from a known Wednesday (2026-08-05 is a Wednesday).
  {
    // 2026-08-05 weekday check.
    const wd = weekdayOfYmd("2026-08-05");
    check("wd: 2026-08-05 is Wednesday(3)", wd === 3);
    const th = upcomingThursdays(3, "2026-08-05");
    check("upcoming: count 3", th.length === 3);
    check("upcoming: first is 2026-08-06 (Thu)", th[0] === "2026-08-06");
    check("upcoming: 7-day spacing", th[1] === "2026-08-13" && th[2] === "2026-08-20");
    check("upcoming: all Thursdays", th.every((d) => weekdayOfYmd(d) === THURSDAY_INDEX));
  }

  // 2. upcomingThursdays includes today when today IS Thursday.
  {
    const th = upcomingThursdays(2, "2026-08-06"); // 2026-08-06 is Thursday
    check("upcoming-today: first is today", th[0] === "2026-08-06");
    check("upcoming-today: next is +7", th[1] === "2026-08-13");
  }

  // 3. upcomingThursdays(0) → [].
  check("upcoming: zero → empty", upcomingThursdays(0, "2026-08-05").length === 0);

  // 4. thursdayWindowUtc: start < end, both ISO, same Pacific date.
  {
    const w = thursdayWindowUtc("2026-08-13");
    check("window: start before end", new Date(w.startsAtUtc).getTime() < new Date(w.endsAtUtc).getTime());
    check("window: start is ISO", w.startsAtUtc.endsWith("Z"));
    check("window: end is ISO", w.endsAtUtc.endsWith("Z"));
  }

  // 5. humanThursdayLabel.
  check("label: Aug 13", humanThursdayLabel("2026-08-13") === "Aug 13");
  check("label: Dec 3", humanThursdayLabel("2026-12-03") === "Dec 3");

  // 6. buildPlannedPromotions: happy multi-week, distinct brands.
  {
    const plan: PlannedWeek[] = [
      { ymd: "2026-08-06", brands: ["Avitas"], percent: 20 },
      { ymd: "2026-08-13", brands: ["Fairwinds"], percent: 25 },
      { ymd: "2026-08-20", brands: ["Dama"], percent: null },
    ];
    const r = buildPlannedPromotions(plan, MENU, 15);
    check("build: 3 drafts", r.drafts.length === 3);
    check("build: scheduledCount 3", r.scheduledCount === 3);
    check("build: week1 Avitas 20", r.drafts[0].brands.join() === "Avitas" && r.drafts[0].discountPercent === 20);
    check("build: week3 uses default 15", r.drafts[2].discountPercent === 15);
    check("build: each has a window", r.drafts.every((d) => !!d.startsAtUtc && !!d.endsAtUtc));
    check("build: each weekday null implied (dated)", r.drafts.every((d) => d.startsAtUtc < d.endsAtUtc));
    check("build: distinct dates", new Set(r.drafts.map((d) => d.ymd)).size === 3);
    check("build: title carries date label", r.drafts[1].title.includes("Aug 13"));
  }

  // 7. Unknown brand dropped + week with no valid brand skipped.
  {
    const plan: PlannedWeek[] = [
      { ymd: "2026-08-06", brands: ["Avitas", "Ghost"], percent: 20 },
      { ymd: "2026-08-13", brands: ["Nope"], percent: 20 },
    ];
    const r = buildPlannedPromotions(plan, MENU, 15);
    check("drop: one draft (week2 skipped)", r.drafts.length === 1);
    check("drop: skippedCount 1", r.skippedCount === 1);
    check("drop: week1 valid only Avitas", r.drafts[0].brands.join() === "Avitas");
    check("drop: warns Ghost", r.warnings.some((w) => w.includes("Ghost")));
  }

  // 8. Non-Thursday date is skipped with a warning.
  {
    const r = buildPlannedPromotions([{ ymd: "2026-08-05", brands: ["Avitas"], percent: 20 }], MENU, 15);
    check("nonthu: no drafts", r.drafts.length === 0);
    check("nonthu: warns not a Thursday", r.warnings.some((w) => w.includes("isn't a Thursday")));
  }

  // 9. Percent clamping in a week.
  {
    const r = buildPlannedPromotions([{ ymd: "2026-08-06", brands: ["Avitas"], percent: 500 }], MENU, 15);
    check("clamp: week percent 90", r.drafts[0]?.discountPercent === 90);
    check("clamp: warns adjusted", r.warnings.some((w) => w.includes("adjusted")));
  }

  // 10. Empty plan → warning, no drafts.
  {
    const r = buildPlannedPromotions([], MENU, 15);
    check("empty: no drafts", r.drafts.length === 0);
    check("empty: warns pick at least one", r.warnings.some((w) => w.toLowerCase().includes("no weeks")));
  }

  if (failures.length) {
    console.error("thursday-planner-core FAILURES:", failures.join("; "));
  }
  return { passed, failed: failures.length };
}
