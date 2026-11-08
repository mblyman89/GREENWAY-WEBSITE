/**
 * src/lib/atm/atm-forecast-core.ts  (D209f, cockpit v2)
 *
 * PURE ATM throughput statistics and a "when will it run empty" forecast.
 * No I/O, no clock (today and the reading are passed in). Money in CENTS.
 *
 * Owner, verbatim (D209): "Charts/ graphs showing how much the atm goes
 * through on average, a forecaster for when it will be empty."
 *
 * THE FACTS IT STANDS ON (each already verified elsewhere, not re-decided):
 *   - `settlementTotalCents` is the cash the machine DISPENSED that day
 *     (atm-ui-core.ts AtmDispenseInput: every value a clean $20 multiple; the
 *     surcharge settles separately).
 *   - The current cash is PAI's live Terminal Status balance when there is
 *     one; otherwise the derived "last load minus settled since", which is a
 *     conservative UPPER bound (buildCashLoadsView). The forecast always says
 *     which one it started from.
 *
 * HONEST GAPS
 *   - A day with no settlement row is UNKNOWN, not $0, and is left out of the
 *     averages. Leaving it out can only raise the average, which brings the
 *     "empty" date EARLIER: the safe direction for someone deciding when to
 *     refill.
 *   - The forecast uses the weekday profile of the last 12 weeks (a Friday
 *     drains faster than a Tuesday). A weekday with fewer than 2 observations
 *     falls back to the overall daily average.
 *   - The range: "early" uses each weekday's high (75th percentile), "late"
 *     its low (25th percentile). It is a planning range, not a guarantee.
 */

export type DispenseDayIn = {
  settlementDate: string; // YYYY-MM-DD
  terminalId: string;
  withdrawalTrx: number | null;
  surchargeCents: number | null;
  settlementTotalCents: number | null;
};

export type DispenseDay = {
  date: string;
  dispensedCents: number;
  withdrawals: number | null;
  surchargeCents: number | null;
};

function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, calendar arithmetic only (no time zone). */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function finiteInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

/**
 * One row per day (several terminals or duplicate rows on a day are summed).
 * Only the given terminal when `terminalId` is set; a blank terminal on a row
 * is then skipped (not provably the same machine).
 */
