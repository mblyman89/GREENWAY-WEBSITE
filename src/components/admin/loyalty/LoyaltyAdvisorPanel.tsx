"use client";

/**
 * LoyaltyAdvisorPanel (Task S-a) — on-demand, DRAFTS-ONLY AI briefing for the
 * loyalty command center. Reads aggregate program metrics only (enrollment,
 * points economy, liability, code usage, member vs guest order values, tier
 * distribution) — never customer PII — and returns: what needs attention,
 * what's healthy, retention ideas, and next steps. Advisory only — it never
 * changes the program.
 */
import { useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import {
  generateLoyaltyAdviceAction,
  type LoyaltyAdvisorResult,
} from "@/app/admin/loyalty/actions";
import type { LoyaltyAdvice } from "@/lib/loyalty/loyalty-advisor";

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

export function LoyaltyAdvisorPanel({ aiEnabled }: { aiEnabled: boolean }) {
  const { toast } = useToast();
  const [advice, setAdvice] = useState<LoyaltyAdvice | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    setAdvice(null);
    startTransition(async () => {
      const res: LoyaltyAdvisorResult = await generateLoyaltyAdviceAction(
        question.trim() || undefined,
      );
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setAdvice(res.advice);
      toast({ tone: "success", message: "Loyalty advisor ready." });
    });
  }

  return (
    <section className="rounded-2xl border border-[#7ed957]/25 bg-[#7ed957]/[0.04] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <span>✨ Customer-behavior advisor</span>
          </h2>
          <p className="mt-0.5 text-sm text-white/60">
            A plain-language read of how members earn, save, and spend their points — engagement,
            liability, member vs guest behavior, and retention ideas. Grounded in the aggregate
            metrics on this page (no customer data sent). Advisory only — it never changes the
            program.
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
            placeholder='Optional question — e.g. "Are members redeeming fast enough, or is liability piling up?"'
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
            Generated by {advice.model} from the aggregate metrics above. Advisory only — the cost
            floor, never-free, and no-stacking rules baked into the register are the source of
            truth.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/45">
          Click <span className="font-semibold text-white/70">Ask the advisor</span> for a customer
          behavior briefing, or ask a question about the program.
        </p>
      )}
    </section>
  );
}
