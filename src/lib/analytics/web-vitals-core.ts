/**
 * R59-S4 — real page-speed numbers from real visitors (Core Web Vitals).
 *
 * The public site measures each page load in the shopper's own browser
 * (Next's useReportWebVitals = Google's web-vitals library) and sends one
 * tiny beacon to /api/vitals when the page is hidden. Stored in
 * website_web_vitals (migration 0280). Same privacy rules as click counting:
 * no cookies, IP, user id or user-agent; nothing sent with Global Privacy
 * Control, on admin / no-track pages, or from staff previews.
 *
 * Google's thresholds (web.dev/articles/vitals, "good" / "poor" at p75):
 *   LCP  ≤ 2.5 s good, > 4 s poor        — main picture/text visible
 *   INP  ≤ 200 ms good, > 500 ms poor    — reacts to taps and clicks
 *   CLS  ≤ 0.1 good, > 0.25 poor         — page doesn't jump around
 *   FCP  ≤ 1.8 s good, > 3 s poor        — first thing on screen
 *   TTFB ≤ 0.8 s good, > 1.8 s poor      — server answers
 * The rating is recomputed here (never trusted from the browser).
 */
import { cleanClickPath, deviceFromWidth, pacificDay, type ClickDevice } from "./click-events-core";

export const VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];
export type VitalRating = "good" | "needs-improvement" | "poor";

export const VITAL_INFO: Record<VitalMetric, { label: string; plain: string; good: number; poor: number; unit: "ms" | "" ; core: boolean }> = {
  LCP: { label: "Largest Contentful Paint", plain: "Main picture / headline shows", good: 2500, poor: 4000, unit: "ms", core: true },
  INP: { label: "Interaction to Next Paint", plain: "Reacts when tapped or clicked", good: 200, poor: 500, unit: "ms", core: true },
  CLS: { label: "Cumulative Layout Shift", plain: "Page doesn't jump while loading", good: 0.1, poor: 0.25, unit: "", core: true },
  FCP: { label: "First Contentful Paint", plain: "First thing appears on screen", good: 1800, poor: 3000, unit: "ms", core: false },
  TTFB: { label: "Time to First Byte", plain: "Server starts answering", good: 800, poor: 1800, unit: "ms", core: false },
};

/** Value caps — identical to the CHECK constraint in migration 0280. */
export const VITAL_LIMITS = { maxMs: 120_000, maxCls: 50, page_path: 300, nav_type: 24, perBeacon: 6 } as const;
const NAV_TYPES = ["navigate", "reload", "back-forward", "back-forward-cache", "prerender", "restore"] as const;

export type VitalRow = {
  page_path: string;
  metric: VitalMetric;
  value: number;
  rating: VitalRating;
  device: ClickDevice;
  nav_type: string | null;
};
export type StoredVital = VitalRow & { occurred_at: string };

export function rateVital(metric: VitalMetric, value: number): VitalRating {
  const t = VITAL_INFO[metric];
  return value <= t.good ? "good" : value > t.poor ? "poor" : "needs-improvement";
}

/** One beacon = { page_path, device_width, nav_type?, metrics: [{ name, value }] } → rows (or []). */
export function normalizeVitalsBeacon(raw: unknown): VitalRow[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const r = raw as Record<string, unknown>;
  const page_path = cleanClickPath(r.page_path);
  if (!page_path || page_path.startsWith("/admin") || page_path.startsWith("/api")) return [];
  if (!Array.isArray(r.metrics)) return [];
  const device = deviceFromWidth(r.device_width);
  const nav = typeof r.nav_type === "string" && (NAV_TYPES as readonly string[]).includes(r.nav_type) ? r.nav_type : null;
  const seen = new Set<string>();
  const out: VitalRow[] = [];
  for (const m of r.metrics.slice(0, VITAL_LIMITS.perBeacon)) {
    if (!m || typeof m !== "object") continue;
    const name = (m as Record<string, unknown>).name;
    const value = (m as Record<string, unknown>).value;
    if (typeof name !== "string" || !(VITAL_METRICS as readonly string[]).includes(name) || seen.has(name)) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    const metric = name as VitalMetric;
    if (value > (metric === "CLS" ? VITAL_LIMITS.maxCls : VITAL_LIMITS.maxMs)) continue;
    seen.add(name);
    const v = metric === "CLS" ? Math.round(value * 10000) / 10000 : Math.round(value);
    out.push({ page_path, metric, value: v, rating: rateVital(metric, v), device, nav_type: nav });
  }
  return out;
}

