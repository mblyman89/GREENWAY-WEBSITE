"use client";

/**
 * InfoHint — a small "?" affordance that reveals contextual help on hover/focus.
 *
 * Use it next to any label or control that isn't self-explanatory. It's a thin
 * wrapper over Tooltip with a consistent circular "?" trigger so help looks the
 * same everywhere in the admin.
 *
 * Usage:
 *   <label>Publish window <InfoHint text="The dates this deal is visible to shoppers." /></label>
 */
import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export function InfoHint({
  text,
  position = "top",
}: {
  text: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip label={text} position={position}>
      <span
        tabIndex={0}
        role="button"
        aria-label="More information"
        className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-white/25 text-[10px] font-bold leading-none text-white/50 transition hover:border-[#7ed957] hover:text-[#7ed957] focus:border-[#7ed957] focus:text-[#7ed957] focus:outline-none"
      >
        ?
      </span>
    </Tooltip>
  );
}
