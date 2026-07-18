/**
 * src/components/admin/inventory/IntakeChecklistPanel.tsx
 *
 * Slice AO — the intake command-center checklist for the manifest review
 * screen. Renders the six-item "everything this page needs" list computed by
 * intake-checklist-core (tested, pure):
 *
 *   ① Mark received → ② Verify counts & accept products → ③ Verify transport
 *   → ④ Finalize → ⑤ Mark accepted (automatic) → ⑥ Promote to KB (automatic)
 *
 * Each row shows an honest done/todo/auto/blocked state derived from REAL
 * recorded facts (manifest status, per-lot dispositions, transport fields,
 * the kb_writeback audit event), a plain-English hint, and — for human todos
 * — a jump link to the exact section on the page where the work happens.
 * The header carries a progress meter plus the ONE next action.
 *
 * Pure presentation server component — zero client JS, all logic in the core.
 */

import type { IntakeChecklist, IntakeChecklistItem } from "@/lib/inventory/intake-checklist-core";

function stateBadge(state: IntakeChecklistItem["state"]): {
  glyph: string;
  chipClass: string;
  label: string;
} {
  switch (state) {
    case "done":
      return {
        glyph: "✓",
        chipClass: "bg-[var(--admin-accent)] text-black",
        label: "Done",
      };
    case "todo":
      return {
        glyph: "→",
        chipClass: "bg-[var(--admin-gold)] text-black",
        label: "To do",
      };
    case "auto":
      return {
        glyph: "⚙",
        chipClass: "bg-white/10 text-[var(--admin-text-muted)]",
        label: "Automatic",
      };
    case "blocked":
    default:
      return {
        glyph: "•",
        chipClass: "bg-white/5 text-white/30",
        label: "Waiting",
      };
  }
}

export function IntakeChecklistPanel({ checklist }: { checklist: IntakeChecklist }) {
  const pct =
    checklist.total > 0 ? Math.round((checklist.doneCount / checklist.total) * 100) : 0;

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text-muted)]">
          📋 Intake checklist
        </h2>
        <span className="text-xs font-bold text-[var(--admin-text-faint)]">
          {checklist.doneCount} of {checklist.total} done
        </span>
      </div>

      {/* Progress meter */}
      <div
        className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={checklist.doneCount}
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-label="Intake checklist progress"
      >
        <div
          className="h-full rounded-full bg-[var(--admin-accent)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* The ONE next action */}
      {checklist.nextAction ? (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
          <span className="mr-1.5 font-bold">Next:</span>
          {checklist.nextAction.label}
          {checklist.nextAction.anchor && (
            <a href={checklist.nextAction.anchor} className="ml-2 font-semibold underline">
              Jump to it ↓
            </a>
          )}
        </div>
      ) : (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
          ✓ Everything on this manifest is done — nothing left to do here.
        </div>
      )}

      <ul className="space-y-2">
        {checklist.items.map((item) => {
          const badge = stateBadge(item.state);
          const isNext = checklist.nextAction?.id === item.id;
          return (
            <li
              key={item.id}
              className={`flex items-start gap-3 rounded-[var(--admin-radius)] px-3 py-2 ${
                isNext ? "bg-[var(--admin-surface-2)]" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-black ${badge.chipClass}`}
                aria-hidden
              >
                {badge.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm font-bold ${
                      item.state === "done"
                        ? "text-[var(--admin-text-muted)] line-through decoration-[var(--admin-accent)]/50"
                        : item.state === "blocked"
                          ? "text-[var(--admin-text-faint)]"
                          : "text-[var(--admin-text)]"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      item.state === "done"
                        ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                        : item.state === "todo"
                          ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                          : "bg-white/5 text-[var(--admin-text-faint)]"
                    }`}
                  >
                    {badge.label}
                  </span>
                  {item.state === "todo" && item.anchor && (
                    <a
                      href={item.anchor}
                      className="text-[11px] font-semibold text-[var(--admin-accent)] hover:underline"
                    >
                      Jump ↓
                    </a>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{item.hint}</p>
                {item.detail && (
                  <p className="mt-0.5 text-[11px] text-[var(--admin-text-faint)]">{item.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
