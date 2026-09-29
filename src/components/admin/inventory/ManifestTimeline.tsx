/**
 * src/components/admin/inventory/ManifestTimeline.tsx  (Run 4 / Slice 18)
 *
 * A Cultivera-style lifecycle timeline for an inbound manifest:
 *   pending → in transit → received → accepted (or rejected)
 * Renders the canonical stages with the current one highlighted, plus the
 * actual recorded events underneath.
 *
 * S29: events are labelled by the pure `labelForEvent` (no more raw
 * `vendor_bill_refused`), grouped Delivery / Menu / Knowledge base / Books,
 * and the Books group is collapsed by default (the Accounting tab is its home).
 * Notes are never truncated: a long note sits in <details>, wrapped.
 */

import { fmtPacificDateTime } from "@/lib/inventory/manifest-table-core";
import { groupManifestEvents } from "@/lib/inventory/manifest-event-labels-core";

type ManifestEvent = { id: string; event_type: string; note: string | null; created_at: string };

/** Notes longer than this open in <details> instead of being cut off. */
const NOTE_INLINE_MAX = 140;

const STAGES: { key: string; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "in_transit", label: "In transit" },
  { key: "received", label: "Received" },
  { key: "accepted", label: "Accepted" },
];

const STAGE_ORDER: Record<string, number> = {
  pending: 0,
  in_transit: 1,
  received: 2,
  accepted: 3,
  rejected: 3,
};

export function ManifestTimeline({
  status,
  events,
}: {
  status: string;
  events: ManifestEvent[];
}) {
  const currentIdx = STAGE_ORDER[status] ?? 0;
  const rejected = status === "rejected";
  const groups = groupManifestEvents(events);

  return (
    <div className="space-y-4">
      {/* Stage rail */}
      <div className="flex items-center gap-1">
        {STAGES.map((s, i) => {
          const reached = i <= currentIdx && !(rejected && s.key === "accepted");
          const isCurrent = STAGE_ORDER[status] === i && !(rejected && s.key === "accepted");
          const isRejectedFinal = rejected && s.key === "accepted";
          return (
            <div key={s.key} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[0.7rem] font-black ${
                    isRejectedFinal
                      ? "bg-[var(--admin-danger)]/20 text-[var(--admin-danger)]"
                      : reached
                        ? "bg-[var(--admin-accent)] text-black"
                        : "bg-white/10 text-white/40"
                  }`}
                >
                  {isRejectedFinal ? "✕" : reached ? "✓" : i + 1}
                </div>
                <span
                  className={`mt-1 text-[0.6rem] uppercase tracking-[0.1em] ${
                    isCurrent ? "font-black text-white" : "text-white/40"
                  }`}
                >
                  {isRejectedFinal ? "Rejected" : s.label}
                </span>
              </div>
              {i < STAGES.length - 1 ? (
                <div className={`mx-1 h-0.5 flex-1 ${i < currentIdx ? "bg-[var(--admin-accent)]" : "bg-white/10"}`} />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Event log, grouped (S29) */}
      {groups.length > 0 ? (
        <div className="space-y-3 border-t border-white/5 pt-3 text-xs" data-testid="timeline-groups">
          {groups.map((g) => {
            const list = (
              <ul className="space-y-1.5">
                {g.events.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3" data-event-type={e.event_type}>
                    <span
                      className={`shrink-0 font-bold ${e.label.problem ? "text-[var(--admin-gold)]" : "text-white/70"}`}
                    >
                      {e.label.label}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-white/40">
                      {e.note && e.note.length > NOTE_INLINE_MAX ? (
                        <details>
                          <summary className="cursor-pointer">{e.note.slice(0, NOTE_INLINE_MAX)}{"\u2026"}</summary>
                          <span className="whitespace-pre-wrap">{e.note}</span>
                        </details>
                      ) : (
                        (e.note ?? "")
                      )}
                    </span>
                    <span className="shrink-0 text-white/30">{fmtPacificDateTime(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            );
            return g.collapsed ? (
              <details key={g.key} data-group={g.key}>
                <summary className="cursor-pointer text-[0.65rem] font-black uppercase tracking-[0.12em] text-white/50">
                  {g.title} ({g.events.length})
                </summary>
                <div className="mt-1.5">{list}</div>
              </details>
            ) : (
              <div key={g.key} data-group={g.key}>
                <p className="mb-1 text-[0.65rem] font-black uppercase tracking-[0.12em] text-white/50">{g.title}</p>
                {list}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
