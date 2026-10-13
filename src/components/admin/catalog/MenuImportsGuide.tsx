/**
 * R50 S10b — the Menu Imports step-by-step migration guide.
 *
 * Pure presentational server component (no hooks, no client directive) so the
 * compliance suite can render it with renderToStaticMarkup. Statuses come from
 * buildMenuImportsGuide (menu-imports-guide-core): a step this page cannot
 * prove is shown as "Check", never "Done".
 *
 * Before the import is live the guide is open (it is the job of the page).
 * After it, the guide sits behind a closed native <details> so day-to-day work
 * (drafts from receiving) stays on top.
 */
import Link from "next/link";
import {
  GUIDE_STATUS_LABEL,
  guideSummary,
  type GuideStatus,
  type GuideStep,
} from "@/lib/pos/menu-imports-guide-core";

const STATUS_CHIP: Record<GuideStatus, string> = {
  done: "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]",
  next: "bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]",
  todo: "bg-white/10 text-white/50",
  check: "bg-[var(--admin-gold)]/15 text-[var(--admin-gold)]",
  blocked: "bg-red-500/15 text-red-300",
};

const STEP_BORDER: Record<GuideStatus, string> = {
  done: "border-white/10",
  next: "border-[var(--admin-orange)]/50 bg-[var(--admin-orange)]/5",
  todo: "border-white/10 opacity-80",
  check: "border-[var(--admin-gold)]/30",
  blocked: "border-red-500/40 bg-red-500/5",
};

export const GUIDE_TITLE = "Cultivera migration: step by step";

function StepList({ steps }: { steps: readonly GuideStep[] }) {
  return (
    <ol className="mt-4 space-y-2" data-testid="menu-imports-guide-steps">
      {steps.map((s) => (
        <li
          key={s.key}
          data-testid={`guide-step-${s.key}`}
          data-status={s.status}
          aria-current={s.status === "next" ? "step" : undefined}
          className={`rounded-lg border px-4 py-3 ${STEP_BORDER[s.status]}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
              {s.status === "done" ? "\u2713" : s.n}
            </span>
            <p className="text-sm font-semibold text-white">{s.title}</p>
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_CHIP[s.status]}`}>
              {GUIDE_STATUS_LABEL[s.status]}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-white/60">{s.body}</p>
          <p className="mt-1 text-xs text-white/40">{s.why}</p>
          {s.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {s.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`admin-focus rounded-[var(--admin-radius-sm)] border px-2.5 py-1 text-xs font-semibold transition ${
                    s.status === "next"
                      ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/20"
                      : "border-white/15 text-white/70 hover:border-[var(--admin-accent)] hover:text-white"
                  }`}
                >
                  {l.label} &rarr;
                </Link>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function MenuImportsGuide({ steps, importLive }: { steps: readonly GuideStep[]; importLive: boolean }) {
  const sum = guideSummary(steps);
  const header = (
    <>
      <span className="text-sm font-semibold text-white">{GUIDE_TITLE}</span>
      <span className="ml-2 text-xs text-white/50" data-testid="menu-imports-guide-progress">
        {sum.done} of {sum.total} done
      </span>
    </>
  );
  return (
    <section
      id="migration-guide"
      data-testid="menu-imports-guide"
      className="rounded-xl border border-[var(--admin-accent)]/30 bg-[#0a0a0a] p-5"
    >
      {importLive ? (
        <details>
          <summary className="admin-focus cursor-pointer">{header}</summary>
          <p className="mt-2 text-xs text-[var(--admin-accent)]" data-testid="menu-imports-guide-headline">{sum.headline}</p>
          <StepList steps={steps} />
        </details>
      ) : (
        <>
          <h2>{header}</h2>
          <p className="mt-2 text-sm text-[var(--admin-orange)]" data-testid="menu-imports-guide-headline">{sum.headline}</p>
          <p className="mt-1 text-xs text-white/40">
            Each step turns green on its own when this page can prove it. A gold &ldquo;Check&rdquo; means open the link to see.
            Nothing here publishes or changes anything by itself.
          </p>
          <StepList steps={steps} />
        </>
      )}
    </section>
  );
}
