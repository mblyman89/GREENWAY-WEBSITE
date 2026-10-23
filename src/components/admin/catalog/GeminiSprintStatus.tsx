/**
 * R74 S21: the Gemini sprint status indicator on Product Onboarding.
 * Server component, zero JS: one coloured line that says whether Gemini
 * sprint is set correctly; open it for each setting and the exact Vercel
 * change (if any). The data comes from sprint-status-core (pure, tested).
 */
import type { SprintStatus, SprintTone } from "@/lib/ai/sprint-status-core";

const DOT: Record<SprintTone, string> = { good: "bg-emerald-400", warn: "bg-[var(--admin-gold)]", bad: "bg-red-400" };
const TEXT: Record<SprintTone, string> = { good: "text-emerald-300", warn: "text-[var(--admin-gold)]", bad: "text-red-300" };
const MARK: Record<SprintTone, string> = { good: "\u2713", warn: "!", bad: "\u2717" };

export function GeminiSprintStatus({ status }: { status: SprintStatus }) {
  return (
    <details
      data-testid="gemini-sprint-status"
      data-tone={status.tone}
      open={status.tone === "bad"}
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
        <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[status.tone]}`} />
        <span className="font-semibold text-[var(--admin-text)]">Gemini sprint:</span>
        <span data-testid="gemini-sprint-headline" className={TEXT[status.tone]}>{status.headline}</span>
        <span className="ml-auto text-xs text-[var(--admin-text-muted)]">Details</span>
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {status.checks.map((c) => (
          <li key={c.id} data-testid={`gemini-sprint-${c.id}`} className="flex gap-2">
            <span aria-hidden className={`w-4 shrink-0 text-center font-bold ${TEXT[c.tone]}`}>{MARK[c.tone]}</span>
            <span>
              <span className="font-semibold text-[var(--admin-text)]">{c.label}.</span>{" "}
              <span className="text-[var(--admin-text-muted)]">{c.detail}</span>
              {c.fix ? <span className={`block ${TEXT[c.tone]}`}>Fix: {c.fix}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
        Read from this deployment&apos;s Vercel settings each time the page opens (keys are never shown). After changing a
        setting in Vercel, redeploy, then reload this page. AI_MODE=sprint sends every heavy AI task to AI_MODEL_HEAVY;
        product lookups always use AI_MODEL_HEAVY.
      </p>
    </details>
  );
}
