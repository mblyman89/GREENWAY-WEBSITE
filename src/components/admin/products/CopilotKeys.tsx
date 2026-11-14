"use client";

/**
 * CopilotKeys.tsx  (D244 R-5)
 *
 * The Copilot's keyboard: A accept all >= 80%, 1-9 attach a recommended
 * photo, P publish and next, N next, S skip, D draft now, / talk. Each key
 * presses the element with the matching data-copilot-key (a real button, so
 * the same server action and busy state run as for a click). Ignored while
 * typing in a field, and with Ctrl / Cmd / Alt.
 */
import { useEffect } from "react";
import { copilotKeyTarget } from "@/lib/enrichment/copilot-core";

export function CopilotKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
      const target = copilotKeyTarget(e, typing);
      if (!target) return;
      const node = document.querySelector<HTMLElement>(`[data-copilot-key="${target}"]`);
      if (!node) return;
      e.preventDefault();
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        node.focus();
        return;
      }
      if (node instanceof HTMLButtonElement && node.disabled) return;
      node.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
