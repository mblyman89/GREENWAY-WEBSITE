/**
 * src/lib/inventory/count-time-core.ts   (Fix Phase 4.5c · G-40 / G-41 · D58)
 *
 * MINUTES OF COUNTING TIME, not just lots. PURE: no I/O, no clock.
 *
 * The owner (D58): "a vendor per day, broken into chunks if a large vendor"
 * and a large vendor "is split into chunks one employee can finish in a
 * session". A session is TIME, so the planner should let him say "about 45
 * minutes" and turn that into lots, and show the minutes beside every lot size.
 *
 * WHERE THE RATE COMES FROM (never invented)
 *   1. MEASURED: every finished count since 0326 records when the counter
 *      claimed it (claimed_at) and pressed I'm done (submitted_at), and how many
 *      lots it held. Minutes per lot is the MEDIAN over the recent finished
 *      counts (median, so one count left open over lunch does not skew it),
 *      once there are at least MIN_MEASURED_COUNTS of them. Counts shorter than
 *      a minute or longer than 8 hours, or with no lots, are left out (a
 *      claimed-then-forgotten count is not a pace).
 *   2. THE OWNER'S SETTING: until then, the minutes per lot he sets on Plan a
 *      count → Vendor of the day (site setting `count_pace`). The screen says
 *      plainly which one is in use.
 *   3. If neither exists the starting value is DEFAULT_MINUTES_PER_LOT, shown
 *      as "a starting guess; set your own or count a few times".
 *
 * Lots stay the stored unit (the generators and the full-count plan work in
 * lots); minutes are converted at the edge, so nothing downstream changes.
 */

export const MIN_MEASURED_COUNTS = 3;
export const PACE_LOOKBACK_COUNTS = 20;
/** Starting guess only, labelled as such on screen until replaced. */
export const DEFAULT_MINUTES_PER_LOT = 1;
export const MIN_MINUTES_PER_LOT = 0.2;
export const MAX_MINUTES_PER_LOT = 15;
export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 480;
export const PACE_SETTING_KEY = "count_pace";

export type FinishedCount = {
  /** ISO instant the counter claimed it. */
  claimedAt: string | null;
  /** ISO instant I'm done was pressed. */
  submittedAt: string | null;
  /** Lots on the count. */
  lots: number;
};

export type PaceSource = "measured" | "owner" | "default";

export type CountPace = {
  minutesPerLot: number;
  source: PaceSource;
  /** How many finished counts the measured pace came from (0 unless measured). */
  sample: number;
};

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** Round to one decimal (0.1 minute is plenty of precision for a plan). */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function checkMinutesPerLot(raw: unknown): Checked<number> {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n < MIN_MINUTES_PER_LOT || n > MAX_MINUTES_PER_LOT) {
    return { ok: false, message: `Minutes per lot is a number from ${MIN_MINUTES_PER_LOT} to ${MAX_MINUTES_PER_LOT}. Nothing was saved.` };
  }
  return { ok: true, value: r1(n) };
}

export function checkSessionMinutes(raw: unknown): Checked<number> {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < MIN_SESSION_MINUTES || n > MAX_SESSION_MINUTES) {
    return { ok: false, message: `Minutes is a whole number from ${MIN_SESSION_MINUTES} to ${MAX_SESSION_MINUTES}.` };
  }
  return { ok: true, value: n };
}

/** The owner's saved rate from the site setting, or null. Never trusts junk. */
export function paceFromSetting(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const c = checkMinutesPerLot((value as Record<string, unknown>).minutesPerLot);
  return c.ok ? c.value : null;
}

