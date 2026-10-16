/**
 * R59-S4 — Reports > Website > Page speed: REAL numbers from real shoppers
 * (website_web_vitals, migration 0280), scored the way Google scores them
 * (75th percentile against the Core Web Vitals thresholds).
 */
import { DayBarChart } from "@/components/admin/reports/Charts";
import { VITAL_INFO, VITAL_METRICS, VITALS_MIN_PAGE_SAMPLES, fmtVital, type VitalRating, type VitalStat, type VitalsSummary } from "@/lib/analytics/web-vitals-core";

const TONE: Record<VitalRating, { text: string; bg: string; label: string }> = {
  good: { text: "text-emerald-300", bg: "bg-emerald-400", label: "Good" },
  "needs-improvement": { text: "text-amber-300", bg: "bg-amber-400", label: "Needs work" },
  poor: { text: "text-rose-300", bg: "bg-rose-400", label: "Poor" },
};

function Pill({ s }: { s: VitalStat }) {
  if (!s.rating) return <span className="text-white/35">—</span>;
  const t = TONE[s.rating];
  return <span className={`font-bold tabular-nums ${t.text}`}>{fmtVital(s.metric, s.p75)}</span>;
}

function MetricCard({ s }: { s: VitalStat }) {
  const info = VITAL_INFO[s.metric];
  const t = s.rating ? TONE[s.rating] : null;
  const unit = (v: number) => (info.unit === "ms" ? (v >= 1000 ? `${v / 1000} s` : `${v} ms`) : String(v));
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-black text-white/80">
          {s.metric} {info.core ? <span className="ml-1 rounded bg-white/10 px-1 text-[10px] font-bold text-white/55">CORE</span> : null}
        </span>
        {t ? <span className={`text-[11px] font-bold ${t.text}`}>{t.label}</span> : null}
      </div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${t ? t.text : "text-white/35"}`}>{fmtVital(s.metric, s.p75)}</div>
      <div className="text-[11px] text-white/50">{info.plain}</div>
      {s.samples ? (
        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/10" title={`${s.goodPct}% good · ${100 - s.goodPct - s.poorPct}% needs work · ${s.poorPct}% poor`}>
          <div className="bg-emerald-400" style={{ width: `${s.goodPct}%` }} />
          <div className="bg-amber-400" style={{ width: `${100 - s.goodPct - s.poorPct}%` }} />
          <div className="bg-rose-400" style={{ width: `${s.poorPct}%` }} />
        </div>
      ) : null}
      <div className="mt-1 text-[10px] text-white/35">
        {s.samples ? `${s.goodPct}% of visits good · ${s.samples.toLocaleString()} measured` : "No measurements yet"} · good ≤ {unit(info.good)}
      </div>
    </div>
  );
}

export function PageSpeedReport({ summary, days, missingTable }: { summary: VitalsSummary; days: number; missingTable: boolean }) {
  if (missingTable) {
    return (
      <div className="rounded-xl border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
        Real page-speed numbers need database update <strong>0280</strong>. Open the Supabase SQL editor, paste the contents of{" "}
        <code className="font-mono">supabase/migrations/0280_website_web_vitals.sql</code>, and run it. Measuring starts right after.
      </div>
    );
  }
  const verdict =
    summary.passes === null
      ? { cls: "border-white/15 text-white/60", text: summary.loads ? "Not enough data for a verdict yet (INP needs visitors who tap or click)." : `No page loads measured in the last ${days} days yet.` }
      : summary.passes
        ? { cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200", text: "✅ Passes Google's Core Web Vitals (LCP, INP and CLS all good for 75% of visits)." }
        : { cls: "border-amber-400/40 bg-amber-400/10 text-amber-200", text: "⚠️ Doesn't pass Google's Core Web Vitals yet — see which number is not green below." };
  const dev = (k: "phone" | "tablet" | "desktop", label: string) => {
    const st = summary.byDevice[k];
    const n = st.find((x) => x.metric === "LCP")!.samples;
    return (
      <tr key={k}>
        <td className="px-3 py-2 font-semibold text-white/80">{label}</td>
        {VITAL_METRICS.map((m) => (
          <td key={m} className="px-3 py-2 text-right">
            <Pill s={st.find((x) => x.metric === m)!} />
          </td>
        ))}
        <td className="px-3 py-2 text-right tabular-nums text-white/45">{n.toLocaleString()}</td>
      </tr>
    );
  };
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border px-4 py-3 text-sm ${verdict.cls}`}>
        {verdict.text}
        <span className="ml-2 text-xs opacity-70">{summary.loads.toLocaleString()} page loads measured.</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {summary.overall.map((s) => (
          <MetricCard key={s.metric} s={s} />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-white/45">
            <tr>
              <th className="px-3 py-2 font-bold">Device</th>
              {VITAL_METRICS.map((m) => (
                <th key={m} className="px-3 py-2 text-right font-bold">
                  {m}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-bold">Loads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {dev("phone", "📱 Phone")}
            {dev("tablet", "Tablet")}
            {dev("desktop", "💻 Computer")}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-white">Slowest parts of the site</h3>
        {summary.pages.length ? (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-3 py-2 font-bold">Pages</th>
                  <th className="px-3 py-2 text-right font-bold">LCP</th>
                  <th className="px-3 py-2 text-right font-bold">INP</th>
                  <th className="px-3 py-2 text-right font-bold">CLS</th>
                  <th className="px-3 py-2 text-right font-bold">Loads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {summary.pages.map((p) => (
                  <tr key={p.path} className={p.lcp.samples < VITALS_MIN_PAGE_SAMPLES ? "opacity-60" : undefined}>
                    <td className="px-3 py-2 font-mono text-xs text-white/80">{p.path === "/" ? "/ (home)" : `${p.path}…`}</td>
                    <td className="px-3 py-2 text-right"><Pill s={p.lcp} /></td>
                    <td className="px-3 py-2 text-right"><Pill s={p.inp} /></td>
                    <td className="px-3 py-2 text-right"><Pill s={p.cls} /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/45">{p.loads.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-white/40">No pages measured yet.</p>
        )}
        <p className="mt-1 text-[11px] text-white/35">Grouped by section (/menu… = every menu and product page). Faded rows have fewer than {VITALS_MIN_PAGE_SAMPLES} loads — too few to judge.</p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-white">Main content load time per day (LCP, seconds, 75th percentile)</h3>
        <DayBarChart data={summary.dailyLcp} showTotal={false} valueFormatter={(v) => (v ? `${v} s` : "no data")} />
      </div>

      <p className="text-xs text-white/40">
        Measured in real shoppers&apos; browsers on real visits (Google&apos;s web-vitals method; each number is what 75% of visits beat, as Google
        scores it). Nobody is identified; staff previews and visitors who ask not to be tracked aren&apos;t measured. Vercel Speed Insights keeps its own copy:{" "}
        <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] underline">
          Vercel dashboard ↗
        </a>{" "}
        → Greenway project → Speed Insights.
      </p>
    </div>
  );
}
