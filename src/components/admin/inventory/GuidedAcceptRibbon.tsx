/**
 * src/components/admin/inventory/GuidedAcceptRibbon.tsx
 *
 * Slice H15f — the guided-accept status ribbon for the manifest review
 * screen: ① Arrived → ② Verify counts → ③ Accept, with a plain-English
 * "What do I do here?" line and the green "from the manifest" chips showing
 * everything the system already staged from the signed source document.
 *
 * Pure presentation server component — all logic lives in
 * guided-accept-core.ts (tested). Zero client JS.
 */

import {
  guidedProgress,
  whatDoIDoHere,
  GUIDED_STEP_LABELS,
  type ManifestChip,
} from "@/lib/inventory/guided-accept-core";

export function GuidedAcceptRibbon({
  status,
  etaDate,
  chips,
}: {
  status: string;
  etaDate: string | null;
  chips: ManifestChip[];
}) {
  const progress = guidedProgress(status);
  const line = whatDoIDoHere(status, etaDate);

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      {/* ①②③ step rail */}
      <ol className="flex flex-wrap items-center gap-2" aria-label="Intake progress">
        {GUIDED_STEP_LABELS.map((label, i) => {
          const state = progress.steps[i];
          const failed = state === "failed";
          const done = state === "done";
          const current = state === "current";
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[0.75rem] font-black ${
                  failed
                    ? "bg-[var(--admin-danger)]/20 text-[var(--admin-danger)]"
                    : done
                      ? "bg-[var(--admin-accent)] text-black"
                      : current
                        ? "bg-[var(--admin-gold)] text-black"
                        : "bg-white/10 text-white/40"
                }`}
                aria-hidden
              >
                {failed ? "✕" : done ? "✓" : i + 1}
              </span>
              <span
                className={`text-xs font-bold uppercase tracking-[0.1em] ${
                  failed
                    ? "text-[var(--admin-danger)]"
                    : current
                      ? "text-[var(--admin-text)]"
                      : done
                        ? "text-[var(--admin-text-muted)]"
                        : "text-[var(--admin-text-faint)]"
                }`}
              >
                {failed && i === 2 ? "Rejected" : label}
              </span>
              {i < GUIDED_STEP_LABELS.length - 1 && (
                <span
                  className={`h-0.5 w-8 rounded sm:w-14 ${
                    progress.steps[i] === "done" ? "bg-[var(--admin-accent)]" : "bg-white/10"
                  }`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* "What do I do here?" — one plain-English action for this stage */}
      <p className="mt-3 rounded-[var(--admin-radius)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]">
        <span className="mr-1.5 font-bold text-[var(--admin-text-muted)]">What do I do here?</span>
        {line}
      </p>

      {/* Green "from the manifest" chips — what the system staged for you */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            className="text-[10px] font-bold uppercase tracking-wide text-[var(--admin-text-faint)]"
            title="These values were staged straight from the signed transfer document — legally validated for CCRS, no need to re-type or re-verify them."
          >
            ✓ From the manifest:
          </span>
          {chips.map((c) => (
            <span
              key={`${c.label}-${c.value}`}
              className="rounded bg-[var(--admin-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-accent)]"
              title={`${c.label} came from the vendor's transfer document — the system filled it in for you.`}
            >
              {c.label}: {c.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
