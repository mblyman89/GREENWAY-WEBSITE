"use client";

/**
 * Tooltip — accessible, brand-styled hover/focus tooltip.
 *
 * Wraps any trigger element and shows a small popover on hover OR keyboard
 * focus (so it's reachable without a mouse). Pure CSS positioning, no portal,
 * so it works inside server-rendered admin pages without extra wiring.
 *
 * Usage:
 *   <Tooltip label="This publishes to the live public site.">
 *     <button>Publish</button>
 *   </Tooltip>
 */
import { useId, useState, type ReactNode } from "react";

const POSITION_CLASSES: Record<string, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export function Tooltip({
  label,
  children,
  position = "top",
  maxWidth = 260,
}: {
  label: ReactNode;
  children: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  maxWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          role="tooltip"
          id={id}
          style={{ maxWidth }}
          className={`pointer-events-none absolute z-50 w-max rounded-lg border border-white/15 bg-[#1a1a1a] px-3 py-2 text-xs leading-relaxed text-white/90 shadow-xl shadow-black/50 ${POSITION_CLASSES[position]}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
