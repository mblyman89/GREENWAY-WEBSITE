"use client";

/**
 * GettingStartedWizard — a guided, multi-step first-run experience for the
 * back office (PR D / slice 7). Unlike the dashboard's compact checklist, this
 * walks the owner through each setup step one at a time with:
 *   - a left progress rail (click any step to jump)
 *   - live "Done / To do / Checking" status pulled from the real database
 *   - plain-language "why this matters" + numbered how-to + a deep-link CTA
 *   - Back / Next navigation that auto-advances to the next unfinished step
 *   - an optional AI setup concierge ("ask me anything about getting set up")
 *
 * It changes nothing on its own — every action is a deep link into the real
 * permission-gated page. Status is computed server-side and passed in.
 */
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import { askSetupAction, type SetupAskResult } from "@/app/admin/getting-started/actions";

type CheckState = "done" | "todo" | "unknown";

export type WizardStep = {
  id: string;
  label: string;
  state: CheckState;
  why: string;
  how: string[];
  time: string;
  ctaLabel?: string;
  ctaHref?: string;
  tip?: string;
};

type Props = {
  steps: WizardStep[];
  completed: number;
  total: number;
  aiEnabled: boolean;
};

function stateBadge(state: CheckState) {
  if (state === "done")
    return (
      <span className="rounded-full border border-[#7ed957]/40 bg-[#7ed957]/10 px-2.5 py-0.5 text-[0.65rem] font-semibold text-[#7ed957]">
        ✓ Done
      </span>
    );
  if (state === "unknown")
    return (
      <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-[0.65rem] font-semibold text-white/40">
        Checking…
      </span>
    );
  return (
    <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2.5 py-0.5 text-[0.65rem] font-semibold text-[#ffd700]">
      To do
    </span>
  );
}

export function GettingStartedWizard({ steps, completed, total, aiEnabled }: Props) {
  const { toast } = useToast();
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = completed >= total && total > 0;

  // Start on the first unfinished step (so the owner lands on what matters).
  const firstUnfinished = useMemo(() => {
    const idx = steps.findIndex((s) => s.state !== "done");
    return idx === -1 ? 0 : idx;
  }, [steps]);

  const [active, setActive] = useState(firstUnfinished);
  const step = steps[active];

  // AI concierge
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; model: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function ask() {
    if (!question.trim()) return;
    setAnswer(null);
    startTransition(async () => {
      const res: SetupAskResult = await askSetupAction(question);
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setAnswer({ text: res.answer, model: res.model });
    });
  }

  function goNext() {
    // Jump to the next not-done step after the current one; else just +1.
    const nextUnfinished = steps.findIndex((s, i) => i > active && s.state !== "done");
    if (nextUnfinished !== -1) setActive(nextUnfinished);
    else setActive((a) => Math.min(a + 1, steps.length - 1));
  }

  return (
    <div className="space-y-6">
      {/* Overall progress */}
      <div className="rounded-xl border border-[#7ed957]/25 bg-[#0a0a0a] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              {allDone ? "You're all set up 🎉" : "Let's get your site live"}
            </h2>
            <p className="mt-0.5 text-sm text-white/60">
              {completed} of {total} steps complete.
              {allDone
                ? " Everything below is green — you can revisit any step anytime."
                : " Follow the steps below in order; this page updates as each finishes."}
            </p>
          </div>
          <span className="text-2xl font-semibold text-[#7ed957]">{pct}%</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#7ed957] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Step rail */}
        <nav className="space-y-2">
          {steps.map((s, i) => {
            const isActive = i === active;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                  isActive
                    ? "border-[#7ed957]/50 bg-[#7ed957]/10"
                    : "border-white/10 bg-[#0a0a0a] hover:bg-white/5"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    s.state === "done"
                      ? "bg-[#7ed957] text-black"
                      : isActive
                        ? "border border-[#7ed957] text-[#7ed957]"
                        : "border border-white/20 text-white/40"
                  }`}
                >
                  {s.state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-medium ${
                    isActive ? "text-white" : "text-white/70"
                  }`}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Active step detail */}
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          {step && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-white/40">
                    Step {active + 1} of {steps.length}
                  </span>
                  {stateBadge(step.state)}
                </div>
                <span className="text-xs text-white/40">{step.time}</span>
              </div>

              <h3 className="mt-2 text-lg font-semibold text-white">{step.label}</h3>
              <p className="mt-1 text-sm text-white/70">{step.why}</p>

              <ol className="mt-4 space-y-2">
                {step.how.map((h, i) => (
                  <li key={i} className="flex gap-3 text-sm text-white/80">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[0.7rem] font-bold text-white/70">
                      {i + 1}
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ol>

              {step.tip && (
                <p className="mt-4 rounded-lg border border-[#ffd700]/25 bg-[#ffd700]/[0.05] px-3 py-2 text-xs text-[#ffd700]">
                  💡 {step.tip}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {step.ctaHref && step.state !== "done" && (
                  <Link
                    href={step.ctaHref}
                    className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#94e570]"
                  >
                    {step.ctaLabel ?? "Do this now"}
                  </Link>
                )}
                {step.state === "done" && step.ctaHref && (
                  <Link
                    href={step.ctaHref}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/10"
                  >
                    Revisit
                  </Link>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActive((a) => Math.max(a - 1, 0))}
                    disabled={active === 0}
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={active >= steps.length - 1}
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* AI concierge */}
      <div className="rounded-xl border border-[#7ed957]/25 bg-[#7ed957]/[0.04] p-5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#7ed957]">✨ Setup concierge</span>
          <span className="text-xs text-white/45">Ask anything about getting set up</span>
        </div>
        {!aiEnabled ? (
          <p className="mt-2 text-xs text-[#ffd700]">
            The AI concierge turns on once an <code className="font-mono">AI_API_KEY</code> is set.
            Until then, the written steps above cover everything.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") ask();
                }}
                placeholder="e.g. What's a migration? How do I invite my manager?"
                className="min-w-[14rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
              <button
                type="button"
                onClick={ask}
                disabled={pending}
                className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#6bc746] disabled:opacity-50"
              >
                {pending ? "Thinking…" : "Ask"}
              </button>
            </div>
            {answer && (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
                <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                  Concierge · {answer.model}
                </div>
                <p className="whitespace-pre-wrap text-sm text-white/90">{answer.text}</p>
                <p className="mt-2 text-[0.65rem] text-white/35">
                  Advisory only — the concierge explains the steps but never changes your settings.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