export function dispenseDays(rows: readonly DispenseDayIn[], terminalId?: string | null): DispenseDay[] {
  const want = (terminalId ?? "").trim();
  const map = new Map<string, DispenseDay>();
  for (const r of rows) {
    if (!isYmd(r?.settlementDate)) continue;
    const term = (r.terminalId ?? "").trim();
    if (want !== "" && term !== want) continue;
    const cents = finiteInt(r.settlementTotalCents);
    if (cents === null || cents < 0) continue;
    const cur = map.get(r.settlementDate) ?? { date: r.settlementDate, dispensedCents: 0, withdrawals: null, surchargeCents: null };
    cur.dispensedCents += cents;
    const w = finiteInt(r.withdrawalTrx);
    if (w !== null) cur.withdrawals = (cur.withdrawals ?? 0) + w;
    const s = finiteInt(r.surchargeCents);
    if (s !== null) cur.surchargeCents = (cur.surchargeCents ?? 0) + s;
    map.set(r.settlementDate, cur);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type WeekdayStat = {
  dow: number;
  label: string;
  /** Mean dispensed per observed day (cents). */
  meanCents: number;
  p25Cents: number;
  p75Cents: number;
  observations: number;
};

export type DispenseStats = {
  /** Days used (with a settlement) in the stats window. */
  daysObserved: number;
  windowDays: number;
  /** Mean dispensed per observed day over the window (cents), null with no data. */
  avgDailyCents: number | null;
  medianDailyCents: number | null;
  maxDay: { date: string; cents: number } | null;
  totalCents: number;
  avgWithdrawalsPerDay: number | null;
  /** Mean cash per withdrawal (cents). */
  avgWithdrawalCents: number | null;
  avgSurchargePerDayCents: number | null;
  /** Weekday profile over the longer profile window. */
  weekdays: WeekdayStat[];
  /** Mean of the last 7 observed days vs the 7 before (pct), null when thin. */
  trendPct: number | null;
};

/** Throughput stats: the last `windowDays` for averages, the last `profileDays` for the weekday profile. */
export function dispenseStats(days: readonly DispenseDay[], todayYmd: string, windowDays = 30, profileDays = 84): DispenseStats {
  const from = shiftYmd(todayYmd, -windowDays);
  const pFrom = shiftYmd(todayYmd, -profileDays);
  const win = days.filter((d) => d.date >= from && d.date < todayYmd);
  const prof = days.filter((d) => d.date >= pFrom && d.date < todayYmd);
  const vals = win.map((d) => d.dispensedCents).sort((a, b) => a - b);
  const total = vals.reduce((a, b) => a + b, 0);
  let maxDay: { date: string; cents: number } | null = null;
  for (const d of win) if (!maxDay || d.dispensedCents > maxDay.cents) maxDay = { date: d.date, cents: d.dispensedCents };
  const wd = win.filter((d) => d.withdrawals !== null);
  const wTotal = wd.reduce((a, d) => a + (d.withdrawals ?? 0), 0);
  const wCash = wd.reduce((a, d) => a + d.dispensedCents, 0);
  const sd = win.filter((d) => d.surchargeCents !== null);

  const weekdays: WeekdayStat[] = DOW.map((label, dow) => {
    const v = prof.filter((d) => weekdayOf(d.date) === dow).map((d) => d.dispensedCents).sort((a, b) => a - b);
    return {
      dow,
      label,
      meanCents: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0,
      p25Cents: Math.round(quantile(v, 0.25)),
      p75Cents: Math.round(quantile(v, 0.75)),
      observations: v.length,
    };
  });

  const recent = [...win].slice(-7);
  const prior = [...win].slice(-14, -7);
  const mean = (a: readonly DispenseDay[]) => a.reduce((s, d) => s + d.dispensedCents, 0) / a.length;
  const trendPct = recent.length >= 4 && prior.length >= 4 && mean(prior) > 0 ? Math.round(((mean(recent) - mean(prior)) / mean(prior)) * 1000) / 10 : null;

  return {
    daysObserved: win.length,
    windowDays,
    avgDailyCents: vals.length ? Math.round(total / vals.length) : null,
    medianDailyCents: vals.length ? Math.round(quantile(vals, 0.5)) : null,
    maxDay,
    totalCents: total,
    avgWithdrawalsPerDay: wd.length ? Math.round((wTotal / wd.length) * 10) / 10 : null,
    avgWithdrawalCents: wTotal > 0 ? Math.round(wCash / wTotal) : null,
    avgSurchargePerDayCents: sd.length ? Math.round(sd.reduce((a, d) => a + (d.surchargeCents ?? 0), 0) / sd.length) : null,
    weekdays,
    trendPct,
  };
}

export type BalanceSource = "live" | "estimate" | "unknown";

export type DepletionPoint = {
  date: string;
  label: string;
  /** Projected cash at the END of this day (cents, floored at 0). */
  likelyCents: number;
  /** Faster draining (weekday p75). */
  earlyCents: number;
  /** Slower draining (weekday p25). */
  lateCents: number;
};

export type DepletionForecast = {
  hasForecast: boolean;
  /** Why there is no forecast, in plain words (when hasForecast is false). */
  reason: string | null;
  startCents: number | null;
  source: BalanceSource;
  /** First day projected. */
  startDate: string | null;
  points: DepletionPoint[];
  /** The day the likely path reaches the threshold (null = beyond the horizon). */
  likelyEmptyDate: string | null;
  earlyEmptyDate: string | null;
  lateEmptyDate: string | null;
  /** Whole days from today to likelyEmptyDate (0 = today), null beyond the horizon. */
  likelyDaysLeft: number | null;
  /** True when the likely empty date is today or already passed (estimate path). */
  urgent: boolean;
  /** The level counted as "empty" (cents). */
  thresholdCents: number;
  horizonDays: number;
};

/**
 * Walk the balance forward day by day using the weekday profile.
 *
 * `startDate` is the first day still to be dispensed: today for a live
 * reading (with `firstDayFraction` = the share of today's trade still to
 * come), or the day after the last settled day for the derived estimate.
 * `thresholdCents` is the level treated as empty (e.g. a reload floor);
 * default 0.
 */
export function forecastDepletion(input: {
  balanceCents: number | null;
  source: BalanceSource;
  startDate: string;
  todayYmd: string;
  stats: DispenseStats;
  firstDayFraction?: number;
  thresholdCents?: number;
  horizonDays?: number;
}): DepletionForecast {
  const threshold = Math.max(0, Math.trunc(input.thresholdCents ?? 0));
  const horizon = Math.max(1, Math.min(120, Math.trunc(input.horizonDays ?? 45)));
  const empty = (reason: string): DepletionForecast => ({
    hasForecast: false,
    reason,
    startCents: input.balanceCents,
    source: input.source,
    startDate: null,
    points: [],
    likelyEmptyDate: null,
    earlyEmptyDate: null,
    lateEmptyDate: null,
    likelyDaysLeft: null,
    urgent: false,
    thresholdCents: threshold,
    horizonDays: horizon,
  });
  if (input.balanceCents === null || !Number.isFinite(input.balanceCents) || input.source === "unknown") {
    return empty("There is no cash reading yet: no live PAI balance and not enough loads and settlements to estimate one.");
  }
  if (input.stats.avgDailyCents === null || input.stats.avgDailyCents <= 0) {
    return empty("There are no settled withdrawals in the last 30 days to learn the daily pace from.");
  }
  if (!isYmd(input.startDate) || !isYmd(input.todayYmd)) return empty("The start date could not be read.");

  const avg = input.stats.avgDailyCents;
  const byDow = new Map(input.stats.weekdays.map((w) => [w.dow, w]));
  const rate = (ymd: string, which: "mean" | "p25" | "p75") => {
    const w = byDow.get(weekdayOf(ymd));
    if (!w || w.observations < 2) return avg;
    return which === "mean" ? w.meanCents : which === "p25" ? w.p25Cents : w.p75Cents;
  };

  const frac0 = Math.max(0, Math.min(1, input.firstDayFraction ?? 1));
  let likely = Math.trunc(input.balanceCents);
  let early = likely;
  let late = likely;
  const points: DepletionPoint[] = [];
  let likelyEmpty: string | null = likely <= threshold ? input.startDate : null;
  let earlyEmpty: string | null = likelyEmpty;
  let lateEmpty: string | null = likelyEmpty;
  for (let i = 0; i < horizon; i += 1) {
    const d = shiftYmd(input.startDate, i);
    const f = i === 0 ? frac0 : 1;
    likely -= Math.round(rate(d, "mean") * f);
    early -= Math.round(rate(d, "p75") * f);
    late -= Math.round(rate(d, "p25") * f);
    if (likelyEmpty === null && likely <= threshold) likelyEmpty = d;
    if (earlyEmpty === null && early <= threshold) earlyEmpty = d;
    if (lateEmpty === null && late <= threshold) lateEmpty = d;
    points.push({
      date: d,
      label: `${DOW[weekdayOf(d)]} ${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`,
      likelyCents: Math.max(0, likely),
      earlyCents: Math.max(0, early),
      lateCents: Math.max(0, late),
    });
    if (lateEmpty !== null && i >= 2) break; // every path is empty; stop drawing
  }

  const dayDiff = (a: string, b: string) => {
    const [ya, ma, da] = a.split("-").map(Number);
    const [yb, mb, db] = b.split("-").map(Number);
    return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86_400_000);
  };
  const daysLeft = likelyEmpty === null ? null : Math.max(0, dayDiff(likelyEmpty, input.todayYmd));
  return {
    hasForecast: true,
    reason: null,
    startCents: Math.trunc(input.balanceCents),
    source: input.source,
    startDate: input.startDate,
    points,
    likelyEmptyDate: likelyEmpty,
    earlyEmptyDate: earlyEmpty,
    lateEmptyDate: lateEmpty,
    likelyDaysLeft: daysLeft,
    urgent: likelyEmpty !== null && likelyEmpty <= input.todayYmd,
    thresholdCents: threshold,
    horizonDays: horizon,
  };
}

export type DispenseHistoryRow = {
  date: string;
  label: string;
  /** null = no settlement that day (unknown, not $0). */
  dispensedCents: number | null;
  /** Mean of the last 7 observed days ending here (cents). */
  ma7Cents: number | null;
  withdrawals: number | null;
};

/** The last `days` calendar days for the bar chart, gaps kept as null. */
export function dispenseHistory(days: readonly DispenseDay[], todayYmd: string, span = 30): DispenseHistoryRow[] {
  const by = new Map(days.map((d) => [d.date, d]));
  const rows: DispenseHistoryRow[] = [];
  const recent: number[] = [];
  // Seed the moving average with the observed days just before the span.
  for (let i = span + 7; i > span; i -= 1) {
    const d = by.get(shiftYmd(todayYmd, -i));
    if (d) {
      recent.push(d.dispensedCents);
      if (recent.length > 7) recent.shift();
    }
  }
  for (let i = span; i >= 1; i -= 1) {
    const ymd = shiftYmd(todayYmd, -i);
    const d = by.get(ymd);
    if (d) {
      recent.push(d.dispensedCents);
      if (recent.length > 7) recent.shift();
    }
    rows.push({
      date: ymd,
      label: `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`,
      dispensedCents: d ? d.dispensedCents : null,
      ma7Cents: recent.length >= 3 ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null,
      withdrawals: d ? d.withdrawals : null,
    });
  }
  return rows;
}

/**
 * Share (0..1) of a typical day's sales that happens after hour:minute,
 * from a per-hour revenue profile. The current hour counts pro rata. With
 * no profile it is 1 (the whole day still to come: the cautious choice, it
 * makes the machine look emptier sooner, never later).
 */
export function shareOfDayRemaining(byHour: readonly { hour: number; revenueMinorUnits: number }[], hour: number, minute: number): number {
  let total = 0;
  let after = 0;
  for (const h of byHour) {
    const v = Math.max(0, h.revenueMinorUnits);
    total += v;
    if (h.hour > hour) after += v;
    else if (h.hour === hour) after += v * Math.max(0, Math.min(1, (60 - minute) / 60));
  }
  return total > 0 ? Math.max(0, Math.min(1, after / total)) : 1;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runAtmForecastTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      messages.push(label);
    }
  };

  ok(weekdayOf("2026-11-07") === 6, "2026-11-07 is a Saturday");
  ok(shiftYmd("2026-03-01", -1) === "2026-02-28", "calendar shift");

  // ── dispenseDays ──
  const raw: DispenseDayIn[] = [
    { settlementDate: "2026-11-01", terminalId: "T1", withdrawalTrx: 10, surchargeCents: 2500, settlementTotalCents: 100_000 },
    { settlementDate: "2026-11-01", terminalId: "T1", withdrawalTrx: 2, surchargeCents: 500, settlementTotalCents: 20_000 },
    { settlementDate: "2026-11-02", terminalId: "T2", withdrawalTrx: 9, surchargeCents: 0, settlementTotalCents: 90_000 },
    { settlementDate: "2026-11-03", terminalId: "", withdrawalTrx: 1, surchargeCents: 0, settlementTotalCents: 2_000 },
    { settlementDate: "bad", terminalId: "T1", withdrawalTrx: 1, surchargeCents: 0, settlementTotalCents: 2_000 },
    { settlementDate: "2026-11-04", terminalId: "T1", withdrawalTrx: null, surchargeCents: null, settlementTotalCents: null },
  ];
  const dd = dispenseDays(raw, "T1");
  ok(dd.length === 1 && dd[0].dispensedCents === 120_000 && dd[0].withdrawals === 12, "same-day rows summed, other terminals and blanks skipped");
  ok(dispenseDays(raw).length === 3, "no terminal filter keeps every day with a figure");
  ok(dispenseDays(raw).every((d) => d.date !== "2026-11-04"), "a null settlement is unknown, not $0");

  // ── dispenseStats ── 12 weeks: weekdays $400, Fri/Sat $800, two missing days.
  const today = "2026-11-07";
  const hist: DispenseDay[] = [];
  for (let i = 1; i <= 84; i += 1) {
    const d = shiftYmd(today, -i);
    if (i === 3 || i === 10) continue; // no settlement row -> unknown
    const dow = weekdayOf(d);
    const cents = dow === 5 || dow === 6 ? 80_000 : 40_000;
    hist.push({ date: d, dispensedCents: cents, withdrawals: cents / 10_000, surchargeCents: (cents / 10_000) * 250 });
  }
  const st = dispenseStats(hist, today);
  ok(st.daysObserved === 28, "30-day window minus two unknown days");
  ok(st.weekdays[5].meanCents === 80_000 && st.weekdays[2].meanCents === 40_000, "weekday profile");
  ok(st.avgWithdrawalCents === 10_000, "average withdrawal = cash / withdrawals");
  ok(st.avgDailyCents !== null && st.avgDailyCents > 40_000 && st.avgDailyCents < 80_000, "average sits between the weekday levels");
  ok(st.maxDay?.cents === 80_000, "max day");
  ok(st.trendPct !== null && Math.abs(st.trendPct) < 30, "trend is computed");
  ok(st.avgSurchargePerDayCents !== null && st.avgSurchargePerDayCents > 0, "surcharge per day");
  ok(dispenseStats([], today).avgDailyCents === null, "no data: null average, not $0");

  // ── forecastDepletion ──
  const fc = forecastDepletion({ balanceCents: 200_000, source: "live", startDate: today, todayYmd: today, stats: st, firstDayFraction: 0.5 });
  // Sat (half): 40k -> 160k; Sun 40k -> 120k; Mon 80k; Tue 40k; Wed 0 -> empty Wed 11-11.
  ok(fc.hasForecast && fc.points[0].likelyCents === 160_000, "live: only the rest of today is drawn");
  ok(fc.likelyEmptyDate === "2026-11-11" && fc.likelyDaysLeft === 4, "likely empty date and days left");
  ok(fc.earlyEmptyDate !== null && fc.earlyEmptyDate <= fc.likelyEmptyDate!, "early is not after likely");
  ok(fc.lateEmptyDate !== null && fc.lateEmptyDate >= fc.likelyEmptyDate!, "late is not before likely");
  ok(fc.points.every((p) => p.likelyCents >= 0 && p.earlyCents >= 0), "balance floored at 0");
  ok(!fc.urgent, "four days out is not urgent");
  const est = forecastDepletion({ balanceCents: 50_000, source: "estimate", startDate: "2026-11-05", todayYmd: today, stats: st });
  ok(est.urgent && est.likelyEmptyDate !== null && est.likelyEmptyDate < today, "estimate path can already be past empty: urgent");
  ok(est.likelyDaysLeft === 0, "past empty reads 0 days left");
  const thr = forecastDepletion({ balanceCents: 200_000, source: "live", startDate: today, todayYmd: today, stats: st, firstDayFraction: 0.5, thresholdCents: 80_000 });
  ok(thr.likelyEmptyDate === "2026-11-09", "a reload floor brings the date earlier");
  ok(!forecastDepletion({ balanceCents: null, source: "unknown", startDate: today, todayYmd: today, stats: st }).hasForecast, "no reading: no forecast");
  ok(!forecastDepletion({ balanceCents: 100, source: "live", startDate: today, todayYmd: today, stats: dispenseStats([], today) }).hasForecast, "no pace: no forecast");
  const big = forecastDepletion({ balanceCents: 100_000_000, source: "live", startDate: today, todayYmd: today, stats: st, horizonDays: 10 });
  ok(big.likelyEmptyDate === null && big.likelyDaysLeft === null && big.points.length === 10, "beyond the horizon says so");
  const zero = forecastDepletion({ balanceCents: 0, source: "live", startDate: today, todayYmd: today, stats: st });
  ok(zero.likelyEmptyDate === today && zero.urgent, "already empty");
  // thin weekday falls back to the average
  const thin = dispenseStats(hist.slice(0, 10), today); // hist is newest first
  const fThin = forecastDepletion({ balanceCents: 1_000_000, source: "live", startDate: today, todayYmd: today, stats: thin, horizonDays: 3 });
  ok(fThin.hasForecast && fThin.points.length === 3, "thin profile still forecasts");

  // ── dispenseHistory ──
  const h = dispenseHistory(hist, today, 30);
  ok(h.length === 30 && h[29].date === "2026-11-06", "30 days ending yesterday");
  ok(h.find((r) => r.date === shiftYmd(today, -3))!.dispensedCents === null, "a missing day is a gap");
  ok(h[0].ma7Cents !== null, "moving average seeded from before the span");

  // ── shareOfDayRemaining ──
  const prof = [
    { hour: 10, revenueMinorUnits: 100 },
    { hour: 11, revenueMinorUnits: 100 },
    { hour: 12, revenueMinorUnits: 200 },
  ];
  ok(shareOfDayRemaining(prof, 9, 0) === 1, "before the first sale hour: whole day to come");
  ok(shareOfDayRemaining(prof, 13, 0) === 0, "after the last sale hour: nothing to come");
  ok(shareOfDayRemaining(prof, 11, 30) === 0.625, "current hour counts pro rata (50 + 200 of 400)");
  ok(shareOfDayRemaining([], 15, 0) === 1, "no profile: cautious whole day");

  return { passed, failed, messages };
}
