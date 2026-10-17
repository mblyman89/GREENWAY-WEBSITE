"use client";

/** R70 - renders print-rules issues grouped by severity (shared by Check + Design tabs). */
import type { Issue, Level } from "@/lib/merch-studio/print-rules-core";

const STYLE: Record<Level, { label: string; cls: string; icon: string }> = {
  blocker: { label: "Blocker", cls: "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10", icon: "\u26d4" },
  warning: { label: "Warning", cls: "border-[var(--admin-gold)]/60 bg-[var(--admin-gold)]/10", icon: "\u26a0\ufe0f" },
  review: { label: "Review", cls: "border-[var(--admin-orange)]/60 bg-[var(--admin-orange)]/10", icon: "\ud83d\udc41\ufe0f" },
  tip: { label: "Pro tip", cls: "border-[var(--admin-accent)]/50 bg-[var(--admin-accent-soft)]", icon: "\ud83d\udca1" },
};

export function IssueList({ issues, onSelect, acknowledged, onAcknowledge }: {
  issues: Issue[];
  onSelect?: (elementId: string) => void;
  acknowledged?: Set<string>;
  onAcknowledge?: (id: string) => void;
}) {
  if (issues.length === 0) return <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3 text-sm text-white/70">{"\u2705"} No issues - this placement is print-ready by every rule the studio knows.</p>;
  return (
    <ul className="space-y-2">
      {issues.map((i, n) => {
        const s = STYLE[i.level];
        const ack = acknowledged?.has(i.id);
        return (
          <li key={`${i.id}-${n}`} className={`rounded-[var(--admin-radius-sm)] border p-2.5 text-sm ${s.cls} ${ack ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-white">{s.icon} <span className="text-[0.68rem] uppercase tracking-wide text-white/60">{s.label}</span> {i.title}</p>
              <div className="flex shrink-0 gap-1">
                {i.elementId && onSelect ? <button type="button" className="rounded border border-white/20 px-1.5 text-[0.68rem] text-white/80 hover:bg-white/10" onClick={() => onSelect(i.elementId!)}>Select</button> : null}
                {i.level === "review" && onAcknowledge ? <button type="button" className="rounded border border-white/20 px-1.5 text-[0.68rem] text-white/80 hover:bg-white/10" onClick={() => onAcknowledge(i.id)}>{ack ? "Acknowledged" : "Acknowledge"}</button> : null}
              </div>
            </div>
            <p className="mt-1 text-white/75"><b className="text-white/90">Why:</b> {i.why}</p>
            <p className="text-white/75"><b className="text-white/90">Fix:</b> {i.fix}</p>
            <p className="mt-0.5 text-[0.66rem] text-white/40">Source: {i.source}</p>
          </li>
        );
      })}
    </ul>
  );
}
