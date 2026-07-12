"use client";

/**
 * HrAdvisorPanel (Task S-b) — on-demand, DRAFTS-ONLY AI helper for the
 * Employee command center. Reads aggregate roster stats only (status counts,
 * missing critical documents, expiring credentials, sick-leave totals) —
 * never SSNs, birth dates, banking, or document contents — and returns: what
 * needs attention, concrete next steps, and standing legal reminders. The
 * owner can also ask a process question ("someone quit today — what do I
 * do?"). Advisory only — it never changes records.
 */
import { useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import {
  generateHrAdviceAction,
  type HrAdvisorResult,
} from "@/app/admin/staffing/employees/[id]/actions";
import type { HrAdvice } from "@/lib/staffing/hr-advisor";

function BulletList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "warn" | "action" | "reminder";
}) {
  if (items.length === 0) return null;
  const color =
    tone === "warn" ? "text-[#ff6b6b]" : tone === "action" ? "text-[#7ed957]" : "text-[#ffd700]";
  const dot = tone === "warn" ? "bg-[#ff6b6b]" : tone === "action" ? "bg-[#7ed957]" : "bg-[#ffd700]";
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

export function HrAdvisorPanel({ aiEnabled }: { aiEnabled: boolean }) {
  const { toast } = useToast();
  const [advice, setAdvice] = useState<HrAdvice | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    setAdvice(null);
    startTransition(async () => {
      const res: HrAdvisorResult = await generateHrAdviceAction(question.trim() || undefined);
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setAdvice(res.advice);
      toast({ tone: "success", message: "HR helper ready." });
    });
  }

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">AI HR helper (drafts only)</h3>
          <p className="mt-0.5 text-xs text-white/50">
            Reads aggregate roster stats only — never SSNs, birth dates, banking, or documents. It
            advises; it never changes records.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!aiEnabled || pending}
          className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {pending ? "Thinking…" : "Run the HR helper"}
        </button>
      </div>

      <div className="mt-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='Optional question, e.g. "Someone quit today — walk me through what to do."'
          className="w-full rounded-lg border border-[var(--admin-border)] bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/30"
          maxLength={400}
          disabled={!aiEnabled || pending}
        />
      </div>

      {!aiEnabled && (
        <p className="mt-3 rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-3 py-2 text-xs text-[var(--admin-gold)]">
          Set AI_API_KEY to enable the HR helper. Everything else on this page works without it.
        </p>
      )}

      {advice && (
        <div className="mt-4 space-y-4 rounded-lg border border-[var(--admin-border)] bg-black/20 p-4">
          <p className="text-sm font-semibold text-white">{advice.headline}</p>
          <BulletList title="Needs attention" items={advice.attention} tone="warn" />
          <BulletList title="Next steps" items={advice.steps} tone="action" />
          <BulletList title="Legal reminders" items={advice.reminders} tone="reminder" />
          <p className="text-[10px] uppercase tracking-wide text-white/30">
            Draft advice from {advice.model} — verify before acting; not legal advice.
          </p>
        </div>
      )}
    </div>
  );
}
