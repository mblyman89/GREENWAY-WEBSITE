import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState, HelpPanel } from "@/components/admin/ux";
import { isAiConfigured } from "@/lib/ai/provider";
import { getAiUsageSummary, getAcceptRateReport, getAiSpendReport } from "@/lib/ai/usage";
import { formatCents, priceRow, PRICES_READ_ON, type SpendBucket } from "@/lib/ai/ai-cost-core";
import { getBudgetStatus } from "@/lib/ai/router";
import { AiTokensTrend, AiFeatureDonut, AiSpendTrend, AiSpendDonut } from "@/components/admin/ai/AiUsageCharts";
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
  const [summary, budget, acceptReport, spendRes] = await Promise.all([
    getAiUsageSummary(30),
    getBudgetStatus(),
    getAcceptRateReport(90),
    getAiSpendReport(30),
  ]);
  const spend = spendRes.report;
  const featureCents = new Map(spend.byFeature.map((f) => [f.key, f.cents]));

  const modeLabel = budget.mode === "sprint" ? "Sprint (filling the database)" : "Maintenance (day-to-day)";
  const pct = budget.usdPct ?? budget.tokenPct;
  const pctLabel = pct === null ? null : `${Math.min(100, Math.round(pct * 100))}%`;

  return (
    <div>
      <AdminPageHeader
        title="AI Usage"
        subtitle="How much AI the back office is using, where, and what it costs — last 30 days"
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
          <div className="mt-4 rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/[0.06] px-4 py-3 text-sm text-[var(--admin-gold)]">
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

        {/* AI-$: dollars spent */}
        <SpendSection spend={spend} complete={spendRes.complete} message={spendRes.message} />

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
                      <th className="py-2 pr-4 text-right font-semibold">Tokens</th>
                      <th className="py-2 text-right font-semibold">Dollars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byFeature.map((f) => (
                      <tr key={f.feature} className="border-b border-white/5">
                        <td className="py-2 pr-4 text-white/80">{featureLabel(f.feature)}</td>
                        <td className="py-2 pr-4 text-right text-white/60">{fmt(f.calls)}</td>
                        <td className="py-2 pr-4 text-right text-white/60">{fmt(f.tokens)}</td>
                        <td className="py-2 text-right font-semibold text-[var(--admin-gold)]">{formatCents(featureCents.get(f.feature) ?? 0)}</td>
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
                      <span className={r.ok ? "text-[var(--admin-accent)]" : "text-red-400"}>{r.ok ? "✓" : "✕"}</span>
                      <span className="font-semibold text-white/80">{featureLabel(r.feature)}</span>
                      {r.actor_email && <span className="text-white/40">· {r.actor_email}</span>}
                    </span>
                    <span className="flex items-center gap-3 text-white/40">
                      <span>{fmt(r.total_tokens)} tok{r.estimated ? "*" : ""}</span>
                      <span className="text-[var(--admin-gold)]">{costLabel(r)}</span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-white/30">* estimated token count · † vendor-reported cost · ? no published price</p>
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

function costLabel(r: Parameters<typeof priceRow>[0]): string {
  const c = priceRow(r);
  if (c.basis === "unpriced") return "?";
  if (c.basis === "free") return "free";
  return `${formatCents(c.cents)}${c.basis === "measured" ? "†" : ""}`;
}

function pctOf(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

function SpendTable({ title, rows, keyLabel, total, label }: { title: string; rows: SpendBucket[]; keyLabel: string; total: number; label?: (k: string) => string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-white/40">Nothing in this window.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                <th className="py-2 pr-3 font-semibold">{keyLabel}</th>
                <th className="py-2 pr-3 text-right font-semibold">Calls</th>
                <th className="py-2 pr-3 text-right font-semibold">Avg / call</th>
                <th className="py-2 pr-3 text-right font-semibold">Share</th>
                <th className="py-2 text-right font-semibold">Dollars</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 25).map((b) => (
                <tr key={b.key} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-white/80">{label ? label(b.key) : b.key}</td>
                  <td className="py-2 pr-3 text-right text-white/60">{fmt(b.calls)}</td>
                  <td className="py-2 pr-3 text-right text-white/60">{formatCents(b.calls ? b.cents / b.calls : 0)}</td>
                  <td className="py-2 pr-3 text-right text-white/60">{pctOf(b.cents, total)}</td>
                  <td className="py-2 text-right font-semibold text-[var(--admin-gold)]">{formatCents(b.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SpendSection({ spend, complete, message }: { spend: Awaited<ReturnType<typeof getAiSpendReport>>["report"]; complete: boolean; message: string | null }) {
  const change = spend.lastMonthCents > 0 ? (spend.projectedMonthCents - spend.lastMonthCents) / spend.lastMonthCents : null;
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-white">💵 Money spent on AI</h2>
      <p className="mt-1 text-xs text-white/50">
        Every AI call in the ledger priced in dollars. Vendor-reported cost is used where the vendor sends one (FLUX credits,
        Gemini overnight batches); everything else is tokens × the vendor&apos;s published price (read {PRICES_READ_ON}). Compare with your
        real invoices at platform.openai.com, aistudio.google.com, dashboard.bfl.ai and cloud.llamaindex.ai.
      </p>
      {!complete && (
        <div className="mt-3 rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
          These dollar figures may be LOW: the usage ledger could not be read completely. {message}
        </div>
      )}
      {spend.unpricedCalls > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/[0.06] px-4 py-3 text-sm text-[var(--admin-gold)]">
          {fmt(spend.unpricedCalls)} call{spend.unpricedCalls === 1 ? "" : "s"} used a model with no published price in our table
          ({spend.unpricedModels.join(", ")}). They are counted as $0 here, so the real total is higher. Add the price to
          src/lib/ai/ai-cost-core.ts.
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Spent (30 days)" value={formatCents(spend.totalCents)} hint={`${formatCents(spend.last7dCents)} in last 7 days · ${formatCents(spend.todayCents)} today`} accent="gold" />
        <StatCard label={`This month (${spend.monthKey})`} value={formatCents(spend.monthToDateCents)} hint={`On pace for ${formatCents(spend.projectedMonthCents)}`} accent="gold" />
        <StatCard label="Last month" value={formatCents(spend.lastMonthCents)} hint={change === null ? "No spend last month" : `This month's pace is ${change >= 0 ? "+" : ""}${Math.round(change * 100)}% vs last month`} accent={change !== null && change > 0.25 ? "orange" : "green"} />
        <StatCard label="Average per call" value={formatCents(spend.avgCentsPerCall)} hint={`${fmt(spend.freeCalls)} free calls (own server or failed)`} accent="muted" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Vendor-reported" value={formatCents(spend.measuredCents)} hint={`${pctOf(spend.measuredCents, spend.totalCents)} of the 30-day total`} accent="green" />
        <StatCard label="At list price" value={formatCents(spend.listPriceCents)} hint="Tokens × published price" accent="muted" />
        <StatCard label="From estimated tokens" value={formatCents(spend.estimatedTokenCents)} hint="Provider sent no token count (~4 chars/token)" accent={spend.estimatedTokenCents > 0 ? "orange" : "green"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <AiSpendTrend byDay={spend.byDay} />
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <AiSpendDonut byProvider={spend.byProvider} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SpendTable title="By provider (30 days)" keyLabel="Provider" rows={spend.byProvider} total={spend.totalCents} />
        <SpendTable title="By model (30 days)" keyLabel="Model" rows={spend.byModel} total={spend.totalCents} />
        <SpendTable title="By feature (30 days)" keyLabel="Feature" rows={spend.byFeature} total={spend.totalCents} label={featureLabel} />
        <SpendTable title="By person (30 days)" keyLabel="Who" rows={spend.byPerson} total={spend.totalCents} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h3 className="text-sm font-semibold text-white">By month (Pacific)</h3>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {spend.byMonth.length === 0 && (
                <tr><td className="py-2 text-xs text-white/40">No spend recorded yet.</td></tr>
              )}
              {spend.byMonth.map((m) => (
                <tr key={m.month} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-white/80">{m.month}{m.month === spend.monthKey ? " (so far)" : ""}</td>
                  <td className="py-2 pr-3 text-right text-white/60">{fmt(m.calls)} calls</td>
                  <td className="py-2 text-right font-semibold text-[var(--admin-gold)]">{formatCents(m.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h3 className="text-sm font-semibold text-white">Most expensive calls (30 days)</h3>
          <div className="mt-3 space-y-1.5">
            {spend.topCalls.length === 0 && <p className="text-xs text-white/40">No paid calls in this window.</p>}
            {spend.topCalls.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/40 px-3 py-1.5 text-xs">
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-white/80">{featureLabel(c.feature)}</span>
                  <span className="text-white/40">· {c.model}</span>
                  {c.actor && <span className="text-white/40">· {c.actor}</span>}
                </span>
                <span className="flex items-center gap-3 text-white/40">
                  <span className="font-semibold text-[var(--admin-gold)]">{formatCents(c.cents)}{c.basis === "measured" ? "†" : ""}</span>
                  <span>{new Date(c.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-white/30">
        Not included: Google Search grounding on live lookups ($14 per 1,000 searches after 5,000 free a month), because live calls
        do not record a search count. LlamaParse is priced at $1.50 per 1,000 credits without subtracting the 10,000 free each month,
        so it is an upper bound. Overnight batch rows are half price.
      </p>
    </section>
  );
}