/** 75th percentile (nearest-rank, as Google / CrUX report it). */
export function p75(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.75 * s.length) - 1)];
}

export type VitalStat = { metric: VitalMetric; p75: number | null; rating: VitalRating | null; samples: number; goodPct: number; poorPct: number };
export function vitalStat(metric: VitalMetric, rows: { metric: string; value: number }[]): VitalStat {
  const vals = rows.filter((r) => r.metric === metric).map((r) => Number(r.value)).filter(Number.isFinite);
  const p = p75(vals);
  const good = vals.filter((v) => rateVital(metric, v) === "good").length;
  const poor = vals.filter((v) => rateVital(metric, v) === "poor").length;
  const pct = (n: number) => (vals.length ? Math.round((n / vals.length) * 100) : 0);
  return { metric, p75: p, rating: p === null ? null : rateVital(metric, p), samples: vals.length, goodPct: pct(good), poorPct: pct(poor) };
}

/** Pages grouped by section ("/menu/product/x" → "/menu"), so small shops still get enough samples per row. */
export function pageGroup(path: string): string {
  const seg = path.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/";
}

export type VitalsSummary = {
  /** page loads measured (= LCP or TTFB samples, whichever is larger). */
  loads: number;
  overall: VitalStat[];
  byDevice: Record<ClickDevice, VitalStat[]>;
  /** null = not enough data; true = all three Core Web Vitals good at p75. */
  passes: boolean | null;
  pages: { path: string; loads: number; lcp: VitalStat; inp: VitalStat; cls: VitalStat }[];
  dailyLcp: { date: string; value: number }[];
};

export const VITALS_MIN_PAGE_SAMPLES = 5;

export function summarizeVitals(rows: StoredVital[], days: number, endMs: number): VitalsSummary {
  const stats = (rs: StoredVital[]) => VITAL_METRICS.map((m) => vitalStat(m, rs));
  const overall = stats(rows);
  const byDevice = {
    phone: stats(rows.filter((r) => r.device === "phone")),
    tablet: stats(rows.filter((r) => r.device === "tablet")),
    desktop: stats(rows.filter((r) => r.device === "desktop")),
  };
  const core = overall.filter((s) => VITAL_INFO[s.metric].core);
  // A verdict needs all three Core Web Vitals measured (INP only exists after a tap).
  const passes = core.some((s) => s.samples === 0) ? null : core.every((s) => s.rating === "good");
  const groups = new Map<string, StoredVital[]>();
  for (const r of rows) {
    const g = pageGroup(r.page_path);
    const arr = groups.get(g);
    if (arr) arr.push(r);
    else groups.set(g, [r]);
  }
  const pages = [...groups.entries()]
    .map(([path, rs]) => ({ path, loads: Math.max(rs.filter((r) => r.metric === "LCP").length, rs.filter((r) => r.metric === "TTFB").length), lcp: vitalStat("LCP", rs), inp: vitalStat("INP", rs), cls: vitalStat("CLS", rs) }))
    .sort((a, b) => (b.lcp.samples >= VITALS_MIN_PAGE_SAMPLES ? 1 : 0) - (a.lcp.samples >= VITALS_MIN_PAGE_SAMPLES ? 1 : 0) || (b.lcp.p75 ?? -1) - (a.lcp.p75 ?? -1))
    .slice(0, 15);
  const byDay = new Map<string, number[]>();
  for (const r of rows) if (r.metric === "LCP") {
    const d = pacificDay(r.occurred_at);
    const arr = byDay.get(d);
    if (arr) arr.push(r.value);
    else byDay.set(d, [r.value]);
  }
  const dailyLcp: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = pacificDay(endMs - i * 86_400_000);
    const p = p75(byDay.get(d) ?? []);
    dailyLcp.push({ date: d, value: p === null ? 0 : Math.round(p / 100) / 10 });
  }
  const lcpN = overall.find((s) => s.metric === "LCP")!.samples;
  const ttfbN = overall.find((s) => s.metric === "TTFB")!.samples;
  return { loads: Math.max(lcpN, ttfbN), overall, byDevice, passes, pages, dailyLcp };
}

