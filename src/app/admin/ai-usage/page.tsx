import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState, HelpPanel } from "@/components/admin/ux";
import { isAiConfigured } from "@/lib/ai/provider";
import { getAiUsageSummary, getAcceptRateReport } from "@/lib/ai/usage";
import { getBudgetStatus } from "@/lib/ai/router";
import { AiTokensTrend, AiFeatureDonut } from "@/components/admin/ai/AiUsageCharts";
import { AiAcceptRatePanel } from "@/components/admin/ai/AiAcceptRatePanel";

export const dynamic = "force-dynamic";

const FEATURE_LABELS: Record<string, string> = {
  "product.description": "Product descriptions",
  "product.tags": "Product tags",
  "vendor.profile": "Vendor profiles",
  "brand.profile": "Brand profiles",
  "media.alt_text": "Media alt-text",
  "blog.write": "Blog writing",
  "blog.improve": "Blog improvements",
  "blog.seo": "Blog SEO",
  "content.rewrite": "Content rewrites",
  "seo.meta": "SEO meta",
  "promotion.copy": "Promotion copy",
  "ai.vision": "Image analysis",
  "ai.generate": "Other AI",
};

function featureLabel(f: string) {
  return FEATURE_LABELS[f] ?? f;
}

function fmt(n: number) {
  return n.toLocaleString();
}

