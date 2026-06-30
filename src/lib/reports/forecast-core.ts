/**
 * src/lib/reports/forecast-core.ts
 *
 * Pure, dependency-free demand forecasting for a single daily metric (revenue,
 * orders, or units). No I/O, no `server-only` — safe to import anywhere and to
 * exercise from tsx test scripts.
 *
 * Method (classical time-series decomposition — an industry-standard, fully
 * explainable approach in the Holt-Winters / seasonal-naive family):
 *
 *   1. Build a contiguous daily series (gap-fill missing days with 0 so closed
 *      days are represented honestly).
 *   2. Estimate multiplicative DAY-OF-WEEK seasonal indices (Mon..Sun), each
 *      normalized so the seven average to 1.0. Cannabis retail has a strong,
 *      stable weekly rhythm, so a weekly seasonal model is appropriate.
 *   3. Deseasonalize the series, fit a damped LINEAR TREND by least squares,
 *      and blend it with a recent EXPONENTIALLY-SMOOTHED level so the forecast
 *      tracks the latest momentum without overreacting to a single spike.
 *   4. Forecast h days ahead = level/trend projection × that day's seasonal
 *      index. Attach symmetric PREDICTION INTERVALS from the residual standard
 *      deviation (≈80% band at ±1.28σ, ≈95% at ±1.96σ), widening with horizon.
 *   5. Backtest on a holdout to report accuracy (MAPE / MAE / bias) so the
 *      forecast is honestly "rated" rather than presented as gospel.
 *
 * Everything is in the metric's native units (minor units for money, integer
 * counts for orders/units). Rounding to whole units is the caller's choice.
 */

export type DailyObservation = { date: string; value: number }; // date = YYYY-MM-DD

export type ForecastPoint = {
  date: string; // YYYY-MM-DD (Pacific calendar day)
  dow: number; // 0=Sun..6=Sat
  mean: number; // point forecast
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
};

export type ForecastAccuracy = {
  /** Mean absolute percentage error on the backtest holdout (0..1+, lower is better). Null if not computable. */
  mape: number | null;
  /** Mean absolute error on the holdout (native units). */
  mae: number | null;
  /** Mean signed error (bias): positive = model under-forecasts. */
  bias: number | null;
  /** Days held out for the backtest. */
  holdoutDays: number;
  /** A friendly grade derived from MAPE. */
  grade: "excellent" | "good" | "fair" | "weak" | "insufficient-data";
};

export type ForecastResult = {
  /** True when there was enough history to produce a meaningful forecast. */
  hasForecast: boolean;
  /** Reason when hasForecast is false. */
  note?: string;
  /** Multiplicative day-of-week indices, index 0=Sun..6=Sat (avg = 1.0). */
  dowIndex: number[];
  /** Per-day trend slope (deseasonalized native units per day). */
  trendPerDay: number;
  /** Smoothed current level (deseasonalized). */
  level: number;
  /** Residual standard deviation used for the intervals. */
  sigma: number;
  /** The forecast horizon. */
  points: ForecastPoint[];
  /** Sum of the point forecasts over the horizon. */
  horizonTotal: number;
  /** Accuracy from the backtest. */
  accuracy: ForecastAccuracy;
  /** Days of usable history fed to the model. */
  historyDays: number;
};

const MS_DAY = 86400000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse YYYY-MM-DD to a UTC-noon Date (noon avoids DST edge surprises). */
function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Day-of-week for a YYYY-MM-DD (0=Sun..6=Sat), Gregorian. */
export function dowOf(ymd: string): number {
  return parseYmd(ymd).getUTCDay();
}

function addDays(ymd: string, n: number): string {
  return toYmd(new Date(parseYmd(ymd).getTime() + n * MS_DAY));
}

/**
 * Build a contiguous daily series from possibly-sparse observations. Missing
 * calendar days between the first and last observation are filled with 0.
 */
export function buildContiguousSeries(obs: DailyObservation[]): DailyObservation[] {
  if (obs.length === 0) return [];
  const sorted = [...obs].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((o) => [o.date, o.value]));
  const out: DailyObservation[] = [];
  let cur = sorted[0].date;
  const end = sorted[sorted.length - 1].date;
  // Guard against pathological inputs.
  let guard = 0;
  while (cur <= end && guard < 100000) {
    out.push({ date: cur, value: byDate.get(cur) ?? 0 });
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

/** Multiplicative day-of-week indices (0=Sun..6=Sat), normalized to mean 1.0. */
function computeDowIndex(series: DailyObservation[]): number[] {
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const o of series) {
    const d = dowOf(o.date);
    sums[d] += o.value;
    counts[d] += 1;
  }
  const overallMean =
    series.reduce((a, o) => a + o.value, 0) / Math.max(1, series.length);
  if (overallMean <= 0) return new Array(7).fill(1);
  const raw = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] / overallMean : 1));
  // Normalize so the seven indices average exactly 1.0.
  const avg = raw.reduce((a, b) => a + b, 0) / 7;
  if (avg <= 0) return new Array(7).fill(1);
  return raw.map((r) => r / avg);
}