/** "2.1 s", "180 ms", "0.04". */
export function fmtVital(metric: VitalMetric, v: number | null): string {
  if (v === null) return "—";
  if (metric === "CLS") return v.toFixed(2);
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runWebVitalsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  ✗ web-vitals: ${m}`);
    }
  };
  ok(rateVital("LCP", 2500) === "good" && rateVital("LCP", 2501) === "needs-improvement" && rateVital("LCP", 4001) === "poor", "LCP thresholds");
  ok(rateVital("INP", 200) === "good" && rateVital("INP", 501) === "poor", "INP thresholds");
  ok(rateVital("CLS", 0.1) === "good" && rateVital("CLS", 0.2) === "needs-improvement" && rateVital("CLS", 0.3) === "poor", "CLS thresholds");
  ok(rateVital("TTFB", 900) === "needs-improvement" && rateVital("FCP", 3100) === "poor", "FCP/TTFB thresholds");
  const rows = normalizeVitalsBeacon({
    page_path: "/menu?email=a@b.c#x",
    device_width: 390,
    nav_type: "navigate",
    metrics: [{ name: "LCP", value: 2310.7 }, { name: "CLS", value: 0.123456 }, { name: "LCP", value: 1 }, { name: "FID", value: 3 }, { name: "INP", value: -1 }, { name: "TTFB", value: 9e9 }],
  });
  ok(rows.length === 2 && rows[0].page_path === "/menu" && rows[0].value === 2311 && rows[0].rating === "good" && rows[0].device === "phone", "beacon: query stripped, rounded, rated, device");
  ok(rows[1].value === 0.1235 && rows[1].rating === "needs-improvement", "CLS kept to 4 decimals");
  ok(normalizeVitalsBeacon({ page_path: "/admin/x", metrics: [{ name: "LCP", value: 1 }] }).length === 0, "admin pages never stored");
  ok(normalizeVitalsBeacon({ page_path: "//evil", metrics: [{ name: "LCP", value: 1 }] }).length === 0 && normalizeVitalsBeacon(null).length === 0, "bad path / body dropped");
  ok(normalizeVitalsBeacon({ page_path: "/", nav_type: "weird", metrics: [{ name: "FCP", value: 5 }] })[0].nav_type === null, "unknown nav type → null");
  ok(p75([]) === null && p75([5]) === 5 && p75([1, 2, 3, 4]) === 3 && p75([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) === 8, "p75 nearest-rank");
  ok(pageGroup("/") === "/" && pageGroup("/menu/product/x") === "/menu" && pageGroup("/specials") === "/specials", "page groups");
  const now = Date.parse("2026-03-10T20:00:00Z");
  const at = new Date(now - 3600_000).toISOString();
  const mk = (metric: VitalMetric, value: number, device: ClickDevice = "desktop", page_path = "/"): StoredVital => ({ occurred_at: at, page_path, metric, value, rating: rateVital(metric, value), device, nav_type: null });
  const data = [mk("LCP", 1000), mk("LCP", 2000), mk("LCP", 3000, "phone", "/menu"), mk("LCP", 5000, "phone", "/menu"), mk("INP", 100), mk("CLS", 0.01), mk("TTFB", 300)];
  const s = summarizeVitals(data, 7, now);
  const lcp = s.overall.find((x) => x.metric === "LCP")!;
  ok(lcp.p75 === 3000 && lcp.rating === "needs-improvement" && lcp.samples === 4 && lcp.goodPct === 50 && lcp.poorPct === 25, "overall LCP stat");
  ok(s.byDevice.phone.find((x) => x.metric === "LCP")!.p75 === 5000 && s.byDevice.desktop.find((x) => x.metric === "LCP")!.p75 === 2000, "phone vs computer split");
  ok(s.passes === false && s.loads === 4, "fails CWV when LCP p75 not good; loads counted");
  ok(summarizeVitals([mk("LCP", 1000), mk("INP", 50), mk("CLS", 0)], 7, now).passes === true, "passes when all three good");
  ok(summarizeVitals([], 7, now).passes === null && summarizeVitals([mk("LCP", 1000)], 7, now).passes === null, "not enough data → null");
  ok(s.pages.length === 2 && s.pages[0].path === "/menu" && s.pages[0].loads === 2, "pages grouped, slowest first");
  ok(s.dailyLcp.length === 7 && s.dailyLcp[6].value === 3, "daily LCP p75 in seconds");
  ok(fmtVital("LCP", 2310) === "2.3 s" && fmtVital("INP", 180) === "180 ms" && fmtVital("CLS", 0.04) === "0.04" && fmtVital("LCP", null) === "—", "formatting");
  return { passed, failed };
}
