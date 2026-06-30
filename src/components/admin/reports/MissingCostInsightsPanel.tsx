"use client";

/**
 * MissingCostInsightsPanel — on-demand AI assistant for the COGS "no cost
 * recorded" table (Slice 48). Click "Diagnose" and the server explains, in plain
 * language, why each sold product has $0 COGS and exactly how to fix it inside
 * the back office. Read-only / advisory.
 */
import { useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import {
  generateMissingCostInsightsAction,
  type MissingCostInsightsResult,
} from "@/app/admin/reports/cogs/actions";
import type { MissingCostInsights } from "@/lib/reports/cogs-ai";

export function MissingCostInsightsPanel({
  range,
  aiEnabled,
  count,
}: {
  range: { from: string; to: string };
  aiEnabled: boolean;
  count: number;
}) {
  const { toast } = useToast();
  const [insights, setInsights] = useState<MissingCostInsights | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setInsights(null);
    startTransition(async () => {
      const res: MissingCostInsightsResult = await generateMissingCostInsightsAction({
        from: range.from,
        to: range.to,
      });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setInsights(res.insights);
      toast({ tone: "success", message: "Diagnosis ready." });
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-[#ffd700]/25 bg-[#ffd700]/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span>🔎 AI cost-diagnosis assistant</span>
          </h3>
          <p className="mt-1 text-xs text-white/50">
            {count > 0
              ? `Have the assistant explain why these ${count} product${count === 1 ? "" : "s"} have no recorded cost — and how to fix each one.`
              : "No products are missing cost in this window."}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!aiEnabled || pending || count === 0}
          className="shrink-0 rounded-lg border border-[#ffd700]/40 bg-[#ffd700]/10 px-3.5 py-2 text-xs font-bold text-[#ffd700] transition hover:bg-[#ffd700]/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Diagnosing…" : "Diagnose"}
        </button>
      </div>

      {!aiEnabled ? (
        <p className="mt-3 text-xs text-white/40">
          AI isn&apos;t set up yet. Add an <code className="text-white/60">AI_API_KEY</code> to enable the
          assistant. The reasons in the table above are computed without AI.
        </p>
      ) : null}

      {insights ? (
        <div className="mt-4 space-y-4">
          {insights.summary ? <p className="text-sm text-white/85">{insights.summary}</p> : null}

          {insights.causes.length > 0 ? (
            <div className="space-y-2.5">
              {insights.causes.map((c, i) => (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-sm font-semibold text-white">{c.cause}</div>
                  {c.impact ? <div className="mt-1 text-xs text-white/55">{c.impact}</div> : null}
                  {c.fix ? (
                    <div className="mt-1.5 flex gap-2 text-sm text-[#7ed957]">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7ed957]" />
                      <span>{c.fix}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {insights.steps.length > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-white/70">Next steps</div>
              <ol className="mt-1.5 space-y-1.5">
                {insights.steps.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-white/80">
                    <span className="font-bold text-[#7ed957]">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <p className="text-[11px] text-white/35">
            AI-generated guidance — review before acting. Model: {insights.model}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