export default async function AiUsagePage() {
  await requirePermission("reports.view");
  const [summary, budget, acceptReport] = await Promise.all([
    getAiUsageSummary(30),
    getBudgetStatus(),
    getAcceptRateReport(90),
  ]);

  const modeLabel = budget.mode === "sprint" ? "Sprint (filling the database)" : "Maintenance (day-to-day)";
  const pct = budget.usdPct ?? budget.tokenPct;
  const pctLabel = pct === null ? null : `${Math.min(100, Math.round(pct * 100))}%`;

  return (
    <div>
      <AdminPageHeader
        title="AI Usage"
        subtitle="How much AI the back office is using, and where — last 30 days"
      />

      <div className="px-5 py-6 sm:px-8">
        <HelpPanel id="ai-usage-help" title="What is this?">
          <p>
            Every time someone uses an <strong>✨ AI</strong> button (drafting a product description,
            researching a vendor, writing alt-text, etc.), we log one entry here. This gives you a
            simple, private picture of your AI usage — no third-party analytics.
          </p>
          <p className="mt-2">
            Token counts are <em>estimated</em> unless your AI provider reports exact numbers. Use
            this to spot which features are most valuable and keep an eye on usage.
          </p>
          <p className="mt-2">
            <strong>Two modes.</strong> Set <code className="rounded bg-black/40 px-1">AI_MODE=sprint</code>{" "}
            while you fill the database (uses the strong model for the best-quality drafts), then switch to{" "}
            <code className="rounded bg-black/40 px-1">AI_MODE=maintenance</code> for day-to-day work (uses the
            lighter, cheaper model). New vendors/products still get great drafts in maintenance — just on the
            efficient model.
          </p>
          <p className="mt-2">
            <strong>Hard budget caps.</strong> Set{" "}
            <code className="rounded bg-black/40 px-1">AI_MONTHLY_USD_BUDGET</code> (and the per-1k prices{" "}
            <code className="rounded bg-black/40 px-1">AI_PRICE_PER_1K_PROMPT</code> /{" "}
            <code className="rounded bg-black/40 px-1">AI_PRICE_PER_1K_COMPLETION</code> so the dollar estimate is
            accurate), or <code className="rounded bg-black/40 px-1">AI_MONTHLY_TOKEN_BUDGET</code>. When the cap is
            reached, AI <strong>pauses automatically</strong> until the next month — it can never overspend.
          </p>
        </HelpPanel>

        {!isAiConfigured && (
          <div className="mt-4 rounded-lg border border-[#ffd700]/30 bg-[#ffd700]/[0.06] px-4 py-3 text-sm text-[#ffd700]">
            AI isn&apos;t set up yet. Add an <code className="rounded bg-black/40 px-1">AI_API_KEY</code> to
            start drafting — usage will appear here automatically.
          </div>
        )}

        {/* Operating mode + budget */}
        {isAiConfigured && (
          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">AI mode</p>
              <p className="mt-1 text-base font-semibold text-[var(--admin-text)]">{modeLabel}</p>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                {budget.mode === "sprint"
                  ? "Using the strong model to fill gaps with quality data."
                  : "Using the lighter model to keep costs low."}
              </p>
            </div>
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">This month&apos;s spend</p>
              <p className="mt-1 text-base font-semibold text-[var(--admin-text)]">
                {budget.usdBudget ? `$${budget.monthUsd.toFixed(2)} / $${budget.usdBudget.toFixed(2)}` : `${fmt(budget.monthTokens)} tokens`}
              </p>
              {pctLabel && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                  <div
                    className={`h-full rounded-full ${budget.blocked ? "bg-[var(--admin-danger)]" : (pct ?? 0) > 0.8 ? "bg-[var(--admin-orange)]" : "bg-[var(--admin-accent)]"}`}
                    style={{ width: pctLabel }}
                  />
                </div>
              )}
              {!budget.usdBudget && !budget.tokenBudget && (
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">No monthly cap set.</p>
              )}
            </div>
            <div className={`rounded-[var(--admin-radius-lg)] border p-4 ${budget.blocked ? "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]" : "border-[var(--admin-border)] bg-[var(--admin-surface)]"}`}>
              <p className="text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">Budget status</p>
              <p className={`mt-1 text-base font-semibold ${budget.blocked ? "text-[var(--admin-danger)]" : "text-[var(--admin-accent)]"}`}>
                {budget.blocked ? "Paused — cap reached" : "OK"}
              </p>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                {budget.blocked
                  ? budget.reason
                  : "AI will pause automatically if you hit your monthly cap."}
              </p>
            </div>
          </section>
        )}

        {summary.totalCalls === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon="✨"
              title="No AI usage yet"
              description="Once your team starts using the AI draft buttons across the back office, every call shows up here so you can track it."
            />
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="AI calls (30d)" value={fmt(summary.totalCalls)} hint={`${fmt(summary.last7dCalls)} in last 7 days`} accent="green" />
              <StatCard label="Tokens (30d)" value={fmt(summary.totalTokens)} hint={`${fmt(summary.last7dTokens)} in last 7 days`} accent="gold" />
              <StatCard label="Successful" value={fmt(summary.okCalls)} hint="Completed OK" accent="green" />
              <StatCard label="Errors" value={fmt(summary.errorCalls)} hint={summary.errorCalls > 0 ? "Check provider/key" : "None — healthy"} accent={summary.errorCalls > 0 ? "orange" : "green"} />
            </section>

            {/* Charts */}
            <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
                <AiTokensTrend byDay={summary.byDay} />
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
                <AiFeatureDonut byFeature={summary.byFeature} />
              </div>
            </section>

            {/* By-feature table */}
            <section className="mt-8 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <h2 className="text-sm font-semibold text-white">Usage by feature</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                      <th className="py-2 pr-4 font-semibold">Feature</th>
                      <th className="py-2 pr-4 text-right font-semibold">Calls</th>
                      <th className="py-2 text-right font-semibold">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byFeature.map((f) => (
                      <tr key={f.feature} className="border-b border-white/5">
                        <td className="py-2 pr-4 text-white/80">{featureLabel(f.feature)}</td>
                        <td className="py-2 pr-4 text-right text-white/60">{fmt(f.calls)}</td>
                        <td className="py-2 text-right font-semibold text-[#7ed957]">{fmt(f.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Recent activity */}
            <section className="mt-8 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <h2 className="text-sm font-semibold text-white">Recent AI activity</h2>
              <div className="mt-3 space-y-1.5">
                {summary.recent.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/40 px-3 py-1.5 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span className={r.ok ? "text-[#7ed957]" : "text-red-400"}>{r.ok ? "✓" : "✕"}</span>
                      <span className="font-semibold text-white/80">{featureLabel(r.feature)}</span>
                      {r.actor_email && <span className="text-white/40">· {r.actor_email}</span>}
                    </span>
                    <span className="flex items-center gap-3 text-white/40">
                      <span>{fmt(r.total_tokens)} tok{r.estimated ? "*" : ""}</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-white/30">* estimated token count</p>
            </section>
          </>
        )}

        {/* AI-4 accept-rate report — reads ai_suggestions, so it renders even
            when the usage ledger is empty. */}
        <AiAcceptRatePanel report={acceptReport} days={90} />
      </div>
    </div>
  );
}
