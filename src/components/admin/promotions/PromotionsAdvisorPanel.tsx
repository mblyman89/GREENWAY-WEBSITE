"use client";

/**
 * PromotionsAdvisorPanel (Task R) — on-demand, DRAFTS-ONLY AI briefing for the
 * Promotions command center. Reads aggregate counts only (promotion statuses,
 * conflicts, below-cost audit totals) and returns: what needs attention,
 * what's healthy, margin-smart ideas, and next steps. Advisory only — it never
 * creates, edits, or publishes promotions.
 */
import { useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import {
  generatePromotionsAdviceAction,
  type PromotionsAdvisorResult,
} from "@/app/admin/promotions/actions";
import type { PromotionsAdvice } from "@/lib/promotions/promotions-advisor";

function BulletList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "warn" | "idea" | "action";
}) {
  if (items.length === 0) return null;
  const color =
    tone === "good"
      ? "text-[#7ed957]"
      : tone === "warn"
        ? "text-[#ff6b6b]"
        : tone === "idea"
          ? "text-[#ffd700]"
          : "text-white";
  const dot =
    tone === "good"
      ? "bg-[#7ed957]"
      : tone === "warn"
        ? "bg-[#ff6b6b]"
        : tone === "idea"
          ? "bg-[#ffd700]"
          : "bg-[#8ab4f8]";
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-wide ${color}`}>{title}</div>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-white/80">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PromotionsAdvisorPanel({ aiEnabled }: { aiEnabled: boolean }) {
  const { toast } = useToast();
  const [advice, setAdvice] = useState<PromotionsAdvice | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    setAdvice(null);
    startTransition(async () => {
      const res: PromotionsAdvisorResult = await generatePromotionsAdviceAction(
        question.trim() || undefined,
      );
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setAdvice(res.advice);
      toast({ tone: "success", message: "Promotions advisor ready." });
    });
  }

  return (
    <section className="rounded-2xl border border-[#7ed957]/25 bg-[#7ed957]/[0.04] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <span>✨ Promotions advisor</span>
          </h2>
          <p className="mt-0.5 text-sm text-white/60">
            A plain-language read of your promotions program — below-cost risks, conflicts, weekly
            coverage, and margin-smart ideas. Grounded in the counts on this page (no customer data
            sent). Advisory / drafts only — it never publishes anything.
          </p>
        </div>
        {aiEnabled && (
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#6bc746] disabled:opacity-50"
          >
            {pending ? "Reviewing…" : advice ? "Re-review" : "Ask the advisor"}
          </button>
        )}
      </div>

      {aiEnabled && (
        <div className="mt-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                run();
              }
            }}
            placeholder='Optional question — e.g. "What kind of Friday deal keeps margin above 40%?"'
            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white/85 placeholder:text-white/30 focus:border-[#7ed957]/50 focus:outline-none"
          />
        </div>
      )}

      {!aiEnabled ? (
        <p className="mt-3 text-xs text-[#ffd700]">
          The advisor turns on once an <code className="font-mono">AI_API_KEY</code> is set.
          Everything else on this page works without it.
        </p>
      ) : advice ? (
        <div className="mt-4 space-y-4 rounded-xl border border-white/10 bg-black/40 p-4">
          {advice.headline && <p className="text-sm font-medium text-white/90">{advice.headline}</p>}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <BulletList title="Needs attention" items={advice.attention} tone="warn" />
            <BulletList title="Healthy" items={advice.healthy} tone="good" />
            <BulletList title="Ideas" items={advice.ideas} tone="idea" />
            <BulletList title="Next steps" items={advice.steps} tone="action" />
          </div>
          <p className="text-[0.65rem] text-white/35">
            Generated by {advice.model} from the aggregate counts above. Advisory only — the cost
            floor, publish block, and no-stacking rules baked into the engine are the source of
            truth.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/45">
          Click <span className="font-semibold text-white/70">Ask the advisor</span> for a briefing,
          or ask about a promotion you&apos;re considering.
        </p>
      )}
    </section>
  );
}
