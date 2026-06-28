/**
 * src/components/admin/vendors/CompletenessMeter.tsx
 *
 * A small, brand-styled "profile completeness" meter. Server component (no
 * interactivity) so it can be dropped into vendor cards and the vendor/brand
 * editor. Color follows brand status semantics:
 *   complete → green, good → green-ish, started → gold, empty → orange.
 *
 * Two variants:
 *   - compact: a thin bar + "%"" — for list cards.
 *   - full: bar + percent + a checklist of what's done/missing + "next up".
 */
import type { CompletenessResult } from "@/lib/vendors/completeness";

const LEVEL_BAR: Record<CompletenessResult["level"], string> = {
  complete: "bg-[#7ed957]",
  good: "bg-[#7ed957]",
  started: "bg-[#ffd700]",
  empty: "bg-[#ff7f00]",
};

const LEVEL_TEXT: Record<CompletenessResult["level"], string> = {
  complete: "text-[#7ed957]",
  good: "text-[#7ed957]",
  started: "text-[#ffd700]",
  empty: "text-[#ff7f00]",
};

export function CompletenessMeter({
  result,
  variant = "full",
  className = "",
}: {
  result: CompletenessResult;
  variant?: "compact" | "full";
  className?: string;
}) {
  const barColor = LEVEL_BAR[result.level];
  const textColor = LEVEL_TEXT[result.level];

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${result.percent}%` }} />
        </div>
        <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${textColor}`}>{result.percent}%</span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-white/10 bg-[#0a0a0a] p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Profile completeness</h3>
        <span className={`text-sm font-bold tabular-nums ${textColor}`}>{result.percent}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${result.percent}%` }} />
      </div>

      {result.nextUp ? (
        <p className="mt-3 text-xs text-white/60">
          <span className="font-semibold text-white/80">Next up:</span> add the{" "}
          <span className={textColor}>{result.nextUp.label.toLowerCase()}</span>.
        </p>
      ) : (
        <p className="mt-3 text-xs text-[#7ed957]">All set — this profile is complete. 🎉</p>
      )}

      <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {result.items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-xs">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                item.done ? "bg-[#7ed957]/20 text-[#7ed957]" : "bg-white/10 text-white/40"
              }`}
            >
              {item.done ? "✓" : "○"}
            </span>
            <span className={item.done ? "text-white/70" : "text-white/40"}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
