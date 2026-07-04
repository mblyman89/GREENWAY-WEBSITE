"use client";

/**
 * LeadsAssistantPanel — an on-demand AI second opinion over the discovery
 * pipeline. Click "Analyze my leads" and the server re-reads the same vendor &
 * product leads shown below (plus local competitor market context when a CCRS
 * dataset exists) and returns a grounded briefing: a headline read, per-lead
 * verdicts with a suggested next step, portfolio insights, next actions, and the
 * open questions worth answering before spending money.
 *
 * Read-only / advisory. Powered by gpt-4o via the "heavy" model tier
 * (router-controlled). Soft-disables when no AI key is configured.
 */
import { useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import { analyzeLeadsAction, type LeadsAdviceResult } from "./actions";
import type { LeadsAdvice, LeadAssessment, LeadVerdict } from "@/lib/discovery/leads-ai";

type Props = { aiEnabled: boolean };

const VERDICT_STYLE: Record<LeadVerdict, { label: string; badge: string; dot: string }> = {
  strong: { label: "Strong", badge: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]", dot: "bg-[var(--admin-accent)]" },
  promising: { label: "Promising", badge: "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]", dot: "bg-[var(--admin-gold)]" },
  thin: { label: "Thin", badge: "bg-white/10 text-[var(--admin-text-muted)]", dot: "bg-white/40" },
  risky: { label: "Risky", badge: "bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]", dot: "bg-[var(--admin-danger)]" },
};

function BulletList({ title, items, tone }: { title: string; items: string[]; tone: "good" | "warn" | "action" }) {
  if (!items || items.length === 0) return null;
  const color =
    tone === "good" ? "text-[var(--admin-accent)]" : tone === "warn" ? "text-[var(--admin-gold)]" : "text-[var(--admin-text)]";
  const dot =
    tone === "good" ? "bg-[var(--admin-accent)]" : tone === "warn" ? "bg-[var(--admin-gold)]" : "bg-[#8ab4f8]";
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-wide ${color}`}>{title}</div>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-[var(--admin-text-muted)]">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssessmentCard({ a }: { a: LeadAssessment }) {
  const style = VERDICT_STYLE[a.verdict];
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            {a.kind}
          </span>
          <div className="truncate text-sm font-semibold text-[var(--admin-text)]">{a.name}</div>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
          {style.label}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--admin-text-muted)]">{a.rationale}</p>
      <p className="mt-1.5 flex gap-2 text-sm text-[var(--admin-text)]">
        <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
        <span><span className="font-semibold">Next:</span> {a.suggested_action}</span>
      </p>
      <div className="mt-1.5 text-[0.65rem] text-[var(--admin-text-faint)]">
        confidence {Math.round(a.confidence * 100)}%
      </div>
    </div>
  );
}

export function LeadsAssistantPanel({ aiEnabled }: Props) {
  const { toast } = useToast();
  const [advice, setAdvice] = useState<LeadsAdvice | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setAdvice(null);
    startTransition(async () => {
      const res: LeadsAdviceResult = await analyzeLeadsAction();
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setAdvice(res.advice);
      toast({ tone: "success", message: "Leads analyzed." });
    });
  }

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--admin-accent)]">
            <span aria-hidden>🤖</span> AI leads advisor
          </h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            A grounded second opinion on your pipeline — which vendor &amp; product leads look
            strongest, which are thin or risky, and what to do next. When a CCRS dataset is loaded,
            it also weighs each lead against the local market (what competitors pay, sell, and who
            they buy from). Advisory only — it never changes a lead or places an order.
          </p>
        </div>
        {aiEnabled && (
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Analyzing…" : advice ? "Re-analyze" : "Analyze my leads"}
          </button>
        )}
      </div>

      {!aiEnabled ? (
        <p className="mt-3 text-xs text-[var(--admin-gold)]">
          The advisor turns on once an <code className="font-mono">AI_API_KEY</code> (or{" "}
          <code className="font-mono">OPENAI_API_KEY</code>) is set. The lead tables below work
          without it.
        </p>
      ) : advice ? (
        <div className="mt-4 space-y-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/30 p-4">
          {advice.headline && (
            <p className="text-sm font-medium text-[var(--admin-text)]">{advice.headline}</p>
          )}

          {advice.assessments.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Lead-by-lead
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {advice.assessments.map((a, i) => (
                  <AssessmentCard key={`${a.kind}-${a.name}-${i}`} a={a} />
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <BulletList title="Portfolio insights" items={advice.portfolio_insights} tone="good" />
            <BulletList title="Do next" items={advice.next_actions} tone="action" />
            <BulletList title="Answer before buying" items={advice.open_questions} tone="warn" />
          </div>

          <p className="text-[0.65rem] text-[var(--admin-text-faint)]">
            Generated by {advice.model} from your leads{" "}
            {advice.assessments.length > 0 ? "and, when available, the local CCRS market context" : ""}. No
            customer data sent. Advisory only — every buying decision stays yours.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
          Click <span className="font-semibold text-[var(--admin-text)]">Analyze my leads</span> for
          an instant, grounded read you can act on.
        </p>
      )}
    </section>
  );
}