/** Ordinary least squares slope+intercept for y over x = 0..n-1. */
function ols(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

/** Exponentially-smoothed level (returns the final smoothed value). */
function smoothLevel(values: number[], alpha = 0.3): number {
  if (values.length === 0) return 0;
  let level = values[0];
  for (let i = 1; i < values.length; i++) {
    level = alpha * values[i] + (1 - alpha) * level;
  }
  return level;
}

type Model = {
  dowIndex: number[];
  slope: number;
  intercept: number;
  level: number;
  nTrain: number;
};

/** Fit the decomposition model on a deseasonalized series. */
function fitModel(series: DailyObservation[]): Model {
  const dowIndex = computeDowIndex(series);
  const deseason = series.map((o) => {
    const idx = dowIndex[dowOf(o.date)] || 1;
    return idx > 0 ? o.value / idx : o.value;
  });
  const { slope, intercept } = ols(deseason);
  // Blend the smoothed recent level with the regression's end value so we
  // track momentum without chasing a single spike.
  const regEnd = intercept + slope * (deseason.length - 1);
  const smoothed = smoothLevel(deseason, 0.3);
  const level = 0.5 * regEnd + 0.5 * smoothed;
  return { dowIndex, slope, intercept, level, nTrain: series.length };
}

/** In-sample residual standard deviation of the fitted model. */
function residualSigma(series: DailyObservation[], model: Model): number {
  if (series.length < 3) return 0;
  let sumSq = 0;
  for (let i = 0; i < series.length; i++) {
    const idx = model.dowIndex[dowOf(series[i].date)] || 1;
    const fittedDeseason = model.intercept + model.slope * i;
    const fitted = fittedDeseason * idx;
    const r = series[i].value - fitted;
    sumSq += r * r;
  }
  return Math.sqrt(sumSq / Math.max(1, series.length - 2));
}

/**
 * Backtest: refit on all-but-last `holdout` days, forecast that window, and
 * measure error against the held-out actuals.
 */
function backtest(series: DailyObservation[], holdout: number): ForecastAccuracy {
  if (series.length < holdout + 14) {
    return { mape: null, mae: null, bias: null, holdoutDays: 0, grade: "insufficient-data" };
  }
  const train = series.slice(0, series.length - holdout);
  const test = series.slice(series.length - holdout);
  const model = fitModel(train);
  let absErr = 0;
  let absPct = 0;
  let pctCount = 0;
  let signed = 0;
  for (let h = 0; h < test.length; h++) {
    const idx = model.dowIndex[dowOf(test[h].date)] || 1;
    const deseason = model.level + model.slope * (h + 1);
    const pred = Math.max(0, deseason * idx);
    const actual = test[h].value;
    absErr += Math.abs(pred - actual);
    signed += actual - pred;
    if (actual > 0) {
      absPct += Math.abs(pred - actual) / actual;
      pctCount++;
    }
  }
  const mae = absErr / test.length;
  const mape = pctCount > 0 ? absPct / pctCount : null;
  const bias = signed / test.length;
  let grade: ForecastAccuracy["grade"] = "weak";
  if (mape === null) grade = "weak";
  else if (mape <= 0.1) grade = "excellent";
  else if (mape <= 0.2) grade = "good";
  else if (mape <= 0.35) grade = "fair";
  else grade = "weak";
  return { mape, mae, bias, holdoutDays: test.length, grade };
}

const Z80 = 1.2816;
const Z95 = 1.96;

/**
 * Produce an h-day-ahead forecast for a daily metric.
 *
 * @param obs       Historical daily observations (sparse OK; gap-filled to 0).
 * @param horizon   Days to forecast ahead (default 14).
 * @param minHistory Minimum usable days required (default 21 = 3 weeks).
 */
export function forecastDaily(
  obs: DailyObservation[],
  horizon = 14,
  minHistory = 21,
): ForecastResult {
  const series = buildContiguousSeries(obs);
  const empty: ForecastResult = {
    hasForecast: false,
    dowIndex: new Array(7).fill(1),
    trendPerDay: 0,
    level: 0,
    sigma: 0,
    points: [],
    horizonTotal: 0,
    accuracy: { mape: null, mae: null, bias: null, holdoutDays: 0, grade: "insufficient-data" },
    historyDays: series.length,
  };

  if (series.length < minHistory) {
    return {
      ...empty,
      note: `Need at least ${minHistory} days of history to forecast; have ${series.length}.`,
    };
  }

  const model = fitModel(series);
  const sigma = residualSigma(series, model);
  // Backtest on the last min(14, ~25% of history) days.
  const holdout = Math.min(14, Math.max(7, Math.floor(series.length * 0.25)));
  const accuracy = backtest(series, holdout);

  const lastDate = series[series.length - 1].date;
  const points: ForecastPoint[] = [];
  let horizonTotal = 0;
  for (let h = 1; h <= horizon; h++) {
    const date = addDays(lastDate, h);
    const dow = dowOf(date);
    const idx = model.dowIndex[dow] || 1;
    const deseason = model.level + model.slope * h;
    const mean = Math.max(0, deseason * idx);
    // Intervals widen with the square root of the horizon (random-walk-ish).
    const spread = sigma * Math.sqrt(h);
    const lower80 = Math.max(0, mean - Z80 * spread);
    const upper80 = mean + Z80 * spread;
    const lower95 = Math.max(0, mean - Z95 * spread);
    const upper95 = mean + Z95 * spread;
    points.push({ date, dow, mean, lower80, upper80, lower95, upper95 });
    horizonTotal += mean;
  }

  return {
    hasForecast: true,
    dowIndex: model.dowIndex,
    trendPerDay: model.slope,
    level: model.level,
    sigma,
    points,
    horizonTotal,
    accuracy,
    historyDays: series.length,
  };
}

/* ------------------------------------------------------------------------- */
/* Pure self-tests (run via tsx).                                            */
/* ------------------------------------------------------------------------- */

export function __runForecastTests(): { passed: number; failed: number; messages: string[] } {
  const messages: string[] = [];
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean, extra?: string) => {
    if (cond) passed++;
    else {
      failed++;
      messages.push(`FAIL ${name}${extra ? `: ${extra}` : ""}`);
    }
  };

  // dowOf sanity: 2024-01-07 is a Sunday.
  ok("dowOf Sunday", dowOf("2024-01-07") === 0, `got ${dowOf("2024-01-07")}`);
  ok("dowOf Monday", dowOf("2024-01-08") === 1, `got ${dowOf("2024-01-08")}`);

  // Gap fill: 3-day span with a hole becomes contiguous with 0 in the middle.
  const filled = buildContiguousSeries([
    { date: "2024-01-01", value: 10 },
    { date: "2024-01-03", value: 30 },
  ]);
  ok("gapfill length", filled.length === 3, `got ${filled.length}`);
  ok("gapfill hole is 0", filled[1].date === "2024-01-02" && filled[1].value === 0);

  // Build 12 weeks of synthetic data: trend up + strong weekend seasonality.
  const obs: DailyObservation[] = [];
  let day = "2024-01-01"; // Monday
  for (let i = 0; i < 84; i++) {
    const d = dowOf(day);
    const weekendBoost = d === 5 || d === 6 || d === 0 ? 1.6 : 1.0; // Fri/Sat/Sun busy
    const base = 1000 + i * 5; // gentle upward trend
    obs.push({ date: day, value: Math.round(base * weekendBoost) });
    day = addDays(day, 1);
  }
  const f = forecastDaily(obs, 14);
  ok("has forecast", f.hasForecast);
  ok("history days", f.historyDays === 84, `got ${f.historyDays}`);
  ok("horizon length", f.points.length === 14, `got ${f.points.length}`);
  ok("positive trend detected", f.trendPerDay > 0, `slope ${f.trendPerDay.toFixed(2)}`);
  // Weekend index should exceed weekday index.
  const weekendIdx = (f.dowIndex[5] + f.dowIndex[6] + f.dowIndex[0]) / 3;
  const weekdayIdx = (f.dowIndex[1] + f.dowIndex[2] + f.dowIndex[3] + f.dowIndex[4]) / 4;
  ok("weekend > weekday seasonality", weekendIdx > weekdayIdx, `wknd ${weekendIdx.toFixed(2)} wkdy ${weekdayIdx.toFixed(2)}`);
  // Intervals are ordered and non-negative.
  const p = f.points[0];
  ok("interval ordering", p.lower95 <= p.lower80 && p.lower80 <= p.mean && p.mean <= p.upper80 && p.upper80 <= p.upper95);
  ok("intervals non-negative", p.lower95 >= 0 && p.lower80 >= 0);
  // Clean synthetic data should backtest well (MAPE small).
  ok("backtest computed", f.accuracy.mape !== null, `mape ${f.accuracy.mape}`);
  ok("backtest decent", (f.accuracy.mape ?? 1) < 0.2, `mape ${f.accuracy.mape}`);
  // dowIndex averages ~1.0.
  const idxAvg = f.dowIndex.reduce((a, b) => a + b, 0) / 7;
  ok("dowIndex avg ~1", Math.abs(idxAvg - 1) < 1e-6, `avg ${idxAvg}`);

  // Insufficient history.
  const short = forecastDaily(obs.slice(0, 10), 14);
  ok("insufficient history flagged", !short.hasForecast && !!short.note);

  return { passed, failed, messages };
}