/** Minutes per lot of one finished count, or null when it is not a usable pace. */
export function countMinutesPerLot(c: FinishedCount): number | null {
  if (!c.claimedAt || !c.submittedAt || !Number.isInteger(c.lots) || c.lots <= 0) return null;
  const a = Date.parse(c.claimedAt);
  const b = Date.parse(c.submittedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const minutes = (b - a) / 60_000;
  if (minutes < 1 || minutes > 480) return null;
  return minutes / c.lots;
}

/**
 * The pace to plan with. `finished` should be newest first; only the most
 * recent PACE_LOOKBACK_COUNTS usable counts are used.
 */
export function resolvePace(finished: readonly FinishedCount[], ownerMinutesPerLot: number | null): CountPace {
  const rates: number[] = [];
  for (const c of finished) {
    const r = countMinutesPerLot(c);
    if (r !== null) rates.push(r);
    if (rates.length >= PACE_LOOKBACK_COUNTS) break;
  }
  if (rates.length >= MIN_MEASURED_COUNTS) {
    const s = [...rates].sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    const median = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
    const clamped = Math.min(MAX_MINUTES_PER_LOT, Math.max(MIN_MINUTES_PER_LOT, median));
    return { minutesPerLot: r1(clamped), source: "measured", sample: rates.length };
  }
  if (ownerMinutesPerLot !== null) return { minutesPerLot: ownerMinutesPerLot, source: "owner", sample: rates.length };
  return { minutesPerLot: DEFAULT_MINUTES_PER_LOT, source: "default", sample: rates.length };
}

/** Lots that fit in `minutes`, clamped to the caller's lot range. */
export function lotsForMinutes(minutes: number, pace: CountPace, minLots: number, maxLots: number): number {
  const raw = Math.floor(minutes / pace.minutesPerLot);
  return Math.min(maxLots, Math.max(minLots, raw));
}

/** About how many minutes `lots` take, whole minutes, at least 1. */
export function minutesForLots(lots: number, pace: CountPace): number {
  if (!Number.isFinite(lots) || lots <= 0) return 0;
  return Math.max(1, Math.round(lots * pace.minutesPerLot));
}

/** "about 45 minutes" / "about 1 h 30 min". */
export function formatMinutes(m: number): string {
  if (m < 60) return `about ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `about ${h} h` : `about ${h} h ${rest} min`;
}

/** The one sentence the screens show about where the rate comes from. */
export function paceSentence(p: CountPace): string {
  const rate = `${p.minutesPerLot} minute${p.minutesPerLot === 1 ? "" : "s"} a lot`;
  if (p.source === "measured") return `${rate}, measured from your last ${p.sample} finished counts (start to I'm done).`;
  if (p.source === "owner") {
    return `${rate}, your setting. After ${MIN_MEASURED_COUNTS} finished counts the app uses your store's own measured pace (${p.sample} so far).`;
  }
  return `${rate}, a starting guess. Set your own on Plan a count \u2192 Vendor of the day, or finish ${MIN_MEASURED_COUNTS} counts and the app measures it (${p.sample} so far).`;
}

// ---------------------------------------------------------------------------
// Self-tests (pure)
// ---------------------------------------------------------------------------

export function __runCountTimeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL count-time-core: ${name}`);
    }
  };
  const fc = (mins: number, lots: number): FinishedCount => ({
    claimedAt: "2026-10-01T16:00:00.000Z",
    submittedAt: new Date(Date.parse("2026-10-01T16:00:00.000Z") + mins * 60_000).toISOString(),
    lots,
  });

  ok(countMinutesPerLot(fc(30, 20)) === 1.5, "30 minutes for 20 lots is 1.5 a lot");
  ok(countMinutesPerLot(fc(0.5, 20)) === null && countMinutesPerLot(fc(600, 20)) === null, "under a minute or over 8 hours is not a pace");
  ok(countMinutesPerLot({ claimedAt: null, submittedAt: "2026-10-01T16:00:00Z", lots: 5 }) === null, "never claimed is not a pace");
  ok(countMinutesPerLot(fc(30, 0)) === null, "no lots is not a pace");

  const d = resolvePace([], null);
  ok(d.source === "default" && d.minutesPerLot === DEFAULT_MINUTES_PER_LOT, "nothing known: the labelled starting guess");
  const o = resolvePace([fc(30, 20), fc(30, 20)], 2);
  ok(o.source === "owner" && o.minutesPerLot === 2 && o.sample === 2, "two counts: still the owner's setting");
  const m = resolvePace([fc(30, 20), fc(60, 20), fc(20, 20), fc(600, 5)], 2);
  ok(m.source === "measured" && m.minutesPerLot === 1.5 && m.sample === 3, "three usable counts: the median, outlier left out");
  const even = resolvePace([fc(20, 20), fc(40, 20), fc(30, 20), fc(60, 20)], null);
  ok(even.minutesPerLot === 1.8, "even sample: mean of the middle two (1.5, 2) rounded to 0.1");

  ok(lotsForMinutes(45, { minutesPerLot: 1.5, source: "owner", sample: 0 }, 5, 200) === 30, "45 minutes at 1.5 is 30 lots");
  ok(lotsForMinutes(2, { minutesPerLot: 1.5, source: "owner", sample: 0 }, 5, 200) === 5, "clamped to the minimum");
  ok(lotsForMinutes(480, { minutesPerLot: 0.5, source: "owner", sample: 0 }, 10, 300) === 300, "clamped to the maximum");
  ok(minutesForLots(60, { minutesPerLot: 1.5, source: "owner", sample: 0 }) === 90, "60 lots at 1.5 is 90 minutes");
  ok(minutesForLots(1, { minutesPerLot: 0.2, source: "owner", sample: 0 }) === 1, "at least a minute");
  ok(formatMinutes(45) === "about 45 minutes" && formatMinutes(90) === "about 1 h 30 min" && formatMinutes(120) === "about 2 h", "format");

  ok(checkMinutesPerLot("1.25").ok && (checkMinutesPerLot("1.25") as { value: number }).value === 1.3, "rate rounded to 0.1");
  ok(!checkMinutesPerLot("0").ok && !checkMinutesPerLot("abc").ok && !checkMinutesPerLot(99).ok, "bad rates refused");
  ok(checkSessionMinutes("45").ok && !checkSessionMinutes("4").ok && !checkSessionMinutes("45.5").ok, "session minutes band");
  ok(paceFromSetting({ minutesPerLot: 2 }) === 2 && paceFromSetting({ minutesPerLot: "x" }) === null && paceFromSetting(null) === null, "setting parsed safely");
  ok(paceSentence(m).includes("measured from your last 3 finished counts"), "sentence names the measurement");
  ok(paceSentence(d).includes("a starting guess"), "sentence names the guess");
  return { passed, failed };
}
