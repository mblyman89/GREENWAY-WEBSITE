/**
 * src/components/admin/inventory/ManifestTimeline.tsx  (Run 4 / Slice 18)
 *
 * A Cultivera-style lifecycle timeline for an inbound manifest:
 *   pending → in transit → received → accepted (or rejected)
 * Renders the canonical stages with the current one highlighted, plus the
 * actual recorded events underneath.
 */

type ManifestEvent = { id: string; event_type: string; note: string | null; created_at: string };

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
                      ? "bg-red-500/20 text-red-300"
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

      {/* Event log */}
      {events.length > 0 ? (
        <ul className="space-y-1.5 border-t border-white/5 pt-3 text-xs">
          {events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3">
              <span className="font-bold capitalize text-white/70">{e.event_type.replace(/_/g, " ")}</span>
              <span className="flex-1 truncate text-white/40">{e.note ?? ""}</span>
              <span className="shrink-0 text-white/30">{new Date(e.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
