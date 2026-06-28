/**
 * src/components/admin/orders/OrderStatusFlow.tsx
 *
 * A compact horizontal "where is this order" stepper: New → Acknowledged →
 * Preparing → Ready → Completed. Completed steps glow green, the current step
 * pulses, future steps are dimmed. Cancelled / no-show orders show a single
 * red terminal pill instead of the flow.
 *
 * Server component, presentational. Used on order cards (compact) and the
 * order detail page (full).
 */
import type { OrderStatus } from "@/lib/orders/types";

const FLOW: { status: OrderStatus; label: string }[] = [
  { status: "new", label: "New" },
  { status: "acknowledged", label: "Ack" },
  { status: "preparing", label: "Prep" },
  { status: "ready", label: "Ready" },
  { status: "completed", label: "Done" },
];

const FLOW_INDEX: Record<string, number> = Object.fromEntries(FLOW.map((s, i) => [s.status, i]));

export function OrderStatusFlow({
  status,
  size = "sm",
}: {
  status: OrderStatus;
  size?: "sm" | "md";
}) {
  if (status === "cancelled" || status === "no_show") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300">
        ✕ {status === "cancelled" ? "Cancelled" : "No-show"}
      </span>
    );
  }

  const currentIdx = FLOW_INDEX[status] ?? 0;
  const dot = size === "md" ? "h-7 w-7 text-xs" : "h-5 w-5 text-[10px]";
  const labelCls = size === "md" ? "text-[11px]" : "text-[9px]";

  return (
    <div className="flex items-center">
      {FLOW.map((step, i) => {
        const done = i < currentIdx;
        const current = i === currentIdx;
        return (
          <div key={step.status} className="flex items-center">
            <div className="flex flex-col items-center gap-0.5">
              <span
                className={`flex items-center justify-center rounded-full font-bold ${dot} ${
                  done
                    ? "bg-[#7ed957] text-black"
                    : current
                      ? "bg-[#7ed957]/20 text-[#7ed957] ring-2 ring-[#7ed957] animate-pulse"
                      : "bg-white/10 text-white/30"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`${labelCls} ${current ? "font-bold text-[#7ed957]" : done ? "text-white/60" : "text-white/30"}`}>
                {step.label}
              </span>
            </div>
            {i < FLOW.length - 1 && (
              <span className={`mx-1 h-0.5 w-4 sm:w-6 ${i < currentIdx ? "bg-[#7ed957]" : "bg-white/10"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
